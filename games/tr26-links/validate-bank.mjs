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
  assert.doesNotMatch(t.why, /Разобрать с репетитором|\\nКурсы\\n|Всё необходимое для достижения цели/i,t.id+': advertising/footer in explanation');
  const statedAnswer=t.why.match(/(?:^|\\n)Ответ\\s*:\\s*([\\d\\s,;]+)/i)?.[1];
  if(statedAnswer)assert.equal(statedAnswer.replace(/[^\\d]/g,''),t.a.join(''),t.id+': explanation answer disagrees with key');
}
// Regression checks for six wrong keys found in independent contextual answer audit.
for(const [id,expected] of [['R1899',10],['R4115',34],['R4544',5],['R341',21],['R455',8],['R113',21]]){
  assert.deepEqual(Array.from(bank.find(x=>x.id===id).a),[expected],id+': regression in corrected key');
}

// Regression against independently reconstructed Google Docs source assignments.
// Every S-identifier must retain its own numbered passage; previously all 76 were shifted by one task.
const fingerprints=JSON.parse(read('school-source-fingerprints.json'));
const school=bank.filter(t=>t.id.startsWith('S'));
assert.equal(school.length,76,'unexpected Shkolkovo task count');
assert.equal(Object.keys(fingerprints.passages).length,76,'fingerprint fixture incomplete');
function fnv32(x){
  const s=JSON.stringify(x);let h=2166136261;
  for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619)>>>0;
  return h.toString(16).padStart(8,'0');
}
for(const t of school){
  assert.equal(fnv32(t.s),fingerprints.passages[t.id],t.id+': wrong/shifted source passage');
}
const get=id=>bank.find(t=>t.id===id);
assert.equal(get('S150576').s.find(s=>s[0]===16)[1].includes('дом'),true,'S150576: source context must mention the house');
assert.match(get('S150576').s.find(s=>s[0]===17)[1],/^Отчего он такой тихий сейчас\?/,'S150576: personal pronoun on sentence 17');
assert.deepEqual(Array.from(get('S150576').a),[17]);
assert.deepEqual(Array.from(get('R50341').a),[13,15],'R50341 has two valid answers');

// Minimal lexical evidence: every answer requested to contain a personal pronoun
// must actually contain a personal-pronoun form. This alone does not establish anaphoric link.
const personal=/(?:^|[^\p{L}])(?:я|мы|ты|вы|он|она|оно|они|меня|мне|мной|мною|нас|нам|нами|тебя|тебе|тобой|тобою|вас|вам|вами|его|него|ему|нему|ним|им|ей|её|нее|ней|нею|ними|их|них|ими)(?=$|[^\p{L}])/iu;
for(const t of bank){
  if(!/личн\w*\s+местоимен/i.test(t.prompt))continue;
  for(const n of t.a){
    const sentence=t.s.find(x=>x[0]===n)?.[1]||'';
    assert.match(sentence,personal,t.id+': key '+n+' has no personal pronoun');
  }
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
