---
type: tz
status: ready-to-implement
feature: probe-system-phase2-completeness
date: 2026-06-17
owner: sergrv80 (владелец Z)
relates_to:
  - plans/analysis/2026-06-17-probe-system-completeness.md
  - plans/tz/2026-06-11-probe-system-upgrade-phase1.md
  - plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md
  - second-brain/03_processes/probe-question-flow.md
  - second-brain/01_projects/probe-agent.md
---
> Анализ: `plans/analysis/2026-06-17-probe-system-completeness.md` · Согласовано с владельцем: 2026-06-17

# ТЗ — Доведение системы уточняющих вопросов (Probe, Layer 6) до полноценного состояния

## Принцип

Probe-вопрос существует, потому что граф чего-то **не знает** (прошла встреча / пришли данные /
поставлена задача) или не знает, **к чему привязать** входящие знания. Задача системы — задать
полноценный, точный вопрос нужному человеку, гарантированно получить ответ обратно в граф и не
дёргать людей лишним. Поиска готового ответа в графе перед вопросом (answer-first) **нет** — это
противоречит сути probe (решение владельца Q1, 2026-06-17).

Делаем БЕЗ ожидания статистики/калибровки (решение владельца). Ship-On: всё выкатывается включённым;
флаги — только kill-switch (тип А) или решение владельца (тип Б), каждый → строка в
`docs/operations/feature-flags.md`.

## REALITY-CHECK (факт по коду на 2026-06-17 — расходится со старым second-brain, приоритет у кода)

УЖЕ реализовано и **НЕ переделывать** (Фаза 1 + W0/W2 autonomy, коммиты `5ed78b54..fa950cd1`, 2026-06-12):
- `probe-formulate` переписан (персона+few-shot+self-check, без кодов, cache-friendly) — `backend/src/modules/knowledge-core/prompts/probe-formulate.prompt.ts`.
- Гейт ценности `dropped_low_value` (`probe.minValuePriority=30`) — `probe.service.ts:232-264`.
- Cold-start реально включён → `routed_to_digest` — `probe.service.ts:423-442` (метод `isColdStart` возвращает живой результат, НЕ заглушку).
- Recheck повода → `suppressed_stale` — `probe-dispatcher.worker.ts:205-245`, предикаты `probe-reason-policy.ts:86`.
- NUDGE/дайджест (`queued_digest`, `routed_to_digest`), adaptive fatigue, topic cooldown — есть.
- Классификатор ответа `probe-response-classify` + closing-loop + ack — `probe-response.handler.ts`.

> ⚠️ Номера строк — на момент написания ТЗ. Перед правкой **перечитать файл** и искать по якорю-символу
> (указан в каждой фазе), а не по номеру строки.

## Принятые решения владельца (2026-06-17 — не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Answer-first поиск в графе НЕ делаем | Вопрос задаётся именно потому, что граф не знает; ответ должен достраивать граф |
| Р2 | Свободный ответ привязываем через расширение входного классификатора `dialog-classify` (интент `probe_reply`), а не отдельной эвристикой | «Классификатор на входе должен это понимать» — один мозг понимания запроса |
| Р3 | Re-ask: ровно 1 переспрос, переформулировав, со ссылкой на прошлый вопрос; затем `ignored` | Повышает доходимость без спама |
| Р4 | Память тона получателя — в vNext (отдельное ТЗ) | Требует накопления по человеку, даёт мало на незрелом графе |
| Р5 | Статистику/калибровку не ждём — реализуем всё сразу | Прямое указание владельца |

## Scope

### Входит
- G1 (Ф1): распознавание свободного ответа на probe во входном классификаторе (Telegram без reply + MAX).
- G6 (Ф2): LLM-судья качества формулировки + один регенерат.
- G2+G3 (Ф3): выбор получателя по engagement + реальный `kind` метрики доставки.
- G5 (Ф4): семантический дедуп вопросов по эмбеддингу (pgvector).
- G4 (Ф5): re-ask петля (1 переспрос, переформулировав).
- G7 (Ф6): новый ingest-повод атрибуции «новые данные не привязаны к отделу/клиенту/сущности».

### Не входит
- Память тона получателя → vNext, отдельное ТЗ (Р4).
- Answer-first / RAG-поиск ответа перед вопросом → исключено (Р1).
- Переписывание уже готовых частей Фазы 1 / W2 autonomy (REALITY-CHECK).
- Новые каналы доставки (только Telegram/MAX/in_app как сейчас).

