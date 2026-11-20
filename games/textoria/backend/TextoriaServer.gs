/* TextoriaServer.gs — единый серверный файл для добавления в существующий QuizBot.gs.
Не устанавливать одновременно отдельные TextoriaCore/Duels/Clans/BotLaunch/WebGateway.gs!
Код создавался для существующих QuizBot.gs и Code.gs 11 «К».
Токен не хранится здесь; используется TELEGRAM_BOT_TOKEN из Script Properties.
*/


/* ===== TextoriaCore.gs ===== */
/**
 * Текстория — серверная надстройка для существующего QuizBot.gs.
 * ВАЖНО: не самостоятельный бот; присоединяется к тому же контейнерному
 * Google Apps Script, в котором уже работает russian11_island_bot.
 * Статистика берётся из подтверждённых вкладок «Тренажёры — результаты» и «Результаты».
 * Никакого приёма игровых процентов непосредственно из браузера здесь нет.
 * 20.11.2026 — этап интеграции, рассылки по умолчанию выключены.
 */
var TEXTORIA_ = {
  tabs: {
    students: 'Ученики', results: 'Тренажёры — результаты', tests: 'Результаты',
    citizens: 'Текстория — жители', clans: 'Текстория — рода',
    duels: 'Текстория — дуэли', events: 'Текстория — события',
    settings: 'Текстория — настройки'
  },
  totalSubjects: 21, // № 1–15, 21–26; № 16–20 — отдельная активность
  maxDuellingGlory: 12,
  maxClanSize: 4
};

