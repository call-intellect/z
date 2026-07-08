---
type: project
status: active
updated: 2026-07-05
related:
  - 01_projects/probe-agent.md
  - 01_projects/probe-observers-catalog.md
  - 01_projects/conversational-channels.md
  - 01_projects/telegram-user-flows.md
  - 01_projects/tracker.md
  - 01_projects/clone-how-it-works.md
  - 02_architecture/knowledge-core.md
---

# Петля method-capture: закрыл задачу → «расскажи, как решал» → куда улетает ответ

> **Карта по коду `backend/` на 2026-07-05.** Полная трассировка цепочки: закрытие
> задачи в трекере → вопрос исполнителю «расскажи, как ты её делал» → его ответ →
> ветвление ответа во второй мозг / клон / кандидата на закрытие. Собрана, чтобы
> **не переанализировать каждый раз**. Механику доставки probe см. [[probe-agent]],
> реестр всех наблюдателей — [[probe-observers-catalog]], omnichannel-слой —
> [[conversational-channels]].

## Короткий вывод

Сценарий «закрыли задачу → исполнителю прилетает просьба рассказать, как он её делал»
реализован **не прямым уведомлением при закрытии**, а через **петлю method-capture
(probe)**. Это осознанно: система не спамит на каждое закрытие, а поднимает вопрос
только для «непростых» задач и только исполнителям. Ответ человека потом веером
расходится в независимые ветки, главная — **граф знаний и клон сотрудника**.

**Не путать три исходящих потока при работе с задачей:**

| Событие (`eventType`) | Когда | Кому | Смысл |
|---|---|---|---|
| `issue.assigned` | назначение исполнителя | **исполнителю** | «Вам поставили задачу» (информирующее) |
| `task.closed_for_review` | закрытие «из разговора» (подтверждение кандидата) | **постановщику** | «Задача закрыта — проверьте» |
| `probe.question` (reason `task.method_capture`) | первое закрытие сложной задачи | **исполнителю** | **«Расскажи, как ты её решал»** ← этот флоу |

## Схема цепочки

```
ЗАКРЫТИЕ ЗАДАЧИ (transitionState → completed, первый раз)
   │  maybeRaiseMethodCaptureProbe (гейт: сложность ≥ порога, флаг ON)
   ▼
ProbeService.suggest(reason='task.method_capture', получатели = исполнители)
   │  → ProbeEvent(pending) → очередь core.probe-events
   ▼
ProbeDispatcherWorker → переформулирует вопрос (LLM) → создаёт
   Notification(eventType='probe.question', responseStatus='pending')
   ▼
ДОСТАВКА  conversational.sendNotification
   каналы telegram_bot → max_bot → in_app │ бюджет / тихие часы / data-class гейт
   → очередь conversational.send → воркер → Telegram-адаптер → Telegram API (через proxy)
   ▼
✉️  ИСПОЛНИТЕЛЬ видит: «Расскажи, пожалуйста, пошагово, как ты её решал?
    Можно текстом, а удобнее — наговори голосом, я распознаю.»
   ▼
ЧЕЛОВЕК ОТВЕЧАЕТ (текст/голос в Telegram)
   webhook → adapter.ingestUpdate → сопоставление с уведомлением
   → InboundMessage{type:'response', notificationId} → respondToProbe
   → emit('notification.responded')
   ▼
ВЕТВЛЕНИЕ (best-effort, ветки независимы):
   ├─ ProbeResponseHandler (eventType startsWith 'probe.')
   │      ├─► ГРАФ ЗНАНИЙ: RawEvent('reasoning') → IdeaBlock → Entity → Theme
   │      ├─► SubjectMemory сотрудника
   │      ├─► КЛОН сотрудника (через граф, person-subject reasoning-блоки)
   │      ├─► диалог-машина (уточнить / подтвердить / эскалировать владельцу)
   │      └─► ack «Спасибо, записал»
   └─ (сиблинг) ответ на чек-ин → CheckinResponseHandler → DailyCheckIn → свой веер
```

