/**
 * Универсальный учёт диагностических навыков тренажёров 11 «К».
 * Добавить этот файл в ПРОЕКТ APPS SCRIPT бота как GameSkillStats.gs.
 * В QuizBot.gs, внутри e4GameResult_(m), СРАЗУ ПЕРЕД const lines=[...]:
 * e4SaveGameSkills_(book, uid, auth.name, gameId, String(game[2]), attemptId, data);
 *
 * Ничего не изменяет в общем результате ЕГЭ, Code.gs и школьном журнале.
 * При ошибке дополнительной диагностики общий результат остаётся записанным.
 */
function e4SaveGameSkills_(book, uid, pupil, gameId, gameTitle, attemptId, data) {
  try {
    const legacy = {
      TR8_01: 'Грамматическая конструкция · задание',
      TR8_02: 'Грамматическая конструкция · задание',
      HOSPITAL: 'Написание наречия · выбор',
      TR21_DASH: 'Пунктограмма · ведущая категория задания',
      TR21_COLON: 'Пунктограмма · ведущая категория задания',
      TR21_COMMA: 'Пунктограмма · категория задания',
      TR22: 'Средство выразительности · распознавание'
    };
    let category = String(data.diagKind || '').trim();
    let stats = null;
    let names = {};
    if (data.ruleStats && typeof data.ruleStats === 'object' &&
        !Array.isArray(data.ruleStats)) {
      stats = data.ruleStats;
      names = data.ruleNames && typeof data.ruleNames === 'object' &&
        !Array.isArray(data.ruleNames) ? data.ruleNames : {};
      if (!category) category = gameId === 'ege11-cauldron' ? 'word' : 'question';
    } else if (Object.prototype.hasOwnProperty.call(legacy, gameId) &&
               data.tested && typeof data.tested === 'object' &&
               !Array.isArray(data.tested)) {
      stats = {};
      Object.keys(data.tested).forEach(function(label) {
        const count = Number(data.tested[label]);
        const mistakes = Number((data.errors || {})[label] || 0);
        stats['legacy:' + label] = [count, mistakes];
        names['legacy:' + label] = label;
      });
      category = legacy[gameId];
    } else return;

    const entries = Object.entries(stats);
    if (!entries.length || entries.length > 30) return;

    const labels = {
      word: 'Буква в слове · точная ошибка',
      repair: 'Исправление букв после ошибки №9',
      question: 'Тема комплексного задания',
      stage: 'Попытки на этапе разбора',
      lexeme: 'Конкретное словарное слово'
    };
    const evidence = labels[category] || category;
    const output = [];
    entries.forEach(function(item) {
      const ruleId = String(item[0]);
      const values = item[1];
      if (!ruleId || ruleId.length > 130 || !Array.isArray(values) ||
          values.length !== 2) throw Error('Неверный формат правила');
      const tested = Number(values[0]), errors = Number(values[1]);
      if (!Number.isSafeInteger(tested) || tested < 1 || tested > 2000 ||
          !Number.isSafeInteger(errors) || errors < 0 || errors > tested)
        throw Error('Неправильное количество проверок: ' + ruleId);
      // Защита Google Sheets от формул в присланных строках.
      const safe = function(s, maxLen) {
        const x = String(s == null ? '' : s).slice(0, maxLen);
        return /^[=+\-@]/.test(x) ? "'" + x : x;
      };
      const title = safe(names[ruleId] || ruleId.replace(/^legacy:/, ''), 120);
      output.push([
        new Date(), safe(pupil, 120), String(uid),
        safe(gameId, 40), safe(gameTitle, 120), safe(attemptId, 80),
        safe(ruleId, 130), title, tested, errors, tested - errors,
        (tested - errors) / tested,
        safe(evidence + (category === 'lexeme' && data.omittedWords ?
          ' · ещё ' + data.omittedWords + ' слов не включено' : ''), 160)
      ]);
    });

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = book.getSheetByName('Тренажёры — навыки');
      if (!sh) throw Error('Не найдена вкладка «Тренажёры — навыки»');
      const last = sh.getLastRow();
      if (last > 1) {
        // D:F = ID игры, название, ID попытки: повтор не создаёт дублей.
        const prior = sh.getRange(2, 4, last - 1, 3).getDisplayValues();
        if (prior.some(function(r) {
          return r[0] === gameId && r[2] === attemptId;
        })) return;
      }
      const start = last + 1;
      if (start + output.length - 1 > sh.getMaxRows()) {
        sh.insertRowsAfter(sh.getMaxRows(), Math.max(1000, output.length));
      }
      sh.getRange(start, 1, output.length, 13).setValues(output);
      sh.getRange(start, 12, output.length, 1).setNumberFormat('0%');
    } finally {
      try { lock.releaseLock(); } catch (ignored) {}
    }
  } catch (err) {
    console.error('RULE_DIAGNOSTICS ' + gameId + '/' + attemptId + ': ' + String(err));
  }
}
