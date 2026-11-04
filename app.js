import { MODEL } from './config.js';
import { cachedModel, downloadModel, removeModel, withModelLock } from './model-storage.js';

const $ = id => document.getElementById(id);
import { createChat, chatTitle, loadChats, saveChats } from './chat-store.js';
import { normalizeReasoning, REASONING_KEY } from './reasoning.js';
import { ReadAloud, VOICE_KEY } from './speech.js';
let chatState;
let historyReadable = true;
let reasoning = 'off';
let voiceURI = '';
const reader = new ReadAloud({ onChange: updateSpeechButtons, onError: text => notice(text) });
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
  $('sidebar-new-chat').disabled = busy;
  $('reasoning-effort').disabled = busy;
  document.querySelectorAll('[data-chat-id]').forEach(button => { button.disabled = busy; });
  document.querySelectorAll('.read-aloud').forEach(button => { button.disabled = !reader.supported || !button.closest('article').querySelector('.message-body').textContent || busy && button.closest('article').querySelector('.message-body') === activeBody; });
  $('save-settings').disabled = busy;
  $('delete-model').disabled = busy || loading;
  $('show-loader').hidden = ready;
  $('show-loader').textContent = loading ? 'View progress' : 'Load model';
}
function currentChat() { return chatState.chats.find(chat => chat.id === chatState.activeId); }
function saveHistory() {
  if (!chatState || !historyReadable) return;
  const chat = currentChat();
  chat.messages = messages;
  chat.draft = $('prompt').value;
  chat.title = chatTitle(messages);
  chat.updatedAt = Date.now();
  try { saveChats(localStorage, chatState); }
  catch {
    storageFailed = true;
    notice('Chat history could not be saved. You can still chat and export this conversation.');
  }
  renderChats();
}
function renderChats() {
  $('chat-list').replaceChildren();
  for (const chat of [...chatState.chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'saved-chat'; button.dataset.chatId = chat.id;
    button.setAttribute('aria-current', chat.id === chatState.activeId ? 'true' : 'false');
    button.disabled = busy;
    const title = document.createElement('strong'); title.textContent = chat.title;
    const detail = document.createElement('small');
    detail.textContent = `${chat.messages.filter(m => m.role === 'assistant').length} replies · ${new Date(chat.updatedAt).toLocaleDateString()}`;
    button.append(title, detail);
    button.addEventListener('click', () => openChat(chat.id));
    $('chat-list').append(button);
  }
}
function setSidebar(open) {
  $('chat-sidebar').hidden = !open;
  $('chat-sidebar').inert = !open;
  $('sidebar-backdrop').hidden = !open;
  $('history-button').setAttribute('aria-expanded', String(open));
  for (const child of $('chat-app').children) {
    if (!['chat-sidebar', 'sidebar-backdrop'].includes(child.id)) child.inert = open;
  }
  if (open) $('close-sidebar').focus();
  else $('history-button').focus();
}
function openChat(id) {
  if (busy) return;
  saveHistory();
  reader.stop();
  chatState.activeId = id;
  const chat = currentChat();
  messages = chat.messages;
  $('messages').replaceChildren();
  messages.forEach(addMessage);
  $('welcome').hidden = messages.length > 0;
  $('prompt').value = chat.draft;
  notice();
  resizePrompt();
  saveHistory();
  setSidebar(false);
  scrollToBottom();
  $('prompt').focus();
}
function newChat() {
  if (busy) return;
  saveHistory();
  const chat = createChat();
  chatState.chats.push(chat);
  openChat(chat.id);
}
function updateSpeechButtons() {
  document.querySelectorAll('.read-aloud').forEach(button => {
    const speaking = reader.active === button;
    button.innerHTML = speaking ? STOP_ICON : SPEAKER_ICON;
    button.setAttribute('aria-label', speaking ? 'Stop reading' : 'Read response aloud');
    button.title = speaking ? 'Stop reading' : 'Read aloud';
    button.setAttribute('aria-pressed', String(speaking));
  });
}
const SPEAKER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 4 5 9H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></svg>';
function populateVoices() {
  const select = $('tts-voice');
  select.replaceChildren(new Option('Browser / device default', ''));
  for (const voice of reader.voices()) select.add(new Option(`${voice.name} (${voice.lang})${voice.localService ? ' · device' : ' · online'}`, voice.voiceURI));
  if (voiceURI && ![...select.options].some(option => option.value === voiceURI)) select.add(new Option('Saved voice unavailable · using default', voiceURI));
  select.value = voiceURI;
  select.disabled = !reader.supported;
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
    copy.innerHTML = COPY_ICON;
    copy.setAttribute('aria-label', 'Copy response');
    copy.title = 'Copy response';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(body.textContent);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.innerHTML = COPY_ICON; }, 1800);
      } catch { notice('Copy is unavailable here. Select the response text to copy it.'); }
    });
    const speak = document.createElement('button');
    speak.type = 'button'; speak.className = 'read-aloud'; speak.innerHTML = SPEAKER_ICON;
    speak.setAttribute('aria-label', 'Read response aloud'); speak.title = 'Read aloud'; speak.setAttribute('aria-pressed', 'false');
    speak.disabled = !reader.supported || !message.content;
    speak.addEventListener('click', () => reader.toggle(speak, body.textContent, voiceURI));
    actions.append(copy, speak);
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
  worker.postMessage({ type: 'generate', messages: context, instructions, reasoning });
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
$('prompt').addEventListener('input', () => { resizePrompt(); saveHistory(); });
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
$('new-chat').addEventListener('click', newChat);
$('sidebar-new-chat').addEventListener('click', newChat);
$('history-button').addEventListener('click', () => setSidebar($('chat-sidebar').hidden));
$('close-sidebar').addEventListener('click', () => setSidebar(false));
$('sidebar-backdrop').addEventListener('click', () => setSidebar(false));
document.addEventListener('keydown', event => {
  if ($('chat-sidebar').hidden) return;
  if (event.key === 'Escape') setSidebar(false);
  if (event.key === 'Tab') {
    const buttons = [...$('chat-sidebar').querySelectorAll('button:not(:disabled)')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('reasoning-effort').addEventListener('change', () => {
  reasoning = normalizeReasoning($('reasoning-effort').value);
  try { localStorage.setItem(REASONING_KEY, reasoning); }
  catch { notice('Reasoning effort applies now, but could not be saved.'); }
});
$('tts-voice').addEventListener('change', () => {
  voiceURI = $('tts-voice').value;
  reader.stop();
  try { localStorage.setItem(VOICE_KEY, voiceURI); }
  catch { notice('The voice applies now, but could not be saved.'); }
});
reader.synth?.addEventListener('voiceschanged', populateVoices);
document.querySelectorAll('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; resizePrompt(); saveHistory(); $('prompt').focus(); });
});
$('settings-button').addEventListener('click', async () => {
  $('system-instructions').value = instructions;
  populateVoices();
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
  const blob = new Blob([JSON.stringify({ app: 'KnotGPT', model: MODEL.name, title: currentChat().title, reasoning, instructions, messages }, null, 2)], { type: 'application/json' });
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
window.addEventListener('pagehide', () => { saveHistory(); reader.stop(); loadController?.abort(); worker?.terminate(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) { ready = false; loading = false; busy = false; showLoader(); startLoading(); }
});

try {
  chatState = loadChats(localStorage);
} catch {
  historyReadable = false;
  const chat = createChat();
  chatState = { version: 2, chats: [chat], activeId: chat.id };
  notice('Saved chats could not be read. Existing storage has been left intact; export new conversations to keep them.');
}
try {
  instructions = localStorage.getItem(INSTRUCTIONS_KEY) || '';
  reasoning = normalizeReasoning(localStorage.getItem(REASONING_KEY));
  voiceURI = localStorage.getItem(VOICE_KEY) || '';
} catch { notice('Settings cannot be saved in this browser session.'); }
messages = currentChat().messages;
$('prompt').value = currentChat().draft;
messages.forEach(addMessage);
$('reasoning-effort').value = reasoning;
populateVoices();
renderChats();
resizePrompt();
updateControls();
startLoading();
