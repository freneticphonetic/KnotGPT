import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL } from '../config.js';
import { cachedModel, downloadModel, removeModel, withModelLock } from '../model-storage.js';

function setup(initialSize = 0) {
  let size = initialSize;
  let position = 0;
  let closed = false;
  const handle = {
    getFile: async () => ({ size }),
    createWritable: async ({ keepExistingData }) => {
      if (!keepExistingData) size = 0;
      position = 0;
      return {
        seek: async value => { position = value; },
        write: async chunk => { position += chunk.byteLength; size = Math.max(size, position); },
        close: async () => { closed = true; },
      };
    },
  };
  const dir = { getFileHandle: async () => handle, removeEntry: async () => { size = 0; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    storage: { getDirectory: async () => ({ getDirectoryHandle: async () => dir }), estimate: async () => ({ quota: MODEL.bytes * 4, usage: initialSize }) },
    locks: { request: async (name, options, action) => action() },
  } });
  return { size: () => size, closed: () => closed };
}
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test('a complete pinned model is reused without a network request', async () => {
  setup(MODEL.bytes);
  globalThis.fetch = () => { throw new Error('must not fetch'); };
  assert.equal((await cachedModel()).size, MODEL.bytes);
  assert.equal((await downloadModel()).size, MODEL.bytes);
});
test('a partial model is not considered ready', async () => {
  setup(30);
  assert.equal(await cachedModel(), null);
});
test('resumes an interrupted download at the saved byte position', async () => {
  const state = setup(MODEL.bytes - 4);
  let requestHeaders;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, MODEL.url);
    requestHeaders = options.headers;
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'Content-Length': '4', 'Content-Range': `bytes ${MODEL.bytes - 4}-${MODEL.bytes - 1}/${MODEL.bytes}` } });
  };
  const progress = [];
  const file = await downloadModel({ onProgress: n => progress.push(n) });
  assert.equal(requestHeaders.Range, `bytes=${MODEL.bytes - 4}-`);
  assert.equal(file.size, MODEL.bytes);
  assert.equal(progress.at(-1), MODEL.bytes);
  assert.equal(state.closed(), true);
});
test('rejects an incorrect resume range before writing', async () => {
  const state = setup(MODEL.bytes - 4);
  globalThis.fetch = async () => new Response(new Uint8Array(4), { status: 206, headers: { 'Content-Range': `bytes 0-3/${MODEL.bytes}` } });
  await assert.rejects(downloadModel(), /unexpected download range/);
  assert.equal(state.size(), MODEL.bytes - 4);
});
test('a disconnected transfer commits partial bytes for the next attempt', async () => {
  const state = setup(MODEL.bytes - 8);
  let reads = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (!reads++) controller.enqueue(new Uint8Array(4));
    else controller.error(new Error('connection lost'));
  } });
  globalThis.fetch = async () => new Response(stream, { status: 206, headers: { 'Content-Range': `bytes ${MODEL.bytes - 8}-${MODEL.bytes - 1}/${MODEL.bytes}` } });
  await assert.rejects(downloadModel(), /connection lost/);
  assert.equal(state.size(), MODEL.bytes - 4);
  assert.equal(state.closed(), true);
});
test('a truncated response stays partial and can be resumed', async () => {
  const state = setup(MODEL.bytes - 8);
  globalThis.fetch = async () => new Response(new Uint8Array(4), { status: 206, headers: { 'Content-Range': `bytes ${MODEL.bytes - 8}-${MODEL.bytes - 1}/${MODEL.bytes}` } });
  await assert.rejects(downloadModel(), /interrupted/);
  assert.equal(state.size(), MODEL.bytes - 4);
  assert.equal(await cachedModel(), null);
});
test('HTTP failures do not overwrite already saved bytes', async () => {
  const state = setup(50);
  globalThis.fetch = async () => new Response('failed', { status: 503 });
  await assert.rejects(downloadModel(), /HTTP 503/);
  assert.equal(state.size(), 50);
});
test('insufficient quota fails before the model fetch', async () => {
  setup();
  navigator.storage.estimate = async () => ({ quota: 100, usage: 0 });
  globalThis.fetch = () => { throw new Error('must not fetch'); };
  await assert.rejects(downloadModel(), /not enough browser storage/);
});
test('cross-tab lock covers model mutation', async () => {
  setup();
  let lockName;
  navigator.locks.request = async (name, options, action) => { lockName = name; assert.equal(options.mode, 'exclusive'); return action(); };
  assert.equal(await withModelLock(async () => 42), 42);
  assert.equal(lockName, 'knotgpt-model');
});
test('removing a model leaves it unavailable for later loads', async () => {
  setup(MODEL.bytes);
  await removeModel();
  assert.equal(await cachedModel(), null);
});
