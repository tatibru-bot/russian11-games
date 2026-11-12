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

// Necessary lexical evidence for all answer sentences with the named grammatical marker.
// This detects impossible keys, not all possible semantic mistakes of antecedent reference.
const person=/(?:^|[^\p{L}])(?:я|мы|ты|вы|он|она|оно|они|меня|мне|мной|мною|нас|нам|нами|тебя|тебе|тобой|тобою|вас|вам|вами|его|него|ему|нему|ним|им|ей|её|ее|нее|ней|нею|ними|их|них|ими)(?=$|[^\p{L}])/iu;
const possessive=/(?:^|[^\p{L}])(?:мой|моя|моё|мои|моего|моему|моим|моей|мою|моих|моими|твой|твоя|твоё|твои|твоему|твоей|твоих|свой|свою|своё|свои|своих|своего|своей|своему|своими|наш|наша|наше|наши|нашего|нашей|наших|нашему|нашими|ваш|ваша|ваше|ваши|вашего|вашей|ваших|вашему|вашими|его|её|ее|их)(?=$|[^\p{L}])/iu;
const demonstrative=/(?:^|[^\p{L}])(?:этот|эта|это|эти|этом|этим|этой|этого|эту|этих|этими|тому|тот|та|то|те|того|той|ту|тем|тех|теми|такой|такая|такое|такие|такого|такую|таким|таких|такими|столько|сей|сия)(?=$|[^\p{L}])/iu;
const words=x=>(x.toLowerCase().match(/[а-яё]+/g)||[]);
const stopWords=new Set('не и а но да ли же бы в на по под над из к от с со для при где как что был была были есть уже за об у до то лишь вот'.split(' '));
let cases=0;
for(const t of bank){
 const p=t.prompt.toLowerCase();
 for(const n of t.a){
  const current=t.s.find(x=>x[0]===n)?.[1]||'';
  const previous=t.s.find(x=>x[0]===n-1)?.[1]||'';
  const check=(result,type)=>{cases++;assert.ok(result,t.id+': answer '+n+' lacks required '+type);};
  if(/личн[а-яё]*\s+местоимен/u.test(p))check(person.test(current),'personal pronoun');
  if(/притяжательн[а-яё]*\s+местоимен/u.test(p))check(possessive.test(current),'possessive pronoun');
  if(/указательн[а-яё]*\s+местоимен/u.test(p))check(demonstrative.test(current),'demonstrative pronoun');
  if(/лексическ[а-яё]*\s+повтор/u.test(p)){
   const prev=words(previous);
   check(words(current).some(w=>!stopWords.has(w)&&prev.includes(w)),'lexical repetition');
  }
  if(/противительн[а-яё]*\s+союз/u.test(p)){
   const initial=/^\s*[—–-]?\s*(?:а|но|зато|однако|да)(?=$|[^\p{L}])/iu.test(current);
   const postpositive=/(?:^|[^\p{L}])же(?=$|[^\p{L}])/iu.test(current);
   check(initial||postpositive,'adversative conjunction');
  }
  if(/вводн[а-яё]*\s+слов/u.test(p))
   check(/конечно|наверное|вероятно|может быть|кажется|по-видимому|к сожалению|к счастью|кстати|итак|следовательно|разумеется|видимо|действительно|по-моему|например/iu.test(current),'introductory word');
 }
}
assert.ok(cases>=300,'too few lexical checks: '+cases);
vm.runInNewContext(read('reference.js'),ctx);
assert.ok(ctx.window.TR26_REFERENCE.includes('Лексический повтор'));
assert.ok(ctx.window.TR26_REFERENCE.includes('Притяжательные местоимения'));
const page=read('index.html');
const match=page.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
assert.ok(match,'app script missing');
new vm.Script(match[1]);
for(const needle of ['100dvh','CloudStorage','"game_result"','gameId:"TR26"','"error"','"ok"','Мои ошибки','Справочник'])
 assert.ok(page.includes(needle),'missing feature '+needle);
console.log('EGE26 QA PASSED: '+bank.length+' cards; 76 source fingerprints; '+cases+' required grammatical marker checks; all explanations and corrected keys; UI syntax.');
