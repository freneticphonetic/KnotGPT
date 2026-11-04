import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadAloud, speechChunks } from '../speech.js';
function fixture(voices=[]) {
  const queue=[];let cancels=0;const changes=[],errors=[];
  class Utterance { constructor(text) {this.text=text;} }
  const reader=new ReadAloud({synth:{getVoices:()=>voices,cancel:()=>cancels++,speak:u=>queue.push(u)},Utterance,onChange:id=>changes.push(id),onError:e=>errors.push(e)});
  return {reader,queue,changes,errors,cancels:()=>cancels};
}
test('default reading leaves voice and language selection to the browser',()=>{
  const f=fixture();f.reader.toggle('a','Hello');assert.equal(f.queue[0].voice,undefined);assert.equal(f.queue[0].lang,undefined);
  f.queue[0].onend();assert.equal(f.reader.active,null);
});
test('a saved voice is used, with default then local fallback on failure',()=>{
  const selected={voiceURI:'edge',lang:'en-US'},local={voiceURI:'device',lang:'en-US',localService:true};
  const f=fixture([selected,local]);f.reader.toggle('a','Hello','edge');assert.equal(f.queue[0].voice,selected);
  f.queue[0].onerror({error:'network'});assert.equal(f.queue[1].voice,undefined);
  f.queue[1].onerror({error:'network'});assert.equal(f.queue[2].voice,local);
});
test('repeated tap stops reading and stale events cannot restart it',()=>{
  const f=fixture();f.reader.toggle('a','Long response. '.repeat(40));const old=f.queue[0];f.reader.toggle('a','Again');
  old.onend();assert.equal(f.queue.length,1);assert.equal(f.reader.active,null);
});
test('switching responses cancels the previous utterance',()=>{
  const f=fixture();f.reader.toggle('a','First');f.reader.toggle('b','Second');f.queue[0].onend();
  assert.equal(f.reader.active,'b');assert.equal(f.queue.length,2);assert.equal(f.queue[1].text,'Second');
});
test('long responses advance chunk by chunk without dropping text',()=>{
  const f=fixture(), text='A sentence with several words. '.repeat(80).trim();f.reader.toggle('a',text);
  for(let i=0;i<f.queue.length;i++) f.queue[i].onend();
  assert.equal(f.queue.map(u=>u.text).join(' '),text);assert.equal(f.reader.active,null);
});
test('speech failure resets controls and reports an actionable error',()=>{
  const f=fixture();f.reader.toggle('a','Hello');f.queue[0].onerror({error:'not-allowed'});
  assert.equal(f.reader.active,null);assert.match(f.errors[0],/Settings/);
});
test('unsupported browsers report unavailable speech',()=>{
  let error;const r=new ReadAloud({synth:null,Utterance:null,onError:e=>error=e});r.toggle('a','Hello');assert.match(error,/unavailable/);
});
test('chunk boundaries preserve emoji surrogate pairs',()=>{
  const text='😀'.repeat(300);const chunks=speechChunks(text,221);assert.equal(chunks.join(''),text);
  assert.ok(chunks.every(c=>!/[\uD800-\uDBFF]$/.test(c)));
});
