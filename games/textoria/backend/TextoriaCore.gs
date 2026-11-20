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