## Граничные контракты с другими модулями
- `dialog-layer` (`query-classifier.service.ts`, `prompts/classify.prompt.ts`) — расширяем enum интентов и промпт; контракт `dialog-classify` остаётся обратносовместимым (старые интенты не меняем).
- `conversational` — тип `InboundMessage='response'` уже существует и обрабатывается через `respondToProbe`; новый интент маппится в него же. Сам `respondToProbe` НЕ меняем.
- `llm-router` — добавляем 1 новый `taskType='probe-quality-judge'` (и используем существующие `probe-formulate`, `dialog-classify`); регистрация route в seed.
- `embeddings` / `knowledge-core` — переиспользуем `text-embedding-3-small` через существующий embedding-сервис; новую vector-колонку добавляем на `ProbeEvent`.

## Контракты (единый источник правды)

### Prisma (Ф4 — семантический дедуп)
Добавить в модель `ProbeEvent` (`backend/prisma/schema.prisma`, якорь `model ProbeEvent`):
```prisma
  /// Ф4 (2026-06-17) — эмбеддинг сформулированного/исходного вопроса для
  /// семантического дедупа близких по смыслу probe (а не только точного content-hash).
  questionEmbedding Unsupported("vector(1536)")?
```
HNSW-индекс — **только** в `backend/scripts/postgres-init.sql` (НЕ в schema.prisma), якорь рядом с `idx_ideablock_embedding_hnsw`:
```sql
CREATE INDEX IF NOT EXISTS idx_probeevent_qembed_hnsw
  ON "probe_events" USING hnsw ("questionEmbedding" vector_cosine_ops)
  WHERE "questionEmbedding" IS NOT NULL;
```
> НЕ использовать `prisma migrate` — по правилам Z только `prisma:push` для локальной пробы; реальное
> применение колонки на проде идёт штатным механизмом схемы. Индекс — через `postgres-init.sql` (Шаг 5 prod-deploy).

### Новый таск LLM (Ф2 — судья качества)
`taskType='probe-quality-judge'`. Добавить в union `LlmTaskType` (`backend/src/modules/ai/services/llm-router.service.ts`, якорь `export type LlmTaskType`) и в `ALL_LLM_TASK_TYPES`. Промпт — новый файл `backend/src/modules/probe/prompts/probe-quality-judge.prompt.ts`.
JSON-схема ответа:
```json
{ "type":"object","additionalProperties":false,
  "required":["ok","issues"],
  "properties":{
    "ok":{"type":"boolean","description":"true — вопрос полноценный и точный, можно слать"},
    "issues":{"type":"array","items":{"type":"string","enum":["empty","vague","has_code_or_english","multiple_questions","not_answerable","too_long"]}},
    "rewrite":{"type":"string","description":"при ok=false — улучшенный вопрос ≤200 символов; иначе пустая строка"}
  } }
```
Контракт поведения: судья вызывается ПОСЛЕ `formulate()` в dispatcher. Если `ok=false` и `rewrite`
непустой и проходит повторную проверку маркеров — берём `rewrite`. Один регенерат, не цикл.
Kill-switch: `probe.qualityJudgeEnabled` (AdminSetting, тип А, ON). При выключенном — поведение как сейчас.

### Расширение `dialog-classify` (Ф1)
Добавить интент `probe_reply` в `DialogIntent` (`backend/src/modules/dialog-layer/prompts/classify.prompt.ts`,
якорь `export type DialogIntent`) и в JSON-enum схемы. USER-промпт получает (в КОНЦЕ, cache-friendly) блок
«Открытый вопрос Коры тебе сейчас» с текстом последнего неотвеченного probe (если есть). Если открытых
probe нет — блок не добавляется и интент `probe_reply` модель не выбирает.

### Метрика канала (Ф3)
Заменить хардкод `incProbeDispatched({ kind: 'in_app' })` (`probe-dispatcher.worker.ts`, якорь
`incProbeDispatched`) на реальный kind: после `sendNotification` прочитать первый
`NotificationDelivery.channelBinding.channel.kind` для `notif.id` (как делает
`ProbeResponseHandler.lookupDeliveryKind`, `probe-response.handler.ts:410`) и передать его; fallback `'in_app'`.

