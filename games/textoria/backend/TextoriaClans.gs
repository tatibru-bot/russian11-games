/**
 * Текстория: рода, прошения, эпитеты и серверный снимок королевства.
 * Требует TextoriaCore.gs + TextoriaDuels.gs в одном проекте QuizBot.gs.
 * Вся идентификация производится по проверенной подписи Telegram initData.
 */
var TEXTORIA_SYMBOLS_=['dragon','lion','raven','unicorn','rose','tree','sun','moon'];
function textoriaCitizen_(book,uid) {
  var s=textoriaSheet_(book,TEXTORIA_.tabs.citizens);
  var rows=textoriaRows_(s);
  for(var i=0;i<rows.length;i++) {
    if(String(rows[i][0]||'')===uid) return {sheet:s,row:i+2,cells:rows[i]};
  }
  throw new Error('Житель ещё не зарегистрирован');
}
function textoriaClan_(book,clanId) {
  var sheet=textoriaSheet_(book,TEXTORIA_.tabs.clans),rows=textoriaRows_(sheet);
  for(var i=0;i<rows.length;i++) {
    if(String(rows[i][0])===String(clanId)&&String(rows[i][10])!=='Распущен')
      return {sheet:sheet,row:i+2,cells:rows[i]};
  }
  throw new Error('Род не найден');
}
function textoriaMembers_(clan) {
  try {return JSON.parse(String(clan.cells[9]||'[]')).map(String);}
  catch(e){throw new Error('Повреждён список участников рода');}
}
function textoriaActiveSymbols_(book,withoutClan) {
  var occupied={};
  textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.clans)).forEach(function(r){
    if(String(r[0])!==String(withoutClan||'')&&String(r[10])!=='Распущен'&&r[4])occupied[String(r[4])]=true;
  });
  textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.citizens)).forEach(function(r){
    if(r[4])occupied[String(r[4])]=true;
  });
  return occupied;
}
function textoriaValidateHeraldry_(symbol,color,shape){
  if(TEXTORIA_SYMBOLS_.indexOf(String(symbol))<0)throw new Error('Неизвестный символ');
  if(!/^#[0-9a-fA-F]{6}$/.test(String(color||'')))throw new Error('Некорректный цвет');
  if(['gothic','kite','round'].indexOf(String(shape))<0)throw new Error('Неизвестная форма щита');
}
function textoriaName_(text,max){
  var name=String(text||'').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>max||!/^[А-Яа-яЁё -]+$/.test(name))
    throw new Error('Используй от 2 до '+max+' русских букв, пробелов или дефисов');
  return name;
}
function textoriaChangeEpithet(initData,epithet){
  var p=textoriaRequirePupil_(initData);
  var name=textoriaName_(epithet,26);
  var c=textoriaCitizen_(p.book,p.id);
  c.sheet.getRange(c.row,3).setValue(name);
  textoriaEvent_(p.book,'epithet_changed',p.id,'Изменён эпитет');
  return {ok:true,displayName:p.name+' '+name};
}
function textoriaCreateClan(initData,name,symbol,color,shape){
  var p=textoriaRequirePupil_(initData),citizen=textoriaCitizen_(p.book,p.id);
  if(citizen.cells[3])throw new Error('Сначала нужно выйти из существующего рода');
  if(['Городской бездельник','Свободный житель'].indexOf(String(citizen.cells[13]))>=0)
    throw new Error('Создать род можно с титула барона или выше');
  var title=textoriaName_(name,34);
  textoriaValidateHeraldry_(symbol,color,shape);
  var clans=textoriaRows_(textoriaSheet_(p.book,TEXTORIA_.tabs.clans));
  if(clans.some(function(r){return String(r[1]||'').toLocaleLowerCase()===title.toLocaleLowerCase()&&String(r[10])!=='Распущен';}))
    throw new Error('Род с таким названием уже существует');
  if(textoriaActiveSymbols_(p.book)[symbol])throw new Error('Этот геральдический символ уже занят');
  var id=Utilities.getUuid(),sh=textoriaSheet_(p.book,TEXTORIA_.tabs.clans);
  sh.appendRow([id,title,p.id,p.id,symbol,color,shape,.10,new Date(),JSON.stringify([p.id]),'Активен']);
  citizen.sheet.getRange(citizen.row,4).setValue(id);
  textoriaEvent_(p.book,'clan_founded',p.id,'Основан род «'+title+'»');
  return {ok:true,clanId:id};
}
function textoriaSubmitClanRequest(initData,clanId) {
  var p=textoriaRequirePupil_(initData),citizen=textoriaCitizen_(p.book,p.id);
  var clan=textoriaClan_(p.book,clanId);
  if(citizen.cells[3])throw new Error('Сначала выйди из своего рода');
  if(Number(citizen.cells[12])<3 && ['Городской бездельник'].indexOf(String(citizen.cells[13]))>=0)
    throw new Error('Для вступления нужно пройти три разных тренажёра');
  if(textoriaMembers_(clan).length>=TEXTORIA_.maxClanSize)throw new Error('В роду нет свободных мест');
  var events=textoriaRows_(textoriaSheet_(p.book,TEXTORIA_.tabs.events));
  if(events.some(function(r){return r[1]==='clan_request'&&String(r[2])===p.id&&String(r[5])==='Ожидает';}))
    throw new Error('У тебя уже есть ожидающее прошение');
  var id=Utilities.getUuid(),desc=JSON.stringify({clanId:clanId,applicant:p.id});
  textoriaSheet_(p.book,TEXTORIA_.tabs.events).appendRow([new Date(),'clan_request',p.id,desc,id,'Ожидает','','']);
  textoriaNotify_(p.book,String(clan.cells[3]),'🏰 Текстория: '+p.name+' просится в род «'+clan.cells[1]+'». Открой Гербовую палату.');
  return {ok:true,requestId:id};
}
function textoriaResolveClanRequest(initData,requestId,approve) {
  var p=textoriaRequirePupil_(initData);
  var e=textoriaSheet_(p.book,TEXTORIA_.tabs.events),rows=textoriaRows_(e);
  var index=rows.findIndex(function(r){return r[1]==='clan_request'&&String(r[4])===String(requestId);});
  if(index<0)throw new Error('Прошение не найдено');
  var r=rows[index];
  if(String(r[5])!=='Ожидает')throw new Error('Прошение уже рассмотрено');
  var detail=JSON.parse(String(r[3])),clan=textoriaClan_(p.book,detail.clanId);
  if(String(clan.cells[3])!==p.id)throw new Error('Прошения рассматривает только глава рода');
  var applicant=textoriaCitizen_(p.book,String(detail.applicant));
  if(applicant.cells[3])throw new Error('Претендент уже вступил в другой род');
  var members=textoriaMembers_(clan);
  if(approve){
    if(members.length>=TEXTORIA_.maxClanSize)throw new Error('Род уже заполнен');
    members.push(String(detail.applicant));
    clan.sheet.getRange(clan.row,10).setValue(JSON.stringify(members));
    applicant.sheet.getRange(applicant.row,4).setValue(String(detail.clanId));
  }
  e.getRange(index+2,6).setValue(approve?'Принято':'Отклонено');
  textoriaNotify_(p.book,String(detail.applicant),approve?
    '🏰 Твоё прошение принято! Добро пожаловать в род «'+clan.cells[1]+'».':
    '🏰 Твоё прошение в род «'+clan.cells[1]+'» отклонено.');
  textoriaEvent_(p.book,'clan_request_resolved',p.id,(approve?'Принято':'Отклонено')+' '+requestId);
  return {ok:true,joined:!!approve};
}
function textoriaWithdrawClanRequest(initData,requestId) {
  var p=textoriaRequirePupil_(initData),sheet=textoriaSheet_(p.book,TEXTORIA_.tabs.events),rows=textoriaRows_(sheet);
  var idx=rows.findIndex(function(r){return r[1]==='clan_request'&&String(r[4])===String(requestId)&&String(r[2])===p.id&&String(r[5])==='Ожидает';});
  if(idx<0)throw new Error('Нет такого ожидающего прошения');
  sheet.getRange(idx+2,6).setValue('Отозвано');
  return {ok:true};
}
function textoriaLeaveClan(initData) {
  var p=textoriaRequirePupil_(initData),citizen=textoriaCitizen_(p.book,p.id);
  if(!citizen.cells[3])throw new Error('Ты сейчас не состоишь в роду');
  var clan=textoriaClan_(p.book,String(citizen.cells[3]));
  var members=textoriaMembers_(clan).filter(function(id){return id!==p.id;});
  clan.sheet.getRange(clan.row,10).setValue(JSON.stringify(members));
  if(!members.length)clan.sheet.getRange(clan.row,11).setValue('Распущен');
  else if(String(clan.cells[3])===p.id) {
    var standings=textoriaRows_(citizen.sheet);
    standings.sort(function(a,b){return (Number(b[10])||0)-(Number(a[10])||0);});
    var next=standings.find(function(c){return members.indexOf(String(c[0]))>=0;});
    if(next)clan.sheet.getRange(clan.row,4).setValue(String(next[0]));
  }
  citizen.sheet.getRange(citizen.row,4).setValue('');
  textoriaEvent_(p.book,'clan_left',p.id,'Покинул род «'+clan.cells[1]+'»');
  return {ok:true};
}
/**
 * Приватный снимок для авторизованного Telegram Mini App.
 * Никаких фамилий, @username, учебных Telegram ID или данных гостя в ответе.
 */
