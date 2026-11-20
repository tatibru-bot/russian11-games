/**
 * Текстория — серверная надстройка для существующего QuizBot.gs.
 * ВАЖНО: не самостоятельный бот; присоединяется к тому же контейнерному
 * Google Apps Script, в котором уже работает russian11_island_bot.
 * Статистика берётся ТОЛЬКО из проверенной вкладки «Тренажёры — результаты».
 * Никакого приёма игровых процентов непосредственно из браузера здесь нет.
 * 20.11.2026 — этап интеграции, рассылки по умолчанию выключены.
 */
var TEXTORIA_ = {
  tabs: {
    students: 'Ученики', results: 'Тренажёры — результаты',
    citizens: 'Текстория — жители', clans: 'Текстория — рода',
    duels: 'Текстория — дуэли', events: 'Текстория — события',
    settings: 'Текстория — настройки'
  },
  totalSubjects: 26,
  maxDuellingGlory: 12,
  maxClanSize: 4,
  seasonless: true
};

function textoriaBook_() {
  // Работает внутри того же Apps Script, что и QuizBot.gs.
  // При автономном тестировании можно указать ID в Script Properties.
  var id = PropertiesService.getScriptProperties().getProperty('TEXTORIA_SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
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
function textoriaRoundScore_(items, isLego) {
  if (!items.length) return 0;
  if (isLego) {
    // Первое полностью разобранное предложение даёт 40/100, а семь — 100/100.
    // Примечание: окончательное подтверждение уникальности делает ЛЕГОПУНКТ.
    var solved=items.reduce(function(s, a) {return s + a.correct;}, 0);
    return solved ? Math.min(100, 30 + solved * 10) : 0;
  }
  var best = Math.max.apply(null, items.map(function(r) {return r.accuracy;}));
  var recent = items.slice().sort(function(a,b) {return a.at - b.at;}).slice(-5);
  var avg = recent.reduce(function(s, a) {return s + a.accuracy;}, 0) / recent.length;
  var activity = Math.min(10, items.length) / 10 * 100;
  return best * 0.5 + avg * 0.3 + activity * 0.2;
}
function textoriaStudyRating_(items) {
  var subjects = {}, trainers = {}, extra = {words:0, parts:0};
  items.forEach(function(r) {
    trainers[textoriaTrainerIdentity_(r.gameId)] = true;
    (subjects[r.subject] || (subjects[r.subject] = [])).push(r);
  });
  var values = [];
  Object.keys(subjects).forEach(function(n) {
    if (n === 'words' || n === 'parts') {
      extra[n] = textoriaRoundScore_(subjects[n], false);
      return;
    }
    values.push(textoriaRoundScore_(subjects[n], /^LEGO/.test(subjects[n][0].gameId)));
  });
  var quality = values.length ?
    values.reduce(function(s,n){return s+n;},0) / values.length : 0;
  var coverage = values.length / TEXTORIA_.totalSubjects * 100;
  // Качество 65%, разнообразие освоенных номеров 35%.
  // Бонусные тренировки — не основной путь к престолу.
  var score = 0.65 * quality + 0.35 * coverage +
              0.03 * extra.words + 0.02 * extra.parts;
  return {
    score: Math.round(score * 100) / 100,
    attempts: items.length,
    differentTrainers: Object.keys(trainers).length,
    subjects: values.length,
    quality: Math.round(quality * 100)/100
  };
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
    var sorted = all.filter(function(p){return p.eligible;})
      .sort(function(a,b) {return b.total-a.total || b.study.attempts-a.study.attempts || a.index-b.index;});
    var rank = {};
    sorted.forEach(function(p, i){rank[p.index] = i+1;});
    var sh = textoriaSheet_(book, TEXTORIA_.tabs.citizens);
    var oldHeraldry = sh.getRange(2, 8, all.length, 1).getValues();
    var scores = all.map(function(p){return [p.study.score];});
    var bonuses = all.map(function(p){return [p.glory];});
    var titles = all.map(function(p,i) {
      return [textoriaTitle_(rank[p.index] || 0, p.eligible, p.name, oldHeraldry[i][0]===true)];
    });
    sh.getRange(2, 9, all.length, 1).setValues(scores);
    sh.getRange(2, 10, all.length, 1).setValues(bonuses);
    sh.getRange(2, 14, all.length, 1).setValues(titles);
    return {pupils: all.length, eligible: sorted.length, monarch: sorted.length ? sorted[0].name : null};
  } finally {lock.releaseLock();}
}
/** Для ручной или плановой проверки, не меняет исходные результаты тренажёров. */
function textoriaAudit() {
  var book = textoriaBook_();
  var resultRows = textoriaRows_(textoriaSheet_(book, TEXTORIA_.tabs.results));
  return {resultRows: resultRows.length, rating: textoriaRebuild()};
}
