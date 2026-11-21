# ЕГЭ №11 — подключение подробной статистики к Telegram-боту

Редакция: 21.11.2026. **Никаких изменений школьного журнала.** Только существующий приватный проект Apps Script бота и наша собственная таблица Telegram.

## Изменение в Apps Script

**Файл:** `QuizBot.gs` (в действующем проекте бота; НЕ `Code.gs`).

**Функция:** `e4GameResult_(m)`.

Найди в этой функции уже существующую строку:

```js
sheet.getRange(sheet.getLastRow(),9).setNumberFormat('0%');
```

**Сразу после неё**, до `const lines=[...`, добавь следующий блок (не заменяй саму функцию и другие участки бота):

```js
  // ЕГЭ №11: диагностика слов по конкретным правилам, отдельно от балла 0–5.
  if (gameId === 'ege11-cauldron' && data.ruleStats &&
      typeof data.ruleStats === 'object' && !Array.isArray(data.ruleStats)) {
    try {
      const detailSheet = book.getSheetByName('Котёл — правила');
      if (!detailSheet) throw Error('Не найдена вкладка Котёл — правила');
      const ruleNames = data.ruleNames && typeof data.ruleNames === 'object'
        && !Array.isArray(data.ruleNames) ? data.ruleNames : {};
      const entries = Object.entries(data.ruleStats);
      if (!entries.length || entries.length > 23) throw Error('Неверное число правил');
      let checkedWords = 0;
      let wrongWords = 0;
      const details = entries.map(function(entry) {
        const id = entry[0], pair = entry[1];
        if (!/^[a-z][a-z0-9-]{1,39}$/.test(id) ||
            !Array.isArray(pair) || pair.length !== 2 ||
            !Number.isSafeInteger(pair[0]) || !Number.isSafeInteger(pair[1]) ||
            pair[0] < 1 || pair[0] > 50 ||
            pair[1] < 0 || pair[1] > pair[0]) {
          throw Error('Некорректная детализация правила ' + id);
        }
        checkedWords += pair[0];
        wrongWords += pair[1];
        const title = String(ruleNames[id] || id).slice(0, 120);
        const passed = pair[0] - pair[1];
        return [new Date(), auth.name, uid, attemptId, id, title,
                pair[0], pair[1], passed, passed / pair[0]];
      });
      // Пять номеров ЕГЭ, по десять вставленных букв в каждом.
      if (checkedWords !== 50 || wrongWords > checkedWords)
        throw Error('Несогласованное число проверенных слов: ' + checkedWords);
      const startRow = detailSheet.getLastRow() + 1;
      detailSheet.getRange(startRow, 1, details.length, 10).setValues(details);
      detailSheet.getRange(startRow, 10, details.length, 1).setNumberFormat('0%');
    } catch (err) {
      // Не ломаем уже записанный экзаменационный балл из-за сбоя диагностики.
      console.error('Ошибка сохранения детализации ЕГЭ №11: ' + String(err));
    }
  }
```

## Что сохранится

- Вкладка `Тренажёры — результаты`: прежние `correct/total = 0..5/5`, `errors` и `tested` без изменений.
- Вкладка `Котёл — правила`: одна строка **на конкретное правило, встреченное в пятёрке**, с количеством проверенных слов, ошибками, правильными ответами и процентом.
- Другие игры не изменяются. Старые попытки не дополняются задним числом: детальные данные для них в бот не передавались.
- Сохранение по каждому `attemptId` происходит только для новой попытки: текущая функция `e4GameResult_` уже проверяет дубликаты **до** нового блока.

## После вставки

1. В редакторе Apps Script нажми **Сохранить**.
2. Меню **Развернуть → Управление развёртываниями**. У существующего веб-приложения нажми **Изменить** (карандаш), выбери **Новая версия**, затем **Развернуть**. Не создавай новый проект и не меняй webhook, если адрес развёртывания не изменился.
3. В личном чате `@russian11_island_bot` открой **🎮 Тренажёры → Адский суффиксный котёл**. Заверши пять экзаменационных заданий и нажми **Сохранить в Telegram**.
4. В нашей таблице Telegram открой вкладку **Котёл — правила**. Должны появиться строки со свежим ID попытки и конкретными правилами. Сумма значений **«Проверено слов»** за одну попытку должна равняться **50**.
5. Убедись, что общая запись в `Тренажёры — результаты` осталась ровно одной и имеет **«Всего» = 5**.

Если результат записан в общей таблице, но нет строк с детализацией, первым делом проверь **Выполнения** в Apps Script на сообщение `Ошибка сохранения детализации ЕГЭ №11`. Пока код в Apps Script не обновлён, игра будет показывать разбор ученику, но сервер подробности не сохранит.
