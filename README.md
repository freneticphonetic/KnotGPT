# KnotGPT

**Untangle the thread.** A static, browser-local Gemma 4 chat app with the original animated purple knot splash.

## Opening the app

On a WebGPU-capable browser, opening the site automatically starts downloading **Gemma 4 E2B's web `.task` model**. The splash displays actual transferred bytes and percentage, then an indeterminate initialization stage. Chat opens when the engine is ready. There is no first-run download button or account requirement.

- First setup downloads **2,003,697,664 bytes (~2.00 GB)** from Hugging Face, plus the pinned MediaPipe runtime from jsDelivr.
- Model bytes stream directly to the browser's **Origin Private File System (OPFS)**, rather than accumulating a multi-GB JavaScript download buffer. Completed files are reused; interrupted transfers resume using HTTP ranges when the host supports them.
- The app requests persistent browser storage. Browsers can still restrict storage or evict data if persistence is not granted.
- The service worker caches the app shell and runtime files as they are used, allowing subsequent offline launches after a successful first setup.
- Chrome or Edge with WebGPU, graphics acceleration, a compatible GPU and enough storage/RAM is required. HTTPS is required in production; GitHub Pages provides it.

## Chat

- Streaming local responses; inference and initialization run in a worker.
- Stop generation, start a new chat, copy responses, and export a conversation as JSON.
- The current conversation and optional system instructions are saved in browser `localStorage`. The model uses OPFS, which is appropriate for multi-GB files.
- Optional instructions are editable in Settings and blank by default. The app supplies only the Gemma 4 conversation template; it adds no default personality prompt.
- Context is bounded to 2,048 total tokens, with 512 tokens reserved for output. When old exchanges no longer fit, they stay visible and saved; an inline notice says how many were omitted from the model's current context.
- Model text is rendered as plain text, not executed as HTML.
- Prompts, responses, and instructions are not sent to an inference server. External requests fetch the static site, model and runtime assets.
- Settings includes model removal and an install button when the browser makes app installation available.

## Existing GitHub Pages deployment

The repository remains a **buildless static site served from its root**. The existing `.github/workflows/static.yml` is retained unchanged: pushing these files to `main` triggers deployment as before. No backend, API key, bundler, npm install, or Pages reconfiguration is needed.

To apply the supplied update archive through GitHub's website:

1. Extract the archive.
2. Open this repository's **Add file → Upload files** page.
3. Upload the extracted files/folders to the repository root, replacing matching files, and commit to `main`.
4. The existing Pages workflow deploys the update.

For a local Git checkout, copy the archive contents into the root, review `git diff`, and commit/push to `main`. A `KnotGPT-update.patch` is also provided for `git apply` against commit `8200dcd757c57c753dc9bbd16f236c60b03fc679`.

## Development and verification

```sh
python3 -m http.server 8000
# Open http://localhost:8000 (localhost is a secure context).
npm run check
npm test
```

Checks use only Node's built-in test runner; no dependencies are installed. Tests cover Gemma 4 prompt formatting, context limits, cached loads, partial downloads, resumable range validation, storage failures and cross-tab locking.

Visual checks cover the splash, chat screen, starter prompts, settings and unavailable-WebGPU state. Full model initialization, generation performance and offline GPU execution need a compatible HTTPS/localhost browser; the managed HTTP preview does not expose those capabilities.

## Pinned assets

- Runtime: `@mediapipe/tasks-genai@0.10.30`.
- Model: `litert-community/gemma-4-E2B-it-litert-lm`, revision `c658da437244f072bf2f1cabc916b60d66d97663`, file `gemma-4-E2B-it-web.task`.
- Model card and license: https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
- Web runtime: https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/web_js
- Gemma 4 format: https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4

The original `splash.png`, `card.png`, traced SVG paths and entrance animations are retained.
