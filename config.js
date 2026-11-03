// Pin both the model and runtime so cached assets cannot silently change.
export const MODEL = Object.freeze({
  name: 'Gemma 4 E2B',
  revision: 'c658da437244f072bf2f1cabc916b60d66d97663',
  file: 'gemma-4-E2B-it-web.task',
  bytes: 2003697664,
  storageDirectory: 'knotgpt-models-v1',
  storageFile: 'gemma-4-E2B-c658da4.task',
  url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/c658da437244f072bf2f1cabc916b60d66d97663/gemma-4-E2B-it-web.task',
});
export const RUNTIME_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.30';
export const MAX_TOKENS = 2048;
export const OUTPUT_RESERVE = 512;
