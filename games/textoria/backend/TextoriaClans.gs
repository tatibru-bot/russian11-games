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
/**
 * Начало рода: один игрок предлагает имя, герб и зовёт второго.
 * До согласия приглашённого в таблице «Текстория — рода» записи НЕТ.
 */
function textoriaCreateClan(initData,name,symbol,color,shape,inviteeId) {
  var p=textoriaRequirePupil_(initData),founder=textoriaCitizen_(p.book,p.id);
  var invitee=String(inviteeId||'');
  if(invitee===p.id||!/^\d+$/.test(invitee))throw new Error('Нужно пригласить другого ученика');
  if(founder.cells[3])throw new Error('Сначала выйди из существующего рода');
  var results=textoriaResultData_(p.book);
  if(textoriaStudyRating_(results[p.id]||[]).differentTrainers<3)
    throw new Error('Для основания рода нужно пройти три разных тренажёра');
  var other=textoriaCitizen_(p.book,invitee);
  if(other.cells[3]||textoriaStudyRating_(results[invitee]||[]).differentTrainers<3)
    throw new Error('Приглашённый игрок пока не может вступить в род');
  var title=textoriaName_(name,34);
  if(!/^Род /.test(title))title='Род '+title;
  textoriaValidateHeraldry_(symbol,color,shape);
  var clans=textoriaRows_(textoriaSheet_(p.book,TEXTORIA_.tabs.clans));
  if(clans.some(function(r){return String(r[1]||'').toLocaleLowerCase()===title.toLocaleLowerCase()&&String(r[10])!=='Распущен';}))
    throw new Error('Такой род уже существует');
  var events=textoriaRows_(textoriaSheet_(p.book,TEXTORIA_.tabs.events));
  if(events.some(function(r){return r[1]==='clan_invitation'&&r[5]==='Ожидает'&&
    (String(r[2])===p.id||JSON.parse(String(r[3]||'{}')).invitee===p.id);}))
    throw new Error('У тебя уже есть ожидающее приглашение');
  var occupied=textoriaActiveSymbols_(p.book);
  events.forEach(function(r){if(r[1]==='clan_invitation'&&r[5]==='Ожидает'){
    try{occupied[JSON.parse(String(r[3])).symbol]=true;}catch(e){}
  }});
  if(occupied[symbol])throw new Error('Этот геральдический символ занят');
  var details={founder:p.id,invitee:invitee,title:title,symbol:symbol,color:color,shape:shape};
  var id=Utilities.getUuid(),sheet=textoriaSheet_(p.book,TEXTORIA_.tabs.events);
  sheet.appendRow([new Date(),'clan_invitation',p.id,JSON.stringify(details),id,'Ожидает','','']);
  textoriaNotify_(p.book,invitee,'🏰 '+p.name+' приглашает тебя основать «'+title+'» в Текстории. Открой раздел родовых союзов.');
  return {ok:true,proposalId:id,status:'Ожидает'};
}
function textoriaRespondClanInvitation(initData,proposalId,accept) {
  var p=textoriaRequirePupil_(initData),sheet=textoriaSheet_(p.book,TEXTORIA_.tabs.events);
  var rows=textoriaRows_(sheet);
  var idx=rows.findIndex(function(r){return r[1]==='clan_invitation'&&String(r[4])===String(proposalId);});
  if(idx<0)throw new Error('Приглашение не найдено');
  var r=rows[idx],info=JSON.parse(String(r[3]||'{}'));
  if(info.invitee!==p.id)throw new Error('Приглашение адресовано другому игроку');
  if(String(r[5])!=='Ожидает')throw new Error('Это приглашение уже рассмотрено');
  if(!accept){sheet.getRange(idx+2,6).setValue('Отклонено');return {ok:true,accepted:false};}
  var founder=textoriaCitizen_(p.book,info.founder),other=textoriaCitizen_(p.book,p.id);
  if(founder.cells[3]||other.cells[3])throw new Error('Один из игроков уже состоит в другом роду');
  var results=textoriaResultData_(p.book);
  if(textoriaStudyRating_(results[info.founder]||[]).differentTrainers<3||
     textoriaStudyRating_(results[p.id]||[]).differentTrainers<3)
    throw new Error('Не выполнено условие трёх разных тренажёров');
  if(textoriaActiveSymbols_(p.book)[info.symbol])throw new Error('Символ уже используется');
  var clanId=Utilities.getUuid(),clans=textoriaSheet_(p.book,TEXTORIA_.tabs.clans);
  clans.appendRow([clanId,info.title,info.founder,info.founder,info.symbol,info.color,info.shape,0.10,new Date(),JSON.stringify([info.founder,p.id]),'Активен']);
  founder.sheet.getRange(founder.row,4).setValue(clanId);
  other.sheet.getRange(other.row,4).setValue(clanId);
  sheet.getRange(idx+2,6).setValue('Принято');
  textoriaEvent_(p.book,'clan_founded',info.founder,'Основан род «'+info.title+'»');
  textoriaRebuild();
  return {ok:true,accepted:true,clanId:clanId};
}
function textoriaWithdrawClanInvitation(initData,proposalId) {
  var p=textoriaRequirePupil_(initData),sheet=textoriaSheet_(p.book,TEXTORIA_.tabs.events);
  var rows=textoriaRows_(sheet),idx=rows.findIndex(function(r){
    return r[1]==='clan_invitation'&&String(r[4])===String(proposalId)&&
      String(r[2])===p.id&&String(r[5])==='Ожидает';
  });
  if(idx<0)throw new Error('Нет такого ожидающего предложения');
  sheet.getRange(idx+2,6).setValue('Отозвано');
  return {ok:true};
}
function textoriaClanForecast(initData,clanId) {
  var p=textoriaRequirePupil_(initData),clan=textoriaClan_(p.book,clanId);
  var citizens=textoriaRows_(textoriaSheet_(p.book,TEXTORIA_.tabs.citizens));
  var members=textoriaMembers_(clan).map(function(uid){
    return citizens.find(function(c){return String(c[0])===uid;});
  }).filter(Boolean);
  var me=textoriaCitizen_(p.book,p.id).cells;
  var score=function(r){return {total:Number(r[10])||0};};
  var before=textoriaClanPower_(members.map(score),0.10);
  var after=textoriaClanPower_(members.concat([me]).map(score),0.10);
  return {current:Math.round(before*100)/100,ifAccepted:Math.round(after*100)/100,
          change:Math.round((after-before)*100)/100};
}
function textoriaSubmitClanRequest(initData,clanId) {
  var p=textoriaRequirePupil_(initData),citizen=textoriaCitizen_(p.book,p.id);
  var clan=textoriaClan_(p.book,clanId);
  if(citizen.cells[3])throw new Error('Сначала выйди из своего рода');
  if(textoriaStudyRating_(textoriaResultData_(p.book)[p.id]||[]).differentTrainers<3)
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
  if(approve)textoriaRebuild();
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
  // Род существует лишь при двух или более членах.
  // При последнем выходе остальных участников возвращаем к самостоятельным.
  if(members.length<2) {
    clan.sheet.getRange(clan.row,11).setValue('Распущен');
    members.forEach(function(uid){
      var alone=textoriaCitizen_(p.book,uid);
      alone.sheet.getRange(alone.row,4).setValue('');
    });
  }
  else if(String(clan.cells[3])===p.id) {
    var standings=textoriaRows_(citizen.sheet);
    standings.sort(function(a,b){return (Number(b[10])||0)-(Number(a[10])||0);});
    var next=standings.find(function(c){return members.indexOf(String(c[0]))>=0;});
    if(next)clan.sheet.getRange(clan.row,4).setValue(String(next[0]));
  }
  citizen.sheet.getRange(citizen.row,4).setValue('');
  textoriaEvent_(p.book,'clan_left',p.id,'Покинул род «'+clan.cells[1]+'»');
  textoriaRebuild();
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
      var members=textoriaMembers_({cells:c}).map(function(uid){
        return citizens.findIndex(function(p){return String(p[0])===uid;});
      }).filter(function(i){return i>=0;});
      var bonus=Number(c[7])||0.10;
      var power=textoriaClanPower_(members.map(function(i){
        return {total:Number(citizens[i][10])||0};
      }),bonus);
      return {
        id:String(c[0]),name:String(c[1]),symbol:String(c[4]),
        color:String(c[5]),shape:String(c[6]),bonus:bonus,
        members:members,rating:Math.round(power*100)/100
      };
    })
  };
}
