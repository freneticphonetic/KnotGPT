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
- Stop generation, start a new chat, copy responses, read a response aloud, and export a conversation as JSON.
- New chat creates an in-app conversation without navigation. A collapsible **Your threads** sidebar indexes saved chats by their first message. Each chat retains its messages and unsent draft; the active chat returns on the next launch. The previous single-chat history migrates automatically, with its legacy copy retained.
- Conversations, optional system instructions, reasoning effort and voice preference are saved in browser `localStorage`. The model uses OPFS, which is appropriate for multi-GB files.
- Optional instructions are editable in Settings and blank by default. The app adds no default personality prompt. Enabling reasoning adds the disclosed reasoning guidance described below.
- Context is bounded to 2,048 total tokens, with 512 tokens reserved for output. When old exchanges no longer fit, they stay visible and saved; an inline notice says how many were omitted from the model's current context.
- Model text is rendered as plain text, not executed as HTML.
- Prompts, responses, and instructions are not sent to an inference server. External requests fetch the static site, model and runtime assets.
- Settings includes model removal and an install button when the browser makes app installation available.

## Read-aloud

The speaker icon beside Copy reads that response; tapping it again stops playback. Selecting another response cancels the previous one. Switching chats or leaving the page also stops speech. Long responses are spoken in consecutive chunks for browser compatibility.

By default, the app leaves voice and language unset so the **current browser/device TTS engine chooses its default**. Settings offers the voices exposed by the browser as optional overrides, and remembers the selection. If a selected voice fails, playback tries the browser default and an available device voice. Voice lists refresh when the browser makes them available. No speech service or API key is added by KnotGPT. An online voice supplied by the browser may send the spoken text to its speech provider; device voices are labeled in the picker.

## Reasoning effort

The composer has **Off / Low / Medium / High**, saved immediately and restored on the next visit. Off preserves standard generation. The other levels insert Gemma 4's documented `<|think|>` control token and the following guidance alongside any user-written system instructions:

| Level | Added guidance |
| --- | --- |
| Low | Keep your reasoning brief and focused before answering. |
| Medium | Reason through the relevant steps before answering. |
| High | Examine the problem carefully, check assumptions and verify your reasoning before answering. |

These are prompt-guided effort levels, not a runtime API for fixed reasoning-token budgets. Thinking shares the existing 2,048-token context with the prompt and answer. Generated thought-channel text is excluded from visible responses and read-aloud; if thinking exhausts the available context without an answer, the app returns the request to the composer with an explanatory message.

## Existing GitHub Pages deployment

The repository remains a **buildless static site served from its root**. The existing `.github/workflows/static.yml` is retained unchanged: pushing these files to `main` triggers deployment as before. No backend, API key, bundler, npm install, or Pages reconfiguration is needed.

The original update bundle and its Git patch are retained in `archive/` for reference: `archive/KnotGPT-update.zip` and `archive/KnotGPT-update.patch`. The patch applies against commit `8200dcd757c57c753dc9bbd16f236c60b03fc679`.

The newer update bundle and standalone patch are retained as `archive/KnotGPT-update-main-5ebccc6.zip` and `archive/KnotGPT-update-main-5ebccc6.patch`. The patch was applied to commit `5ebccc6`.

## Development and verification

```sh
python3 -m http.server 8000
# Open http://localhost:8000 (localhost is a secure context).
npm run check
npm test
```

Checks use only Node's built-in test runner; no dependencies are installed. The 33 tests cover Gemma 4 prompt formatting, thinking controls and streaming boundaries, context limits, chat migration and restoration, speech defaults/fallback/cancellation/chunking, cached loads, partial downloads, resumable range validation, storage failures and cross-tab locking.

The model has successfully initialized and generated a reply on Android in the installed web app. This update also verifies chat switching, draft restoration, persisted reasoning selection and voice settings in browser UI checks. The managed HTTP preview cannot run GPU inference or exercise Android TTS; the new reasoning modes and actual device audio still need an on-device check.

## Pinned assets

- Runtime: `@mediapipe/tasks-genai@0.10.30`.
- Model: `litert-community/gemma-4-E2B-it-litert-lm`, revision `c658da437244f072bf2f1cabc916b60d66d97663`, file `gemma-4-E2B-it-web.task`.
- Model card and license: https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
- Web runtime: https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/web_js
- Gemma 4 format: https://ai.google.dev/gemma/docs/core/prompt-formatting-gemma4

The original `splash.png`, `card.png`, traced SVG paths and entrance animations are retained.
