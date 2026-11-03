import { MODEL } from './config.js';
import { cachedModel, downloadModel, removeModel, withModelLock } from './model-storage.js';

const $ = id => document.getElementById(id);
const HISTORY_KEY = 'knotgpt-chat-v1';
const INSTRUCTIONS_KEY = 'knotgpt-instructions-v1';
let messages = [];
let instructions = '';
let worker;
let ready = false;
let busy = false;
let loading = false;
let loadController;
let activeMessage;
let activeBody;
let stopTimer;
let installPrompt;
let generationId = 0;
let lastProgressUpdate = 0;
let storageFailed = false;

function notice(text = '') {
  $('chat-notice').textContent = text;
  $('chat-notice').hidden = !text;
}
function modelStatus(text, state = '') {
  $('model-status').textContent = text;
  $('status-dot').className = `status-dot ${state}`;
}
function updateControls() {
  $('send').disabled = !ready || busy || !$('prompt').value.trim();
  $('send').hidden = busy;
  $('stop').hidden = !busy;
  $('new-chat').disabled = busy;
  $('save-settings').disabled = busy;
  $('delete-model').disabled = busy || loading;
  $('show-loader').hidden = ready;
  $('show-loader').textContent = loading ? 'View progress' : 'Load model';
}
function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
  } catch {
    storageFailed = true;
    notice('Chat history could not be saved. You can still chat and export this conversation.');
  }
}
function scrollToBottom() {
  const area = $('chat-scroll');
  area.scrollTop = area.scrollHeight;
}
function nearBottom() {
  const area = $('chat-scroll');
  return area.scrollHeight - area.scrollTop - area.clientHeight < 140;
}
function addMessage(message) {
  $('welcome').hidden = true;
  const article = document.createElement('article');
  article.className = `message ${message.role}`;
  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = message.role === 'user' ? 'You' : 'KnotGPT';
  const body = document.createElement('div');
  body.className = 'message-body';
  body.textContent = message.content;
  article.append(label, body);
  if (message.role === 'assistant') {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(body.textContent);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
      } catch { notice('Copy is unavailable here. Select the response text to copy it.'); }
    });
    actions.append(copy);
    article.append(actions);
  }
  $('messages').append(article);
  return { article, body };
}
function showChat() {
  $('splash').hidden = true;
  $('chat-app').hidden = false;
  scrollToBottom();
}
function showLoader() {
  $('splash').hidden = false;
  $('chat-app').hidden = true;
}
function resizePrompt() {
  $('prompt').style.height = 'auto';
  $('prompt').style.height = `${Math.min($('prompt').scrollHeight, 180)}px`;
  updateControls();
}
function progress(loaded, total) {
  const now = performance.now();
  if (now - lastProgressUpdate < 120 && loaded !== total) return;
  lastProgressUpdate = now;
  const percentage = Math.min(100, loaded / total * 100);
  $('load-progress').value = percentage;
  $('load-status').textContent = `Saving Gemma 4 on this device · ${percentage.toFixed(1)}%`;
  $('load-detail').textContent = `${(loaded / 1e6).toFixed(0)} MB / ${(total / 1e6).toFixed(0)} MB`;
  modelStatus(`Loading Gemma 4 · ${percentage.toFixed(0)}%`, 'busy');
}
function failLoading(error) {
  loading = false;
  ready = false;
  worker?.terminate();
  worker = undefined;
  $('load-progress').hidden = true;
  $('cancel-load').hidden = true;
  $('load-button').hidden = false;
  $('load-button').disabled = false;
  $('load-button').textContent = 'Retry loading';
  $('load-status').textContent = 'The model could not finish loading.';
  $('load-description').textContent = error?.message || String(error);
  $('load-detail').textContent = 'Retry when ready. Existing model files are kept.';
  modelStatus('Gemma 4 · needs attention');
  updateControls();
}
function attachWorker(file) {
  return new Promise((resolve, reject) => {
    worker?.terminate();
    const currentWorker = new Worker(new URL('./inference-worker.js', import.meta.url));
    worker = currentWorker;
    let initialized = false;
    const timeout = setTimeout(() => reject(new Error('Model initialization is taking too long. Retry loading, or close other GPU-heavy tabs.')), 240000);
    currentWorker.addEventListener('error', event => {
      event.preventDefault();
      const error = new Error(event.message || 'The local model worker stopped unexpectedly. Reload the model.');
      if (!initialized) { clearTimeout(timeout); reject(error); }
      else failGeneration(error, true);
    });
    currentWorker.addEventListener('message', ({ data }) => {
      if (currentWorker !== worker) return;
      if (data.type === 'phase') {
        $('load-status').textContent = data.text;
      } else if (data.type === 'ready') {
        initialized = true;
        clearTimeout(timeout);
        resolve();
      } else if (data.type === 'context') {
        if (data.dropped) notice(`${data.dropped} earlier messages are outside the model’s current context. They remain in your saved chat.`);
      } else if (data.type === 'token') {
        if (!busy || !activeBody) return;
        const follow = nearBottom();
        activeMessage.content = data.text;
        activeBody.textContent = data.text;
        if (follow) scrollToBottom();
      } else if (data.type === 'done') {
        finishGeneration(data.text, data.stopped);
      } else if (data.type === 'error') {
        if (data.action === 'load') { clearTimeout(timeout); reject(new Error(data.message)); }
        else failGeneration(new Error(data.message));
      }
    });
    currentWorker.postMessage({ type: 'load', file });
  });
}
async function setupOffline() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })),
        new Promise(resolve => setTimeout(resolve, 2500)),
      ]);
    }
  } catch {
    $('offline-status').textContent = 'Local inference · online launch required';
  }
}
async function startLoading() {
  if (loading || ready) return;
  loading = true;
  $('load-button').hidden = true;
  $('load-progress').hidden = false;
  $('load-progress').removeAttribute('value');
  $('load-description').textContent = 'Gemma 4 loads automatically and stays on this device for next time.';
  $('load-status').textContent = 'Checking this browser…';
  $('load-detail').textContent = '';
  modelStatus('Preparing Gemma 4…', 'busy');
  updateControls();
  try {
    if (!window.isSecureContext || !navigator.gpu) {
      throw new Error('Gemma 4 needs WebGPU. Open this HTTPS site in a current Chrome or Edge browser with graphics acceleration enabled.');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU could not access a GPU on this device. Enable graphics acceleration or try another compatible browser.');
    await setupOffline();
    // Request eviction protection without introducing a confirmation screen.
    await navigator.storage.persist?.().catch(() => false);
    loadController = new AbortController();
    let file;
    await withModelLock(async () => {
      file = await cachedModel();
      if (!file) {
        $('cancel-load').hidden = false;
        file = await downloadModel({ signal: loadController.signal, onProgress: progress });
      }
    });
    $('cancel-load').hidden = true;
    $('load-progress').removeAttribute('value');
    $('load-detail').textContent = 'Model saved · starting local inference';
    await attachWorker(file);
    ready = true;
    loading = false;
    $('load-progress').value = 100;
    $('load-status').textContent = 'All set. Let’s untangle the thread.';
    modelStatus('Gemma 4 E2B · on your device', 'ready');
    updateControls();
    showChat();
  } catch (error) {
    if (error.name === 'AbortError') {
      loading = false;
      $('load-status').textContent = 'Download paused.';
      $('load-detail').textContent = 'Your progress is saved on this device.';
      $('cancel-load').hidden = true;
      $('load-button').hidden = false;
      $('load-button').textContent = 'Resume loading';
      modelStatus('Gemma 4 · download paused');
      updateControls();
    } else failLoading(error);
  }
}
function finishGeneration(text, stopped = false) {
  if (!busy) return;
  clearTimeout(stopTimer);
  if (!text) {
    failGeneration(new Error(stopped ? 'Response stopped. Your message is back in the composer.' : 'No response was produced. Your message is back in the composer.'));
    return;
  }
  activeMessage.content = text;
  activeMessage.stopped = stopped;
  activeBody.textContent = text || (stopped ? 'Response stopped.' : 'No response was produced.');
  busy = false;
  activeMessage = null;
  activeBody = null;
  modelStatus('Gemma 4 E2B · on your device', 'ready');
  saveHistory();
  updateControls();
  if (stopped) notice('Response stopped.');
}
function failGeneration(error, fatal = false) {
  if (busy) {
    clearTimeout(stopTimer);
    const userMessage = messages[messages.length - 2];
    const hasPartial = !!activeMessage?.content;
    if (!hasPartial) {
      activeBody?.closest('article')?.remove();
      messages.pop();
      // Restore the failed request to the composer, rather than leave two user turns.
      messages.pop();
      $('messages').lastElementChild?.remove();
      $('prompt').value = userMessage?.content || '';
      $('welcome').hidden = messages.length > 0;
      resizePrompt();
    }
    busy = false;
    activeMessage = null;
    activeBody = null;
    saveHistory();
  }
  if (fatal) { ready = false; worker?.terminate(); worker = undefined; }
  notice(error.message);
  modelStatus(ready ? 'Gemma 4 E2B · on your device' : 'Gemma 4 · reload needed', ready ? 'ready' : '');
  updateControls();
}
$('composer').addEventListener('submit', event => {
  event.preventDefault();
  const content = $('prompt').value.trim();
  if (!ready || busy || !content) return;
  notice();
  generationId++;
  messages.push({ role: 'user', content });
  addMessage(messages.at(-1));
  const context = messages.map(message => ({ role: message.role, content: message.content }));
  activeMessage = { role: 'assistant', content: '' };
  messages.push(activeMessage);
  activeBody = addMessage(activeMessage).body;
  busy = true;
  $('prompt').value = '';
  resizePrompt();
  scrollToBottom();
  modelStatus('Gemma 4 · thinking…', 'busy');
  worker.postMessage({ type: 'generate', messages: context, instructions });
  saveHistory();
  updateControls();
});
$('stop').addEventListener('click', () => {
  if (!busy) return;
  worker?.postMessage({ type: 'stop' });
  notice('Stopping response…');
  // Prefill cannot be cancelled by the runtime. Terminate if it doesn't yield.
  const current = generationId;
  stopTimer = setTimeout(() => {
    if (!busy || generationId !== current) return;
    worker?.terminate();
    worker = undefined;
    finishGeneration(activeMessage?.content || '', true);
    ready = false;
    modelStatus('Response stopped · reload model to continue');
    notice('Response stopped. Reload the saved model to continue.');
    updateControls();
  }, 1800);
});
$('prompt').addEventListener('input', resizePrompt);
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(pointer:fine)').matches) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});
$('load-button').addEventListener('click', startLoading);
$('cancel-load').addEventListener('click', () => loadController?.abort());
$('enter-chat').addEventListener('click', showChat);
$('show-loader').addEventListener('click', () => { showLoader(); startLoading(); });
$('new-chat').addEventListener('click', () => {
  if (busy || !confirm('Start a new chat? Export this conversation first if you want to keep it.')) return;
  messages = [];
  $('messages').replaceChildren();
  $('welcome').hidden = false;
  notice();
  saveHistory();
  $('prompt').focus();
});
document.querySelectorAll('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; resizePrompt(); $('prompt').focus(); });
});
$('settings-button').addEventListener('click', async () => {
  $('system-instructions').value = instructions;
  $('settings').showModal();
  try {
    const file = await cachedModel();
    const persisted = await navigator.storage.persisted?.();
    $('storage-status').textContent = `${file ? 'Model saved on this device.' : 'Model not fully downloaded.'} ${persisted ? 'Persistent storage is enabled.' : 'The browser may clear cached files if device storage runs low.'}`;
  } catch { $('storage-status').textContent = 'Browser storage status unavailable.'; }
});
$('save-settings').addEventListener('click', () => {
  if (busy) return;
  instructions = $('system-instructions').value;
  try { localStorage.setItem(INSTRUCTIONS_KEY, instructions); }
  catch { notice('Instructions apply to this session, but could not be saved.'); storageFailed = true; }
  $('settings').close();
  if (!storageFailed) notice('Instructions saved. They apply to your next message.');
});
$('export-chat').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'KnotGPT', model: MODEL.name, instructions, messages }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'KnotGPT-chat.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('delete-model').addEventListener('click', async () => {
  if (busy || loading || !confirm('Remove the saved Gemma model from this device? Your chat will stay.')) return;
  worker?.terminate(); worker = undefined; ready = false;
  try {
    await withModelLock(removeModel);
    $('settings').close();
    notice('Saved model removed. Use Load model when you want to chat again.');
  } catch (error) { notice(error.message); }
  modelStatus('Gemma 4 · not loaded');
  updateControls();
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event; $('installButton').hidden = false;
});
$('installButton').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt(); installPrompt = null; $('installButton').hidden = true;
});
window.addEventListener('appinstalled', () => { installPrompt = null; $('installButton').hidden = true; });
window.addEventListener('pagehide', () => { saveHistory(); loadController?.abort(); worker?.terminate(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) { ready = false; loading = false; busy = false; showLoader(); startLoading(); }
});

try {
  const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (Array.isArray(saved)) {
    messages = saved.filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string' && message.content.length > 0);
    // A closed tab may have saved a user turn before an answer arrived.
    if (messages.at(-1)?.role === 'user') $('prompt').value = messages.pop().content;
    messages.forEach(addMessage);
  }
  instructions = localStorage.getItem(INSTRUCTIONS_KEY) || '';
} catch { storageFailed = true; notice('Local chat history is unavailable. This conversation will work for this session.'); }
updateControls();
startLoading();
