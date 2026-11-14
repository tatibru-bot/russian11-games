"use strict";
const {chromium,webkit} = require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs"),http=require("node:http"),path=require("node:path");
const ROOT=path.resolve(__dirname,"../../..");
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};
const app="/games/ege11-cauldron/";
const widths=[[320,568],[375,667],[390,844],[430,932],[1280,720],[1366,768]];
function server(){
return http.createServer((req,res)=>{
 const url=decodeURIComponent((req.url||"/").split("?")[0]);
 const file=path.resolve(ROOT,"."+url+(url.endsWith("/")?"index.html":""));
 if(!file.startsWith(ROOT+path.sep)){res.writeHead(403).end();return}
 fs.readFile(file,(err,b)=>{if(err){res.writeHead(404).end();return}res.writeHead(200,{"Content-Type":MIME[path.extname(file)]||"application/octet-stream"});res.end(b)});
});
}
async function checkFit(page,context){
 const d=await page.evaluate(()=>{
  const view={w:innerWidth,h:innerHeight};
  const outer=document.querySelector(".screen").getBoundingClientRect();
  const all=[...document.querySelectorAll(".qrow,.slot,.keyboard,.keyboard button,.controls,.controls button")];
  let clipped=[];
  for(const el of all){
   const b=el.getBoundingClientRect(),par=el.closest(".qrow");
   const p=par?par.getBoundingClientRect():outer;
   if(b.width<1||b.height<1||b.left<-1||b.right>innerWidth+1||b.top<-1||b.bottom>innerHeight+1||
      (par&&(b.top<p.top-1||b.bottom>p.bottom+1)))clipped.push({sel:el.className||el.tagName,y:b.y,bottom:b.bottom,parent:par&&[p.top,p.bottom]});
  }
  return {view,bodyScroll:document.documentElement.scrollHeight>innerHeight+2||document.body.scrollHeight>innerHeight+2,slots:document.querySelectorAll(".slot").length,clipped};
 });
 assert.equal(d.bodyScroll,false,context+" scroll "+JSON.stringify(d));
 assert.equal(d.slots,page._expectedSlots||10,context+" slots "+JSON.stringify(d));
 assert.equal(d.clipped.length,0,context+" clipped elements "+JSON.stringify(d.clipped.slice(0,5)));
}
async function fillCorrect(page){
 const slots=await page.evaluate(()=>window.__CAULDRON_QA.currentSlots());
 page._expectedSlots=slots.length;
 for(let i=0;i<slots.length;i++){
  await page.locator('[data-action="slot"][data-index="'+i+'"]').click();
  let key=slots[i].letter.toLocaleLowerCase("ru").replace(/ё/g,"е");
  await page.locator('[data-action="key"][data-key="'+key+'"]').click();
 }
 return slots;
}
async function engineCheck(engine,name,base){
 const browser=await engine.launch({headless:true});
 try{
  for(const [width,height] of widths){
    const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:width<600?2:1,isMobile:width<600,hasTouch:width<600});
    const page=await ctx.newPage();
    await page.route("https://telegram.org/js/telegram-web-app.js",route=>route.fulfill({status:200,body:""}));
    await page.addInitScript(()=>{window.Telegram={WebApp:{platform:"android",initDataUnsafe:{user:{id:741159}},ready(){},expand(){},sendData(s){window.__qaPayload=s}}}});
    await page.goto(base+app,{waitUntil:"load"});
    const n=await page.evaluate(()=>window.__CAULDRON_QA.counts());
    assert.equal(n.tasks,276);
    assert.equal(Object.values(n.rulePools).filter(c=>c>=5).length,23,"all 23 rules drillable");
    await page.locator('[data-action="start-exam"]').click();
    page._expectedSlots=10;
    await checkFit(page,name+" "+width+"x"+height+" exam");
    await page.screenshot({path:"/tmp/ege11-"+name+"-"+width+".png",fullPage:false});
    // Stress-fit more than one random question on mobile.
    if(width<=390){
      for(let k=0;k<15;k++){
        await page.locator('[data-action="home"]').click();
        await page.locator('[data-action="start-exam"]').click();
        await checkFit(page,name+" "+width+"x"+height+" random "+k);
      }
    }
    if(width===375){
      // The entire five-task cycle must complete, without losing an opened handbook.
      await page.locator('[data-action="guide"]').count().then(async count=>{if(count){await page.locator('[data-action="guide"]').click();await page.locator('[data-action="back-guide"]').click()}});
      for(let round=0;round<5;round++){
        await fillCorrect(page);
        await page.locator('[data-action="check"]').click();
        assert.match(await page.locator(".feedbackHead").innerText(),/Все буквы на месте/);
        await page.locator('[data-action="advance"]').click();
      }
      assert.match(await page.locator(".scoreBig").innerText(),/5\s*\/\s*5/);
      await page.locator('[data-action="send"]').click();
      const sent=JSON.parse(await page.evaluate(()=>window.__qaPayload));
      assert.equal(sent.gameId,"ege11-cauldron");
      assert.equal(sent.correct,5);assert.equal(sent.total,5);assert.equal(Object.values(sent.tested).reduce((x,y)=>x+y,0),50);
      await page.locator('[data-action="home"]').click();
      await page.locator('[data-action="start-exam"]').click();
      const slots=await page.evaluate(()=>window.__CAULDRON_QA.currentSlots());
      for(let i=0;i<slots.length;i++){
        const real=slots[i].letter.toLocaleLowerCase("ru").replace(/ё/g,"е");
        await page.locator('[data-action="slot"][data-index="'+i+'"]').click();
        await page.locator('[data-action="key"][data-key="'+(real==="а"?"е":"а")+'"]').click();
      }
      await page.locator('[data-action="check"]').click();
      assert((await page.locator(".feedbackItem").count())>0,"wrong words explained");
      await page.locator('[data-action="home"]').count().then(async count=>{if(count)await page.locator('[data-action="home"]').click()});
      // feedback has no home button; after check use guide and then 4 remaining rounds.
      if(await page.locator(".feedback").count()){
        await page.locator('[data-action="advance"]').click();
        await page.locator('[data-action="home"]').click();
      }
      await page.locator('[data-action="errors"]').click();
      page._expectedSlots=5;
      await checkFit(page,name+" "+width+"x"+height+" errors");
      await fillCorrect(page);await page.locator('[data-action="check"]').click();
      await page.locator('[data-action="advance"]').click();
      await page.locator('[data-action="home"]').click();
      await page.locator('[data-action="rules"]').click();
      const first=await page.locator('[data-action="start-rule"]').first().getAttribute("data-rule");
      assert(first);
      await page.locator('[data-action="start-rule"]').first().click();
      page._expectedSlots=5;
      await checkFit(page,name+" "+width+"x"+height+" rule drill");
      await fillCorrect(page);await page.locator('[data-action="check"]').click();
      await page.locator('[data-action="advance"]').click();
    }
    await ctx.close();
  }
  console.log("PASS",name,"viewports:",widths.length);
 }finally{await browser.close()}
}
(async()=>{
 const srv=server();await new Promise(r=>srv.listen(0,"127.0.0.1",r));
 const base="http://127.0.0.1:"+srv.address().port;
 try{await engineCheck(chromium,"chromium",base);await engineCheck(webkit,"webkit",base);console.log("ALL EGE11 QA PASSED")}
 finally{await new Promise(r=>srv.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
