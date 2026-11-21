/**
 * Неэкзаменационная диагностика «Целую, милая», ЕГЭ №12.
 * Добавить в существующий Google Apps Script проекта Telegram-бота как Ege12SkillDiagnostics.gs.
 * В QuizBot.gs внутри e4GameResult_(m) после JSON.parse(raw), перед отсевом
 * data.type !== 'game_result' вставить:
 *
 * if (data && data.v === 1 && data.type === 'skill_result' &&
 *     data.gameId === 'ege12-celuyu-milaya')
 *   return e4Ege12SkillResult_(m, data);
 *
 * Не касается Code.gs, Текстории и общего рейтинга.
 */
function e4Ege12SkillResult_(m, data) {
  const gameId = 'ege12-celuyu-milaya';
  const modes = {
    drill: 'Тематическая тренировка',
    guide: 'Алгоритм',
    doublet: 'Смысловые двойники',
    errors: 'Повторение ошибок'
  };
  const kinds = {
    word: 'Буква в слове · точная проверка',
    lexeme: 'Ошибочное слово · проверенная форма',
    recovery: 'Исправленное слово · успешное повторение',
    stage: 'Шаг обучающего алгоритма · проверка выбора',
    hint: 'Запрошена подсказка на этапе алгоритма'
  };
  let uid = '';
  try {
    if (!m || !m.from || !m.chat || m.chat.type !== 'private' || !m.web_app_data) return;
    uid = String(m.from.id);
    const auth = e4Auth_(uid);
    if (!auth) return;
    if (!data || data.v !== 1 || data.type !== 'skill_result' || data.gameId !== gameId) return;
    if (Object.prototype.hasOwnProperty.call(data, 'correct') ||
        Object.prototype.hasOwnProperty.call(data, 'total'))
      throw Error('Учебный отчёт не должен содержать correct/total');

    const attemptId = String(data.attemptId || '').trim();
    const mode = String(data.mode || '').trim();
    const topic = String(data.topic || '').trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(attemptId)) throw Error('Некорректный ID попытки');
    if (!Object.prototype.hasOwnProperty.call(modes, mode)) throw Error('Недопустимый режим');
    if (!/^[a-z_-]{2,32}$/.test(topic)) throw Error('Недопустимая тема');
    const stats = data.ruleStats, names = data.ruleNames, types = data.ruleTypes;
    const isPlain = x => x && typeof x === 'object' && !Array.isArray(x);
    if (!isPlain(stats) || !isPlain(names) || !isPlain(types))
      throw Error('Отсутствуют поля учебной диагностики');
    const ids = Object.keys(stats);
    if (ids.length < 1 || ids.length > 40 ||
        Object.keys(names).length > 40 || Object.keys(types).length > 40)
      throw Error('Неправильное число категорий');

    const book = SpreadsheetApp.openById(E4_MAIN);
    const catalog = book.getSheetByName('Тренажёры');
    if (!catalog) throw Error('Нет реестра тренажёров');
    const game = catalog.getDataRange().getValues().slice(1).find(row =>
      String(row[0]).trim() === gameId && String(row[5]).trim() === 'Готов');
    if (!game) throw Error('Игра не активирована в реестре');
    const gameTitle = String(game[2] || 'Целую, милая · ЕГЭ № 12');
    const safe = (value, limit) => {
      let x = String(value == null ? '' : value).slice(0, limit);
      return /^[=+\-@]/.test(x) ? "'" + x : x;
    };
    const output = ids.map(id => {
      if (!/^[A-Za-z0-9:_-]{2,130}$/.test(id)) throw Error('Недопустимый ID навыка');
      const t = stats[id];
      if (!Array.isArray(t) || t.length !== 2) throw Error('Неверный формат проверки');
      const tested = Number(t[0]), mistakes = Number(t[1]);
      if (!Number.isSafeInteger(tested) || !Number.isSafeInteger(mistakes) ||
          tested < 1 || tested > 2000 || mistakes < 0 || mistakes > tested)
        throw Error('Недопустимые счётчики');
      const kind = String(types[id] || '');
      if (!Object.prototype.hasOwnProperty.call(kinds, kind))
        throw Error('Неизвестный тип навыка');
      return [new Date(), safe(auth.name, 120), uid, gameId,
        safe(gameTitle, 120), attemptId, safe('e12:' + id, 130),
        safe(names[id] || id, 120), tested, mistakes, tested - mistakes,
        (tested - mistakes) / tested,
        safe(kinds[kind] + ' · ' + modes[mode] + ' · ' + topic, 160)];
    });
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    let duplicate = false;
    try {
      const sheet = book.getSheetByName('Тренажёры — навыки');
      if (!sheet) throw Error('Не найдена вкладка «Тренажёры — навыки»');
      const last = sheet.getLastRow();
      if (last > 1) {
        const prev = sheet.getRange(2, 3, last - 1, 4).getDisplayValues();
        duplicate = prev.some(row => String(row[0]) === uid &&
          String(row[1]) === gameId && String(row[3]) === attemptId);
      }
      if (!duplicate) {
        const start = last + 1;
        if (start + output.length - 1 > sheet.getMaxRows())
          sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(100, output.length));
        sheet.getRange(start, 1, output.length, 13).setValues(output);
        sheet.getRange(start, 12, output.length, 1).setNumberFormat('0%');
      }
    } finally {
      try { lock.releaseLock(); } catch (ignored) {}
    }
    e4Api_('sendMessage', {chat_id: m.chat.id,
      text: duplicate
        ? '📊 Этот учебный отчёт уже записан. Повторная отправка не создала дубликатов.'
        : '📊 Диагностика № 12 записана: ' + modes[mode] + ' (' +
          output.length + ' категорий). В рейтинг Текстории эта тренировка не входит.'});
  } catch (err) {
    console.error('EGE12_SKILLS ' + uid + ': ' + String(err));
    try {
      e4Api_('sendMessage', {chat_id: m.chat.id,
        text: 'Не удалось сохранить учебную диагностику № 12. Открой игру снова и повтори отправку через «Отчёты для преподавателя». Если ошибка повторится, сообщи учителю.'});
    } catch (ignored) {}
  }
}
