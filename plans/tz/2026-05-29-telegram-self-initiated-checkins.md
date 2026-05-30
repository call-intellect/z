---
type: tz
status: draft
feature: telegram-self-initiated-checkins
date: 2026-05-29
revised: 2026-05-29 (rev3 — LLM-классификатор как primary)
related:
  - second-brain/01_projects/telegram-user-flows.md
  - second-brain/01_projects/conversational-channels.md
  - second-brain/01_projects/llm-providers-verified.md
depends_on:
  - 2026-05-29-telegram-checkin-routing.md (Задача 1 — включить `checkin.prompt` в Telegram-роутинг; здесь зависимости от него нет по коду, но логически идёт после)
---

# ТЗ: Утренний план и вечерний отчёт по инициативе сотрудника в Telegram

> Часть «Telegram-функционал» из анализа [`second-brain/01_projects/telegram-user-flows.md`](../../second-brain/01_projects/telegram-user-flows.md) §7.3.
>
> **Никаких новых моделей графа знаний или дашбордов не вводится** — переиспользуем существующие `CheckinParserService`, `DailyCheckInService`, `CheckinResponseHandler`, `/dashboard/operations/daily`.
>
> **Ревизия 3 (2026-05-29):** по решению владельца — классификация «план/отчёт vs остальное» делается через **LLM сразу**, а не через эвристику. Расширяем существующий `QueryClassifierService` (taskType `dialog-classify`) — он уже зовётся на каждое текстовое сообщение в боте, добавление новых intent-значений не вводит лишний LLM-вызов. Эвристика остаётся только как fallback при недоступности LLM (timeout, ошибка провайдера).

## Цель

Сотрудник может сам в любое время написать или сказать боту план дня или итоги дня в свободной форме, и эта запись попадает в тот же структурированный объект `DailyCheckIn` и в тот же дашборд руководителя, что и ответ на cron-приглашение `DailyCheckInPromptCron`. Классификация «это план / это отчёт / это вопрос / это заметка» делается LLM-моделью, не списком фраз.

## Контекст (зачем)

Сейчас в системе два параллельных мира:

1. **Cron спрашивает первым** (`DailyCheckInPromptCron`): в 9:00 локального времени бот шлёт «Какие 1-3 задачи на сегодня?». Ответ через Reply парсится `CheckinParserService` → структурированные `plans/dones/blockers` → запись в `DailyCheckIn` → дашборд `/dashboard/operations/daily`.

2. **Сотрудник пишет первым**: если Иванов в 7:30 пишет боту «план на сегодня: КП Заречному, созвон с дизайнером, отчёт» — текст идёт в обычный `free_note` (память компании). Запись `DailyCheckIn` не создаётся, дашборд про это не знает.

Дыра: **одно и то же по смыслу сообщение** даёт разный результат в зависимости от того, кто написал первым.

## Решение

В `TelegramBotChannelAdapter` существующий метод `classifyIntent` (зовущий `QueryClassifierService.classify`) расширяется на 3 новые intent-категории: `daily_plan_morning`, `daily_report_evening`, `note`. Маппинг в InboundMessage:

| Intent от классификатора | InboundMessage |
|---|---|
| `factual`, `exploratory`, `analytical`, `clone_roleplay` | `chat_query` (без изменений) |
| `daily_plan_morning` | **`daily_checkin_self` (kind=morning)** |
| `daily_report_evening` | **`daily_checkin_self` (kind=evening)** |
| `note` | `free_note` |

LLM-классификатор `dialog-classify` уже работает на каждое сообщение (`BOT_INTENT_CLASSIFIER_ENABLED=true` по умолчанию). Мы **добавляем 3 значения в enum** и расширяем промпт примерами — **никакого нового LLM-вызова не возникает**, нагрузка не растёт.

### Архитектурные решения и обоснование

**Решение 1: LLM primary, эвристика только как fallback при недоступности LLM.**

Текущий `QueryClassifierService.classify`:
- Делает `heuristicClassify(question)` first-pass (быстрая, без LLM). Если поймала — возвращает intent без LLM-вызова.
- Если эвристика null — зовёт LLM.
- При исключении LLM — fallback `intent='factual', source='fallback'`.

В новой версии для **bot-flow**:
- Параметр `skipHeuristicFirstPass: boolean` в `ClassifyInput` (default false для веб-чата, true для бота). Бот передаёт `true` — heuristic-first отключается, LLM зовётся всегда.
- При исключении LLM → не сразу `factual`, а сначала компактная **fallback-эвристика для plan/report** (10 самых очевидных триггеров в первых 30 символах). Если поймала — возвращаем `daily_plan_morning` или `daily_report_evening` с `source='fallback_heuristic'`. Иначе — `factual` с `source='fallback'` (текущее поведение).
- Эвристика **не блокирует** релиз: даже при отсутствии fallback-эвристики plan/report ловится LLM в 100% случаев работы LLM. Триггер-список — страховка на 0.5-1% времени, когда LLM упал.

Аргументы:
- Эвристика не знает про категории plan/report. Срабатывание chat-эвристики на «почему не успел отчёт» вернёт `analytical` (вопрос) — и текст уйдёт в chat_query вместо `daily_checkin_self`. Это уже наблюдалось бы, если бы мы оставили heuristic-first.
- LLM «понимает смысл». Различает «план на день» / «план на отпуск» / «план на квартал».
- Существующий LLM-вызов через цепочку (DeepSeek-flash primary → DeepSeek-pro → Ollama qwen3.5:9b) уже отлажен. Расширение enum не меняет цепочку.
- Стоимость не растёт.

**Решение 2: Расширяем существующий `dialog-classify`, не создаём отдельный `checkin-classify`.**