## Шаг 1. Триггер — закрытие задачи

`tracker/services/issues.service.ts:1225` — метод `transitionState`: при **первом**
переходе в категорию `completed` (`newState.category === 'completed' && !existing.completedAt`)
вызывается `maybeRaiseMethodCaptureProbe({ issueId, tenantId })` (fire-and-forget).

Внутри `issues.service.ts:1266`:
- **Получатели** = userId **всех исполнителей** задачи (`:1293-1296`); исполнителей нет → выход.
- **Гейты (не на каждую задачу):**
  - флаг `tracker.methodCaptureEnabled` (default ON);
  - **порог сложности** `computeMethodCaptureComplexity ≥ tracker.methodCaptureMinComplexity`
    (default 0.5, `:1309-1320`). Сложность = f(длина описания, число активностей, время
    жизни задачи, приоритет). Простую задачу «на 5 минут» система не трогает — иначе шум.
- Вызывает `probe.suggest(reason='task.method_capture', message, suggestedQuestion)`.

Параллельно закрытие эмитит `issue.status_changed_to_done` → отдельный ingest-сигнал
`task_completed` в knowledge-core (факт закрытия в графе), **не** уведомление человеку.

## Шаг 2. Формулировка вопроса и создание уведомления

`probe/probe.service.ts:46` `suggest` → создаёт `ProbeEvent(status='pending')`
(`:328-341`) с дедупом (Redis contentHash TTL 72ч), rate-limit (5/час, 20/день) и
cold-start-гейтами, ставит в очередь `core.probe-events` (`:372`).

`probe/probe-dispatcher.worker.ts:85` `process`:
- **value-гейт диспетчера (`formulation.gate`, `:208`) для `task.method_capture` ПРОПУСКАЕТСЯ** — `gate()` возвращает `{ask:true, reason:'method_capture_complexity_gated'}` (`probe-formulation.service.ts`), т.к. опросник уже прошёл детерминированный порог сложности при подъёме (`computeMethodCaptureComplexity ≥ 0.5`); иначе недетерминированный LLM value-гейт спорадически давал `dropped_low_value` и душил основной поток захвата ещё до отправки. Доказано e2e P1 (регуляционный стенд, 9/9 при гейте ON);
- переформулирует вопрос через LLM (`probe-formulate` + оценка качества, `:227-232`);
- создаёт уведомление `conversational.sendNotification(eventType='probe.question')` (`:248-263`),
  payload `{ question, askedBy:'task-method-capture', context }`.

`conversational.service.ts:122` `sendNotification` пишет `Notification` и для probe-типов
ставит `responseStatus='pending'` (`:148-153`) — «ждёт ответа».

**Реальный текст** (`issues.service.ts:1339-1340`):
- шапка: «Ты закрыл задачу «‹title›». Задача была непростая — это важно для памяти компании.»
- вопрос: **«Расскажи, пожалуйста, пошагово, как ты её решал? Можно текстом, а удобнее —
  наговори голосом, я распознаю.»**

Fallback-формулировка для reason `task.method_capture` — `probe/probe-reason-labels.ts:120-121`.
Рендер в Telegram — `telegram-bot.adapter.ts:1134` («Кора уточняет … Ответьте текстом этим же сообщением»).

## Шаг 3. Доставка уведомления

`conversational.service.ts:122` `sendNotification`:
1. валидация payload по `types/event-payload.registry.ts` → `Notification(status='queued')` в БД;
2. гарантия `in_app`-канала + сбор верифицированных `ChannelBinding`;
3. выбор каналов по `EVENT_TYPE_CHANNEL_POLICY` (`:60-90`): для `probe.question` —
   `telegram_bot → max_bot → in_app`;
