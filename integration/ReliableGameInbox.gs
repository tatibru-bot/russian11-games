/**
 * ЕГЭ 11К — долговечная приёмная очередь Telegram Mini App.
 * ВАЖНО: файл НЕ работает сам по себе. Требуется направить входящие
 * web_app_data в e4GameInboxAccept_ из действующего doPost и создать триггер.
 * Остальные сообщения продолжают обрабатываться прежним маршрутом.
 *
 * Не трогает Code.gs, школьный журнал или рейтинг напрямую.
 * Сохраняет сообщения до обработки, повторно пытается провести неудачные.
 */
const E4_INBOX_PREFIX_ = 'E4_GAME_IN_';
const E4_INBOX_LEASE_ = 'E4_GAME_INBOX_LEASE';
const E4_INBOX_LIMIT_ = 65;  // ограничение количества запросов за минуту
const E4_INBOX_BATCH_ = 20;

function e4GameInboxAccept_(update) {
  if (!update || !update.message || !update.message.web_app_data) return false;
  const id = String(update.update_id);
  if (!/^\d{1,20}$/.test(id)) throw Error('GAME_INBOX invalid update_id');
  const m = update.message;
  if (!m.from || !m.chat || !m.web_app_data || typeof m.web_app_data.data !== 'string')
    throw Error('GAME_INBOX malformed Telegram message');
  const raw = m.web_app_data.data;
  if (Utilities.newBlob(raw).getBytes().length > 4096)
    throw Error('GAME_INBOX excessive payload');
  const key = E4_INBOX_PREFIX_ + id;
  if (CacheService.getScriptCache().get('E4_DONE_' + id)) return true;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) return true;
  // Сохраняем только поля, необходимые e4GameResult_; без лишних данных Telegram.
  const entry = {
    update_id: id, accepted_at: new Date().toISOString(),
    message: {
      from: { id: m.from.id },
      chat: { id: m.chat.id, type: m.chat.type },
      message_id: m.message_id,
      web_app_data: { data: raw }
    }
  };
  const str = JSON.stringify(entry);
  // Apps Script имеет ограничение размера одного Script Property: 9 КБ.
  if (Utilities.newBlob(str).getBytes().length > 8500)
    throw Error('GAME_INBOX message too large for safe storage');
  const pending = Object.keys(props.getProperties()).filter(k => k.startsWith(E4_INBOX_PREFIX_));
  if (pending.length >= E4_INBOX_LIMIT_) throw Error('GAME_INBOX capacity reached');
  props.setProperty(key, str);
  return true;
}

/**
 * Check the actual destination sheet before removing an inbox item.
 * This catches handlers that log an error or send a failure message
 * but do not propagate an exception to the inbox.
 */
function e4GameInboxPersisted_(event) {
  const m = event && event.message;
  const raw = m && m.web_app_data && m.web_app_data.data;
  if (!raw) throw Error('GAME_INBOX missing result payload');
  const p = JSON.parse(raw);
  if (!p || p.v !== 1 || !p.gameId || !p.attemptId ||
      !['game_result','skill_result'].includes(p.type))
    throw Error('GAME_INBOX unsupported payload');
  const userId = String(m.from.id), gameId = String(p.gameId),
        attemptId = String(p.attemptId);
  const book = SpreadsheetApp.openById(E4_MAIN);
  const name = p.type === 'skill_result' ? 'Тренажёры — навыки' :
    'Тренажёры — результаты';
  const sheet = book.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return false;
  // Both destination sheets have gameId in D and attemptId in F;
  // students' Telegram ID is in C for skills and B for results.
  const last = sheet.getLastRow(), rows = sheet.getRange(2, 1, last - 1, 6).getDisplayValues();
  return rows.some(row =>
    String(row[p.type === 'skill_result' ? 2 : 1]) === userId &&
    String(row[3]) === gameId && String(row[5]) === attemptId);
}

function e4GameInboxDrain_() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  let token = '';
  try {
    const current = props.getProperty(E4_INBOX_LEASE_);
    const now = Date.now();
    if (current) {
      const [until] = current.split(':');
      if (Number(until) > now) return;
    }
    token = String(now + 240000) + ':' + String(Math.random()).slice(2);
    props.setProperty(E4_INBOX_LEASE_, token);
  } finally {
    lock.releaseLock();
  }
  try {
    const rows = Object.entries(props.getProperties())
      .filter(([k]) => k.startsWith(E4_INBOX_PREFIX_))
      .sort((a,b) => Number(a[0].slice(E4_INBOX_PREFIX_.length)) -
                      Number(b[0].slice(E4_INBOX_PREFIX_.length)))
      .slice(0, E4_INBOX_BATCH_);
    for (const [key,json] of rows) {
      try {
        const event = JSON.parse(json);
        // Здесь намеренно НЕТ внешней блокировки на весь обработчик:
        // e4SaveGameSkills_ и e4Ege12SkillResult_ уже используют свои блокировки.
        e4GameResult_(event.message);
        if (!e4GameInboxPersisted_(event))
          throw Error('GAME_INBOX handler returned without durable sheet record');
        CacheService.getScriptCache().put('E4_DONE_' + event.update_id, '1', 21600);
        props.deleteProperty(key);
      } catch (err) {
        console.error('GAME_INBOX_RETRY ' + key + ' ' + String(err));
        // При ошибке сообщение остаётся в очереди, не теряется и может быть обработано позже.
      }
    }
  } finally {
    const release = LockService.getScriptLock();
    if (release.tryLock(1000)) {
      try {
        if (props.getProperty(E4_INBOX_LEASE_) === token) props.deleteProperty(E4_INBOX_LEASE_);
      } finally { release.releaseLock(); }
    }
  }
}

/** Запустить вручную 1 раз в редакторе Apps Script, до теста с учениками. */
function e4GameInboxInstallTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(t =>
    t.getHandlerFunction() === 'e4GameInboxDrain_');
  if (!has) ScriptApp.newTrigger('e4GameInboxDrain_').timeBased().everyMinutes(1).create();
  console.log('GAME_INBOX trigger installed/exists');
}
/** Безопасная диагностика: не удаляет сообщения и не выводит их содержание. */
function e4GameInboxHealth_() {
  const props = PropertiesService.getScriptProperties();
  const keys = Object.keys(props.getProperties()).filter(k => k.startsWith(E4_INBOX_PREFIX_));
  console.log('GAME_INBOX pending=' + keys.length);
  console.log('GAME_INBOX trigger=' + ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'e4GameInboxDrain_'));
}
