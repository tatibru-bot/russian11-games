/**
 * Текстория — адаптер защищённого HTMLService интерфейса.
 *
 * Подключить к тому же Apps Script проекту, что QuizBot.gs.
 * НИКАКОЙ doGet или doPost не перезаписываем — добавить
 * маршрут в существующий doGet вручную.
 *
 * Вся авторизация проводится textoriaRequirePupil_ по Telegram initData.
 * Клиент передаёт индекс ученика (0..12), НИКОГДА чужой Telegram ID.
 */

function textoriaWebPage(e) {
  // В HTML файле TextoriaWeb.html только дизайн, без оценок.
  // Передача результатов / изменение таблиц происходят исключительно
  // через textoriaWebSnapshot и textoriaWebAction.
  return HtmlService.createHtmlOutputFromFile('TextoriaWeb')
    .setTitle('Текстория · Королевство ЕГЭ')
    .addMetaTag('viewport','width=device-width,initial-scale=1,viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function textoriaWebAppUrl_() {
  var base=PropertiesService.getScriptProperties().getProperty('TEXTORIA_WEBAPP_URL') ||
           ScriptApp.getService().getUrl();
  if(!base || !/^https:\/\/script\.google\.com\/macros\/s\//.test(base))
    throw new Error('Нужен HTTPS URL опубликованного Apps Script Web App');
  return base.split('?')[0]+'?page=textoria';
}

function textoriaMainMenuButton_() {
  return {text:'👑 Текстория',web_app:{url:textoriaWebAppUrl_()}};
}

function textoriaAddToReplyMenu_(replyKeyboard) {
  // Если главное меню в старом боте — Reply Keyboard, а не Inline Keyboard.
  var rows=(replyKeyboard||[]).slice();
  if(rows.some(function(r){return (r||[]).some(function(b){
    return String(b.text||'').indexOf('Текстория')>=0;
  });}))return rows;
  rows.push([textoriaMainMenuButton_()]);
  return rows;
}

function textoriaAddToMainMenu_(inlineKeyboard) {
  // inlineKeyboard — существующий массив рядов главного меню бота.
  // Не вызывать для /games, /trainers и прочих каталогов игр.
  var rows=(inlineKeyboard||[]).slice();
  if(rows.some(function(r){return (r||[]).some(function(b){
    return String(b.text||'').indexOf('Текстория')>=0;
  });}))return rows;
  rows.push([textoriaMainMenuButton_()]);
  return rows;
}

function textoriaWebPupilId_(book,idx) {
  var i=Number(idx);
  if(!Number.isInteger(i)||i<0||i>=13)throw new Error('Некорректный номер игрока');
  var all=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.students))
    .filter(function(r){return /^\d+$/.test(String(r[0]||''));}).slice(0,13);
  var uid=String(all[i]&&all[i][3]||'');
  if(!all[i] || String(all[i][5]||'')!=='Активен')
    throw new Error('У этого игрока неактивный Telegram-аккаунт');
  if(!/^\d+$/.test(uid))throw new Error('У этого игрока нет привязки Telegram');
  return uid;
}

