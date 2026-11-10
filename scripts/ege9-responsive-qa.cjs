const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({headless:true});
  const sizes = [
    {name:'iPhone SE',width:320,height:568},
    {name:'iPhone 375',width:375,height:667},
    {name:'iPhone 390',width:390,height:844},
    {name:'iPhone 430',width:430,height:932},
    {name:'Desktop',width:1366,height:768},
    {name:'Laptop 1280',width:1280,height:720}
  ];
  let failures=[];
  for (const size of sizes) {
    const page = await browser.newPage({viewport:{width:size.width,height:size.height},isMobile:size.width<500,hasTouch:size.width<500,deviceScaleFactor:1});
    await page.route('https://telegram.org/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
    await page.goto('file://'+path.resolve('games/ege9-roots/index.html'));
    await page.waitForSelector('#start-exam');
    async function check(stage,selector) {
      const m=await page.evaluate(sel=>{
        const e=document.querySelector(sel),c=document.querySelector('.content'),w=innerWidth,h=innerHeight;
        if(!e)return {error:'missing '+sel};
        const r=e.getBoundingClientRect();
        return {viewport:[w,h],bodyX:document.documentElement.scrollWidth-w,bodyY:document.documentElement.scrollHeight-h,
          actionTop:Math.round(r.top),actionBottom:Math.round(r.bottom),
          contentExtra:c?Math.round(c.scrollHeight-c.clientHeight):0,
          btnHeight:Math.round(r.height),buttonsOutside:[...document.querySelectorAll('.opt')].filter(x=>x.getBoundingClientRect().bottom>h+1).length};
      },selector);
      const bad=!!m.error||m.bodyX>1||m.actionBottom>size.height+1||m.actionTop<0||m.contentExtra>1||m.buttonsOutside>0||m.btnHeight<43;
      if(bad)failures.push({size:size.name,stage,...m});
      return m;
    }
    await page.click('#start-exam');
    let worstExtra=0;
    for(let j=0;j<20;j++) {
      const v=await check('exam-'+j,'#commit-exam');worstExtra=Math.max(worstExtra,v.contentExtra||0);
      await page.click('#home');await page.click('#start-exam');
    }
    await page.click('#commit-exam');
    await check('exam-next','#commit-exam');
    await page.click('#home');await page.click('#open-training');
    await page.locator('[data-cat]').first().click();
    await check('word-practice','#check-word');
    await page.click('#home');await page.click('#open-rules');
    const rules=await page.evaluate(()=>({reader:!!document.querySelector('.rules-reader'),quicknav:!!document.querySelector('.rules-quicknav'),navButtons:document.querySelectorAll('[data-ref-rule]').length}));
    console.log(JSON.stringify({viewport:size.name,exams:20,worstExtra,rules}));
    await page.close();
  }
  console.log('FAILURES='+JSON.stringify(failures.slice(0,80)));
  await browser.close();
  if(failures.length) {console.error('Total layout failures: '+failures.length);process.exit(1)}
  console.log('PASS: exam and word practice fit tested viewports, links usable');
})().catch(e=>{console.error(e.stack||e);process.exit(2)});