function textoriaBook_() {
  // Работает внутри того же Apps Script, что и QuizBot.gs.
  // При автономном тестировании можно указать ID в Script Properties.
  var id = PropertiesService.getScriptProperties().getProperty('TEXTORIA_SPREADSHEET_ID');
  // QuizBot.gs is standalone: never rely on getActiveSpreadsheet() being non-null.
  return SpreadsheetApp.openById(id || E4_MAIN);
}
function textoriaSheet_(book, name) {
  var sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('Не найдена вкладка: ' + name);
  return sheet;
}
function textoriaRows_(sheet) {
  var last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
}
function textoriaGame_(id) {
  var aliases = {
    TR8_01: 8, TR8_02: 8,
    TR21_DASH: 21, TR21_COLON: 21, TR21_COMMA: 21,
    TR22: 22, TR26: 26, HOSPITAL: 14,
    'ege9-roots': 9, 'ege10-pristavgrad': 10,
    'ege11-cauldron': 11, PARONIMOSKOP: 5,
    LEGO16: 16, LEGO17: 17, LEGO18: 18, LEGO19: 19, LEGO20: 20,
    SLOVAR11: 'words', 'parts-of-speech': 'parts'
  };
  return Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : null;
}
function textoriaTrainerIdentity_(id) {
  // ЛЕГОПУНКТ — один тренажёр с пятью поддисциплинами.
  return /^LEGO(16|17|18|19|20)$/.test(id) ? 'LEGOPUNKT' : id;
}
function textoriaResultData_(book) {
  var raw = textoriaRows_(textoriaSheet_(book, TEXTORIA_.tabs.results));
  var map = {}, dedup = {};
  raw.forEach(function(row) {
    var uid = String(row[1] || '').trim();
    var gameId = String(row[3] || '').trim();
    var kind = textoriaGame_(gameId);
    var attemptId = String(row[5] || '').trim();
    var correct = Number(row[6]), total = Number(row[7]);
    if (!uid || kind === null || !Number.isFinite(correct) ||
        !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total)
      return;
    // Повторная отправка той же попытки не должна давать повторных очков.
    var key = uid + ':' + gameId + ':' + attemptId;
    if (attemptId && dedup[key]) return;
    if (attemptId) dedup[key] = true;
    var e = {
      userId: uid, gameId: gameId, subject: kind, attemptId: attemptId,
      correct: correct, total: total, accuracy: 100 * correct / total,
      at: textoriaTimestamp_(row[0])
    };
    (map[uid] || (map[uid] = [])).push(e);
  });
  // Обычные тесты по № 4 (ударения) и № 7 (морфология) хранятся
  // в другой вкладке. Все полные прохождения учитываются наравне с играми.
  var quizRows = textoriaRows_(textoriaSheet_(book, TEXTORIA_.tabs.tests));
  quizRows.forEach(function(row, idx) {
    var uid=String(row[1]||'').trim(), id=String(row[4]||'');
    var task = /^E4_/.test(id) ? 4 : /^E7_/.test(id) ? 7 : null;
    var correct=Number(row[6]), total=Number(row[7]);
    if(!uid || task===null || !Number.isFinite(correct) ||
       !Number.isFinite(total) || total<=0 || correct<0 || correct>total)return;
    var e={userId:uid,gameId:'QUIZ'+task,subject:task,
      attemptId:'quiz-'+(idx+2),correct:correct,total:total,
      accuracy:100*correct/total,at:textoriaTimestamp_(row[0])};
    (map[uid]||(map[uid]=[])).push(e);
  });
  return map;
}
function textoriaTimestamp_(v) {
  if (v instanceof Date) return v.getTime();
  var s = String(v || '');
  var m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  // Даты результатов в листе записаны по Москве.
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 3, +m[5], +(m[6] || 0));
}
function textoriaRoundScore_(items) {
  if(!items.length)return 0;
  var best=Math.max.apply(null,items.map(function(r){return r.accuracy;}));
  var recent=items.slice().sort(function(a,b){return a.at-b.at;}).slice(-5);
  var avg=recent.reduce(function(total,r){return total+r.accuracy;},0)/recent.length;
  // Максимум 20 очков активности на номер; 11-я попытка не добавляет активность.
  return best*0.5+avg*0.3+Math.min(10,items.length)*2;
}
function textoriaStudyRating_(items) {
  var subjects={},trainers={},legoSentences=0;
  items.forEach(function(r) {
    trainers[textoriaTrainerIdentity_(r.gameId)]=true;
    var number=Number(r.subject);
    if(Number.isInteger(number)&&number>=16&&number<=20) {
      legoSentences+=r.correct; // Только завершённые разборы ЛЕГОПУНКТА.
    } else {
      (subjects[r.subject]||(subjects[r.subject]=[])).push(r);
    }
  });
  var scored=[],words=0,parts=0;
  Object.keys(subjects).forEach(function(k){
    var value=textoriaRoundScore_(subjects[k]);
    if(k==='words'){words=value;return;}
    if(k==='parts'){parts=value;return;}
    var n=Number(k);
    if(Number.isInteger(n)&&((n>=1&&n<=15)||(n>=21&&n<=26)))
      scored.push(value);
  });
  var topFive=scored.slice().sort(function(a,b){return b-a;}).slice(0,5);
  var quality=topFive.reduce(function(total,v){return total+v;},0)/5;
  var qualityPoints=0.60*quality;
  var coveragePoints=30*Math.min(21,scored.length)/21;
  var legoPoints=5*Math.min(20,legoSentences)/20;
  var wordsPoints=0.03*words,partsPoints=0.02*parts;
  var score=qualityPoints+coveragePoints+legoPoints+wordsPoints+partsPoints;
  return {
    score:Math.round(Math.min(100,score)*100)/100,
    attempts:items.length,
    differentTrainers:Object.keys(trainers).length,
    subjects:scored.length,
    quality:Math.round(quality*100)/100,
    legoSentences:legoSentences,
    breakdown:{
      quality:Math.round(qualityPoints*100)/100,
      coverage:Math.round(coveragePoints*100)/100,
      lego:Math.round(legoPoints*100)/100,
      words:Math.round(wordsPoints*100)/100,
      parts:Math.round(partsPoints*100)/100
    }
  };
}
function textoriaClanPower_(members,bonus) {
  // Одиночка и род из одного участника имеют ровно личный рейтинг.
  if(!members.length)return 0;
  var sum=members.reduce(function(total,p){return total+p.total;},0);
  var mean=sum/members.length;
  return members.length>=2 ? mean*(1+bonus) : mean;
}
function textoriaGlory_(book) {
  var totals = {};
  textoriaRows_(textoriaSheet_(book, TEXTORIA_.tabs.duels)).forEach(function(r) {
    if (String(r[7]) !== 'Завершена' || r[12] !== true) return;
    var a = String(r[1]||''), b = String(r[2]||'');
    totals[a] = (totals[a] || 0) + (Number(r[10]) || 0);
    totals[b] = (totals[b] || 0) + (Number(r[11]) || 0);
  });
  Object.keys(totals).forEach(function(k) {
    totals[k] = Math.min(TEXTORIA_.maxDuellingGlory, Math.max(-3, totals[k]));
  });
  return totals;
}
function textoriaIsMale_(name) {
  return ['Игорь','Александр','Даниил','Илья','Василий'].indexOf(name) >= 0;
}
function textoriaTitle_(rank, eligible, name, crestHistory) {
  if (!eligible) return crestHistory ?
    'Свободный житель, потомок бывшей знати' : 'Городской бездельник';
  var male = textoriaIsMale_(name);
  if (rank === 1) return male ? 'Король' : 'Королева';
  if (rank <= 3) return male ? 'Наследник' : 'Наследница';
  if (rank <= 6) return male ? 'Герцог' : 'Герцогиня';
  if (rank <= 10) return male ? 'Граф' : 'Графиня';
  return male ? 'Барон' : 'Баронесса';
}
/**
 * Вызывать после успешной записи game_result в старую таблицу:
 * textoriaRebuild();
 * Это НЕ заменяет существующий учёт для бота и школьного журнала.
 */