function textoriaWebSnapshot(initData) {
  var p=textoriaRequirePupil_(initData),book=p.book;
  var snapshot=textoriaSnapshot(initData);
  var citizenRows=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.citizens)).slice(0,13);
  var data=textoriaResultData_(book);
  var duelGlory=textoriaGlory_(book);
  var uidIndex={};
  citizenRows.forEach(function(row,i){
    if(row[0])uidIndex[String(row[0])]=i;
  });
  snapshot.people=snapshot.players.map(function(player,i){
    var row=citizenRows[i]||[],uid=String(row[0]||'');
    var attempts=data[uid]||[];
    var study=textoriaStudyRating_(attempts);
    var byNumber={};
    attempts.forEach(function(r){
      var n=String(r.subject),val=Number(r.subject);
      if(Number.isInteger(val)&&val>=16&&val<=20)return;
      (byNumber[n]||(byNumber[n]=[])).push(r);
    });
    var gameScores={};
    Object.keys(byNumber).forEach(function(n) {
      var records=byNumber[n];
      gameScores[n]={
        n:records.length,
        best:Math.round(Math.max.apply(null,records.map(function(x){return x.accuracy;}))*10)/10,
        rating:Math.round(textoriaRoundScore_(records)*100)/100
      };
    });
    var glory=duelGlory[uid]||0;
    return {
      name:player.name,epithet:player.epithet,title:player.title,
      score:Math.round((study.score+glory)*100)/100,
      study:study.score,duelGlory:glory,
      attempts:study.attempts,distinct:study.differentTrainers,
      covered:study.subjects,lego:study.legoSentences,
      breakdown:study.breakdown,games:gameScores,
      registered:player.enrolled,
      personalSymbol:player.personalSymbol||null,
      personalColor:String(row[5]||'#334e70'),
      personalShape:String(row[6]||'gothic'),
      wasNoble:row[7]===true
    };
  });
  snapshot.clans=snapshot.clans.map(function(c){
    var raw=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.clans))
      .find(function(row){return String(row[0])===c.id;});
    var head=raw ? uidIndex[String(raw[3])] : c.members[0];
    var score=textoriaClanPower_(c.members.map(function(i){
      return {total:snapshot.people[i].score};
    }),c.bonus);
    return {
      id:c.id,name:c.name,color:c.color,symbol:c.symbol,shape:c.shape,
      members:c.members,leader:head===undefined?c.members[0]:head,
      rating:Math.round(score*100)/100
    };
  });
  snapshot.asOf=Utilities.formatDate(new Date(),'Europe/Moscow','dd.MM.yyyy HH:mm');
  snapshot.pending=[];
  var events=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.events));
  var clanHeads={};
  snapshot.clans.forEach(function(c){clanHeads[c.id]=c.leader;});
  events.forEach(function(r) {
    if(r[5]!=='Ожидает')return;
    var type=String(r[1]),payload;
    if(type!=='clan_invitation'&&type!=='clan_request')return;
    try{payload=JSON.parse(String(r[3]||'{}'));}catch(ex){return;}
    if(type==='clan_invitation'){
      var founder=uidIndex[String(payload.founder)],invitee=uidIndex[String(payload.invitee)];
      if(founder===undefined||invitee===undefined)return;
      if(snapshot.me!==founder&&snapshot.me!==invitee)return;
      snapshot.pending.push({
        id:String(r[4]),type:'founding',founder:founder,invitee:invitee,
        name:String(payload.title),symbol:String(payload.symbol),
        color:String(payload.color),shape:String(payload.shape)
      });
    }else{
      var applicant=uidIndex[String(payload.applicant)],clan=String(payload.clanId);
      if(applicant===undefined)return;
      if(snapshot.me!==applicant&&snapshot.me!==clanHeads[clan])return;
      snapshot.pending.push({
        id:String(r[4]),type:'joining',applicant:applicant,house:clan
      });
    }
  });
  snapshot.duels=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.duels)).filter(function(r){
    return String(r[1])===p.id||String(r[2])===p.id;
  }).slice(-25).map(function(r){
    return {
      id:String(r[0]),challenger:uidIndex[String(r[1])],target:uidIndex[String(r[2])],
      gameId:String(r[3]),status:String(r[7]||''),
      acceptedAt:r[5] instanceof Date?r[5].getTime():0,
      deadline:r[6] instanceof Date?r[6].getTime():0,
      bestA:r[8]!==''?Number(r[8]):null,bestB:r[9]!==''?Number(r[9]):null,
      triesA:Number(r[14])||0,triesB:Number(r[15])||0
    };
  }).filter(function(r){return r.challenger!==undefined&&r.target!==undefined;});
  delete snapshot.players;
  return snapshot;
}

function textoriaWebChangeCrest_(initData,data) {
  var p=textoriaRequirePupil_(initData),book=p.book;
  var citizen=textoriaCitizen_(book,p.id);
  var stud=textoriaStudyRating_(textoriaResultData_(book)[p.id]||[]);
  if(stud.differentTrainers<3)throw new Error('Личный герб доступен после трёх разных тренажёров');
  textoriaValidateHeraldry_(data.symbol,data.color,data.shape);
  var reserved=textoriaActiveSymbols_(book);
  var old=String(citizen.cells[4]||'');
  if(reserved[data.symbol]&&old!==data.symbol)throw new Error('Этот символ уже занят');
  citizen.sheet.getRange(citizen.row,5,1,4)
    .setValues([[data.symbol,data.color,data.shape,true]]);
  textoriaEvent_(book,'crest_changed',p.id,'Выбран личный герб');
  return {ok:true};
}

function textoriaWebAction(initData,action,args) {
  var p=textoriaRequirePupil_(initData),book=p.book;
  args=args||{};
  var result;
  switch(action) {
    case 'epithet':
      result=textoriaChangeEpithet(initData,String(args.epithet||''));break;
    case 'crest':
      result=textoriaWebChangeCrest_(initData,args);break;
    case 'found':
      result=textoriaCreateClan(initData,String(args.name||''),
        String(args.symbol||''),String(args.color||''),String(args.shape||''),
        textoriaWebPupilId_(book,args.invitee));break;
    case 'accept_found':
    case 'decline_found':
      result=textoriaRespondClanInvitation(initData,String(args.id),action==='accept_found');break;
    case 'withdraw_found':
      result=textoriaWithdrawClanInvitation(initData,String(args.id));break;
    case 'join':
      result=textoriaSubmitClanRequest(initData,String(args.clanId));break;
    case 'accept_join':
    case 'decline_join':
      result=textoriaResolveClanRequest(initData,String(args.id),action==='accept_join');break;
    case 'withdraw_join':
      result=textoriaWithdrawClanRequest(initData,String(args.id));break;
    case 'leave':
      result=textoriaLeaveClan(initData);break;
    case 'challenge':
      if(textoriaStudyRating_(textoriaResultData_(book)[p.id]||[]).differentTrainers<3)
        throw new Error('Сначала нужно закончить три разных тренажёра');
      result=textoriaChallenge(initData,textoriaWebPupilId_(book,args.target),
        String(args.gameId||''));break;
    case 'accept_duel':
    case 'decline_duel':
      result=textoriaRespondChallenge(initData,String(args.id),action==='accept_duel');break;
    default:throw new Error('Неизвестное действие Текстории');
  }
  return {ok:true,result:result,snapshot:textoriaWebSnapshot(initData)};
}