Аргументы:
- Один LLM-вызов на сообщение вместо двух. Latency и стоимость идентичны текущему состоянию.
- Промпт `dialog-classify` уже принимает на вход «вопрос/высказывание», возвращает intent. Архитектурно симметрично — добавляем категории.
- Минус: промпт становится длиннее (нужно объяснить LLM 7 категорий с примерами). Митигация: размер увеличится на ~30-40 строк, в пределах нормы для DeepSeek.

**Решение 3: При повторе перезаписываем, явно говорим «заменил».**

Не изменилось от предыдущей версии ТЗ.

**Решение 4: Low parser confidence → `DailyCheckIn` с `curatorReview=true` (симметрия с cron-путём).**

Не изменилось от предыдущей версии ТЗ. Это про confidence **парсера структуры** (CheckinParserService), не классификатора.

### Важное разделение: classifier confidence vs parser confidence

Это **два разных** значения, лежащие на разных этапах:

1. **Classifier confidence** (новое) — насколько LLM-классификатор уверен, что это plan/report/note/chat. Возвращается в JSON ответе `dialog-classify`. Если LLM уверен (≥0.7) — мапим intent в InboundMessage. Если не уверен (<0.7 для plan/report) — fall through в `note` (= free_note). Это **не отправляет в curatorReview**, потому что мы не уверены, что это вообще чек-ин. Пусть лучше уйдёт в общий поток памяти, чем в чек-ин с пометкой «оператор, перепроверь».

2. **Parser confidence** (существующее, не меняется) — насколько `CheckinParserService` уверен в разборе на plans/dones/blockers ВНУТРИ распознанного чек-ина. Если <0.6 — создаём `DailyCheckIn` с `curatorReview=true` (как cron-путь сейчас).

Двухступенчатый gate: «классификатор сказал, что это план?» → «парсер разобрал на пункты?». Каждый со своим порогом.

### Закрытие pending `checkin.prompt` notification

Если у сотрудника есть открытый `checkin.prompt` (cron отправил, ответа нет):

1. Если сотрудник пишет **Reply** на сообщение бота — идёт в существующий `tryMatchReplyToProbe` (поведение не меняется).
2. Если сотрудник пишет **НЕ Reply**, классификатор вернул `daily_plan_morning`/`daily_report_evening`, и есть открытый `checkin.prompt` за этот kind+date:
   - `DailyCheckIn.upsertFromParser` обновит placeholder-запись по unique-ключу.
   - **Новое:** в `processSelfInitiated` после upsert ищем `Notification` с `eventType='checkin.prompt'`, `recipientUserId=userId`, `responseStatus='pending'`, payload.checkInKind=kind, payload.dateLocal=dateLocal. Все найденные помечаем `responseStatus='answered'` через `ConversationalService.markAsAnsweredByCheckin(notificationId, userId, { fromSelfInitiated: true })` (новый метод, тонкая обёртка вокруг update-логики `respondToProbe`, но без эмиссии `notification.responded` — иначе `CheckinResponseHandler.handle` сработает ещё раз и зациклит upsert).
   - Без этой правки — open notification висит в `/me/notifications` как «ждёт ответа» вечно.

## Scope

**Входит:**
- LLM-классификация в `QueryClassifierService` — расширение enum на 3 категории + расширение промпта `dialog-classify` + расширение JSON Schema.
- Golden-snapshot тест `classify.snapshot.spec.ts` с фикстурами: 30+ кейсов на каждую новую категорию (`daily_plan_morning`, `daily_report_evening`, `note`) + регрессия 30+ кейсов на старые 4 (чтобы chat_query flow не сломался).
- Параметр `skipHeuristicFirstPass` в `ClassifyInput` (бот ставит true).
- Fallback-эвристика для plan/report при LLM-падении — компактный список 10 триггеров в новом файле `checkin-fallback-triggers.ts`.
- Маппинг в `TelegramBotChannelAdapter.classifyIntent` (расширение возвращаемого типа на `daily_plan_morning | daily_report_evening | chat_query | free_note`).
- Новый InboundMessage type `daily_checkin_self`.
- Handler self-initiated в `CheckinResponseHandler.processSelfInitiated`.
- Поле `source` в `DailyCheckIn` (`cron_prompted` / `self_initiated` / `manual`).
- Patch-скрипт backfill `source` по `notificationId`.
- Закрытие pending `checkin.prompt` notification после self-initiated upsert (`markAsAnsweredByCheckin`).
- Подтверждение от бота с краткой структурой и явным «заменил» при повторной отправке за тот же day+kind.
- Маршрутизация `checkin.ack` через `preferredChannelKinds=[channelKind]` (резолв из `originChannelBindingId`).
- Метрики:
  - `bot_intent_classified_total{intent, source}` — существующая, расширяется новыми intent values.
  - `bot_checkin_intent_classifier_total{kind, source}` — новая, `source ∈ llm | fallback_heuristic | fallback_factual_at_llm_fail`.
  - `bot_daily_checkin_self_total{kind, outcome}` — новая, `outcome ∈ saved | low_parser_confidence_curator_review | no_person | no_membership | error`.
- Дашборд `/dashboard/operations/daily`: visual hint «источник» (cron / самоинициировано / manual).

**Не входит (отдельные задачи):**
- MAX-бот (тот же подход, но отдельная задача — `2026-05-29-max-self-initiated-checkins.md`). Маппинг в адаптере MAX переиспользует тот же `QueryClassifierService`.
- Сшивка «утренний план vs вечерний отчёт» (что обещал — что закрыл).
- Автосоздание задач в трекере из пунктов плана.
- История правок чек-инов (`DailyCheckInRevision`).
- Merge-режим парсера (новый промпт `daily-checkin-update`) — если поймаем жалобы на потерю пунктов при повторе.
- Команда `/plan` или `/report` в боте: противоречит zero-button.

## Технические изменения

### Backend

**Изменения в существующих модулях:**

