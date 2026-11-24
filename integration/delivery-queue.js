/* R11 durable Telegram delivery queue v1. Completed payloads survive Mini App closure.
   sendData acknowledges only handoff to Telegram, NOT acceptance by the bot. */
(function(){
'use strict';
const getApp=()=>window.Telegram&&window.Telegram.WebApp;
const storageKey=()=>{const app=getApp(),id=app&&app.initDataUnsafe&&app.initDataUnsafe.user&&app.initDataUnsafe.user.id;return 'r11:delivery:v1:'+String(id||'browser')};
const maxItems=150;
const read=()=>{try{const v=JSON.parse(localStorage.getItem(storageKey())||'[]');return Array.isArray(v)?v:[]}catch(_){return []}};
const save=x=>{try{localStorage.setItem(storageKey(),JSON.stringify(x.slice(-maxItems)));return true}catch(_){return false}};
const validate=payload=>{const p=typeof payload==='string'?JSON.parse(payload):payload;
if(!p||p.v!==1||!['game_result','skill_result'].includes(p.type)||!p.gameId||!p.attemptId)throw Error('Некорректный отчёт');
const data=JSON.stringify(p);if(new TextEncoder().encode(data).length>4096)throw Error('Отчёт превышает лимит Telegram (4096 байт)');
return {p,data}};
let open=false;
function enqueue(payload){
const {p,data}=validate(payload),list=read(),key=String(p.gameId)+':'+String(p.attemptId);
let item=list.find(x=>x.key===key);
if(!item){item={key,gameId:p.gameId,attemptId:p.attemptId,type:p.type,data,createdAt:new Date().toISOString(),lastTriedAt:null,tries:0};list.push(item)}
else item.data=data;
if(!save(list))throw Error('Не удалось сохранить отчёт на этом устройстве');
render();return data;
}
function sendData(payload){
const data=enqueue(payload);
const app=getApp();
if(!app||typeof app.sendData!=='function'||app.platform==='unknown')throw Error('Открой тренажёр через кнопку Telegram-бота');
if(app.initDataUnsafe&&app.initDataUnsafe.query_id)throw Error('Этот способ открытия Telegram не поддерживает отправку отчёта. Открой игру из кнопки бота');
const p=JSON.parse(data),list=read(),item=list.find(x=>x.key===p.gameId+':'+p.attemptId);
if(item){item.lastTriedAt=new Date().toISOString();item.tries=(item.tries||0)+1;save(list)}
render();
app.sendData(data);
return true;
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function mount(){
if(document.getElementById('r11-delivery-toggle'))return;
const b=document.createElement('button');b.id='r11-delivery-toggle';b.type='button';b.textContent='📨 Отчёты';b.style.cssText='position:fixed;right:8px;bottom:8px;z-index:2147483000;background:#273b4a;color:white;border:1px solid #fff8;border-radius:20px;padding:8px 12px;font:600 13px system-ui;box-shadow:0 3px 12px #0007;min-height:38px;cursor:pointer';
const panel=document.createElement('section');panel.id='r11-delivery-panel';panel.style.cssText='display:none;position:fixed;right:8px;bottom:52px;width:min(350px,calc(100vw - 16px));max-height:55vh;overflow:auto;z-index:2147483000;background:#202437;color:#fff;border:1px solid #999;border-radius:12px;padding:12px;font:13px/1.5 system-ui;box-shadow:0 10px 30px #0009';
b.addEventListener('click',()=>{open=!open;render()});
panel.addEventListener('click',ev=>{const btn=ev.target.closest('button[data-r11]');if(!btn)return;
const action=btn.dataset.r11,key=btn.dataset.key,item=read().find(x=>x.key===key);
if(action==='close'){open=false;render();return}
if(action==='send'&&item){try{sendData(item.data)}catch(err){alert(err.message||String(err))}}
if(action==='delete'&&item&&confirm('Удалить локальную копию отчёта? Сначала проверь запись в статистике бота.')){save(read().filter(x=>x.key!==key));render()}
});
document.body.appendChild(b);document.body.appendChild(panel);render();
}
function render(){
const panel=document.getElementById('r11-delivery-panel'),b=document.getElementById('r11-delivery-toggle');if(!panel||!b)return;
const items=read();b.textContent='📨 Отчёты'+(items.length?' · '+items.length:'');panel.style.display=open?'block':'none';if(!open)return;
panel.innerHTML='<strong>Сохранённые отчёты</strong> <button type="button" data-r11="close" style="float:right">✕</button><p>«Отправлено» не означает «записано». Проверь результат в боте; повторная отправка того же ID не должна создавать дубль.</p>'+
(items.length?items.slice().reverse().map(x=>'<div style="border-top:1px solid #8885;padding:8px 0"><b>'+esc(x.gameId)+'</b> · '+esc(x.type)+'<div>'+esc(new Date(x.createdAt).toLocaleString('ru-RU'))+' · '+(x.tries?'передавали '+x.tries+' р.':'ещё не передавали')+'</div><button type="button" data-r11="send" data-key="'+esc(x.key)+'">📩 Отправить повторно</button> <button type="button" data-r11="delete" data-key="'+esc(x.key)+'">Удалить копию</button></div>').join(''):'<p>Пока нет сохранённых отправок.</p>');
}
window.R11Delivery={sendData,enqueue,getPending:read};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();