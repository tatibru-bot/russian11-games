import assert from "node:assert/strict";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const address=pathToFileURL(new URL("./index.html",import.meta.url).pathname).href;
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const sizes=[{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:1280,height:800}];
try{
 for(const viewport of sizes){
  const context=await browser.newContext({viewport,deviceScaleFactor:1});
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(address,{waitUntil:"load"});
  await page.getByText("Нити текста",{exact:true}).last().waitFor();
  async function noOuterScroll(stage){
    const dims=await page.evaluate(()=>({innerWidth,innerHeight,bodyHeight:document.body.scrollHeight,htmlHeight:document.documentElement.scrollHeight,bodyWidth:document.body.scrollWidth,htmlWidth:document.documentElement.scrollWidth}));
    assert.ok(dims.bodyHeight<=dims.innerHeight+3 && dims.htmlHeight<=dims.innerHeight+3,JSON.stringify({viewport,stage,reason:"vertical outer scroll",dims}));
    assert.ok(dims.bodyWidth<=dims.innerWidth+3 && dims.htmlWidth<=dims.innerWidth+3,JSON.stringify({viewport,stage,reason:"horizontal outer scroll",dims}));
  }
  await noOuterScroll("menu");
  assert.equal(await page.locator(".stat strong").first().textContent(),"342");
  await page.getByRole("button",{name:/Начать 5 заданий/}).click();
  await noOuterScroll("exam");
  const reading=page.locator("#reading");
  assert.ok(await reading.count(),"no reading viewport");
  assert.ok(await page.locator(".sentence").count()>=3,"no interactive sentences");
  await page.getByRole("button",{name:"Справочник"}).last().click();
  await page.getByRole("heading",{name:"Как находить средства связи предложений"}).waitFor();
  await noOuterScroll("reference");
  await page.getByRole("button",{name:"← Назад"}).click();
  for(let i=0;i<5;i++){
    const taskid=await page.locator(".source").textContent().then(x=>x.match(/карточка ([RS]\d+)/)?.[1]);
    assert.ok(taskid,"missing task id");
    const first=await page.evaluate(id=>window.TR26_TASKS.find(t=>t.id===id).lo,taskid);
    await page.locator('.sentence[data-choice="'+first+'"]').click();
    await page.getByRole("button",{name:"Проверить ответ"}).click();
    await page.getByText("Нужно повторить").waitFor();
    await noOuterScroll("feedback "+i);
    await page.getByRole("button",{name:i===4?"Завершить":"Следующее →"}).click();
  }
  await page.getByText("0 из 5").waitFor();
  await noOuterScroll("result");
  await page.getByRole("button",{name:"В меню"}).last().click();
  assert.equal(await page.locator(".stat strong").nth(2).textContent(),"5","wrong counter did not increase");
  assert.equal(await page.locator(".stat strong").nth(1).textContent(),"0","correct counter should be zero");
  await page.getByRole("button",{name:/Мои ошибки/}).click();
  await page.getByRole("heading",{name:"Мои ошибки · 5"}).waitFor();
  await noOuterScroll("errors");
  await page.locator("[data-retry]").first().click();
  const id=await page.locator(".source").textContent().then(x=>x.match(/карточка ([RS]\d+)/)?.[1]);
  const correct=await page.evaluate(id=>window.TR26_TASKS.find(t=>t.id===id).a,id);
  for(const n of correct)await page.locator('.sentence[data-choice="'+n+'"]').click();
  await page.getByRole("button",{name:"Проверить ответ"}).click();
  await page.getByText("Верно!").waitFor();
  await page.getByRole("button",{name:"Завершить"}).click();
  await page.getByRole("button",{name:"В меню"}).last().click();
  assert.equal(await page.locator(".stat strong").nth(1).textContent(),"1","right counter did not increase");
  assert.equal(await page.locator(".stat strong").nth(2).textContent(),"4","wrong counter did not decrease");
  await noOuterScroll("after correction");
  console.log("PASS "+viewport.width+"x"+viewport.height+": menu, exam, reference, five wrong, error retry, corrected stats, no outer scroll.");
  await context.close();
 }
}finally{await browser.close();}
