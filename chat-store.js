export const CHATS_KEY = 'knotgpt-chats-v2';
export const LEGACY_KEY = 'knotgpt-chat-v1';
const validMessages = value => Array.isArray(value) ? value.filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content.length).map(m => ({ role: m.role, content: m.content, ...(m.stopped ? { stopped: true } : {}) })) : [];
export function createChat() {
  return { id: globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`, title: 'New chat', messages: [], draft: '', updatedAt: Date.now() };
}
export function chatTitle(messages) {
  return messages.find(m => m.role === 'user')?.content.replace(/\s+/g, ' ').trim().slice(0, 64) || 'New chat';
}
export function loadChats(storage) {
  const raw = storage.getItem(CHATS_KEY);
  if (raw !== null) {
    const saved = JSON.parse(raw);
    if (saved?.version !== 2 || !Array.isArray(saved.chats)) throw new Error('Saved chats could not be read.');
    const seen = new Set();
    const chats = saved.chats.filter(c => typeof c?.id === 'string' && !seen.has(c.id) && seen.add(c.id)).map(c => ({
      id: c.id, messages: validMessages(c.messages), draft: typeof c.draft === 'string' ? c.draft : '',
      title: typeof c.title === 'string' ? c.title : chatTitle(validMessages(c.messages)),
      updatedAt: Number.isFinite(c.updatedAt) ? c.updatedAt : Date.now(),
    }));
    if (!chats.length) chats.push(createChat());
    for (const chat of chats) {
      if (chat.messages.at(-1)?.role === 'user') chat.draft = chat.messages.pop().content;
    }
    return { version: 2, chats, activeId: chats.some(c => c.id === saved.activeId) ? saved.activeId : chats[0].id };
  }
  const chat = createChat();
  chat.messages = validMessages(JSON.parse(storage.getItem(LEGACY_KEY) || '[]'));
  if (chat.messages.at(-1)?.role === 'user') chat.draft = chat.messages.pop().content;
  chat.title = chatTitle(chat.messages);
  return { version: 2, chats: [chat], activeId: chat.id };
}
export function saveChats(storage, state) {
  // One atomic setItem keeps the active index and its conversations together.
  storage.setItem(CHATS_KEY, JSON.stringify(state));
}
