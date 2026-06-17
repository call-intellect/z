# Инцидент 13.06.2026: помощник в Telegram принял ответ на чек-ин за заказ и зациклился. Разбор + аудит рисков агента и канала

> **Статус:** инцидент потушен владельцем вручную (отозваны ключи/токен — расход LLM остановлен).
> **Severity:** высокая. Сломалась несущая петля привыкания (вечерний чек-ин — «рефлекс рядового»), неконтролируемый расход токенов, и репутационный удар «помощник тупит как обычный ChatGPT» (размывает позиционирование «память компании»).
> **Тип:** анализ (post-mortem + проактивный риск-аудит). Контракт на фикс — отдельным ТЗ в `plans/tz/`.

---

## 1. Что произошло (со слов владельца + лог)

Кора прислала вечерний чек-ин (ежедневный опрос): «Что удалось закрыть сегодня? Есть ли блокеры на завтра? Ответьте текстом или голосом — Кора запишет». Владелец ответил **отчётом о проделанной работе**: «Написание кода, нового дизайна и шаблонов».

Помощник **понял это как заказ на разработку** («нужно написать код, новый дизайн и шаблоны») и начал агентно собирать ТЗ: вывалил простыни из 8–10 пунктов («цель проекта, стек, бюджет, дизайн-гайд…»), затем **повторял почти идентичные сообщения по 5–6 раз подряд без нового ввода** пользователя. Команды «Стоп», «Остановись, ничего не делаем стоп» **не остановили** — на каждую он отвечал очередной простынёй. Поток прекратился только после ручного отзыва ключей.

Три претензии владельца, на которые отвечает этот разбор:
1. Почему помощник **не понял** ответ на чек-ин.
2. Почему он **«долбил каждую секунду»** (лавина одинаковых сообщений).
3. Как сделать, чтобы впредь он отвечал **только по тематике Коры** (не кодил, не писал стихи, не решал математику).

---

## 2. Цепочка обработки (по коду)

Telegram webhook обрабатывается **синхронно, в теле HTTP-запроса**:

