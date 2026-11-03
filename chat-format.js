// Gemma 4's documented template. There are no added personality instructions.
export function formatPrompt(messages, instructions = '') {
  let prompt = instructions ? `<|turn>system\n${escapeTokens(instructions)}<turn|>\n` : '';
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    prompt += `<|turn>${role}\n${escapeTokens(message.content)}<turn|>\n`;
  }
  return `${prompt}<|turn>model\n`;
}

// Reserved template markers in user content must stay text rather than create roles.
export function escapeTokens(text) {
  return String(text).replace(/<\|/g, '<\u200b|').replace(/<turn\|>/g, '<turn\u200b|>');
}

export function fitContext(messages, instructions, countTokens, budget) {
  const context = messages.slice();
  let dropped = 0;
  while (true) {
    const prompt = formatPrompt(context, instructions);
    const tokens = countTokens(prompt);
    if (!Number.isFinite(tokens)) throw new Error('The model could not measure the conversation length. Reload the model.');
    if (tokens <= budget) return { prompt, dropped, tokens };
    if (context.length <= 1) throw new Error('This message and your instructions are too long for the current context. Shorten either one and try again.');
    // Remove complete oldest turns; never begin with an orphaned model response.
    context.shift();
    dropped++;
    while (context.length > 1 && context[0].role === 'assistant') {
      context.shift();
      dropped++;
    }
  }
}

export function cleanResponse(text) {
  return text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
    .replace(/<\|channel>thought[\s\S]*$/g, '')
    .replace(/<turn\|>|<\|turn>model\n?/g, '').trim();
}
