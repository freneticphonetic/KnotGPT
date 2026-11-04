export const REASONING_KEY = 'knotgpt-reasoning-v1';
export const REASONING_LEVELS = Object.freeze({
  off: '',
  low: 'Keep your reasoning brief and focused before answering.',
  medium: 'Reason through the relevant steps before answering.',
  high: 'Examine the problem carefully, check assumptions and verify your reasoning before answering.',
});
export function normalizeReasoning(value) {
  return Object.hasOwn(REASONING_LEVELS, value) ? value : 'off';
}
export function reasoningSystem(instructions, effort) {
  const level = normalizeReasoning(effort);
  return { thinking: level !== 'off', guidance: REASONING_LEVELS[level], instructions };
}