4. **что душит доставку:**
   - **data-class гейт** (`selectBindingsForNotification:822-841`) — `sensitive`/`private`
     не уходят во внешние каналы без апгрейда `maxDataClass`;
   - **бюджет push** (`notification-budget.service.ts:65`) — opt-out, тихие часы по TZ
     человека, дневной лимит (default 5/день); при блоке push **откладывается**, in-app остаётся;
   - **тихие часы** роутинг-уровня режут не-critical;
   - непривязанный/непроверенный канал не участвует.
5. на каждую доставку — `NotificationDelivery(queued)` → очередь BullMQ `conversational.send`
   (`conversational-queue.service.ts:40`);
6. `conversational-send.worker.ts:72` → `telegram-bot.adapter.ts:106` `send` (расшифровка
   botToken, `renderText:1131`) → `telegram-api-client.ts:31` → POST в Telegram API.
   **В проде — через proxy `telegram.crossmark.ru`** (`resolveApiBase:215`,
   `env.schema.ts:478-480`, `TELEGRAM_PROXY_ENABLED` default true). Ретраи вручную,
   backoff `2^n` (потолок 1ч); исчерпание → delivery `failed`.

Привязка Telegram — одноразовый link-code в Redis (`link-code.service.ts`, `/start ‹code›`).

## Шаг 4. Человек отвечает — приём и сопоставление

`telegram-webhooks.controller.ts:205` `processUpdate`: проверка секрета constant-time →
дедуп по `updateId` в Redis → `adapter.ingestUpdate`.

**Как понять, что это ответ на конкретный вопрос** (`telegram-bot.adapter.ts:154` `ingestUpdate`):
- **явный reply** на сообщение бота → `tryMatchReplyToProbe:1060` ищет `NotificationDelivery`
  по `externalMessageId` (`chat_id:message_id`, `:1065`), ещё не `answered` →
  `InboundMessage{type:'response', notificationId}`;
- **неявный ответ** (человек просто пишет) → `findOpenProbe:1078` берёт последний probe с
  `responseStatus='pending'` за N дней (default 3) + LLM-классификатор интента (`probe_reply`,
  порог 0.6) → тот же `type:'response'`.

`dispatchInbound` роутит `response` → `ProbeResponseInboundBridge` → `respondToProbe`
(`conversational.service.ts:311`): помечает `Notification.responseStatus='answered'`,
`status='responded'`, и **эмитит `notification.responded`** (`:365`).

## Шаг 5. Куда «улетает» ответ (ветвление)

Событие `notification.responded` слушают два обработчика; по гейту `eventType` для
method-capture (`probe.*`) срабатывает **`ProbeResponseHandler`** (`probe/probe-response.handler.ts:85`,
гейт `:88`):

1. **Классификация ответа** (LLM `probe-response-classify`, `:130`/`:1081`) →
   `{outcome: apply|delete|refine|counter_question|unclear, confidence}`.
2. **→ Граф знаний (второй мозг)** — `ingestResponseAsRawEvent` (`:147`) →
   `conversational-ingest.adapter.ts:52` с `signalTypeHint='reasoning'` для `task.method_capture`
   (`:157`). Дальше стандартный конвейер: `ingest.service.ts:41` → `RawEvent(:143)` →
   `core.raw-events` → `block-ingest.worker` → `IdeaBlock` → `RouterService` →
   `Entity`/`EntityLink` → `Theme`. **Здесь «как он решал» становится памятью компании.**
3. **→ Subject-memory** сотрудника (`:168-192`, если включено и классификация уверенная).
4. **→ Клон сотрудника** — через тот же граф: canonical-блок с `Person`-subject и
   `reasoning`-сигналом попадает к специалисту `KNOWLEDGE_CLONE`
   (`knowledge-core/workers/specialist-3-2-knowledge-clone.worker.ts:67`,
   `enqueueRebuildKnowledgeProfile:109`) → пересборка `Person.knowledgeProfile`. Так метод
   уходящего сотрудника оседает в его клоне (чтение: `clones/services/clones.service.ts:2194`).
   Клон кормится **только reasoning/methodology subject-блоками** (см. [[clone-how-it-works]]).