1. [`backend/src/modules/dialog-layer/services/query-classifier.service.ts`](../../backend/src/modules/dialog-layer/services/query-classifier.service.ts):
   - Расширить `DialogIntent` enum:
     ```ts
     export type DialogIntent =
       | 'factual'
       | 'exploratory'
       | 'analytical'
       | 'clone_roleplay'
       | 'daily_plan_morning'    // NEW
       | 'daily_report_evening'  // NEW
       | 'note';                 // NEW
     ```
   - Добавить параметр `skipHeuristicFirstPass?: boolean` в `ClassifyInput` (default false для backwards-compat).
   - Расширить `ClassifyResult.intent` — теперь возвращает любую из 7 категорий.
   - `parseClassifyJson` — расширить switch на новые значения + добавить alias'ы (`plan`, `plan_morning`, `morning_plan`, `daily_plan` → `daily_plan_morning`; `report`, `report_evening`, `evening_report`, `daily_report` → `daily_report_evening`; `statement`, `note`, `free_note` → `note`).
   - В `classify()` обернуть `heuristicClassify(input.question)` условием `if (!input.skipHeuristicFirstPass && heuristic)`.
   - **В catch-блоке (LLM упал) — новая логика:** сначала `checkinFallbackHeuristic(input.question)` → если поймало plan/report, возвращаем с `source='fallback_heuristic'`. Иначе текущий fallback на `'factual'` с `source='fallback'`.

2. [`backend/src/modules/dialog-layer/prompts/classify.prompt.ts`](../../backend/src/modules/dialog-layer/prompts/classify.prompt.ts):
   - Расширить `DIALOG_CLASSIFY_SYSTEM_PROMPT` — добавить описания 3 новых категорий с примерами. Примерная структура (черновик, итоговый промпт согласует владелец):
     ```
     7 категорий:
     - factual: фактический вопрос (Сколько у нас клиентов?)
     - exploratory: обзорный вопрос (Расскажи про проект Заречного)
     - analytical: причинно-следственный (Почему упала конверсия в марте?)
     - clone_roleplay: ответ от лица сотрудника/роли (Как ответил бы клон CFO?)
     - daily_plan_morning: личный план дня (План на сегодня: X, Y, Z. Сегодня хочу закрыть КП.)
     - daily_report_evening: личный отчёт за день (Итоги: А — сделал, Б — не успел из-за Петрова)
     - note: обычное высказывание/заметка, не подходящее под другие категории
     ```
   - Расширить `DIALOG_CLASSIFY_JSON_SCHEMA`:
     - `intent` enum пополнить 3 значениями.
     - Добавить поле `confidence: number (0-1)`. Сейчас в schema его нет — нужно для **classifier confidence** gate.
   - `buildClassifyUserPrompt({question})` — добавить hint про **позицию** возможных триггеров (в начале сообщения), но **не передавать** список триггеров (LLM должен сам понять смысл).

3. [`backend/src/modules/dialog-layer/prompts/__snapshots__/classify.snapshot.spec.ts`](../../backend/src/modules/dialog-layer/prompts/__snapshots__/classify.snapshot.spec.ts) — **новый файл**:
   - Pattern по образцу `decision-extract.snapshot.spec.ts` / `multi-query.snapshot.spec.ts`.
   - Golden-фикстуры:
     - 30 кейсов на `daily_plan_morning` (включая «сегодня у меня план», «доброе утро, мой план», «итак, планы на день», «hostel-варианты не разговорные»).
     - 30 на `daily_report_evening` (включая «по итогам дня», «что я сегодня сделал», «как прошёл день»).
     - 30 на `note` (включая ловушки: «план на отпуск», «план на квартал», «отчёт квартальный», «итоги встречи»).
     - 30 на 4 старых категории (регрессия chat_query).
   - Хранятся в `__snapshots__/classify-fixtures.json`.

4. [`backend/src/modules/conversational/adapters/telegram-bot/checkin-fallback-triggers.ts`](../../backend/src/modules/conversational/adapters/telegram-bot/checkin-fallback-triggers.ts) — **новый файл**:
   - Pure function `checkinFallbackHeuristic(text): { kind: 'morning' | 'evening' } | null`.
   - 5 morning + 5 evening **самых очевидных** триггеров (план на день, план на сегодня, утренний план, сегодня хочу, на сегодня; итоги дня, отчёт за день, вечерний отчёт, сегодня сделал, по итогам дня).
   - Поиск через `text.toLowerCase().indexOf(trigger) <= 30 - trigger.length`.
   - 100% unit-тестов (5+5 позитивных + 5 ловушек).
   - **Используется только** в `QueryClassifierService.classify` catch-блоке. Не используется в адаптере напрямую.

5. [`backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts`](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts):
   - В `classifyIntent` — расширить тип возврата с `'chat_query' | 'free_note'` на `'chat_query' | 'free_note' | 'daily_plan_morning' | 'daily_report_evening'`.
   - Передавать `skipHeuristicFirstPass: true` в `this.classifier.classify(...)`.
   - **Classifier confidence gate:** если LLM вернул plan/report intent с confidence < 0.7 — fall through в `note` (= free_note). Это защита от слабоуверенных «может быть план».
   - Расширить маппинг:
     ```ts
     if (result.intent === 'daily_plan_morning') return 'daily_plan_morning';
     if (result.intent === 'daily_report_evening') return 'daily_report_evening';
     if (result.intent === 'note') return 'free_note';
     // existing chat-categories → 'chat_query'
     ```
   - В `ingestUpdate` после `classifyIntent` — если `intent === 'daily_plan_morning' | 'daily_report_evening'` → возвращаем `InboundMessage` типа `daily_checkin_self` с `kind` из intent.
   - **Голос:** в `handleVoice` после ASR-транскрипта тот же `classifyIntent` уже вызывается. После расширения он автоматически вернёт plan/report → `daily_checkin_self` (никаких изменений в `handleVoice` не нужно). Smoke перед релизом подтверждает.
   - Метрика `bot_inbound_total{kind='daily_checkin_self'}`.

