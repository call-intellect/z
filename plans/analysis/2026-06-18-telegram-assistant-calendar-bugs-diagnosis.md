# Диагностика: 4 бага помощника Коры в Telegram (календарь + дубли)

> Тип: разбор прод-инцидента (read-only, diag.ts + чтение кода). Код НЕ менялся.
> Дата разбора: 2026-06-18. Инцидент: 2026-06-17.
> Аккаунт: `svmazur@mail.ru` (Сергей, Org «Ооо луа», `userId=cmpndk2so000001mwb2v91d2o`).
> Канал: глобальный Telegram-бот `@kora_bot` → AssistantChannelBridge → ConciergeService.
> ТЗ на исправление: [plans/tz/2026-06-18-telegram-assistant-calendar-fixes.md](../tz/2026-06-18-telegram-assistant-calendar-fixes.md).

## 0. Что пытался сделать пользователь

Сергей через Telegram голосом и текстом просил бота **зафиксировать встречи в календарь**
(«завтра в 10:00 с Александром на молочном заводе», позже — с Никитой на производстве обуви),
и спрашивал «какие у меня сегодня встречи». Бот:

1. в начале **не понял «завтра»** и переспросил дату;
2. на каждое сообщение присылал **по 4–5 почти одинаковых ответов**;
3. на «какие сегодня встречи» **показал встречи за вчера и завтра**.

Все три симптома воспроизведены по прод-логам и объяснены кодом. Найден и 4-й, смежный.

---

## 1. БАГ — дублирование ответов (по 5 сообщений на одно сообщение)

### Доказательство (прод-логи)
`diag logs --search assistant` и `--search telegram` за 2026-06-17:

Серия про Никиту (одно входящее → пять исходящих), `eventType=chat.answer channels=[telegram_bot]`,
**пять разных `notification.id`**:
```
10:12:11.155  sendNotification id=cmqhwwb7n011o… chat.answer → telegram_bot
10:12:25.445  sendNotification id=cmqhwwm83012… chat.answer → telegram_bot
10:12:41.070  sendNotification id=cmqhwwyb0012… chat.answer → telegram_bot
10:12:56.005  sendNotification id=cmqhwx9tl012… chat.answer → telegram_bot
10:12:59.225  sendNotification id=cmqhwxcb8013… chat.answer → telegram_bot
```
Каждой строке предшествует свой `AssistantChannelBridge: assistant_turn handled` и свой
`LlmRouter dispatch success`. Значит это **пять полных переобработок одного входящего**,
а не одна отправка пять раз (тексты в Telegram действительно слегка разные — LLM недетерминирован).
Интервалы **14–15 секунд** = время одного прогона `concierge.process`.

То же в 09:28 (два дубля «Готово — встреча записана») и 09:37–09:38 (серия «Сегодня у вас 2 встречи»).

### Причина (код)
Обработка входящего апдейта **полностью синхронна** и блокирует HTTP-ответ Telegram:

