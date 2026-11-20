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