### Новый повод атрибуции (Ф6)
`reason='attribution.unresolved_at_ingest'`. Окно — `deferrable` (добавить в `PROBE_REASON_WINDOW`/labels/fallback/recheck по образцу существующих). Триггер и условие — см. Ф6.

## Границы фичи
- ✅ Always: переиспользовать существующие сервисы (`probe-formulate`, embedding-сервис, `lookupDeliveryKind`, engagement-снимок); все крутилки — в AdminSetting; промпты cache-friendly.
- ⚠️ Ask first: менять контракт `respondToProbe` или `dialog-classify` для старых интентов; трогать формулу priority.
- 🚫 Never: `prisma migrate`; `new PrismaClient()` в скриптах; `process.env.*` в коде; answer-first поиск; вводить флаг «на всякий случай»; добавлять inline-кнопки в probe (только свободный текст/голос).

## Фазы (dependency-ordered)

Граф зависимостей: Ф1 и Ф2 независимы (могут параллельно). Ф3 независима. Ф4 зависит от Prisma-колонки
(своя под-задача в начале Ф4). Ф5 зависит от Ф2 (использует регенерат-формулировку при переспросе) и от
наличия `expired`-обработки в `ProbePriorityCron`. Ф6 независима, но логически после Ф2 (новые вопросы тоже идут через судью).
Рекомендуемый порядок волн: **Ф1 ∥ Ф2 ∥ Ф3 → Ф4 → Ф5 → Ф6**.

---

### Ф1 — Привязка свободного ответа через входной классификатор (G1, Р2) `[ ]`
**Цель:** ответ пользователя на probe засчитывается, даже если он пишет свободным текстом без Telegram-reply, и в MAX.

Мини-картография:
- `backend/src/modules/dialog-layer/prompts/classify.prompt.ts` — `DialogIntent`, SYSTEM, JSON-schema.
- `backend/src/modules/dialog-layer/services/query-classifier.service.ts` — `classify(...)` (taskType `dialog-classify`).
- `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts` — `classifyIntent` (1128), порядок inbound (504–599), `tryMatchReplyToProbe` (1230).
- `backend/src/modules/conversational/adapters/max-bot/max-bot.adapter.ts` — `handleMessage` (187–361).
- `backend/prisma/schema.prisma` — `Notification` (индексы `@@index([recipientUserId, status])`), `NotificationResponseStatus`.

Что входит:
1. Добавить интент `probe_reply` в `DialogIntent` + JSON-enum + правила в SYSTEM (cache-friendly, few-shot: «Кора спросила X → пользователь отвечает Y»). Ловушка в промпте: если открытого вопроса нет — это НЕ `probe_reply`.
2. В `query-classifier.service.ts` — принимать опциональный `openProbeQuestion?: string` и подставлять его в КОНЕЦ USER. Без него `probe_reply` недоступен.
3. В обоих адаптерах ПЕРЕД вызовом классификатора (и только если нет явного reply-матча) — дешёвый pre-фильтр: запросить последний неотвеченный probe пользователя:
   `notification.findFirst({ where:{ tenantId, recipientUserId, eventType:{in:['probe.question','probe.digest']}, responseStatus:'pending' }, orderBy:{createdAt:'desc'} })`.
   Передать его `payload.question`/`formulatedQuestion` в классификатор как `openProbeQuestion`.
4. Если классификатор вернул `probe_reply` (confidence ≥ `probe.replyClassifyMinConfidence`, AdminSetting, дефолт 0.6) → вернуть `InboundMessage{ type:'response', notificationId:<id найденного probe>, payload:{text, kind:'implicit_response'} }`. Иначе — прежний маппинг.
5. MAX: добавить ту же ветку pre-фильтр+probe_reply в `handleMessage` (там reply нет вовсе — это единственный путь привязки).

Что НЕ входит: менять `respondToProbe`; менять существующие интенты; reply-матч в Telegram (оставить как первый, приоритетный путь).

