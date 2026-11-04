import test from 'node:test';
import assert from 'node:assert/strict';
import { loadChats, saveChats, createChat, CHATS_KEY, LEGACY_KEY } from '../chat-store.js';
const storage = entries => { const map = new Map(entries); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }; };
test('migrates the existing conversation without overwriting its legacy backup', () => {
  const messages = [{role:'user',content:'Hello'}, {role:'assistant',content:'Hi'}];
  const db = storage([[LEGACY_KEY, JSON.stringify(messages)]]);
  const state = loadChats(db); saveChats(db,state);
  assert.deepEqual(state.chats[0].messages,messages);
  assert.equal(state.chats[0].title,'Hello');
  assert.equal(db.getItem(LEGACY_KEY),JSON.stringify(messages));
});
test('multiple indexed chats, active selection and drafts survive a reload', () => {
  const db = storage([]), state = loadChats(db);
  const first = state.chats[0]; first.messages = [{role:'user',content:'One'}, {role:'assistant',content:'First answer'}];
  const second = createChat(); second.draft = 'Unsent idea'; state.chats.push(second); state.activeId = second.id;
  saveChats(db,state);
  const restored = loadChats(db);
  assert.equal(restored.activeId,second.id); assert.equal(restored.chats.length,2);
  assert.equal(restored.chats[0].messages[1].content,'First answer'); assert.equal(restored.chats[1].draft,'Unsent idea');
});
test('interrupted unanswered requests return to their own chat composer', () => {
  const db=storage([]), state=loadChats(db);
  state.chats[0].messages=[{role:'user',content:'Retry me'}, {role:'assistant',content:''}];saveChats(db,state);
  const chat=loadChats(db).chats[0];assert.equal(chat.draft,'Retry me');assert.equal(chat.messages.length,0);
});
test('damaged saved history throws without modifying stored data', () => {
  const db=storage([[CHATS_KEY,'broken JSON']]);assert.throws(()=>loadChats(db));assert.equal(db.getItem(CHATS_KEY),'broken JSON');
});
test('missing active id recovers an existing conversation', () => {
  const db=storage([]), state=loadChats(db);state.activeId='missing';saveChats(db,state);
  assert.equal(loadChats(db).activeId,state.chats[0].id);
});