function textoriaRebuild() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var book = textoriaBook_();
    var pupils = textoriaRows_(textoriaSheet_(book, TEXTORIA_.tabs.students));
    var saved = textoriaResultData_(book);
    var glory = textoriaGlory_(book);
    var all = pupils.filter(function(r) { return /^\d+$/.test(String(r[0]||'')); })
      .slice(0, 13).map(function(r, index) {
        var uid = String(r[3] || '').trim();
        var name = String(r[1] || '').trim().split(/\s+/).pop();
        var study = textoriaStudyRating_(saved[uid] || []);
        var allowed = !!uid && study.differentTrainers >= 3;
        return {
          index: index, uid: uid, name: name,
          eligible: allowed, study: study, glory: glory[uid] || 0,
          total: study.score + (glory[uid] || 0)
        };
      });
    var sorted=all.filter(function(p){return p.eligible;})
      .sort(function(a,b){return b.total-a.total || b.study.attempts-a.study.attempts || a.index-b.index;});
    var rank={};
    sorted.forEach(function(p,i){rank[p.index]=i+1;});
    var sh=textoriaSheet_(book,TEXTORIA_.tabs.citizens);
    var savedCitizens=textoriaRows_(sh).slice(0,all.length);
    var attached={};
    savedCitizens.forEach(function(c){if(c[3])attached[String(c[0])]=String(c[3]);});
    var candidates=all.filter(function(p){return p.eligible&&!attached[p.uid];})
      .map(function(p){return {power:p.total,leader:p,house:null};});
    textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.clans)).forEach(function(c) {
      if(!c[0]||String(c[10])==='Распущен')return;
      var ids;
      try{ids=JSON.parse(String(c[9]||'[]')).map(String);}catch(e){return;}
      var members=all.filter(function(p){return ids.indexOf(p.uid)>=0;});
      if(!members.length)return;
      // Среднее личных рейтингов всех участников с коалиционным бонусом.
      // Иначе сумма делает одиночное правление заведомо невозможным.
      var bonus=Number(textoriaSetting_(book,'clan_bonus',0.10));
      if(!Number.isFinite(bonus)||bonus<0||bonus>0.25)bonus=0.10;
      var power=textoriaClanPower_(members,bonus);
      var lead=members.slice().sort(function(a,b){return b.total-a.total||a.index-b.index;})[0];
      if(!lead.eligible)return;
      candidates.push({power:power,leader:lead,house:String(c[1])});
    });
    candidates.sort(function(a,b){return b.power-a.power||a.leader.index-b.leader.index;});
    var crown=candidates.length?candidates[0]:null;
    var oldHeraldry=sh.getRange(2,8,all.length,1).getValues();
    var scores=all.map(function(p){return [p.study.score];});
    var bonuses=all.map(function(p){return [p.glory];});
    var titles=all.map(function(p,i){
      var isMonarch=crown&&crown.leader.index===p.index;
      var r=rank[p.index]||0;
      if(r===1&&!isMonarch)r=2;
      return [textoriaTitle_(isMonarch?1:r,p.eligible,p.name,oldHeraldry[i][0]===true)];
    });
    sh.getRange(2,9,all.length,1).setValues(scores);
    sh.getRange(2,10,all.length,1).setValues(bonuses);
    sh.getRange(2,12,all.length,1).setValues(all.map(function(p){return [p.study.attempts];}));
    sh.getRange(2,13,all.length,1).setValues(all.map(function(p){return [p.study.differentTrainers];}));
    sh.getRange(2,14,all.length,1).setValues(titles);
    return {pupils:all.length,eligible:sorted.length,
      monarch:crown?crown.leader.name:null,rulingClan:crown?crown.house:null};
  } finally {lock.releaseLock();}
}
/** Для ручной или плановой проверки, не меняет исходные результаты тренажёров. */
function textoriaAudit() {
  var book = textoriaBook_();
  var resultRows = textoriaRows_(textoriaSheet_(book, TEXTORIA_.tabs.results));
  return {resultRows: resultRows.length, rating: textoriaRebuild()};
}