1. `POST /api/v1/webhooks/telegram-bot/s/:secret` → `TelegramWebhooksController.processUpdate` ([telegram-webhooks.controller.ts:278](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L278)) — verify secret + dispatch, всё внутри запроса.
2. `adapter.ingestUpdate` → текст → `classifyIntent` ([telegram-bot.adapter.ts:1170](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L1170)) — LLM-классификатор намерения на 7 категорий с гейтом уверенности.
3. Ответ «Написание кода…» **не** получил `daily_report_evening` с confidence ≥ 0.7 (нет маркеров «сделал/закрыл», звучит как перечень тем) → гейт ([adapter.ts:1200](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L1200)) не сработал → intent НЕ чек-ин/задача/план.
4. Флаг `ASSISTANT_CHANNEL_ROUTING_ENABLED=true` (включён 11.06, ТЗ assistant-channels Ф5) → всё свободное (не task/morning/evening) возвращается как `assistant_turn` ([adapter.ts:555](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L555)).
5. `dispatchInbound` → **синхронно** вызывает хендлеры ([conversational.service.ts:985](../../backend/src/modules/conversational/conversational.service.ts#L985)) → `AssistantChannelBridge.handleAssistantTurn` ([assistant-channel.bridge.ts:184](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L184)).
6. Нет pending-confirm (не было мутации) → реплика идёт в `ConciergeService.process` — агентный цикл до `MAX_TOOL_LOOP_ITERATIONS = 5` ([concierge.service.ts:60](../../backend/src/modules/concierge/services/concierge.service.ts#L60), [:601](../../backend/src/modules/concierge/services/concierge.service.ts#L601)).
7. Системный промпт **без границ темы** ([concierge.service.ts:158](../../backend/src/modules/concierge/services/concierge.service.ts#L158)) → модель отвечает как general-purpose ассистент: «помогу написать код, вот вопросы для ТЗ…».
8. Финальный текст → `sendChatReply` (solicited:true + dataClass='internal' — Ф1 «стоп-молчание») ([bridge.ts:337](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L337)) → очередь `conversational.send` ([conversational-queue.ts:12](../../backend/src/modules/conversational/queue/conversational-queue.ts#L12)) → Telegram.

Шаги 2–8 — несколько LLM-вызовов (классификатор + сборка контекста + до 5 итераций concierge + параллельный shadow-PRM скоринг [concierge.service.ts:729](../../backend/src/modules/concierge/services/concierge.service.ts#L729)) — занимают секунды-десятки **внутри одного webhook-запроса**.

---

## 3. Корневые причины

### R1 — Системный промпт помощника без тематических границ ⟵ главный для «отвечает не по теме»
[concierge.service.ts:158-190](../../backend/src/modules/concierge/services/concierge.service.ts#L158). Дословно весь scope: *«Ты — Concierge, AI-помощник в кабинете компании Z (Кора). Отвечай по-русски, кратко и по делу»* + принципы про «не выдумывай / используй search_knowledge». **Нет** запрета на офтоп, **нет** определения домена («только знания/задачи/встречи/люди/решения компании»), **нет** инструкции отказа от того, что вне обязанностей. Поэтому модель по умолчанию ведёт себя как ChatGPT. Whitelist инструментов ([bridge.ts:80](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L80)) ограничивает только **действия через tools**; чистую генерацию текста (ТЗ, код, стихи, математика) — ветка `parsed.kind === 'final'` ([concierge.service.ts:649](../../backend/src/modules/concierge/services/concierge.service.ts#L649)) — **ничто не гейтит**.

### R2 — Ответ на чек-ин не привязан к чек-ину ⟵ главный для «не понял»
Кора за 2 минуты до этого отправила `checkin.prompt`. Но «открытого чек-ина, ждущего ответ» как состояния **нет**. Следующая реплика идёт в общий классификатор, и при неуверенности (<0.7) уходит НЕ в чек-ин, а в агента. Прямой ответ на прямой вопрос Коры теряет контекст вопроса. (Системно: то же касается probe и других проактивных сообщений — см. C3.)

### R3 — Гейт уверенности классификатора односторонний, а «дно» гейта изменилось
`daily_report_evening` требует conf ≥ 0.7, иначе fall-through ([adapter.ts:1200](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L1200)). Раньше fall-through вёл в безобидный `free_note` (молча записать в память). После Ф5 (R6) то же самое «дно» ведёт в **агентного помощника**. «Безопасная деградация» превратилась в «агент берётся за заказ».

### R4 — Лавина: webhook синхронный + нет идемпотентности по `update_id` ⟵ главный для «долбил каждую секунду»
Тяжёлая обработка (LLM) выполняется **в теле webhook'а**, 200-ответ приходит только после всего цикла. Прокси `telegram.crossmark.ru` / Telegram не дожидаются ответа за свой таймаут → **ретраят доставку того же `update`**. `update_id` **нигде не дедуплицируется** → каждый ретрай = новый полный агентный прогон = новый ответ. Отсюда «5 сообщений на 1 ввод, каждую секунду». Контроллер логирует `update_id` ([controller.ts:329](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L329)), но не использует его как ключ идемпотентности.

### R5 — Нет глобальной стоп-команды и анти-флуда в канале
«Стоп/хватит/отмена» **не короткозамыкаются**. Стоп-слова `CONFIRM_NO_WORDS` (включая «стоп», «отмена») ([bridge.ts:127](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L127)) срабатывают **только** когда висит pending-confirm на мутацию ([bridge.ts:190](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L190)). В обычном разговоре «Стоп» — это просто очередной ход → снова в concierge, который из Redis-памяти (24ч) помнит тему и генерит следующий услужливый ответ. Нет и ограничителя «не более N ответов подряд без осмысленного нового ввода» — то есть бесконтрольный исходящий флуд в один чат ничем не тормозится.

### R6 — Флаг Ф5 сменил риск-профиль канала без on-topic фильтра на входе
`ASSISTANT_CHANNEL_ROUTING_ENABLED` ([feature-flags.md:119](../../docs/operations/feature-flags.md)) перенаправил **весь** свободный текст (включая ответы на чек-ин и любой офтоп) в агента. Дефолт канала сместился с «молча записать заметку» на «агент ответит на что угодно» — и это не сопровождено фильтром «по теме компании / офтоп». Свежий флаг (11.06), 13.06 — первый боевой контакт, вскрывший R1–R5 разом.

---

## 4. Прямые ответы на три вопроса владельца

- **Почему не понял ответ?** Связки «ты только что задал вопрос чек-ина → следующая реплика = ответ на него» в системе нет (R2). Классификатор не распознал краткий отчёт как «вечерний отчёт» с нужной уверенностью (R3), и реплика по дефолту ушла в агента (R6), у которого нет границ темы (R1) — он принял отчёт за заказ.
- **Почему долбил каждую секунду?** Webhook обрабатывается синхронно и долго (несколько LLM-вызовов), `update_id` не дедуплицируется, поэтому прокси/Telegram ретраят доставку, и каждый ретрай порождает новый ответ (R4).
- **Почему «Стоп» не работал?** В этой ветке нет понятия стоп-команды — она есть только в узком сценарии подтверждения мутации (R5).

---

## 5. Проактивный аудит: будущие риски АГЕНТА (concierge)

| # | Риск | Где | Последствие |
|---|---|---|---|
| A1 | Офтоп-генерация без границ (R1) | [concierge.service.ts:158](../../backend/src/modules/concierge/services/concierge.service.ts#L158) | Просят стихи/код/математику/переводы → жжёт токены, позорит бренд «память компании» |
| A2 | Дорогой ход: context-build + до 5 LLM-итераций + параллельный shadow-PRM | [concierge.service.ts:601](../../backend/src/modules/concierge/services/concierge.service.ts#L601), [:729](../../backend/src/modules/concierge/services/concierge.service.ts#L729) | Один офтоп-разговор кратно дороже обычного ответа; нет отдельного канального rate-limit (только дневная quota) |
| A3 | Память диалога 24ч (Redis) удерживает тему | [bridge.ts:49](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L49) | Застряв на офтопе, агент продолжает его сутки; нет «сброса темы» |
| A4 | Prompt-injection через внешний канал | [concierge.service.ts:585](../../backend/src/modules/concierge/services/concierge.service.ts#L585) | Есть guard (`sanitizeCustomPrompt`/`withInjectionGuard`), но это наблюдение+обёртка, не отклонение; внешний канал = выше риск |
| A5 | `create_event`/`create_meeting` в SELF-whitelist исполняются без подтверждения, если undoable | [bridge.ts:80](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L80), [concierge.service.ts:682](../../backend/src/modules/concierge/services/concierge.service.ts#L682) | Случайная болтовня может создать реальную встречу/событие (confirmHold ловит только мутации БЕЗ undo) |
| A6 | `MAX_TOOL_LOOP_ITERATIONS=5` при зацикливании на выборе инструмента | [concierge.service.ts:601](../../backend/src/modules/concierge/services/concierge.service.ts#L601), [:664](../../backend/src/modules/concierge/services/concierge.service.ts#L664) | До 5 LLM-итераций на ход впустую (модель выбирает tool вне whitelist → отказ → снова) |
| A7 | service-режим: ToolRouter сам минтит JWT по userId; whitelist по роли | [bridge.ts:391](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L391) | Единая точка доверия; при неверном резолве роли рядовой мог бы получить manager-инструменты (есть fallback на SELF — смягчает) |

## 6. Проактивный аудит: будущие риски КАНАЛА (telegram/conversational)

| # | Риск | Где | Последствие |
|---|---|---|---|
| C1 | Синхронная тяжёлая обработка + ретраи без идемпотентности (R4) | [controller.ts:278](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts#L278) | Повторится на любом медленном ходе (ASR голоса, документ, медленный LLM) |
| C2 | Нет анти-флуда на исходящие в один чат | [bridge.ts:337](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L337) | Любая баг-петля (ретраи, дубли событий, цикл крона) выльется спамом пользователю |
| C3 | Состояние «жду ответа» не хранится ни для чек-ина, ни для probe (R2) | — | Ответы на ЛЮБЫЕ проактивные сообщения Коры (14 eventType) могут не привязаться и уйти в агента |
| C4 | Классификатор — единственный диспетчер, бинарный с порогом; всё вне шаблонов → агент (после Ф5) | [adapter.ts:539](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L539) | Сдвиг дефолта «молча записать» → «агент ответит» не сопровождён on-topic фильтром |
| C5 | Блокировка бота не останавливает генерацию | [admin-telegram-bot.service.ts:845](../../backend/src/modules/admin/system/telegram-bot/admin-telegram-bot.service.ts#L845) | Юзер заблокировал → delivery=failed, но агент уже отработал и потратил токены |
| C6 | Ф1 «стоп-молчание» (solicited bypass) гарантирует доставку каждого хода в канал | [bridge.ts:348](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L348) | Усиливает ощущение «долбит»: агент теперь точно шлёт в Telegram каждый ход |
| C7 | MAX-канал использует тот же assistant-routing | `max-bot.adapter.ts` | Все риски тиражированы на второй канал |

---

## 7. Что делать (приоритеты)

> **Приоритет переставлен (по обратной связи владельца 13.06):** «долбёжка и игнор» — корень инфраструктурный (R4+R5), **промпт тут ни при чём**. Границы темы (R1) — отдельная, меньшая проблема, и её замок — в коде, а не в промпте (методология промптов Z, README §4: гейт «делать/не делать» — правилом в коде, не на LLM).

### P0 — контроль и деньги (корень «долбёжки и игнора»; промпта здесь НЕТ)
1. **Идемпотентность webhook по `update_id` + быстрый ack** (R4). Redis `SET tg:update:<id> NX EX 600` на входе → повтор игнорируется; тяжёлую обработку из тела webhook в фон/очередь. Убирает «каждые 3 секунды» в корне.
2. **Глобальная стоп-команда + анти-флуд** (R5/C2). «Стоп/хватит/отмена» короткозамыкает ход, сбрасывает память диалога и ставит silence; лимит N исходящих/мин на chat — страховка от любой петли.

### P1 — понимание (корень «не понял»)
3. **Привязка ответа к открытому чек-ину/probe** (R2/C3). Метка «жду ответа» в Redis при отправке `checkin.prompt`/`probe`; следующая реплика по умолчанию = ответ на чек-ин, не агент.
4. **Замок темы: on-topic гейт В КОДЕ + блок роли/границ в промпте** (R1/R6). Дешёвый классификатор on/off-topic на входе `assistant_turn`; офтоп → вежливый отказ, агент не запускается. Промпт-блок роли — вторая линия. Гейт-решение — код (методология §4), LLM лишь классифицирует.
5. **Confirm для `create_event`/`create_meeting` в канале** (A5). Даже undoable-мутации из случайной болтовни не должны молча создавать сущности.

### P2
6. Аудит всех 14 проактивных `eventType` на «ожидание ответа» (C3 системно).
7. Anti-injection: от наблюдения к мягкому отклонению на внешних каналах (A4).
8. Тиражировать P0–P1 на MAX (C7).

### Порядок включения
`ASSISTANT_CHANNEL_ROUTING_ENABLED` обратно — только после P0 (1–2). До этого канал на старом узком роутере (free_note).

---

## 8. Что НЕ проверено в этом проходе (для честной полноты)

Прочитаны и подтверждены кодом: telegram-bot.adapter, telegram-webhooks.controller, assistant-channel.bridge, conversational.service (dispatchInbound), concierge.service (system prompt + main loop), feature-flags.md. **Не дочитаны детально** (следующий слой для 100% покрытия):
- `query-classifier.service.ts` — точные пороги/категории, поведение при таймауте LLM (что реально вернул классификатор на спорной фразе).
- `conversational-send.worker.ts` — политика attempts/backoff исходящей очереди (умножает ли доставку при сбое).
- `tool-router.service.ts` — RBAC-гейт каждого вызова в service-режиме (граница A7).
- `concierge-quota.service.ts` — дневные лимиты как страховка от расхода.
- `max-bot.adapter.ts` — паритет рисков второго канала.

Точные значения инцидента (какой intent/confidence вернул классификатор, число ретраев) подтверждаются прод-инструментом `diag.ts` (read-only) — требует явного «можно в прод» владельца на сессию.

---

## 8.1 Реальные данные из прода (diag.ts, окно 15:02–15:17 UTC 13.06)

Не гипотезы — прод-логи `/api/v1/platform/logs`:
- **40 прогонов помощника** («assistant_turn handled») за 15 минут; местами интервал **2–3 сек** (15:08:07→15:08:09).
- Все — **один `userId`** (владелец) и **один `conversationId`** (`cmqchhuo…`): память диалога склеила всё в один разговор. `messageId` у каждого разный (каждый прогон писал новый ответ). `outcome: ok` — реальные платные LLM-ответы.
- Каждый прогон — **отдельный HTTP-запрос вебхука** (разные `requestId`), все через прокси-путь `/api/v1/webhooks/telegram-bot/s/…`. ~6 реплик владельца → ~40 доставок ⇒ **прокси переотправлял каждую ~6–7 раз** (синхронная обработка не отдавала 200 за таймаут). Это и есть R4 на данных.
- В хронологии между двумя «handled» — **десятки `LlmRouter dispatch success`** и повторяющийся **`deepseek-v4-flash: ответ не прошёл validate → fallback`** (15:00:43, 15:01:05, …, 15:08:14). Дешёвая flash-модель раз за разом отдавала негодный ответ → роутер переключал модель → ход дольше → больше ретраев. **Новый корень-усилитель R7.**
- С **15:16:10** — `DeepSeek 401 Authentication Fails, api key ****d042 invalid`: момент, когда владелец убил ключи; лавина затухла. Подтверждает, что остановило именно отключение ключей.

### Инструменты помощника (что у агента «в руках»)
Статический whitelist ([service-map-generator.service.ts:137](../../backend/src/modules/concierge/services/service-map-generator.service.ts#L137)); канальный набор для роли «сотрудник» ([assistant-channel.bridge.ts:80](../../backend/src/modules/concierge/services/assistant-channel.bridge.ts#L80)): `list_tasks`, `list_meetings`, `list_my_events`, `create_event`, `create_meeting`, `find_free_slot`, `search_knowledge`, `ask_chat_v2`; manager+ добавляет `get_person_pulse`, `get_team_health`, `list_overdue_promises`, `get_sprint_status`, `list_user_events`. Выполняются от `userId` с RBAC (service-mode JWT, [tool-router.service.ts:102](../../backend/src/modules/concierge/services/tool-router.service.ts#L102)). **Гейтят только действия — генерацию текста не по теме не ограничивают.**

### Два корня, вскрытые на разборе (дополнение к R1–R6)
- **R8 — Классификатор слеп к истории диалога.** `ClassifyInput` = одна строка `question`; `conversationId` идёт только меткой в лог, история НЕ грузится ([query-classifier.service.ts:89](../../backend/src/modules/dialog-layer/services/query-classifier.service.ts#L89), [:233](../../backend/src/modules/dialog-layer/services/query-classifier.service.ts#L233)); Telegram передаёт `conversationId: null`. Поэтому ответ-отчёт после вопроса Коры не опознаётся как ответ — классификатору не с чем связать. **Лечение шире метки чек-ина (Ф3): дать классификатору последние ~4 сообщения канала, включая исходящие Коры.**
- **R9 — Промпт не знает, ЧЕЙ помощник.** Системный промпт зовёт себя «AI-помощник в кабинете компании Z (Кора)» ([concierge.service.ts:159](../../backend/src/modules/concierge/services/concierge.service.ts#L159)); контекст — только `Организация: <имя> (<slug>)` ([context-builder:44](../../backend/src/modules/concierge/services/concierge-context-builder.service.ts#L44)), без описания бизнеса. Нужна per-tenant переменная: «помощник компании _<name>_, которая занимается _<описание>_; отвечает по базе знаний этой компании».

## 9. Открытые решения владельца (для ТЗ)
- **Р-1.** Механизм границ темы: только промпт (дёшево, но модель иногда сорвётся) / промпт + on-topic гейт-классификатор (дороже на 1 дешёвый вызов, но надёжно отсекает офтоп до агента). Рекомендация: **оба** (промпт как база, гейт как замок).
- **Р-2.** Что считать «по теме»: только домен компании (знания/задачи/встречи/люди/решения/цели) — а общие рабочие вопросы («как написать письмо клиенту») разрешать или нет? Рекомендация: разрешать рабочее-в-контексте-компании, отказывать в чистом офтопе (код/стихи/математика/общие знания).
- **Р-3.** Включать `ASSISTANT_CHANNEL_ROUTING_ENABLED` обратно только после P0 (границы + гейт + идемпотентность). До этого — канал на старом узком роутере (free_note).