Acceptance (машинно):
- Греп: `probe_reply` присутствует в `classify.prompt.ts` (enum + schema) и в обоих адаптерах.
- Юнит `query-classifier`: вход «да, Иванов отвечает» + `openProbeQuestion="Кто отвечает за решение?"` → intent `probe_reply`, confidence ≥0.6 (мокнутый LLM-ответ); тот же вход без `openProbeQuestion` → НЕ `probe_reply`.
- Юнит адаптера: inbound без `reply_to_message`, есть pending probe, классификатор вернул `probe_reply` → `InboundMessage.type==='response'` с верным `notificationId`. Негатив: нет pending probe → `type` НЕ `'response'`.
- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` зелёные.

Закрывает: R1, R2.

---

### Ф2 — LLM-судья качества формулировки + один регенерат (G6) `[ ]`
**Цель:** ни один расплывчатый/пустой/с кодом/двойной вопрос не уходит человеку; при браке — один улучшенный регенерат.

Мини-картография:
- `backend/src/modules/probe/probe-dispatcher.worker.ts` — `formulate()` (317), вызов перед `sendNotification` (248).
- `backend/src/modules/ai/services/llm-router.service.ts` — `LlmTaskType` union, `ALL_LLM_TASK_TYPES`.
- образец промпта-судьи: `backend/src/modules/probe/prompts/probe-response-classify.prompt.ts`.
- seed маршрута: `backend/scripts/seed-llm-task-routes-ideas-and-probe.ts`.
- AdminSetting: `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` + `backend/scripts/seed-admin-settings.ts` (секция `probe`).

Что входит:
1. Новый `taskType='probe-quality-judge'` в union + `ALL_LLM_TASK_TYPES`; seed-route с цепочкой `deepseek-v4-flash → gpt-5.4-mini → ollama qwen3.5:9b` (по образцу probe-route в seed).
2. Новый промпт `probe/prompts/probe-quality-judge.prompt.ts` (SYSTEM стабильный: критерии + few-shot плохо→хорошо + self-check; USER: только вопрос в конце). Схема — из раздела «Контракты».
3. В dispatcher после `formulate()`: если `probe.qualityJudgeEnabled` (AdminSetting, тип А, ON) — вызвать судью на `formulated.question`. Если `ok=false` и `rewrite` непустой → прогнать `rewrite` через тот же детерминированный маркер-чек (нет латиницы/длинных id, ≤400, один `?`), и при успехе заменить вопрос. Один проход, без цикла. Best-effort: судья упал → отправляем исходный вопрос (как сейчас).
4. Метрика `probe_quality_judged_total{verdict}` (`ok`|`rewritten`|`kept_on_fail`).

Что НЕ входит: менять SYSTEM `probe-formulate` (он cache-friendly, не трогаем); цикл регенераций (>1).

Acceptance:
- Грепы: `probe-quality-judge` в `llm-router.service.ts` (union + ALL_LLM_TASK_TYPES), файл промпта существует, вызов судьи и метрика в dispatcher.
- Юнит dispatcher (мок LLM): судья `{ok:false, issues:['has_code_or_english'], rewrite:'Кто отвечает за это решение?'}` → отправлен `rewrite`. Судья `{ok:true}` → отправлен исходный. Судья кинул ошибку → отправлен исходный, метрика `kept_on_fail`.
- `probe.qualityJudgeEnabled` присутствует в registry + seed (тип А, дефолт true) + строка в `feature-flags.md`.
- typecheck/lint/build зелёные.

Закрывает: R3, R4.

---

### Ф3 — Выбор получателя по engagement + реальный kind метрики (G2, G3) `[ ]`
**Цель:** вопрос идёт самому отзывчивому из кандидатов; метрика доставки отражает реальный канал.

Мини-картография:
- `probe-dispatcher.worker.ts` — выбор `candidates[0]` (202), `incProbeDispatched({kind:'in_app'})` (291).
- `backend/src/modules/probe/probe-fatigue.util.ts` — `probeEngagementRedisKey`.
- `backend/src/modules/probe/probe-priority.cron.ts` — пишет engagement-снимок.
- `probe-response.handler.ts:410` — `lookupDeliveryKind` (образец чтения реального kind).

Что входит:
1. Метод выбора получателя: из `candidates` (после rate-limit) выбрать с максимальным engagement-снимком из Redis (`probeEngagementRedisKey`); отсутствует снимок → считать нейтральным (например 0.5); tie-break — детерминированная сортировка по `userId` (без `Math.random()`). Kill-switch `probe.engagementRoutingEnabled` (AdminSetting, тип А, ON); выключен → прежний `candidates[0]`.
2. Реальный kind: после `sendNotification` прочитать kind первого `NotificationDelivery` для `notif.id` (переиспользовать логику `lookupDeliveryKind`; вынести в общий util или вызвать сервис), передать в `incProbeDispatched`; fallback `'in_app'`.

Что НЕ входит: менять формулу priority; менять rate-limit/fatigue.

Acceptance:
- Юнит: 2 кандидата с engagement 0.2 и 0.8 → выбран второй; равные → выбран меньший по строковому `userId` (детерминизм). Флаг OFF → `candidates[0]`.
- Греп: `incProbeDispatched` больше не вызывается со строковым литералом `'in_app'` как единственным аргументом без вычисления (проверка — нет хардкода; kind берётся из delivery).
- `probe.engagementRoutingEnabled` в registry+seed+feature-flags.md.
- typecheck/lint/build зелёные.

Закрывает: R5, R6.

---

### Ф4 — Семантический дедуп вопросов (pgvector) (G5) `[ ]`
**Цель:** не задавать по смыслу тот же вопрос, переформулированный иначе (точный content-hash его не ловит).

Под-задача 4.0 (Prisma+SQL): колонка `ProbeEvent.questionEmbedding` (раздел «Контракты») + HNSW-индекс в `postgres-init.sql`. `prisma:push` локально (не коммитить проб), `prisma:generate`.

Мини-картография:
- `probe.service.ts` — `suggest()`, после content-hash dedup (104–133), перед rate-limit.
- embedding-сервис: `backend/src/modules/knowledge-core/services/embedding.service.ts` / `backend/src/modules/embeddings/services/embedding-fallback.service.ts` (`text-embedding-3-small`).
- пример similarity-SQL: `chat-v2-retrieval.service.ts:600` (`<=>`, `$queryRawUnsafe`, `::vector(1536)`).

Что входит:
1. В `suggest()`: после прохождения точного dedup — посчитать эмбеддинг текста вопроса (`payload.suggestedQuestion ?? payload.message`); если пусто — пропустить семантический шаг.
2. Запрос: найти `ProbeEvent` того же `tenantId` за окно `probe.semanticDedupWindowHours` (AdminSetting, дефолт 72) со статусами активными/доставленными (`pending|dispatched|queued_digest|routed_to_digest`) и `questionEmbedding IS NOT NULL`, где cosine-similarity ≥ `probe.semanticDedupThreshold` (AdminSetting, дефолт 0.92). Если найден — `dropped_dedup` (та же ветка метрик, что и content-hash), `return { dropped:'dedup' }`.
3. Если уникален — сохранить `questionEmbedding` при создании `ProbeEvent` (во всех ветках create, где вопрос известен; где известен только позже — записать в dispatcher после формулировки). Минимально: записывать на основном пути create (status='pending').
4. Kill-switch `probe.semanticDedupEnabled` (AdminSetting, тип А, ON); выключен → только content-hash (как сейчас).

Что НЕ входит: семантический дедуп ОТВЕТОВ; переэмбеддинг старых probe (backfill не нужен — окно 72ч естественно наполнится).

Acceptance:
- Юнит/интеграция (можно с замоканным embedding, фиксированные векторы): два probe с близкими векторами (cos ≥0.92) в окне → второй `dropped:'dedup'`; далёкие (<0.92) → проходит. Флаг OFF → семантика не применяется.
- Грепы: `questionEmbedding` в schema.prisma и в `suggest()`; `idx_probeevent_qembed_hnsw` в `postgres-init.sql`.
- `probe.semanticDedupEnabled|Threshold|WindowHours` в registry+seed+feature-flags.md.
- typecheck/lint/build зелёные; `prisma:generate` отработал (тип `questionEmbedding` доступен).

Закрывает: R7.

---

### Ф5 — Re-ask петля: один переспрос, переформулировав (G4, Р3) `[ ]`
**Цель:** неотвеченный вопрос один раз переспрашивается иначе, прежде чем закрыться как ignored.

Мини-картография:
- `backend/src/modules/probe/probe-priority.cron.ts` — обработка `expired` (31–117) + engagement, `incProbeOutcome({outcome:'ignored'})`.
- `probe.service.ts` — `suggest()` (для постановки переспроса как нового pending с пометкой).
- `probe-dispatcher.worker.ts` — `formulate()` (для переформулировки со ссылкой на прошлый вопрос).
- enum `ProbeStatus` (`schema.prisma`).

Что входит:
1. Поле учёта попытки: переиспользовать `payload` (`reaskCount:number`, `originalProbeEventId`) — без новой колонки. (Если потребуется явная колонка — `ProbeEvent.reaskOf String?`; решить на картографии, дефолт — payload, чтобы не плодить миграции.)
2. В `ProbePriorityCron` при истечении probe (`pending`/`dispatched` без ответа, `expiresAt<now`): если `reaskCount` отсутствует/0 и включён `probe.reaskEnabled` (AdminSetting, тип А, ON) → создать НОВЫЙ `ProbeEvent` (status='pending', `reaskCount=1`, `originalProbeEventId`, тот же reason/recipientCandidates/contextHash) и enqueue; старый пометить терминально (`expired`). Если `reaskCount≥1` → старое поведение: `expired` + `incProbeOutcome({outcome:'ignored'})`.
3. В `formulate()`: если `reaskCount≥1` — добавить в USER (в конце) пометку «это повторный вопрос, в прошлый раз ответа не было; переформулируй иначе, мягко» (cache-friendly: переменная в USER, SYSTEM не трогаем). Не дублировать дословно прошлый текст в вопросе.
4. Topic-cooldown НЕ должен глушить переспрос: переспрос ставить в обход cooldown (он порождён системой, не новым специалистом) — пометка в payload, проверяемая в `suggest`/dispatcher. (Если проще — создавать переспрос напрямую как `ProbeEvent` минуя `suggest`-гейты, кроме rate-limit; решить на картографии, описать в коде комментарием.)

Что НЕ входит: >1 переспрос; эскалация другому получателю (это был отклонённый вариант — НЕ делать); смена канала.

Acceptance:
- Юнит cron: probe без ответа, `reaskCount` отсутствует, флаг ON → создан новый ProbeEvent `reaskCount=1` + старый `expired`; повторный прогон по `reaskCount=1` → `expired` + `incProbeOutcome ignored`, нового не создаётся.
- Юнит formulate: `reaskCount=1` → в USER присутствует пометка о переспросе; SYSTEM-строка `probe-formulate` не изменилась (греп хеша/ключевой строки SYSTEM до/после).
- `probe.reaskEnabled` в registry+seed+feature-flags.md.
- typecheck/lint/build зелёные.

Закрывает: R8, R9.

---

### Ф6 — Ingest-повод атрибуции «новые данные не привязаны» (G7) `[ ]`
**Цель:** когда при разборе новых знаний сущность/факт не удаётся привязать к отделу/клиенту/проекту, Кора спрашивает «к чему это относится», достраивая граф.

> ⚠️ Перед реализацией — картография: подтвердить точку в ingest-конвейере knowledge-core, где
> создаётся `Entity`/`Card`/`IdeaBlockEntity` и где видно отсутствие привязки (department/client/project).
> Если такой повод фактически уже эмитится под другим reason — НЕ дублировать, а зафиксировать в Итоге.

Мини-картография (стартовые точки):
- `second-brain/02_architecture/knowledge-core.md`, `module-map.md` — где ingest создаёт Entity/Card.
- `specialist-3-4-probe.service.ts` (card.*), entity-resolver в knowledge-core.
- `probe-reason-labels.ts`, `probe-reason-policy.ts` (`PROBE_REASON_WINDOW`, `NUDGE_REASONS`, `PROBE_REASON_RECHECK`) — куда добавить новый reason.

Что входит:
1. `reason='attribution.unresolved_at_ingest'`. Триггер (класс A, ingest): после разбора нового блока создан/обновлён значимый `Entity`/`Card` (kind client/vendor/project) БЕЗ связи с отделом/владельцем/клиентом, и это новая сущность (а не давно существующая) → `suggest(...)` с payload (заголовок сущности, что именно не определено) и получателями (владелец встречи-источника → глава отдела → админы).
2. Регистрация reason: `PROBE_REASON_LABEL` (рус. ярлык), `PROBE_REASON_FALLBACK` (заготовка вопроса), `PROBE_REASON_WINDOW='deferrable'`, recheck-предикат (пробел открыт, пока привязка не появилась; сущность удалена → false).
3. Дедуп/cooldown — штатные (content-hash по сущности + Ф4 семантика).

Что НЕ входит: переписывать entity-resolution логику графа; авто-привязка без человека (это вопрос, а не NUDGE — окно deferrable, но reason НЕ в `NUDGE_REASONS`).

Acceptance:
- Грепы: `attribution.unresolved_at_ingest` присутствует в источнике-специалисте, в labels, в policy (window + recheck).
- Юнит: новая Entity/Card без привязки → `probeService.suggest` вызван с этим reason и непустыми `recipientCandidates`; сущность с привязкой → suggest НЕ вызван.
- Recheck-предикат: привязка появилась → `false` (suppressed_stale на dispatch).
- typecheck/lint/build зелёные.

Закрывает: R10.

---

## Требования (трассировка)
- R1: Когда пользователь отвечает на probe свободным текстом без reply (Telegram) или в MAX, система shall распознать это как ответ и привязать к открытому probe.
- R2: Если у пользователя нет открытого неотвеченного probe, then свободный текст НЕ классифицируется как `probe_reply`.
- R3: Когда вопрос сформулирован, система shall проверить его судьёй качества (если флаг ON) и при браке заменить одним регенератом.
- R4: Если судья качества недоступен/упал, then отправляется исходный вопрос (без блокировки).
- R5: Когда есть несколько кандидатов-получателей, система shall выбрать с наибольшим engagement (детерминированный tie-break), если флаг ON.
- R6: Когда probe доставлен, метрика `probe_dispatched_total{kind}` shall отражать реальный канал доставки.
- R7: Если новый probe семантически близок (cos ≥ порог) к недавнему в окне, then он дедуплицируется (`dropped_dedup`).
- R8: Когда probe истёк без ответа и переспрос ещё не делался, система shall создать один переформулированный переспрос.
- R9: Если переспрос уже делался (`reaskCount≥1`) и ответа нет, then probe закрывается как ignored.
- R10: Когда при ингесте создаётся значимая сущность без привязки к отделу/клиенту/владельцу, система shall задать вопрос атрибуции.

## Риски / Pre-mortem (для strict-production-review-gate)
- Ложная привязка ответа (Ф1): сообщение, не относящееся к probe, засчитано как ответ → мусор в граф. Митигация: `openProbeQuestion` обязателен для `probe_reply`, порог confidence, only-last-pending.
- Регенерат хуже оригинала (Ф2): judge переписал и сломал смысл → маркер-чек + один проход + best-effort fallback.
- Семантический дедуп глушит валидные разные вопросы (Ф4): высокий порог 0.92 (AdminSetting, можно поднять), окно 72ч.
- Re-ask воспринимается как спам (Ф5): ровно 1 переспрос, обход cooldown только для системного переспроса, мягкая переформулировка.
- Атрибуционный повод шумит (Ф6): только новые значимые сущности, deferrable (в дайджест), recheck.
- pgvector-колонка/индекс не применены на проде → семантический дедуп тихо не работает (graceful), но индекс нужен для производительности — Шаг 5 prod-deploy обязателен.

## Idempotency / прод
- Ф4 колонка → Шаг 4 prod-deploy-log; HNSW-индекс → Шаг 5 (`postgres-init.sql`).
- Новые seed строки AdminSetting (probe.*) и LLM-route (`probe-quality-judge`) → Шаг 7; идемпотентны (upsert), повторный прогон = no-op; зарегистрировать в `apply-prod-deploy.ts` STEPS если новые seed-файлы (или дополнить существующие probe-seed).
- Новые ENV (если потребуются дефолты для AdminSetting) → `env.schema.ts` + Шаг 1. Предпочтительно крутилки только в AdminSetting (code-default), без новых ENV.
- Все новые флаги (`probe.qualityJudgeEnabled`, `engagementRoutingEnabled`, `semanticDedupEnabled`, `reaskEnabled`, `replyClassifyMinConfidence`, `semanticDedupThreshold/WindowHours`) → строки в `docs/operations/feature-flags.md`.
- Новый `taskType` `probe-quality-judge` + smoke → Шаг 12.

## DoD
- typecheck (вкл. `.spec`) / lint / build зелёные; затронутые vitest проходят.
- second-brain обновлён: `03_processes/probe-question-flow.md` (новые шаги/метрики/reason), `01_projects/probe-agent.md` (Фаза 2 — что реализовано), `01_projects/ai-jobs.md` (новый taskType), при колонке — `02_architecture/data-model.md`.
- `docs/operations/prod-deploy-log.md` обновлён (Шаги 4/5/7/12), `feature-flags.md` пополнен.
- Рефлексия в `second-brain/05_история/`.

## Итог
_(заполняет tz-orchestrator по завершении: что реализовано целиком, что осталось, расхождения с ТЗ,
особо — результат картографии Ф6: существовал ли повод атрибуции ранее.)_