5. **Диалог-машина** (`:194-277`, если `probe.dialogEnabled`): уверенный `apply` →
   echo-back `probe.confirm`; неуверенность → `probe.clarify`; превышен лимит витков →
   эскалация владельцу/админу.
6. **Ack** — `probe.answer_acknowledged` (`:280`/`:1003`): «Спасибо! Ваш ответ записан».

### Сиблинг-ветка: ответ на чек-ин (не method-capture)

По тому же событию `notification.responded`, но с гейтом `eventType==='checkin.prompt'`,
срабатывает `operations/services/checkin-response.handler.ts:57` → пишет `DailyCheckIn` →
эмитит `checkin.created`, и там уже большой веер:
- **граф знаний** (`checkin-graph-ingest.listener.ts:20` → `checkin-ingest.service.ts:123`,
  `Source(type='daily_checkin', dataClass='sensitive')`);
- **живая карточка задачи + детект закрытия** — `operations/services/task-completion.handler.ts:87`
  (`@OnEvent('task.completion_signalled')`): embed блока → KNN среди открытых задач →
  LLM `closure-verifier.service.ts` → `TaskClosureCandidate(pending)` **или**
  `IssueProgressUpdate(authorType='ai_agent', draftState='pending')`;
- **тональность** (`checkin-sentiment-analyzer.worker.ts:29`, поле `DailyCheckIn.sentiment`);
- **дайджесты руководителю** (`daily-digest.service.ts` / `weekly-digest.service.ts` /
  `blocker-synthesis.service.ts` — cron поверх строк `DailyCheckIn`);
- **клоны** (через граф).

## Нюансы и инварианты

- **Авто-закрытие запрещено (инвариант R13).** Даже когда система уверена, что задача
  сделана, она создаёт только **обратимый `TaskClosureCandidate(pending)`**
  (`task-completion.handler.ts:208`); финально закрывает задачу **человек** через карточку
  pending-actions. Handler никогда не дёргает `transitionState` сам.
- **Гард от зацикливания.** Блок из самого трекера (`sourceType='tracker_event'`) в петлю
  закрытия не идёт (`task-completion.handler.ts:96`) — иначе ручное закрытие → блок →
  новый кандидат → бесконечный цикл.
- **Всё downstream — best-effort и изолировано.** Факт (`Notification`/`DailyCheckIn`)
  фиксируется до веера; падение любой ветки (граф, sentiment, клон) не рушит остальные и
  не ломает приём ответа. У каждой ветки свой флаг/kill-switch (`taskClosure.enabled`,
  `checkinGraphIngestEnabled`, `sentimentEnabled`).

## Где цепочка обрывается («может не произойти»)

- **Задача проще порога** → probe не поднимается (by design).
- **У исполнителя не привязан Telegram/MAX** → только in-app; не заходит в кабинет — не увидит.
- **Бюджет исчерпан / тихие часы** → push откладывается (in-app остаётся).
- **Ответ классифицирован как `unclear`** → уходит уточняющий вопрос; в граф ничего не
  пишется, пока не прояснится.
- **Флаг ветки выключен** → соответствующая ветвь молча пропускается.

## Зона риска / к проверке

Тонкость приоритета сопоставления: в `telegram-bot.adapter.ts` явный reply матчится к
**любой** ещё-не-`answered` доставке (без фильтра по `eventType`, `:388`) и стоит **до**
структурного issue-хендлера (`:405`). То есть reply на `issue.assigned` /
`task.closed_for_review` может уйти в probe-мост и пометиться `answered`, а не в обработчик
команд по задаче. Единственное место, где ветки могут «перехватить» друг друга — см.
запись в [[../04_не-сделано/README|реестре не-сделанного]] (2026-07-05).
