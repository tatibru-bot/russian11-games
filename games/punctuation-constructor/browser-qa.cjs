"use strict";
const {chromium,webkit}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs"),http=require("node:http"),path=require("node:path");
const ROOT=path.resolve(__dirname,"../.."),prefix="/games/punctuation-constructor/";
const sizes=[[320,568],[375,667],[390,844],[430,932],[1280,720],[1366,768],[1649,920]];
const types={".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8"};
const server=()=>http.createServer((req,res)=>{
 const url=decodeURIComponent((req.url||"/").split("?")[0]);
 const local=path.resolve(ROOT,"."+url+(url.endsWith("/")?"index.html":""));
 if(!local.startsWith(ROOT+path.sep)){res.writeHead(403).end();return}
 fs.readFile(local,(e,bytes)=>{if(e){res.writeHead(404).end();return}res.writeHead(200,{"Content-Type":types[path.extname(local)]||"application/octet-stream"});res.end(bytes)});
});
const parent=(a,s)=>a.subs.find(x=>x.id!==s.id&&x.words.includes(s.head));
function full(a,s){
 const words=new Set(s.words);
 for(const child of a.subs.filter(x=>parent(a,x)?.id===s.id))full(a,child).forEach(i=>words.add(i));
 return [...words].sort((p,q)=>p-q);
}
function depth(a,s){
 const p=parent(a,s);return p?1+depth(a,p):1;
}
async function noInnerScroll(page,tag){
 const result=await page.evaluate(()=>{
  const selectors=[".cleanSentence",".blueprint",".blueprintContent",".buildPanel",".diagramPanel",".diagram",".workarea",".game"];
  return selectors.map(sel=>{const el=document.querySelector(sel);if(!el)return null;
   const style=getComputedStyle(el),r=el.getBoundingClientRect();
   return {sel,over:style.overflowY,client:el.clientHeight,scroll:el.scrollHeight,left:r.left,right:r.right};}).filter(Boolean);
 });
 for(const x of result){
  assert(!["auto","scroll","hidden"].includes(x.over),tag+" hidden/nested scroll "+JSON.stringify(x));
  assert(x.scroll<=x.client+4||x.over==="visible",tag+" clipped "+JSON.stringify(x));
 }
 const width=await page.evaluate(()=>document.documentElement.scrollWidth);
 const vw=page.viewportSize().width;
 assert(width<=vw+6,tag+" horizontally overflowing document "+width+" > "+vw);
}
async function clickWords(page,words){
 for(const i of words)await page.locator('.word[data-i="'+i+'"]').click();
}
async function stepBases(page,a){
 const all=[...new Set(a.bases.flatMap(b=>b.words))].sort((x,y)=>x-y);
 await clickWords(page,all);
 await page.locator('[data-act="mark"][data-kind="bases"]').click();
 assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().marks.bases.length),a.bases.length,"all bases only after full selection");
 for(const v of a.common){await clickWords(page,v.words);await page.locator('[data-act="mark"][data-kind="common"]').click()}
 await page.locator('[data-act="nextstage"]').click();
}
async function stepSubs(page,a){
 const subs=a.subs.slice().sort((x,y)=>depth(a,x)-depth(a,y));
 for(const sub of subs){
  const words=full(a,sub);
  await clickWords(page,words);
  await page.locator('[data-act="mark"][data-kind="subs"]').click();
  assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().pending?.id),sub.id,"subordinate pending");
  await page.locator('.word[data-i="'+sub.head+'"]').click();
  await page.selectOption("#question",sub.question);
  await page.locator('[data-act="link"]').click();
  assert(await page.evaluate(id=>window.__PUNCT_QA.getState().marks.subs.includes(id),sub.id),"subordinate linked");
  const expectedDepth=depth(a,sub);
  assert(await page.locator('[data-lane="'+expectedDepth+'"]').count(),"correct lower track for "+sub.id);
  if(parent(a,sub))assert(await page.locator('[data-lane="'+expectedDepth+'"] .word[data-i="'+sub.words[0]+'"]').count(),"child physically moved down");
 }
 await page.locator('[data-act="nextstage"]').click();
}
async function stepUnions(page,a){
 for(const c of a.conjs){
  await page.selectOption("#kind",c.type);
  await page.selectOption("#role",c.role);
  await page.locator('.word[data-i="'+c.at+'"]').click();
  assert.equal(await page.inputValue("#kind"),c.type,"kind persists after token rerender");
  assert.equal(await page.inputValue("#role"),c.role,"role persists after token rerender");
  await page.locator('[data-act="mark"][data-kind="conjs"]').click();
  assert(await page.evaluate(at=>window.__PUNCT_QA.getState().marks.conjs.includes("c"+at),c.at),"union accepted");
  assert(await page.locator('.word[data-i="'+c.at+'"]').evaluate(el=>el.classList.contains("conj")),"union remains color-marked");
 }
 for(const j of a.junctions)if(j.glued)await page.locator('[data-act="glue"][data-i="'+j.after+'"]').click();
 await page.locator('[data-act="nextstage"]').click();
}
async function stepTurns(page,a){
 for(const t of a.turns){
  await page.selectOption("#kind",t.type);
  await clickWords(page,t.words);
  await page.locator('[data-act="mark"][data-kind="turns"]').click();
  for(const i of t.words)assert(await page.locator('.word[data-i="'+i+'"]').evaluate(el=>el.classList.contains("pendingTurn")),"turn stays highlighted while linking");
  if(t.type==="part")assert.match(await page.locator(".controls").innerText(),/Определяемое слово/,"participial target terminology");
  await page.locator('.word[data-i="'+t.head+'"]').click();
  for(const i of t.words)assert(await page.locator('.word[data-i="'+i+'"]').evaluate(el=>el.classList.contains("pendingTurn")),"turn stays highlighted when head selected");
  await page.locator('[data-act="link"]').click();
  assert(await page.evaluate(id=>window.__PUNCT_QA.getState().marks.turns.includes(id),t.id),"turn accepted");
  for(const i of t.words)assert(await page.locator('.word[data-i="'+i+'"]').evaluate(el=>el.classList.contains("turn")),"turn stays marked after linking");
 }
 await page.locator('[data-act="nextstage"]').click();
}
async function stepExtras(page,a){
 for(const e of a.extras){
  await page.selectOption("#kind",e.type);
  await clickWords(page,e.words);
  await page.locator('[data-act="mark"][data-kind="extras"]').click();
 }
 await page.locator('[data-act="nextstage"]').click();
}
async function stepHom(page,a){
 for(const h of a.hom){await clickWords(page,h.words);await page.locator('[data-act="mark"][data-kind="hom"]').click()}
 for(const g of a.general){await clickWords(page,g.words);await page.locator('[data-act="mark"][data-kind="general"]').click()}
 await page.locator('[data-act="nextstage"]').click();
}
async function stepPunct(page,a){
 for(const p of a.punct){
  await page.locator('[data-act="gap"][data-i="'+p.after+'"]').click();
  await page.locator('[data-act="set-sign"][data-sign="'+p.sign+'"]').click();
 }
 await page.locator('[data-act="nextstage"]').click();
 assert.match(await page.locator(".finish h2").innerText(),/Конструктор собран/);
}
async function solve(page,num,index){
 await page.evaluate(({num,index})=>window.__PUNCT_QA.launch(num,index),{num,index});
 const a=await page.evaluate(()=>window.__PUNCT_QA.getTask());
 assert.equal(await page.locator(".cleanSentence").count(),1,"clean original sentence");
 assert.equal(await page.locator(".track").count(),1,"no useless placeholder tracks");
 assert.equal(await page.locator('[data-act="help"]').count(),0,"no theory button");
 await stepBases(page,a);await stepSubs(page,a);await stepUnions(page,a);
 await stepTurns(page,a);await stepExtras(page,a);await stepHom(page,a);await stepPunct(page,a);
}
async function runViewport(browser,name,width,height,port){
 const ctx=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600});
 const page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("http://127.0.0.1:"+port+prefix,{waitUntil:"load"});
 assert.equal(await page.locator(".modeTile").count(),6);
 await page.locator('[data-act="launch"][data-num="16"]').click();
 await noInnerScroll(page,name+" "+width+"x"+height+" starting game");
 if(width===375){
  const a=await page.evaluate(()=>window.__PUNCT_QA.getTask());
  await clickWords(page,a.bases[0].words);
  await page.locator('[data-act="mark"][data-kind="bases"]').click();
  assert.equal(await page.locator(".hint.error").innerText(),"Неверно выделены основы");
  assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().marks.bases.length),0);
  await page.locator('[data-act="clear"]').click();
  await stepBases(page,a);
  await stepSubs(page,a);
  const testConj=a.conjs[0];
  await page.selectOption("#kind","coord");
  await page.selectOption("#role","members");
  await page.locator('.word[data-i="'+testConj.at+'"]').click();
  await page.locator('[data-act="mark"][data-kind="conjs"]').click();
  assert.match(await page.locator(".hint.error").innerText(),/две грамматические основы/,"clear feedback: ССП vs. homogeneous members");
  assert.equal(await page.inputValue("#role"),"members","chosen wrong role is preserved for correction");
  await page.selectOption("#role","parts");
  await page.locator('[data-act="mark"][data-kind="conjs"]').click();
  assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().marks.conjs.length),1,"right ССП role accepted");
  await page.locator('[data-act="nextstage"]').click();
  assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().step),3,"can advance after correct role");
  for(const num of ["16","17","18","19","20","HARD"]){
   const total=await page.evaluate(n=>window.PUNCT_DATA.filter(a=>a.num===n).length,num);
   for(let index=0;index<total;index++){
    await solve(page,num,index);
    await noInnerScroll(page,name+" "+num+"/"+index);
   }
  }
 }
 await page.screenshot({path:"/tmp/punct-"+name+"-"+width+".png",fullPage:true});
 assert.deepEqual(errors,[],name+" "+width+"x"+height+" JavaScript errors");
 await ctx.close();
}
(async()=>{
 const srv=server();await new Promise(ok=>srv.listen(0,"127.0.0.1",ok));const port=srv.address().port;
 try{
  for(const [name,engine] of [["chromium",chromium],["webkit",webkit]]){
   const browser=await engine.launch({headless:true});
   try{for(const [width,height] of sizes)await runViewport(browser,name,width,height,port)}
   finally{await browser.close()}
  }
  console.log("PASS: 13 tasks fully solved; multi-level subordinates, controls, no nested scrolling, Chromium and WebKit.");
 }finally{await new Promise(ok=>srv.close(ok))}
})().catch(e=>{console.error(e);process.exitCode=1});
