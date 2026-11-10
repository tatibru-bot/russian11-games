const { chromium } = require('playwright');
const path = require('path');
(async function run() {
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  const sizes=[
    ['320x568',320,568],['375x667',375,667],['390x844',390,844],
    ['430x932',430,932],['1280x720',1280,720],['1366x768',1366,768]
  ];
  const problems=[];
  for(const [name,width,height] of sizes){
    const page=await browser.newPage({viewport:{width,height},isMobile:width<700,hasTouch:width<700});
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e.message)));
    await page.route('https://telegram.org/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
    await page.goto('file://'+path.resolve('games/slovar11/index.html'));
    await page.waitForSelector('#screen-menu.active');
    const meta=await page.evaluate(()=>({
      count:WORDS.length,
      idsUnique:new Set(WORDS.map(w=>w.id)).size,
      amendedHint:WORDS.find(w=>w.id===301)?.context,
      amendedMask:WORDS.find(w=>w.id===8)?.mask
    }));
    if(meta.count!==426||meta.idsUnique!==426||meta.amendedMask!=='ак__мпан_мент'
      ||!meta.amendedHint?.includes('Художник создал')) problems.push({size:name,phase:'dataset',meta});
    await page.locator('[data-mode="all"]').click();
    for(let id=1;id<=426;id++){
      const metrics=await page.evaluate(id=>{
        const word=WORDS[id-1],mask=document.getElementById('masked-word'),
          hint=document.getElementById('word-context'),pane=document.querySelector('#screen-play .wordpane');
        mask.innerHTML=makeMask(word);hint.textContent=word.context||'';hint.classList.toggle('hidden',!word.context);
        document.getElementById('feedback').classList.add('hidden');
        document.getElementById('check-answer').classList.remove('hidden');
        document.getElementById('dont-know').classList.remove('hidden');
        document.getElementById('next-word').classList.add('hidden');
        const rect=pane.getBoundingClientRect();
        const nodes=['#masked-word','.blank-notice','#word-context','.answerbox','.progress-bar','.playactions'];
        let clipped=[];
        for(const selector of nodes){
          const el=pane.querySelector(selector);
          if(!el||el.classList.contains('hidden'))continue;
          const b=el.getBoundingClientRect();
          if(b.top<rect.top+4||b.bottom>rect.bottom-4||b.left<rect.left-3||b.right>rect.right+3)
            clipped.push({selector,top:Math.round(b.top),bottom:Math.round(b.bottom),paneTop:Math.round(rect.top),paneBottom:Math.round(rect.bottom)});
        }
        return {
          id:word.id,mask:word.mask,contextLen:(word.context||'').length,
          overflow:Math.round(Math.max(0,pane.scrollHeight-pane.clientHeight)),
          clipped,viewportOverflowX:document.documentElement.scrollWidth-innerWidth,
          actionHeight:Math.round(document.querySelector('#check-answer').getBoundingClientRect().height)
        };
      },id);
      if(metrics.overflow>1||metrics.clipped.length||metrics.viewportOverflowX>1||metrics.actionHeight<43){
        if(problems.filter(p=>p.size===name).length<14)problems.push({size:name,phase:'play',...metrics});
      }
    }
    // Test correct spelling, feedback, and per-word progress without disturbing 426 IDs.
    await page.evaluate(()=>{
      const id=8;queue=[id];lastId=null;nextCard();
    });
    await page.locator('#answer').fill('аккомпанемент');
    await page.locator('#check-answer').click();
    const feedback=await page.evaluate(()=>({
      text:document.getElementById('feedback').textContent,
      hidden:document.getElementById('feedback').classList.contains('hidden'),
      nextHidden:document.getElementById('next-word').classList.contains('hidden')
    }));
    if(feedback.hidden||feedback.nextHidden||!feedback.text.includes('Верно'))problems.push({size:name,phase:'gameplay',feedback});
    const after=await page.evaluate(()=>{
      const pane=document.querySelector('#screen-play .wordpane'),
        r=pane.getBoundingClientRect(),f=document.querySelector('#feedback').getBoundingClientRect(),
        next=document.querySelector('#next-word').getBoundingClientRect();
      return {overflow:pane.scrollHeight-pane.clientHeight,
        feedbackTop:f.top,feedbackBottom:f.bottom,paneTop:r.top,paneBottom:r.bottom,nextBottom:next.bottom};
    });
    if(after.overflow>1||after.feedbackTop<after.paneTop||after.feedbackBottom>after.paneBottom)
      problems.push({size:name,phase:'feedback',...after});
    await page.locator('#go-home').click();
    await page.locator('#open-dict').click();
    const count=await page.locator('#word-list input[type=checkbox]').count();
    if(count!==426)problems.push({size:name,phase:'dictionary',count});
    await page.locator('#word-search').fill('косатка');
    const find=await page.locator('#word-list .word-item').count();
    if(find!==1)problems.push({size:name,phase:'search',matches:find});
    if(errors.length)problems.push({size:name,phase:'console',errors:errors.slice(0,4)});
    console.log(name+': inspected 426 masks/hints, answer, dictionary and search; issues='+problems.filter(p=>p.size===name).length);
    await page.close();
  }
  console.log('RESULT='+JSON.stringify({pass:problems.length===0,count:problems.length,samples:problems.slice(0,36)}));
  await browser.close();
  if(problems.length)process.exit(1);
})().catch(e=>{console.error(e.stack||e);process.exit(2)});
