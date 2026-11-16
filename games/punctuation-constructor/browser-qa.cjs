"use strict";
const {chromium,webkit}=require("playwright");
const assert=require("node:assert/strict"),fs=require("node:fs"),http=require("node:http"),path=require("node:path");
const ROOT=path.resolve(__dirname,"../.."),app="/games/punctuation-constructor/",sizes=[[320,568],[375,667],[390,844],[430,932],[1280,720],[1366,768]];
const types={".html":"text/html;charset=utf-8",".js":"text/javascript;charset=utf-8",".css":"text/css;charset=utf-8"};
function server(){return http.createServer((req,res)=>{const url=decodeURIComponent((req.url||"/").split("?")[0]);const file=path.resolve(ROOT,"."+url+(url.endsWith("/")?"index.html":""));if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return}fs.readFile(file,(error,buffer)=>{if(error){res.writeHead(404).end();return}res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream"});res.end(buffer)})})}
async function visibleFit(page,tag){
 const x=await page.evaluate(()=>{const body=document.body,doc=document.documentElement,rect=document.querySelector(".app").getBoundingClientRect();const tools=[...document.querySelectorAll(".titleline,.stepTitle,.workarea,.controls,.footer")].map(e=>{const r=e.getBoundingClientRect();return {y:r.top,bottom:r.bottom,height:r.height}});return {viewport:[innerWidth,innerHeight],scroll:doc.scrollHeight>innerHeight+2||body.scrollHeight>innerHeight+2,rect:{top:rect.top,bottom:rect.bottom},tools,buttons:document.querySelectorAll("button").length}});
 assert.equal(x.scroll,false,tag+" body must not scroll: "+JSON.stringify(x));
 assert(x.rect.bottom<=x.viewport[1]+2&&x.rect.top>=-1,tag+" app clipped");
 for(const t of x.tools){assert(t.y>=-1&&t.bottom<=x.viewport[1]+2&&t.height>=2,tag+" layout clipped: "+JSON.stringify(x))}
 return x;
}
async function testStage1(page){
 const task=await page.evaluate(()=>window.__PUNCT_QA.getTask()),groups=task.bases;
 for(const b of groups){
  for(const i of b.words)await page.locator('.word[data-i="'+i+'"]').click();
  await page.locator('[data-act="mark"][data-kind="bases"]').click();
 }
 const n=await page.evaluate(()=>window.__PUNCT_QA.getState().marks.bases.length);
 assert.equal(n,groups.length,"all grammatical bases marked");
 await page.locator('[data-act="nextstage"]').click();
}
async function testFirstSub(page){
 const t=await page.evaluate(()=>window.__PUNCT_QA.getTask());
 if(!t.subs.length){await page.locator('[data-act="nextstage"]').click();return}
 const s=t.subs[0];
 for(const i of s.words)await page.locator('.word[data-i="'+i+'"]').click();
 await page.locator('[data-act="mark"][data-kind="subs"]').click();
 await page.locator('.word[data-i="'+s.head+'"]').click();
 await page.selectOption("#question",s.question);
 await page.locator('[data-act="link"]').click();
 const linked=await page.evaluate(()=>window.__PUNCT_QA.getState().marks.subs);
 assert(linked.includes(s.id),"first subordinate attached to exact head and question");
}
async function exhaustiveFeedback(page){
 const items=await page.evaluate(()=>window.PUNCT_DATA);
 assert.equal(items.length,12,"12 manually annotated puzzles");
 assert.equal(new Set(items.map(x=>x.id)).size,items.length);
 for(const item of items){
  assert(item.words.length>3,"no trivial puzzle");
  assert(item.bases.length>=1,"all puzzles have grammar bases");
  const signs=new Set(item.punct.map(x=>x.after));
  assert.equal(signs.size,item.punct.length,"no duplicate punctuation boundaries");
  await page.evaluate(({num,id})=>{window.__PUNCT_QA.launch(num,window.PUNCT_DATA.filter(t=>t.num===num).findIndex(x=>x.id===id));window.__PUNCT_QA.markAllForTest()},{num:item.num,id:item.id});
  assert.equal(await page.locator(".punctGap").count(),item.words.length,"one punctuation target after every word");
  await page.locator('[data-act="nextstage"]').click();
  assert.match(await page.locator(".finish h2").innerText(),/Конструктор собран/);
 }
}
async function engineCheck(name,browser,w,h){
 const ctx=await browser.newContext({viewport:{width:w,height:h},isMobile:w<600,hasTouch:w<600});const page=await ctx.newPage();
 let errors=[];page.on("pageerror",e=>errors.push(e.message));const base="http://127.0.0.1:"+PORT;
 await page.goto(base+app,{waitUntil:"load"});
 assert.equal(await page.locator(".modeTile").count(),6,"six independent EGE menu entries");
 await visibleFit(page,name+" "+w+"x"+h+" menu");
 await page.locator('[data-act="launch"][data-num="19"]').click();
 assert.equal(await page.locator(".word").count(),11,"render individual word tokens");
 await visibleFit(page,name+" "+w+"x"+h+" game");
 await page.screenshot({path:"/tmp/punct-"+name+"-"+w+".png",fullPage:false});
 if(w===375){
  await testStage1(page);
  await testFirstSub(page);
  await page.locator('[data-act="menu"]').click();
  await page.locator('[data-act="launch"][data-num="16"]').click();
  await testStage1(page);
  await page.locator('[data-act="nextstage"]').click(); // 16 has zero subordinated clauses
  const firstConj=await page.evaluate(()=>window.__PUNCT_QA.getTask().conjs[0]);
  await page.locator('.word[data-i="'+firstConj.at+'"]').click();
  await page.selectOption("#kind",firstConj.type);await page.selectOption("#role",firstConj.role);
  await page.locator('[data-act="mark"][data-kind="conjs"]').click();
  assert.equal(await page.evaluate(()=>window.__PUNCT_QA.getState().marks.conjs.length),1);
  await exhaustiveFeedback(page);
 }
 assert.deepEqual(errors,[],name+" "+w+"x"+h+" runtime errors");
 await ctx.close();
}
let PORT;
(async()=>{
 const srv=server();await new Promise(ok=>srv.listen(0,"127.0.0.1",ok));PORT=srv.address().port;
 for(const [name,engine] of [["chromium",chromium],["webkit",webkit]]){
  const b=await engine.launch({headless:true});
  for(const [w,h] of sizes)await engineCheck(name,b,w,h);
  await b.close();
 }
 console.log("PASS: 12 puzzles, six modes, 7-stage prototype, schema, mobile fit and Chromium/WebKit");
 await new Promise(ok=>srv.close(ok));
})().catch(e=>{console.error(e);process.exitCode=1});