function textoriaSnapshot(initData) {
  var p=textoriaRequirePupil_(initData),book=p.book;
  var citizens=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.citizens)).slice(0,13);
  var clans=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.clans))
    .filter(function(r){return r[0]&&String(r[10])!=='Распущен';});
  var me=citizens.findIndex(function(c){return String(c[0])===p.id;});
  var clanMap={};
  clans.forEach(function(c){clanMap[String(c[0])]=c;});
  return {
    version:1,me:me,
    players:citizens.map(function(c,i){
      return {
        index:i,name:String(c[1]||'Житель'),
        epithet:String(c[2]||''),
        title:String(c[13]||'Городской бездельник'),
        clan:String(c[3]||''),
        rating:Number(c[10])||0,
        attempts:Number(c[11])||0,
        enrolled:String(c[14])==='Активен',
        personalSymbol:String(c[4]||'')
      };
    }),
    clans:clans.map(function(c){
      return {
        id:String(c[0]),name:String(c[1]),symbol:String(c[4]),
        color:String(c[5]),shape:String(c[6]),bonus:Number(c[7])||0,
        members:textoriaMembers_({cells:c}).map(function(uid){
          return citizens.findIndex(function(p){return String(p[0])===uid;});
        }).filter(function(i){return i>=0;})
      };
    })
  };
}
