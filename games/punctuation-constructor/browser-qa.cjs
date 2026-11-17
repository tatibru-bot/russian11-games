"use strict";
const {chromium,webkit}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs"),http=require("node:http"),path=require("node:path");
const ROOT=path.resolve(__dirname,"../.."),prefix="/games/punctuation-constructor/";
const sizes=[[320,568],[375,667],[390,844],[430,932],[1280,720],[1366,768],[1649,920]];
const contentTypes={".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8"};
const server=()=>http.createServer((req,res)=>{
 const url=decodeURIComponent((req.url||"/").split("?")[0]);
 const loc=path.resolve(ROOT,"."+url+(url.endsWith("/")?"index.html":""));
 if(!loc.startsWith(ROOT+path.sep)){res.writeHead(403).end();return}
 fs.readFile(loc,(error,bytes)=>{
  if(error){res.writeHead(404).end();return}
  res.writeHead(200,{"Content-Type":contentTypes[path.extname(loc)]||"application/octet-stream"});res.end(bytes);
 });
});
const parent=(a,s)=>a.subs.find(x=>x.id!==s.id&&x.words.includes(s.head));
const depth=(a,s)=>{const p=parent(a,s);return p?1+depth(a,p):1};
function full(a,s){
 const set=new Set(s.words);
 for(const child of a.subs.filter(x=>parent(a,x)?.id===s.id))full(a,child).forEach(i=>set.add(i));
 return [...set].sort((x,y)=>x-y);
}
async function clickWords(page,positions,selector=".word"){
 for(const i of positions)await page.locator(selector+'[data-i="'+i+'"]').click();
}
async function ensureNoNestedScroll(page,tag){
 const result=await page.evaluate(()=>{
  const selectors=[".blueprint",".blueprintContent",".buildPanel",".diagramPanel",".workarea",".game",".restoredPanel",".restoredLine"];
  return selectors.map(sel=>{
   const el=document.querySelector(sel);if(!el)return null;
   const css=getComputedStyle(el);return {sel,over:css.overflowY,scroll:el.scrollHeight,client:el.clientHeight};
  }).filter(Boolean);
 });
 for(const x of result){
  assert(!["auto","scroll"].includes(x.over),tag+" contains hidden scrolling: "+JSON.stringify(x));
  if(x.over==="hidden")assert(x.scroll<=x.client+2,tag+" clips content: "+JSON.stringify(x));
 }
 const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));
 assert(dims.scroll<=dims.width+6,tag+" horizontal viewport overflow: "+JSON.stringify(dims));
}
async function bases(page,a){
 const all=[...new Set(a.bases.flatMap(x=>x.words))].sort((x,y)=>x-y);
 await clickWords(page,all);
 await page.locator('[data-act="mark"][data-kind="bases"]').click();
 assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().marks.bases.length),a.bases.length,"all grammatical bases selected");
 if(a.id==="hard-general"){
  for(const w of ["книги","тетради","письма"]){
   const i=a.words.indexOf(w);
   assert(await page.locator('.word[data-i="'+i+'"]').evaluate(el=>el.classList.contains("subject")),"homogeneous subjects inherit role "+w);
  }
 }
 for(const g of a.common){
  await clickWords(page,g.words);await page.locator('[data-act="mark"][data-kind="common"]').click();
 }
 await page.locator('[data-act="nextstage"]').click();
}
async function clauses(page,a){
 for(const s of a.subs.slice().sort((x,y)=>depth(a,x)-depth(a,y))){
  await clickWords(page,full(a,s));
  await page.locator('[data-act="mark"][data-kind="subs"]').click();
  assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().pending?.id),s.id);
  await page.locator('.word[data-i="'+s.head+'"]').click();
  await page.selectOption("#question",s.question);
  await page.locator('[data-act="link"]').click();
  assert(await page.locator('[data-lane="'+depth(a,s)+'"]').count(),"lower clause track "+s.id);
  assert(await page.locator(".originBadge").count(),"source location marker for moved clause "+s.id);
 }
 await page.locator('[data-act="nextstage"]').click();
}
async function conjunctions(page,a){
 for(const c of a.conjs){
  await page.selectOption("#kind",c.type);
  await page.selectOption("#role",c.role);
  await page.locator('.word[data-i="'+c.at+'"]').click();
  assert.equal(await page.inputValue("#role"),c.role,"selected role survives redraw");
  await page.locator('[data-act="mark"][data-kind="conjs"]').click();
  assert(await page.locator('.word[data-i="'+c.at+'"]').evaluate(el=>el.classList.contains("conj")),"union stays colored");
 }
 if(a.junctions.length){
  await page.locator('[data-act="junction-yes"]').click();
  for(const j of a.junctions){
   await clickWords(page,[j.after,j.right]);
   await page.locator('[data-act="junction-confirm"]').click();
  }
 }else await page.locator('[data-act="junction-no"]').click();
 await page.locator('[data-act="nextstage"]').click();
}
async function turns(page,a){
 for(const t of a.turns){
  await page.selectOption("#kind",t.type);
  await clickWords(page,t.words);
  await page.locator('[data-act="mark"][data-kind="turns"]').click();
  await page.locator('.word[data-i="'+t.head+'"]').click();
  await page.locator('[data-act="link"]').click();
  for(const i of t.words)assert(await page.locator('.word[data-i="'+i+'"]').evaluate(el=>el.classList.contains("turnMuted")),"completed turn muted not removed");
 }
 await page.locator('[data-act="nextstage"]').click();
}
async function extras(page,a){
 for(const x of a.extras){
  await page.selectOption("#kind",x.type);
  await clickWords(page,x.words);
  await page.locator('[data-act="mark"][data-kind="extras"]').click();
  const word=page.locator('.word[data-i="'+x.words[0]+'"]');
  assert(await word.evaluate(el=>el.classList.contains("extra")),"extra remains color-coded");
  assert.equal(await page.locator('.track.tertiary').count(),0,"no detached extras track");
 }
 await page.locator('[data-act="nextstage"]').click();
}
async function homogeneous(page,a){
 for(const x of a.hom){await clickWords(page,x.words);await page.locator('[data-act="mark"][data-kind="hom"]').click()}
 for(const x of a.general){await clickWords(page,x.words);await page.locator('[data-act="mark"][data-kind="general"]').click()}
 await page.locator('[data-act="nextstage"]').click();
}
async function punctuation(page,a){
 assert(await page.locator(".restoredLine").count(),"punctuation stage restores full sentence");
 assert.equal(await page.locator(".analysisDetails").count(),1,"completed lanes available optionally");
 for(const p of a.punct){
  await page.locator('.restToken[data-i="'+p.after+'"]').click();
  await page.locator('[data-act="set-sign"][data-sign="'+p.sign+'"]').click();
 }
 await page.locator('[data-act="start-audit"]').click();
 const seams=await page.evaluate(()=>window.__PUNCT_QA.getState().seams);
 assert(seams.length<a.words.length,"not every gap is required");
 assert(seams.length>=a.punct.length,"audit covers correct punctuation boundaries");
 for(const i of seams){
  const sign=a.punct.find(p=>p.after===i)?.sign||"";
  await page.locator('[data-act="set-sign"][data-sign="'+sign+'"]').click();
 }
 assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().phase),"auditEnd");
 await page.locator('[data-act="finish-audit"]').click();
 assert.match(await page.locator(".finishedStage h3").innerText(),/Все знаки препинания расставлены правильно!/);
 assert(await page.locator(".finishedStage .schemeEquation").count(),"finished schematic retained");
 assert(await page.locator(".finishedStage .trackWords").count(),"finished analysis tracks retained");
}
async function solve(page,num,index){
 await page.evaluate(({num,index})=>window.__PUNCT_QA.launch(num,index),{num,index});
 const a=await page.evaluate(()=>window.__PUNCT_QA.getTask());
 assert.equal(await page.locator(".cleanSentence").count(),1,"unmarked original");
 assert.equal(await page.locator('[data-act="help"]').count(),0,"no theory");
 await bases(page,a);await clauses(page,a);await conjunctions(page,a);
 await turns(page,a);await extras(page,a);await homogeneous(page,a);
 await punctuation(page,a);await ensureNoNestedScroll(page,num+" "+index);
}
async function viewport(browser,label,width,height,port){
 const ctx=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600});
 const page=await ctx.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 try{
  await page.goto("http://127.0.0.1:"+port+prefix,{waitUntil:"load"});
  assert.equal(await page.locator(".modeTile").count(),6);
  await page.locator('[data-act="launch"][data-num="16"]').click();
  await ensureNoNestedScroll(page,label+" "+width);
  if(width===375){
   const a=await page.evaluate(()=>window.__PUNCT_QA.getTask());
   await clickWords(page,a.bases[0].words);
   await page.locator('[data-act="mark"][data-kind="bases"]').click();
   assert.equal(await page.locator(".hint.error").innerText(),"Неверно выделены основы");
   assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().marks.bases.length),0);
   for(const num of ["16","17","18","19","20","HARD"]){
    const n=await page.evaluate(num=>window.PUNCT_DATA.filter(a=>a.num===num).length,num);
    for(let i=0;i<n;i++)await solve(page,num,i);
   }
  }else{
   await solve(page,"16",0);
   await solve(page,"19",0);
   await solve(page,"HARD",1);
  }
  await page.screenshot({path:"/tmp/punct-"+label+"-"+width+".png",fullPage:true});
  assert.deepEqual(errors,[],label+" "+width+" JS errors");
 }finally{await ctx.close()}
}
(async()=>{
 const srv=server();await new Promise(resolve=>srv.listen(0,"127.0.0.1",resolve));const port=srv.address().port;
 try{
  for(const [label,engine] of [["chromium",chromium],["webkit",webkit]]){
   const browser=await engine.launch({headless:true});
   try{for(const [w,h] of sizes)await viewport(browser,label,w,h,port)}
   finally{await browser.close()}
  }
  console.log("PASS 13 examples, 7 stages, junction discovery, restored sentence, seam audit, multiple viewports, Chromium/WebKit");
 }finally{await new Promise(resolve=>srv.close(resolve))}
})().catch(err=>{console.error(err);process.exitCode=1});