6. [`backend/src/modules/conversational/types/channel.types.ts`](../../backend/src/modules/conversational/types/channel.types.ts) — расширение `InboundMessage`:
   ```ts
   | { type: 'daily_checkin_self'; userId; tenantId;
       kind: 'morning' | 'evening'; rawText; originChannelBindingId? }
   ```

7. [`backend/src/modules/operations/operations.module.ts`](../../backend/src/modules/operations/operations.module.ts):
   - Подписка `CheckinResponseHandler` на новый event `inbound.daily_checkin_self` через `ConversationalService.subscribeInbound`.

8. [`backend/src/modules/operations/services/checkin-response.handler.ts`](../../backend/src/modules/operations/services/checkin-response.handler.ts):
   - Новый публичный метод `processSelfInitiated({ tenantId, userId, kind, rawText, originChannelBindingId })`:
     - Резолвит `personId` по `(tenantId, userId)`. Нет Person → return, метрика `outcome='no_person'`.
     - Резолвит `dateLocal` через `getLocalDate(now, person.timezone)`.
     - Проверяет `hasCompletedToday` — для `wasReplace` флага в подтверждении.
     - Зовёт `CheckinParserService.parse({tenantId, kind, rawText})`.
     - Зовёт `DailyCheckInService.upsertFromParser({...source: 'self_initiated'})` — **всегда**, даже при parser confidence < 0.6 (поведение симметрично существующему cron-handler'у: curatorReview=true, structured-поля null, raw в rawResponseText).
     - Закрывает pending `checkin.prompt` notification(s) для этого kind+date через `markAsAnsweredByCheckin`.
     - Эмитит `checkin.created` event.
     - Зовёт `sendNotification(eventType='checkin.ack', preferredChannelKinds=[resolveOriginChannelKind(originChannelBindingId)])` с payload для подтверждения.
     - Метрика `bot_daily_checkin_self_total{kind, outcome}`.
   - Существующий `@OnEvent('notification.responded') handle()` не меняется.

9. [`backend/src/modules/operations/services/daily-checkin.service.ts`](../../backend/src/modules/operations/services/daily-checkin.service.ts):
   - Добавить аргумент `source: 'cron_prompted' | 'self_initiated' | 'manual'` в `upsertFromParser`, `upsertInternal`, `createOrUpsertManual`.
   - При upsert `source` пишется/обновляется.

10. [`backend/src/modules/conversational/conversational.service.ts`](../../backend/src/modules/conversational/conversational.service.ts):
    - В `dispatchInbound` — ветка для `type='daily_checkin_self'`.
    - Новый метод `markAsAnsweredByCheckin(notificationId, userId, { fromSelfInitiated: true })` — копия `respondToProbe` без эмиссии `notification.responded` (иначе зациклит).

11. [`backend/src/modules/conversational/types/event-payload.registry.ts`](../../backend/src/modules/conversational/types/event-payload.registry.ts) — новый payload schema:
    ```ts
    const CheckinAckPayloadSchema = z.object({
      kind: z.enum(['morning', 'evening']),
      wasReplace: z.boolean(),
      plansCount: z.number().int().min(0),
      donesCount: z.number().int().min(0),
      blockersCount: z.number().int().min(0),
      lowParserConfidence: z.boolean(),
    });
    // ...
    ['checkin.ack', CheckinAckPayloadSchema],
    ```

12. **Подтверждение от бота.** `formatCheckinAck(payload)` — 4 шаблона:
    - Утро, новая запись, ok confidence: «✅ Принял утренний план. Сохранил: 3 пункта в плане, 1 блокер. Откроется в дашборде руководителя.»
    - Утро, **wasReplace=true**: «✅ Заменил утренний план. Сохранил: 3 пункта в плане. Если хотел дополнить — пришли полный обновлённый план, я не помню предыдущие пункты.»
    - Вечер, новая запись: «✅ Принял вечерний отчёт. Сохранил: 2 сделанных, 1 не закрыто. Дашборд обновлён.»
    - Любой kind, **lowParserConfidence=true**: «✅ Сохранил как [план дня / отчёт за день], но не уверен в разборке. Оператор перепроверит. Если это была не [план / отчёт], напиши «не считать чек-ином», и я перевешу как заметку.»

### База данных

**Новое поле в `DailyCheckIn`:**

```prisma
enum DailyCheckInSource {
  cron_prompted    // ответ на DailyCheckInPromptCron
  self_initiated   // сотрудник написал боту первым
  manual           // создан вручную через POST /me/check-ins
}

model DailyCheckIn {
  // ... существующие поля ...
  source DailyCheckInSource @default(cron_prompted)
}
```

**Миграция и backfill:**
- `bun run prisma:push` (правило `prisma-db-push-rules`).
- **Patch-скрипт `backend/scripts/patch-daily-checkin-backfill-source.ts`:**
  - `UPDATE "DailyCheckIn" SET source='manual' WHERE notificationId IS NULL AND source='cron_prompted'` — записи через web-UI `POST /me/check-ins`.
  - Идемпотентен, можно запускать многократно.
  - `createPrismaClient()` из `_lib/prisma.ts`.
- Регистрация в [`apply-prod-deploy.ts`](../../backend/scripts/apply-prod-deploy.ts) с `phase='update'`, `skipBootstrap=true`.

### Frontend

1. [`frontend/app/(authenticated)/dashboard/operations/daily/`](../../frontend/app/(authenticated)/dashboard/operations/daily) — visual hint «источник» (🌅 cron / ✋ сам / 🖊 manual) + tooltip.
2. ApiDto `DailyCheckInDto` + DomainModel `DailyCheckIn` — поле `source`.

### Интеграции

- LLM: расширение существующего `dialog-classify` (taskType уже зарегистрирован). Цепочка провайдеров (DeepSeek-flash primary → DeepSeek-pro → Ollama qwen3.5:9b) не меняется. **Финальный промпт согласован владельцем 2026-05-29** — текст полного промпта приведён в Приложении А.

### Совместимость с prompt caching (обязательно)

Это важный раздел по правилу [[feedback_llm_prompts_cache_friendly]] — источник: [[../second-brain/02_architecture/llm-cache-status]] (verified 2026-05-25).

**Что у нас работает на нас:**
- Primary провайдер `deepseek-v4-flash` — кэширует с **hit ≈99.9%** и экономией **≈99%** на каждом cache-hit'е. Минимум для кэша — 64 токена, наш SYSTEM ~600-800 токенов (с описаниями, примерами, ловушками) — попадёт целиком.
- Расширенный `DIALOG_CLASSIFY_SYSTEM_PROMPT` — **стабильный текст**, не зависит от пользователя/Org/времени. Идеальный кандидат на кэширование.
- `DIALOG_CLASSIFY_JSON_SCHEMA` — стабильная, тот же объект каждый вызов.
- Переменная часть (вопрос пользователя) — строго в конце через `buildClassifyUserPrompt`. Префикс «Сообщение пользователя: » стабильный.
- `response_format`, `model`, `tools[]`, `tool_choice` — не меняются между вызовами.
- На bot-trafic'е порядка 500-2000 сообщений в день на одну Org — после первых 5-10 вызовов кэш у DeepSeek наполнен, дальше hit-rate ≈99.9%.

**Что нужно сделать в этом ТЗ для cache-friendliness:**

1. **SYSTEM строго стабильный.** После согласования владельцем — НЕ править «по мелочи». Опечатка / переформулировка одного предложения / замена слова = инвалидация всего накопленного кэша по всем Org. Любая правка SYSTEM в будущем — отдельным версионированным шагом с описанием, что меняется и почему. Лучше копить мелкие правки и выкатывать раз в 2-4 недели, чем мутить кэш каждый день.

2. **JSON Schema стабильна.** Расширение enum (например, в будущем добавим `daily_plan_update` для merge-режима) ломает кэш. Это сознательное решение — делать раз и надолго.

3. **`buildClassifyUserPrompt` — НЕ менять префикс** «Сообщение пользователя: ». Поменяете на «Текст: » или «Вопрос: » — старый кэш сразу не сработает на новых сообщениях (это user-часть, она и так не кэшируется целиком, но единообразие префикса помогает на повторных вопросах с тем же текстом).

4. **`temperature` оставляем 0** (как сейчас в dialog-classify) — детерминизм увеличивает воспроизводимость, не влияет на кэш напрямую, но помогает анализу метрик.

5. **`max_tokens=1500`** не меняем (как сейчас). На кэш не влияет (см. таблицу cache-status), но менять без причины — нет смысла.

6. **6 анти-паттернов проверены:**
   - ✅ SYSTEM одинаковый для всех вызовов (это глобальный промпт классификатора).
   - ✅ `tools[]` не используем в dialog-classify.
   - ✅ Переменное в начале user — нет (наш префикс «Сообщение пользователя: » стабильный, question в конце).
   - ✅ `response_format` стабильный (JSON Schema).
   - ✅ Модель одна на цепочке (DeepSeek-flash primary).
   - ✅ `tool_choice` не используем.

**Бюджет экономии:** при 1500 сообщений/день/Org на 100 Org = 150k вызовов/день. С hit-rate ≈99.9% и SYSTEM ~700 токенов экономия по сравнению с no-cache ≈ **(700 × 0.99 × 150_000) токенов × разница цен hit/miss**. Точные суммы зависят от тарифа DeepSeek-flash, но порядок — на 2 порядка дешевле работы без кэша. Это **основной аргумент** в пользу LLM-классификатора вместо «отдельного LLM-вызова на сообщение» — добавление 3 категорий к существующему dialog-classify бесплатно, потому что используем тот же кэшируемый префикс.

**В DoD добавляем проверку:** после деплоя на прод и накопления 10+ вызовов — посмотреть в `AiUsageLog` поле `cachedTokens` для taskType=dialog-classify. Должно быть ≥50% от input_tokens (для первых 10 вызовов — меньше, пока кэш греется). Если 0% — что-то сломали в payload-стабильности, лезть в `LlmRouter` и проверять.
- `CheckinParserService` — не меняется. Smoke на 5 примерах перед релизом.
- Telegram Bot API — не меняется.
- `DailyCheckInPromptCron` — не меняется. `hasCompletedToday` уже фильтрует и self_initiated записи (побочный эффект: сотрудник написал в 7:30 → cron в 9:00 не дёргает).
- `CheckinSentimentAnalyzerWorker` — не меняется (подписан на `checkin.created`).

## Критерии готовности (DoD)

- [ ] LLM-классификатор расширен: enum + промпт + JSON schema.
- [ ] **Golden-snapshot тест `classify.snapshot.spec.ts` зелёный**:
  - 30 фикстур на `daily_plan_morning` (разные формулировки).
  - 30 на `daily_report_evening`.
  - 30 на `note` (включая ловушки: «план на отпуск», «план на квартал», «отчёт квартальный», «итоги встречи»).
  - 30 регрессионных на 4 старых категории.
  - Accuracy ≥0.85 на каждой категории. Если меньше — итерируем промпт, не релизим.
- [ ] `checkinFallbackHeuristic` покрыт unit-тестами (5 morning + 5 evening + 5 ловушек).
- [ ] `CheckinResponseHandler.processSelfInitiated` покрыт unit-тестами: успешный путь, low-parser-confidence (создаёт запись с curatorReview, не уходит в free_note), отсутствие Person, отсутствие Membership, закрытие pending notification, replace-сценарий.
- [ ] `TelegramBotChannelAdapter` ingest unit-тест: текст «план на сегодня:...» → mock LLM возвращает `daily_plan_morning` → InboundMessage type=`daily_checkin_self`. **Голосовой тест**: голос «план на сегодня…» через mock ASR → тот же результат.
- [ ] `markAsAnsweredByCheckin` покрыт unit-тестом: помечает notification answered, **не эмитит `notification.responded`** (проверка через mock EventEmitter).
- [ ] Smoke на проде (запись в `SMOKE.md`):
  - сотрудник пишет «План на день: А, Б, В» → бот «✅ Принял утренний план...», запись в `/dashboard/operations/daily` с значком ✋.
  - «Доброе утро, мой план: А, Б, В» → LLM ловит — то же самое (проверка, что не строго первое слово).
  - «По итогам дня сделал А, не успел Б» → запись вечернего отчёта.
  - «Обсудим план на отпуск» → бот сохраняет как `free_note` (LLM сказал `note`), в `/dashboard/operations/daily` ничего нового.
  - в 9:00 ответил на cron, в 11:00 «обновляю план: ...» → запись обновилась, source=self_initiated, бот «✅ Заменил утренний план… Если хотел дополнить — пришли полный план».
  - голосом «итоги дня…» → запись вечернего отчёта.
  - cron в 9:00 отправил `checkin.prompt`, в 9:30 self-initiated → в `/me/notifications` нет «висящего» pending.
  - **Аварийный сценарий**: вручную отключить DeepSeek (через AdminSetting) → LLM падает → fallback-эвристика ловит «план на день» → запись создаётся с `source='fallback_heuristic'` в метрике.
- [ ] Метрики в `/metrics`:
  - `bot_intent_classified_total{intent='daily_plan_morning' | 'daily_report_evening' | 'note', source='llm'}`.
  - `bot_checkin_intent_classifier_total{kind, source ∈ llm | fallback_heuristic | fallback_factual_at_llm_fail}`.
  - `bot_daily_checkin_self_total{kind, outcome ∈ saved | low_parser_confidence_curator_review | no_person | no_membership | error}`.
- [ ] Frontend колонка «источник» отображается.
- [ ] Backfill patch-скрипт запущен на проде.
- [ ] **Prompt cache работает на проде:** после 10+ вызовов `dialog-classify` через `LlmRouter` проверить в `AiUsageLog` поле `cachedTokens` для taskType=dialog-classify — должно быть ≥50% от input_tokens на устойчивом потоке. Если 0% — значит сломали стабильность payload в `LlmRouter`, остановить релиз и фиксить.
- [ ] `bun run typecheck && bun run lint && bun run build` зелёные в backend и frontend.
- [ ] Second Brain обновлён:
  - [[telegram-user-flows]] §6 + §7.3 — статус «реализовано», убрать «TBD».
  - [[conversational-channels]] — добавить раздел про `daily_checkin_self` InboundMessage и `checkin.ack` event.
  - [[ai-jobs]] (если есть) — обновить запись `dialog-classify` с новыми категориями.
  - Прод-инструкция в [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md) Шаг 4 (Prisma push) + Шаг 6 (patch).

## Риски и ограничения

1. **Регрессия chat_query.** Расширение промпта `dialog-classify` может ухудшить классификацию вопросов. **Главный риск этого ТЗ.** Митигация: golden-snapshot с 30 регрессионными фикстурами на старые 4 категории. Если accuracy < 0.85 на любой — не релизим, итерируем промпт. После релиза — мониторинг метрики `bot_intent_classified_total{intent, source='llm'}` — соотношение `factual / exploratory / analytical / clone_roleplay` не должно драматически измениться.
2. **LLM ошибается на пограничных кейсах.** Например, «план на квартал» может быть классифицирован как `daily_plan_morning`. Митигация: явные ловушки в golden-фикстурах + `confidence < 0.7` gate (если LLM не уверен — fall through в `note`).
3. **Падение LLM-провайдера.** При недоступности всей цепочки (DeepSeek + Ollama) — fallback на эвристику ловит только 5+5 базовых формулировок. Остальное уходит в `factual` → `chat_query`. Это **деградация, не отказ**. Метрика `source='fallback_heuristic'` и `source='fallback_factual_at_llm_fail'` показывают частоту проблемы.
4. **Промпт не покрывает корпоративный жаргон.** Если в Org N сотрудники пишут «to-do на день», «список таск на сегодня», «дневной todo» — golden-фикстуры не покроют, accuracy упадёт в продакшене. Митигация: после 2 недель смотрим метрику `bot_intent_classified_total` — если большая доля `note` со словами «план/итоги/таск/todo» (по log-инспекции) — расширяем промпт.
5. **Стоимость.** Не растёт (LLM уже зовётся для каждого сообщения через `BOT_INTENT_CLASSIFIER_ENABLED=true`).
6. **Latency.** Не растёт (тот же LLM-вызов).
7. **Перезапись теряет контекст «дополнить план».** Митигация — явный текст в подтверждении: «Я заменил план. Если хотел дополнить — пришли полный план». Если жалобы — отдельной задачей делаем merge-промпт.
8. **Поле `source` ломает существующие тесты.** `@default(cron_prompted)` обеспечивает обратную совместимость.
9. **markAsAnsweredByCheckin без эмиссии event'а.** Сознательное отклонение от `respondToProbe` — иначе `CheckinResponseHandler.handle` сработает повторно. Документировано в коде.
10. **Согласование промпта владельцем.** Промпт `dialog-classify` после расширения — изменение существующего LLM-задания, требует согласования по правилам `z-ai-agent-rules` §10 (промпты — отдельный круг согласования с владельцем продукта). Включаем в DoD.

## Будущие апгрейды (не в этом ТЗ)

1. **Merge-режим парсера** — новый промпт `daily-checkin-update`: принимает предыдущие plans + новый rawText, возвращает merge'нутый список. Срабатывает, если LLM-классификатор увидел «дополняю», «обновляю», «добавился» (новый intent `daily_plan_update`).
2. **Сшивка план↔отчёт за день** — утром в плане «А, Б, В», вечером отчёт без упоминания «А» — система помечает «А» как unknown, проактивно спрашивает.
3. **Автосоздание задач из плана** — после успешного morning self-initiated бот спрашивает «создать задачи в трекере из пунктов плана?». Один пункт = одна Issue.
4. **`DailyCheckInRevision`** — таблица истории правок чек-ина. Только если поймали жалобу «заменил план, нужно было дополнить, не вижу что было раньше».
5. **Per-Org промпт корпоративного жаргона** — если в Org активно используются нестандартные термины (todo, таск, дневник), позволить добавлять Org-override в `dialog-classify` промпт. Использует существующий механизм Org-override промптов из admin-content.

## Связь с другими ТЗ

- **Задача 1** (`checkin.prompt` в Telegram-роутинг) — отдельное мини-ТЗ, не блокирует это, логически идёт первой.
- **Задача 2** (Concierge как обработчик `chat_query` из Telegram) — параллельно, без зависимостей. Concierge обрабатывает только `chat_query`, не пересекается с `daily_checkin_self`.
- **Будущее ТЗ** (сшивка план↔отчёт) — потребует эту задачу как фундамент.
- **Будущее ТЗ** (автосоздание задач из плана) — потребует эту задачу.
- **MAX-бот для self-initiated** — отдельная задача, но reused компоненты: `QueryClassifierService` расширенный + `CheckinResponseHandler.processSelfInitiated` + `markAsAnsweredByCheckin`.

## Фазы реализации

- [ ] **Фаза 1 — LLM-классификатор (расширение `dialog-classify`)**
  - Расширить `DialogIntent` enum + `ClassifyInput.skipHeuristicFirstPass` + `ClassifyResult.intent`.
  - Расширить промпт `classify.prompt.ts` (system + JSON schema + примеры). **Согласовать с владельцем.**
  - Расширить `parseClassifyJson` (новые значения + alias'ы).
  - Создать `checkin-fallback-triggers.ts` + unit-тесты.
  - В `classify()` обернуть heuristic-first условием. В catch-блоке — fallback-эвристика для plan/report.
  - Создать golden-snapshot тест `classify.snapshot.spec.ts` (30+30+30+30 фикстур). **Accuracy ≥0.85** на каждой категории — gate релиза.

- [ ] **Фаза 2 — Адаптер бота**
  - Расширить `TelegramBotChannelAdapter.classifyIntent` (тип возврата + маппинг + confidence-gate).
  - В `ingestUpdate` маппинг plan/report intent → InboundMessage type `daily_checkin_self`.
  - `handleVoice` smoke — убедиться, что после ASR классификатор работает.
  - Расширить `InboundMessage` type.
  - Метрики `bot_inbound_total{kind='daily_checkin_self'}`, `bot_checkin_intent_classifier_total{kind, source}`.

- [ ] **Фаза 3 — Модель и source**
  - Prisma: enum `DailyCheckInSource` + поле `source` (default `cron_prompted`).
  - `bun run prisma:push` + `bun run prisma:generate`.
  - Прокинуть `source` через `DailyCheckInService.upsertFromParser/upsertInternal/createOrUpsertManual`.
  - Patch-скрипт `patch-daily-checkin-backfill-source.ts` + регистрация в `apply-prod-deploy.ts`.

- [ ] **Фаза 4 — Handler self-initiated**
  - `CheckinResponseHandler.processSelfInitiated(...)` — публичный метод.
  - `ConversationalService.markAsAnsweredByCheckin(...)` — новый метод без эмиссии event.
  - Unit-тесты handler'а.

- [ ] **Фаза 5 — Подписка, dispatch, подтверждение**
  - `OperationsModule.onModuleInit` — `conversational.subscribeInbound('daily_checkin_self', ...)`.
  - В `ConversationalService.dispatchInbound` — ветка для `daily_checkin_self`.
  - Payload schema `checkin.ack`.
  - `formatCheckinAck(payload)` — 4 шаблона.
  - В `processSelfInitiated` после upsert — `sendNotification(eventType='checkin.ack', preferredChannelKinds=[resolveOriginChannelKind(originChannelBindingId)])`.

- [ ] **Фаза 6 — Frontend**
  - ApiDto + DomainModel `DailyCheckInDto.source`.
  - Колонка/значок «источник» (🌅/✋/🖊) + tooltip.

- [ ] **Фаза 7 — Прод и second brain**
  - Прогон `apply-prod-deploy.ts` (Шаг 4 schema push + Шаг 6 patch).
  - `docs/operations/prod-deploy-log.md` Шаг 4 + Шаг 6.
  - Обновить [[telegram-user-flows]], [[conversational-channels]], [[ai-jobs]].
  - SMOKE.md — 8 сценариев (см. DoD).
  - Метрика в `/metrics` проверена руками.
  - `bun run typecheck && bun run lint && bun run build` — зелёные.

## Приложение А — Согласованный текст промпта `dialog-classify` (расширенный)

> Согласован владельцем 2026-05-29. Изменения после согласования = инвалидация prompt cache. Любая правка — отдельным шагом с обоснованием.

### `DIALOG_CLASSIFY_SYSTEM_PROMPT`

```
Ты — классификатор намерения пользователя в боте компании.
Пользователь пишет в Telegram-бота, и тебе нужно понять, что это
за сообщение, чтобы система отправила его в правильный обработчик.

Возможные намерения (ровно 7 категорий):

──────────────────────────────────────────────────────────────────
ВОПРОСЫ К AI-ЧАТУ КОМПАНИИ (категории 1-4)

1. factual — пользователь хочет факт, цифру, имя, дату, конкретный
   ответ. Один правильный ответ.
   Примеры:
   • «Какой бюджет на маркетинг в марте?»
   • «Кто отвечает за договор с Заречным?»
   • «Сколько встреч было на прошлой неделе?»

2. exploratory — пользователь хочет обзор темы, не ищет один точный
   факт. Просит «рассказать», «показать», «дать полную картину».
   Примеры:
   • «Расскажи, что обсуждали про найм»
   • «Что у нас по проекту КП-2?»
   • «Покажи всё, что есть про клиента Заречный»

3. analytical — пользователь хочет причинно-следственный анализ,
   сравнение, тренд, вывод. Слова «почему», «сравни», «динамика».
   Примеры:
   • «Почему упала конверсия в марте?»
   • «Сравни эффективность каналов рекламы»
   • «Какая динамика по выручке за квартал?»

4. clone_roleplay — пользователь явно хочет ответ от лица конкретного
   сотрудника или роли. В вопросе есть имя сотрудника, или слова
   «в стиле», «как ответил бы», «спроси клон», «клон <роли>».
   Примеры:
   • «Что бы Иван сказал про эту проблему?»
   • «Спроси клон маркетолога про каналы продвижения»
   • «Как ответил бы CFO про этот контракт?»

──────────────────────────────────────────────────────────────────
ЛИЧНЫЙ ПЛАН/ОТЧЁТ СОТРУДНИКА (категории 5-6)

5. daily_plan_morning — пользователь сам рассказывает свой план
   на сегодня или ближайший рабочий день. Это его рабочий план,
   а не вопрос и не идея для будущего.
   Признаки:
   • речь о делах сотрудника на СЕГОДНЯ/завтра (рабочий день)
   • перечисление задач или приоритетов
   • часто в начале сообщения есть слова «план», «планирую»,
     «сегодня хочу», «на сегодня», «утренний план»
   Примеры:
   • «План на день: КП Заречному, созвон с дизайнером, отчёт за апрель»
   • «Доброе утро, мой план на сегодня — добить три задачи по проекту»
   • «Сегодня хочу закрыть КП и созвониться с Петровым»
   • «На сегодня: А, Б, В. Блокер: ТЗ от Петрова не пришло»

6. daily_report_evening — пользователь сам подводит итоги своего
   рабочего дня. Это отчёт о том, что он сделал/не сделал, не вопрос.
   Признаки:
   • речь о делах сотрудника, которые УЖЕ произошли сегодня
   • перечисление «сделал/не сделал/не успел»
   • часто в начале есть слова «итоги дня», «отчёт за день»,
     «сегодня сделал», «по итогам дня», «как прошёл день»
   Примеры:
   • «Итоги дня: КП отправил, созвон перенесли, отчёт не успел»
   • «Сегодня закрыл задачу А, по Б застрял на согласовании»
   • «По итогам дня — две задачи закрыл, одна в работе»
   • «Как прошёл день: норм, закрыл КП, остальное завтра»

──────────────────────────────────────────────────────────────────
ВСЁ ОСТАЛЬНОЕ

7. note — обычное высказывание, заметка, мысль, описание ситуации,
   которое не подходит ни под одну категорию выше.
   Примеры:
   • «Клиент Заречный сказал, что готов подписать в пятницу»
   • «У Петрова болеет ребёнок, переносим встречу»
   • «Идея: добавить в коммерческое раздел про поддержку»

──────────────────────────────────────────────────────────────────
ВАЖНЫЕ ЛОВУШКИ — НЕ ПУТАЙ

⚠ «План на отпуск», «план на квартал», «план на год», «план встречи»,
  «план запуска проекта» — это НЕ daily_plan_morning. Это note (или
  factual/exploratory, если сформулировано как вопрос). daily_plan_morning
  — ТОЛЬКО про рабочий день сегодня/завтра, личный план сотрудника.

⚠ «Отчёт квартальный», «отчёт по проекту», «отчёт о встрече»,
  «итоги встречи», «итоги квартала», «итоги проекта» — это НЕ
  daily_report_evening. Это note. daily_report_evening — ТОЛЬКО про
  итоги текущего рабочего дня сотрудника.

⚠ «Обсудим план на день на встрече», «надо составить план на день
  команде», «у нас есть план на день в Notion» — это note. План
  должен быть СВОИМ и КОНКРЕТНЫМ (с пунктами), а не разговором о
  планах вообще.

⚠ «Что я сегодня сделал?» — это вопрос (factual), а не отчёт. Отчёт
  — это утверждение «сегодня я сделал X», а не вопрос.

⚠ «Почему не успел отчёт?» — это вопрос (analytical), а не отчёт.

⚠ Если сообщение похоже и на план и на заметку — выбирай НЕ план
  (note), если confidence ниже 0.7. Лучше потерять план в общем
  потоке заметок, чем создать ложный отчёт в дашборде руководителя.

──────────────────────────────────────────────────────────────────
ФОРМАТ ОТВЕТА

Отвечай СТРОГО в JSON, без markdown-блоков, без префиксов, без
пояснений:

{"intent": "<категория>", "confidence": <число от 0 до 1>}

confidence — твоя уверенность в классификации:
• 0.9-1.0 — очевидно (явные признаки категории, ловушек нет)
• 0.7-0.89 — уверен (несколько признаков, ловушки исключены)
• 0.5-0.69 — сомневаешься (один признак, есть похожие категории)
• <0.5 — почти угадываешь (лучше выбрать note)

Если сомневаешься между категорией и note — выбирай note и
ставь confidence 0.5-0.6. Система обработает корректно.
```

### `DIALOG_CLASSIFY_JSON_SCHEMA`

```ts
{
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [
        'factual',
        'exploratory',
        'analytical',
        'clone_roleplay',
        'daily_plan_morning',
        'daily_report_evening',
        'note',
      ],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
  },
  required: ['intent', 'confidence'],
  additionalProperties: false,
}
```

### `buildClassifyUserPrompt`

```ts
return `Сообщение пользователя: ${args.question}\n\nКатегория:`;
```

> **Внимание:** префикс «Сообщение пользователя: » — стабильный, не править. Переменная часть (`args.question`) — единственное, что меняется между вызовами.

## Итог

_Заполняется по факту реализации._
