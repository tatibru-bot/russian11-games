/**
 * Текстория: Telegram-подпись, дуэли и уведомления.
 * Этот модуль добавляется в ТЕХ ЖЕ Apps Script файлах, что QuizBot.gs.
 * Не запускать doPost как открытый приём процентов: учебные результаты
 * берутся только из обычной подтверждённой записи существующего бота.
 */
var TEXTORIA_DUEL_GAMES_ = {
  TR8_01:15, TR8_02:15, TR21_DASH:3, TR21_COLON:3,
  TR21_COMMA:3, TR22:5, TR26:5, HOSPITAL:30,
  'ege9-roots':5, 'ege10-pristavgrad':5, 'ege11-cauldron':5,
  PARONIMOSKOP:10
};
function textoriaBotToken_() {
  // Должен совпадать с токеном существующего @russian11_island_bot.
  // Никогда не добавляйте его в GitHub или ячейки Google-таблицы.
  var token = PropertiesService.getScriptProperties().getProperty('TEXTORIA_BOT_TOKEN');
  if (!token) throw new Error('TEXTORIA_BOT_TOKEN отсутствует в Script Properties');
  return token;
}
function textoriaHex_(bytes) {
  return bytes.map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join('');
}
function textoriaAuth_(initData) {
  if (!initData || typeof initData !== 'string' || initData.length > 8192)
    throw new Error('Тексторию необходимо открыть через Telegram');
  var q = {};
  initData.split('&').forEach(function(part) {
    var p = part.indexOf('=');
    if (p < 0) return;
    var key = decodeURIComponent(part.slice(0,p).replace(/\+/g,' '));
    var value = decodeURIComponent(part.slice(p+1).replace(/\+/g,' '));
    if (!Object.prototype.hasOwnProperty.call(q,key)) q[key]=value;
  });
  if (!q.hash || !q.auth_date || !q.user) throw new Error('Недостаточно данных Telegram');
  var now = Math.floor(Date.now()/1000);
  var age = now - Number(q.auth_date);
  if (!Number.isFinite(age) || age < -300 || age > 86400)
    throw new Error('Истёк срок данных авторизации Telegram');
  var check = Object.keys(q).filter(function(k){return k !== 'hash' && k !== 'signature';})
    .sort().map(function(k){return k+'='+q[k];}).join('\n');
  var secret = Utilities.computeHmacSha256Signature(textoriaBotToken_(),'WebAppData');
  var digest = textoriaHex_(Utilities.computeHmacSha256Signature(check,secret));
  var incoming = String(q.hash).toLowerCase();
  if (incoming.length !== digest.length) throw new Error('Подпись Telegram неверна');
  var different=0;
  for(var i=0;i<digest.length;i++) different |= digest.charCodeAt(i)^incoming.charCodeAt(i);
  if(different) throw new Error('Подпись Telegram неверна');
  var user=JSON.parse(q.user);
  if (!user || !/^\d+$/.test(String(user.id))) throw new Error('Некорректный Telegram ID');
  return String(user.id);
}
function textoriaRequirePupil_(initData) {
  var id=textoriaAuth_(initData),book=textoriaBook_();
  var list=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.students));
  var pupil=list.find(function(r){
    return /^\d+$/.test(String(r[0]||''))&&String(r[3]||'')===id;
  });
  if(!pupil) throw new Error('Доступно только ученикам 11 «К»');
  return {id:id,name:String(pupil[1]||'').trim().split(/\s+/).pop(),book:book};
}
function textoriaSetting_(book,key,defaultValue) {
  var sheet=book.getSheetByName(TEXTORIA_.tabs.settings);
  if(!sheet||sheet.getLastRow()<2)return defaultValue;
  var items=sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues();
  var found=items.find(function(r){return String(r[0])===key;});
  return found ? found[1] : defaultValue;
}
function textoriaNotify_(book,userId,text) {
  // Выключено до пробного запуска на аккаунте преподавателя.
  if (String(textoriaSetting_(book,'notify_private','off'))!=='on')
    return {sent:false,reason:'disabled'};
  var token=textoriaBotToken_();
  var url='https://api.telegram.org/bot'+token+'/sendMessage';
  var response=UrlFetchApp.fetch(url,{
    method:'post',contentType:'application/json',muteHttpExceptions:true,
    payload:JSON.stringify({chat_id:userId,text:text,disable_web_page_preview:true})
  });
  var data=JSON.parse(response.getContentText()||'{}');
  return {sent:!!data.ok,error:data.ok?null:String(data.description||'Telegram API error')};
}
function textoriaEvent_(book,type,uid,description) {
  var sheet=textoriaSheet_(book,TEXTORIA_.tabs.events);
  sheet.appendRow([new Date(),type,String(uid||''),description,Utilities.getUuid(),'отключено','','']);
}
function textoriaDuelRow_(book,id) {
  var sheet=textoriaSheet_(book,TEXTORIA_.tabs.duels),rows=textoriaRows_(sheet);
  for(var i=0;i<rows.length;i++)if(String(rows[i][0])===String(id))
    return {sheet:sheet,row:i+2,cells:rows[i]};
  throw new Error('Дуэль не найдена');
}
function textoriaDuelGameValid_(id) {
  return Object.prototype.hasOwnProperty.call(TEXTORIA_DUEL_GAMES_,id);
}
function textoriaChallenge(initData,targetId,gameId) {
  var p=textoriaRequirePupil_(initData),to=String(targetId||''),g=String(gameId||'');
  if(to===p.id)throw new Error('Нельзя вызвать самого себя');
  if(!textoriaDuelGameValid_(g))throw new Error('В этой игре пока нельзя назначить дуэль');
  var others=textoriaRows_(textoriaSheet_(p.book,TEXTORIA_.tabs.students))
    .filter(function(r){return /^\d+$/.test(String(r[0]||''));});
  var target=others.find(function(r){return String(r[3]||'')===to;});
  if(!target)throw new Error('Соперник не найден среди учеников 11 «К»');
  var duels=textoriaRows_(textoriaSheet_(p.book,TEXTORIA_.tabs.duels));
  var cutoff=Date.now()-7*86400000;
  if(duels.some(function(r){
    return (String(r[1])===p.id||String(r[2])===p.id) &&
      ['Ожидает','Принята'].indexOf(String(r[7]))>=0;
  }))throw new Error('Сначала нужно закончить текущий вызов');
  if(duels.filter(function(r){
    return (String(r[1])===p.id||String(r[2])===p.id) &&
      ['Принята','Завершена'].indexOf(String(r[7]))>=0 &&
      textoriaTimestamp_(r[4])>=cutoff;
  }).length>=3)throw new Error('Достигнут лимит дуэлей за семь дней');
  if(duels.some(function(r){
    return ((String(r[1])===p.id && String(r[2])===to) ||
      (String(r[1])===to && String(r[2])===p.id)) &&
      String(r[3])===g && textoriaTimestamp_(r[4])>=cutoff;
  }))throw new Error('Эта пара уже сражалась на данном тренажёре за семь дней');
  var id=Utilities.getUuid(),sh=textoriaSheet_(p.book,TEXTORIA_.tabs.duels);
  sh.appendRow([id,p.id,to,g,new Date(),'','','Ожидает','','',0,0,false,'',0,0]);
  var message='⚔ Текстория! '+p.name+
    ' бросает тебе вызов на тренажёре «'+g+'». Открой Тексторию, чтобы принять или отклонить.';
  var sent=textoriaNotify_(p.book,to,message);
  textoriaEvent_(p.book,'duel_invited',p.id,p.name+' вызывает '+String(target[1]||'')+' · '+g);
  return {ok:true,id:id,notification:sent.sent?'sent':'queued'};
}
function textoriaRespondChallenge(initData,duelId,accept) {
  var p=textoriaRequirePupil_(initData);
  var d=textoriaDuelRow_(p.book,duelId);
  var r=d.cells;
  if(String(r[2])!==p.id)throw new Error('Решение может принять только вызванный игрок');
  if(String(r[7])!=='Ожидает')throw new Error('Вызов уже обработан');
  if(accept){
    var now=new Date();
    d.sheet.getRange(d.row,6,1,3).setValues([[now,new Date(now.getTime()+86400000),'Принята']]);
    textoriaEvent_(p.book,'duel_accepted',p.id,'Принят вызов '+duelId);
    textoriaNotify_(p.book,String(r[1]),'⚔ '+p.name+' принял(а) твой вызов! У вас 24 часа.');
  }else{
    d.sheet.getRange(d.row,8).setValue('Отклонена');
    d.sheet.getRange(d.row,14).setValue(new Date());
    textoriaEvent_(p.book,'duel_declined',p.id,'Отклонён вызов '+duelId);
  }
  return {ok:true,accepted:!!accept};
}
function textoriaDuelBest_(rows,uid,gameId,start,end) {
  var required=TEXTORIA_DUEL_GAMES_[gameId],best=null,ids={},count=0;
  rows.forEach(function(r) {
    if(String(r[1]||'')!==uid||String(r[3]||'')!==gameId)return;
    var timestamp=textoriaTimestamp_(r[0]);
    var total=Number(r[7]),correct=Number(r[6]),aid=String(r[5]||'');
    if(timestamp<start||timestamp>end||total!==required||
       !Number.isFinite(correct)||correct<0||correct>total)return;
    if(aid&&ids[aid])return;
    if(aid)ids[aid]=true;
    count++;
    best=Math.max(best===null?0:best,100*correct/total);
  });
  return {best:best,count:count};
}
function textoriaCloseExpiredDuels() {
  var lock=LockService.getScriptLock();lock.waitLock(25000);
  try {
    var book=textoriaBook_();
    var sheet=textoriaSheet_(book,TEXTORIA_.tabs.duels);
    var rows=textoriaRows_(sheet),all=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.results));
    var changes=0;
    rows.forEach(function(d,i) {
      if(String(d[7])!=='Принята')return;
      var start=textoriaTimestamp_(d[5]),end=textoriaTimestamp_(d[6]);
      if(!start||!end||Date.now()<end)return;
      var a=textoriaDuelBest_(all,String(d[1]),String(d[3]),start,end);
      var b=textoriaDuelBest_(all,String(d[2]),String(d[3]),start,end);
      var awards,decision;
      if(a.best===null&&b.best===null){awards=[-.5,-.5];decision='неявка обоих';}
      else if(a.best===null){awards=[0,1.5];decision='техническая победа защитника';}
      else if(b.best===null){awards=[1.5,0];decision='техническая победа вызывающего';}
      else if(a.best>b.best){awards=[3,1];decision='победа вызывающего';}
      else if(b.best>a.best){awards=[1,3];decision='победа защитника';}
      else {awards=[2,2];decision='ничья';}
      // Одна строка — одна дуэль. Каждая награда учитывается ровно один раз.
      sheet.getRange(i+2,8).setValue('Завершена');
      sheet.getRange(i+2,9,1,6).setValues([[
        a.best===null?'':a.best,b.best===null?'':b.best,
        awards[0],awards[1],true,new Date()
      ]]);
      sheet.getRange(i+2,15,1,2).setValues([[a.count,b.count]]);
      textoriaEvent_(book,'duel_finished','',String(d[0])+' · '+decision);
      changes++;
    });
    if(changes)textoriaRebuild();
    return {settled:changes};
  }finally{lock.releaseLock();}
}