- [telegram-webhooks.controller.ts:343](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L343) — `await this.conversational.dispatchInbound(inbound)` выполняется **до** возврата `{ ok: true }` (200).
- [conversational.service.ts:989-991](../../backend/src/modules/conversational/conversational.service.ts#L989-L991) — `dispatchInbound` делает `await h(msg)` для каждого подписчика (не fire-and-forget).
- [assistant-channel.bridge.ts:252-290](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L252-L290) — `handleAssistantTurn` крутит `for await … concierge.process(...)` — весь tool-loop LLM (14–15 с, а с двумя tool-вызовами и больше).

Итог: 200 отдаётся Telegram/прокси только спустя 14–15+ секунд. Отправитель апдейта
(Telegram Bot API или прокси `telegram.crossmark.ru`) не дожидается ответа в свой таймаут и
**повторяет доставку того же `update_id`**. Каждая повторная доставка снова проходит весь конвейер
и снова шлёт ответ.

Усугубляет: **нигде нет дедупликации по `update_id`** и идемпотентности обработки
(`ingestUpdate` / `dispatchInbound` / `handleAssistantTurn` не проверяют, обрабатывался ли апдейт).

---

## 2. БАГ — «завтра» не распознаётся (переспрос даты)

### Доказательство (прод-логи)
В момент первой попытки записать встречу с Александром:
```
09:27:57.382  [WARN] AllExceptionsFilter  Ошибка валидации входных данных
              {"method":"POST","url":"/api/v1/events","status":400,"code":"validation_error"}
```
То есть бот **попытался** создать событие (`create_event` → `POST /api/v1/events`), но запрос
**упал с 400** — LLM не смог собрать валидный `startAt` (обязательное ISO-8601 поле), потому что
не знал, какое сегодня число, чтобы превратить «завтра» в дату. После этого LLM переспросил
«На какую дату записать встречу в 10:00?». Со второй попытки (после явного ответа пользователя)
событие создалось — `09:28:10 MeetingsService: Calendar Meeting … создан для события cmqhvbpd6…`.

### Причина (код)
LLM-помощнику **нигде не передаётся текущая дата/время и таймзона**:
- системный промпт [concierge-respond.prompt.ts:26-144](../../backend/src/modules/concierge/prompts/concierge-respond.prompt.ts#L26-L144) — даты нет (и не должно быть: SYSTEM обязан быть стабильным ради prompt-cache);
- user-блок [concierge-respond.prompt.ts:164-199](../../backend/src/modules/concierge/prompts/concierge-respond.prompt.ts#L164-L199) (`buildConciergeUserPrompt`) — только summary, история, сообщение;
- контекст-блок [concierge-context-builder.service.ts:24-81](../../backend/src/modules/concierge/services/concierge-context-builder.service.ts#L24-L81) — только имя/email пользователя, Org, pageContext;
- сборка user-блока [concierge.service.ts:724-755](../../backend/src/modules/concierge/services/concierge.service.ts#L724-L755) (`composeConciergeUserBlock`) — даты нет.

Модель физически не может разрешить «завтра/сегодня/в среду» в конкретную дату → либо переспрашивает, либо галлюцинирует.

---

## 3. БАГ — «какие сегодня встречи» возвращает вчера/завтра

Корень — таймзона. Установлено: **пользователь фактически в UTC+7** (createdAt встречи Александр =
`09:28:10Z`, а в клиенте Telegram это «16:28» → смещение ровно +7 ч). При этом
`User.timezone` по умолчанию `Europe/Moscow` (UTC+3) и никто его не менял.

Три накладывающихся дефекта:

1. **LLM не знает дату/TZ** (см. §2) → при вызове `list_my_events` не передаёт корректные `from/to`
   и полагается на серверный дефолт.
2. **Серверный дефолт окна считается в UTC**, не в таймзоне пользователя —
   [events.service.ts:683-700](../../backend/src/modules/events/services/events.service.ts#L683-L700) (`resolveCalendarWindow`):
   ```ts
   // Default — сегодня 00:00 — завтра 00:00 (UTC).
   const start = new Date(now);
   start.setUTCHours(0, 0, 0, 0);   // ← граница дня в UTC
   const end = new Date(start.getTime() + 24*60*60_000);
   ```
   Для пользователя UTC+7 «сегодня по UTC» = промежуток с 07:00 сегодня до 07:00 завтра по местному:
   захватывает кусок **завтра** и теряет раннее утро **сегодня**. Отсюда «вчера и завтра».
3. **`list_meetings` вообще без фильтра даты**, но его описание зовёт использовать его для запроса
   «что у меня было сегодня» — [service-map-generator.service.ts:139-156](../../backend/src/modules/concierge/services/service-map-generator.service.ts#L139-L156).
   Если LLM выберет его, вернутся «последние 20 видеовстреч Коры» вообще без привязки к дню —
   тоже «вчера/завтра вперемешку».

В проекте уже есть TZ-утилита [operations/utils/local-date.ts](../../backend/src/modules/operations/utils/local-date.ts)
(`getLocalDate`, `getLocalHour`, `DEFAULT_TIMEZONE`, на `Intl.DateTimeFormat`, без сторонних либ) —
переиспользуется в фиксе. Не хватает только «начало локального дня → UTC `Date`».

---

## 4. БАГ (смежный) — офлайн-встреча создаётся как онлайн-видеокомната и «проваливается»

### Доказательство (прод-данные)
`diag meetings` — все 4 встречи 17 июня в статусе `failed/team`, причина `never_activated`:
```
01KVAH1WSSJ…  failed/team   Встреча с Никитой — Компания Производство обуви
01KVAEHP3ERZ…  failed/team   Встреча с Александром — молочный завод
01KV9R6NCY…    failed/team   консультация максиму
```
`diag report --meeting 01KVAEHP3ERZ… --json` → `failureReason: "never_activated"`,
событие FSM `scheduled→failed (idle-cron:never_activated)`.
Лог: `Calendar Meeting … создан для события …` — то есть `create_event` создал событие
с `kind=meeting`, что по описанию инструмента «автоматически создаёт LiveKit-комнату».

### Причина
`create_event` ([service-map-generator.service.ts:300-348](../../backend/src/modules/concierge/services/service-map-generator.service.ts#L300-L348))
для «молочный завод» / «производство обуви» (явно **офлайн**-место, `location`) выбирает `kind=meeting`
(онлайн-видео) вместо `kind=offline_meeting`. LiveKit-комната создаётся, но это очная встреча —
в комнату никто не заходит → idle-cron переводит её в `failed`. Это плодит «мусорные» проваленные
видеовстречи и путает пользователя (он хотел запись в календаре, а получает «несостоявшийся созвон»).

Описание `create_event` не объясняет модели, что наличие физического места ⇒ `offline_meeting` (без комнаты).

---

## 5. Сводная таблица причин

| # | Симптом | Корень | Где | Лечится |
|---|---------|--------|-----|---------|
| 1 | 5 дублей ответа | webhook ждёт LLM (15с) перед 200 → ретрай доставки; нет дедупа `update_id` | controller:343, conversational:989, bridge:252 | дедуп `update_id` (Redis SET NX) + ранний ACK |
| 2 | «завтра» не понято | нет NOW+TZ в контексте LLM | concierge prompts/context-builder | добавить дату/время/TZ в USER-блок |
| 3 | «сегодня» = вчера+завтра | (а) §2 + (б) окно в UTC + (в) list_meetings без даты + (г) TZ юзера=Moscow, факт +7 | events.service:695, service-map:142 | окно в TZ юзера; описания инструментов; TZ в контекст |
| 4 | офлайн-встреча → failed видеокомната | `kind=meeting` для очной встречи с местом | service-map:300 (create_event) | правило выбора kind в описании/промпте |

## 6. Принципы решения (для ТЗ)
- **Дата — только в USER-блок, не в SYSTEM** (иначе ломается prompt-cache, feedback `llm_prompts_cache_friendly`).
- Таймзонные расчёты — через существующий `local-date.ts` (Intl, без новых зависимостей).
- Ship-On: фиксы выкатываются включёнными; для переноса webhook-обработки в фон допустим kill-switch.
- Реальную TZ пользователя система всё равно должна знать (сейчас дефолт Moscow) — нужен способ её задать
  (профиль/бот-команда); фикс кода делает систему TZ-корректной, как только TZ задана.