/* ===== TextoriaDuels.gs ===== */
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
  // The production bot already keeps its token under TELEGRAM_BOT_TOKEN.
  // Do not create a second token or copy secrets into source files.
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN отсутствует в Script Properties');
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
  var digest = textoriaHex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(check).getBytes(),secret));
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
    return {settled:changes};
  }finally{lock.releaseLock();}
}


/* ===== TextoriaClans.gs ===== */
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


/* ===== TextoriaBotLaunch.gs ===== */
/**
 * Мост: каталог Текстории → личный чат существующего бота →
 * КНОПКА Reply Keyboard web_app → исходный тренажёр → sendData → QuizBot.gs.
 *
 * Это не прямой URL на GitHub из обычного браузера: Telegram создаёт
 * именно Keyboard Mini App, в котором исходный sendData уже работает.
 *
 * В существующем обработчике UPDATE добавить ДО обычного /start:
 *   if (textoriaHandleTelegramStart_(update)) return;
 * где update — уже разобранный объект Telegram.
 *
 * Этот файл сам по себе не меняет webhook, меню, токены или старые кнопки.
 */
function textoriaHandleTelegramStart_(update) {
  var message=update && update.message;
  if(!message || !message.from || !message.chat) return false;
  var raw=String(message.text||'').trim();
  var found=raw.match(/^\/start(?:@\w+)?\s+textoria_([A-Za-z0-9_-]{1,50})$/);
  if(!found) return false;
  var gameId=found[1],uid=String(message.from.id||'');
  if(String(message.chat.type||'')!=='private')return true;
  var book=textoriaBook_();
  var pupils=textoriaRows_(textoriaSheet_(book,TEXTORIA_.tabs.students))
    .filter(function(r){return /^\d+$/.test(String(r[0]||''));}).slice(0,13);
  if(!pupils.some(function(p){return String(p[3]||'')===uid;})){
    textoriaReplyKeyboard_(message.chat.id,'Тренажёры Текстории доступны ученикам 11 «К».',null);
    return true;
  }
  var reg=textoriaRows_(textoriaSheet_(book,'Тренажёры'));
  var row=reg.find(function(r){return String(r[0]||'')===gameId;});
  if(!row || !/^https:\/\/tatibru-bot\.github\.io\/russian11-games\/games\/[a-z0-9_-]+\/?$/i.test(String(row[4]||''))){
    textoriaReplyKeyboard_(message.chat.id,'Для этого испытания пока нет подтверждённой ссылки.',null);
    return true;
  }
  var title=String(row[2]||'Испытание').slice(0,75);
  var keyboard={
    keyboard:[[{
      text:'▶ '+title.slice(0,45),web_app:{url:String(row[4])}
    }]],resize_keyboard:true,one_time_keyboard:false
  };
  var home=PropertiesService.getScriptProperties().getProperty('TEXTORIA_URL');
  if(home && /^https:\/\//.test(home))
    keyboard.keyboard.push([{text:'👑 Текстория',web_app:{url:home}}]);
  textoriaReplyKeyboard_(message.chat.id,
    '⚔ Испытание из Текстории: '+title+
    '\n\nОткрой игру кнопкой ниже. После полного раунда нажми «Сохранить результат в Telegram»: он попадёт в обычную учебную статистику и будет учтён Тексторией.',keyboard);
  return true;
}
function textoriaReplyKeyboard_(chatId,text,keyboard) {
  var payload={chat_id:chatId,text:text,disable_web_page_preview:true};
  if(keyboard)payload.reply_markup=keyboard;
  var response=UrlFetchApp.fetch('https://api.telegram.org/bot'+textoriaBotToken_()+'/sendMessage',{
    method:'post',contentType:'application/json',
    payload:JSON.stringify(payload),muteHttpExceptions:true
  });
  var parsed=JSON.parse(response.getContentText()||'{}');
  if(!parsed.ok)throw new Error('Telegram: '+String(parsed.description||'sendMessage failed'));
  return parsed;
}
/**
 * Вызывается ПОСЛЕ записи подтверждённого game_result в
 * «Тренажёры — результаты». Старый учёт/журнал не меняем.
 */
function textoriaAfterGameResult_(result) {
  if(!result || result.type!=='game_result' || !result.attemptId)return;
  try {textoriaRebuild();}
  catch(err) {console.error('Textoria sync error: '+String(err));}
}


/* ===== TextoriaWebGateway.gs ===== */
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
