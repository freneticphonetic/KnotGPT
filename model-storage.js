import { MODEL } from './config.js';

async function directory() {
  if (!navigator.storage?.getDirectory) {
    throw new Error('This browser cannot save the model on this device. Open KnotGPT in a current Chrome or Edge browser.');
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MODEL.storageDirectory, { create: true });
}

export async function cachedModel() {
  try {
    const dir = await directory();
    const handle = await dir.getFileHandle(MODEL.storageFile);
    const file = await handle.getFile();
    return file.size === MODEL.bytes ? file : null;
  } catch (error) {
    if (error.name === 'NotFoundError') return null;
    throw error;
  }
}

export async function removeModel() {
  const dir = await directory();
  try { await dir.removeEntry(MODEL.storageFile); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
}

// Range requests resume interrupted downloads without retaining a multi-GB buffer.
export async function downloadModel({ signal, onProgress = () => {} } = {}) {
  const dir = await directory();
  const handle = await dir.getFileHandle(MODEL.storageFile, { create: true });
  let offset = (await handle.getFile()).size;
  if (offset === MODEL.bytes) return handle.getFile();
  if (offset > MODEL.bytes) offset = 0;
  const estimate = await navigator.storage.estimate?.();
  if (estimate?.quota && estimate.quota - estimate.usage < MODEL.bytes - offset + 64 * 1024 * 1024) {
    throw new Error('There is not enough browser storage for the 2.00 GB model. Free some device storage, then retry.');
  }
  const response = await fetch(MODEL.url, {
    signal,
    headers: offset ? { Range: `bytes=${offset}-` } : {},
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`The model download returned HTTP ${response.status}. Please retry when the connection is available.`);
  if (!response.body) throw new Error('This browser could not stream the model download.');
  if (offset && response.status !== 206) offset = 0;
  if (response.status === 206) {
    const range = response.headers.get('Content-Range');
    if (!range || !range.startsWith(`bytes ${offset}-`) || !range.endsWith(`/${MODEL.bytes}`)) {
      await response.body.cancel();
      throw new Error('The model host returned an unexpected download range. Retry loading.');
    }
  }
  const length = Number(response.headers.get('Content-Length'));
  if (length && length !== MODEL.bytes - offset) {
    await response.body.cancel();
    throw new Error('The model file size has changed. This version of KnotGPT needs its pinned Gemma 4 web model.');
  }
  const writer = await handle.createWritable({ keepExistingData: offset > 0 });
  const reader = response.body.getReader();
  let loaded = offset;
  try {
    if (offset) await writer.seek(offset);
    onProgress(loaded, MODEL.bytes);
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (loaded + value.byteLength > MODEL.bytes) throw new Error('The downloaded model is larger than expected.');
      await writer.write(value);
      loaded += value.byteLength;
      onProgress(loaded, MODEL.bytes);
    }
    if (loaded !== MODEL.bytes) throw new Error('The download was interrupted. Retry to resume from the saved position.');
    await writer.close();
  } catch (error) {
    // Commit bytes already received, so a paused or failed transfer can resume.
    await reader.cancel().catch(() => {});
    await writer.close().catch(() => {});
    if (error.name === 'QuotaExceededError') throw new Error('Browser storage filled up. Free some device storage and retry.');
    throw error;
  } finally {
    reader.releaseLock();
  }
  return handle.getFile();
}

export async function withModelLock(action) {
  if (navigator.locks?.request) {
    return navigator.locks.request('knotgpt-model', { mode: 'exclusive' }, action);
  }
  return action();
}
