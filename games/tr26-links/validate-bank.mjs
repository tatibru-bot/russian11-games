import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = name => fs.readFileSync(new URL('./' + name, import.meta.url),'utf8');
const ctx={window:{}};vm.runInNewContext(read('data.js'),ctx);
const bank=ctx.window.TR26_TASKS;
assert.ok(Array.isArray(bank),'bank missing');
assert.equal(bank.length,342,'unexpected task count');
assert.equal(new Set(bank.map(x=>x.id)).size,bank.length,'duplicate ID');
const flags = /Разобрать с репетитором|Контент к задаче:|Предыдущий раздел|Следующий раздел|©2026/;
for(const t of bank) {
  assert.match(t.id,/^[RS]\d+$/);
  assert.ok(t.prompt.includes('предложени'),'prompt missing');
  assert.ok(t.hi>=t.lo,'range reversed');
  assert.equal(t.s.length,t.hi-t.lo+1, t.id+': unexpected sentence count');
  assert.ok(t.a.length>0,t.id+': empty answer');
  for(let i=0;i<t.s.length;i++){
    const [n,value]=t.s[i];
    assert.equal(n,t.lo+i,t.id+': gap/duplicate sentence');
    assert.ok(typeof value==='string'&&value.length>=2,t.id+': damaged sentence '+n);
    assert.doesNotMatch(value,flags,t.id+': source footer in passage');
  }
  for(const n of t.a)assert.ok(n>t.lo&&n<=t.hi,t.id+': answer outside extract');
  assert.ok(typeof t.why==='string'&&t.why.length>=4,t.id+': no explanation');
}
// Regression checks for six wrong keys found in independent contextual answer audit.
for(const [id,expected] of [['R1899',10],['R4115',34],['R4544',5],['R341',21],['R455',8],['R113',21]]){
  assert.deepEqual(Array.from(bank.find(x=>x.id===id).a),[expected],id+': regression in corrected key');
}
vm.runInNewContext(read('reference.js'),ctx);
assert.ok(ctx.window.TR26_REFERENCE.includes('Лексический повтор'));
assert.ok(ctx.window.TR26_REFERENCE.includes('Притяжательные местоимения'));
const page=read('index.html');
const match=page.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
assert.ok(match,'app script missing');
new vm.Script(match[1]);
for(const needle of ['100dvh','CloudStorage','"game_result"','gameId:"TR26"','"error"','"ok"','Мои ошибки','Справочник'])
 assert.ok(page.includes(needle),'missing feature '+needle);
console.log('EGE26 QA PASSED: '+bank.length+' cards, exact numbered ranges, answers, JS syntax, reference and UI feature hooks.');
