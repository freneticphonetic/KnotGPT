// Classic worker: MediaPipe's WASM loader can use importScripts here.
// Running initialization and inference here keeps the splash and chat responsive.
let engine;
let busy = false;
let stopRequested = false;

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'stop') {
    stopRequested = true;
    engine?.cancelProcessing();
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const { RUNTIME_ROOT, MAX_TOKENS, OUTPUT_RESERVE } = await import('./config.js');
    if (data.type === 'load') {
      self.postMessage({ type: 'phase', text: 'Starting the local engine…' });
      const { FilesetResolver, LlmInference } = await import(`${RUNTIME_ROOT}/genai_bundle.mjs`);
      const fileset = await FilesetResolver.forGenAiTasks(`${RUNTIME_ROOT}/wasm`);
      self.postMessage({ type: 'phase', text: 'Loading Gemma into your GPU…' });
      engine = await LlmInference.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: data.file.stream().getReader() },
        maxTokens: MAX_TOKENS,
        topK: 40,
        temperature: 0.7,
        randomSeed: 42,
      });
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'generate') {
      if (!engine) throw new Error('Load the model before sending a message.');
      stopRequested = false;
      const { fitContext, cleanResponse } = await import('./chat-format.js');
      const context = fitContext(data.messages, data.instructions,
        prompt => engine.sizeInTokens(prompt), MAX_TOKENS - OUTPUT_RESERVE, data.reasoning);
      self.postMessage({ type: 'context', dropped: context.dropped });
      let raw = '';
      const final = await engine.generateResponse(context.prompt, chunk => {
        raw += chunk;
        self.postMessage({ type: 'token', text: cleanResponse(raw) });
      });
      const answer = cleanResponse(final || raw);
      if (!answer && raw.includes('<|channel>thought') && !stopRequested) throw new Error('Thinking used the available context before an answer was produced. Try a lower effort or a shorter message.');
      self.postMessage({ type: 'done', text: answer, stopped: stopRequested });
    }
  } catch (error) {
    self.postMessage({ type: 'error', action: data.type, message: error?.message || String(error) });
  } finally {
    busy = false;
  }
});
