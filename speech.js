export const VOICE_KEY = 'knotgpt-voice-v1';
export function speechChunks(text, limit = 220) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length) {
    if (rest.length <= limit) { chunks.push(rest); break; }
    const window = rest.slice(0, limit);
    const sentence = [...window.matchAll(/[.!?。！？](?:\s|$)/gu)].at(-1);
    let end = sentence ? sentence.index + sentence[0].length : window.lastIndexOf(' ');
    if (end < limit / 3) end = limit;
    // Do not split a UTF-16 surrogate pair.
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
  }
  return chunks;
}
export class ReadAloud {
  constructor({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, onChange = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { synth, Utterance, onChange, onError });
    this.serial = 0;
    this.active = null;
  }
  get supported() { return !!this.synth && !!this.Utterance; }
  voices() { return this.synth?.getVoices() || []; }
  stop() {
    this.serial++;
    this.active = null;
    this.utterance = null;
    this.synth?.cancel();
    this.onChange(null);
  }
  toggle(id, text, voiceURI = '') {
    const wasActive = this.active === id;
    this.stop();
    if (wasActive) return;
    if (!this.supported) { this.onError('Read-aloud is unavailable in this browser.'); return; }
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    const serial = this.serial;
    this.active = id;
    this.onChange(id);
    const selected = this.voices().find(v => v.voiceURI === voiceURI);
    const local = this.voices().find(v => v.localService && v.lang === (selected?.lang || globalThis.navigator?.language)) || this.voices().find(v => v.localService);
    const candidates = [...new Set([selected, undefined, local])];
    let index = 0;
    const speak = (attempt = 0) => {
      if (serial !== this.serial) return;
      const utterance = new this.Utterance(chunks[index]);
      const voice = candidates[attempt];
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      // With no explicit voice/lang, let the current browser/device choose its default.
      this.utterance = utterance;
      utterance.onend = () => {
        if (serial !== this.serial) return;
        if (++index < chunks.length) speak();
        else { this.active = null; this.utterance = null; this.onChange(null); }
      };
      utterance.onerror = event => {
        if (serial !== this.serial) return;
        if (attempt + 1 < candidates.length) { speak(attempt + 1); return; }
        this.stop();
        this.onError(`Read-aloud could not start (${event.error || 'voice unavailable'}). Try another voice in Settings.`);
      };
      try { this.synth.speak(utterance); }
      catch (error) { utterance.onerror({ error: error.message }); }
    };
    speak();
  }
}
