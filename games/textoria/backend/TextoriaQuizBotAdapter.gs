/**
 * Адаптер к настоящему QuizBot.gs от 20.11.2026 (1738 строк).
 * Code.gs с автопубликациями менять не нужно.
 *
 * ОРИГИНАЛЬНЫЙ BOT-СКРИПТ НЕ ПУБЛИКУЕМ В GITHUB:
 * он содержит внутренний одноразовый гостевой код и служебные параметры.
 *
 * В QuizBot.gs нужны всего 3 точечных вставки (см. README).
 * Здесь отдельно настройка автоматического пересчёта, без второго webhook.
 */
function textoriaInstallRatingTrigger() {
  var handler='textoriaScheduledSync_';
  var triggers=ScriptApp.getProjectTriggers();
  if(!triggers.some(function(t){return t.getHandlerFunction()===handler;}))
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  Logger.log('Текстория: плановый пересчёт учебного рейтинга каждые 5 минут.');
}
function textoriaScheduledSync_() {
  try {
    var update=textoriaCloseExpiredDuels();
    // textoriaCloseExpiredDuels освобождает lock до пересчёта.
    var status=textoriaRebuild();
    Logger.log('Текстория: обработано дуэлей '+update.settled+', игроков '+status.pupils);
  }catch(e){
    console.error('Textoria scheduled sync: '+String(e));
    throw e;
  }
}
function textoriaDryRunMenu_(){
  // Проверка кнопки, без отправки в Telegram.
  var keyboard=e4StudentKeyboard_();
  var buttons=keyboard.keyboard.map(function(row){return row.map(function(b){return b.text;});});
  Logger.log(JSON.stringify(buttons));
  return keyboard;
}
function textoriaCheckIntegration_(){
  // Проверяет листы и модули, обновляет только подготовительные рейтинги.
  var b=SpreadsheetApp.openById(E4_MAIN);
  ['Ученики','Тренажёры','Тренажёры — результаты','Результаты',
   'Текстория — жители','Текстория — рода','Текстория — дуэли',
   'Текстория — события','Текстория — настройки'].forEach(function(name){
     if(!b.getSheetByName(name))throw new Error('Нет листа: '+name);
   });
  if(typeof textoriaWebSnapshot!=='function'||typeof textoriaRebuild!=='function'||
     typeof textoriaHandleTelegramStart_!=='function')
    throw new Error('Не все файлы Текстории добавлены в Apps Script');
  var status=textoriaAudit();
  Logger.log(JSON.stringify(status));
  return status;
}

// Публичная обёртка для выпадающего списка Apps Script.
// Имена с завершающим подчёркиванием редактор может скрывать.
function textoriaCheckIntegration() {
  return textoriaCheckIntegration_();
}
