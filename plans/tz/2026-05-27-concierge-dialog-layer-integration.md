# ТЗ: Concierge → подключение dialog-layer и summary в контекст

**Дата:** 2026-05-27
**Автор:** Сергей + Claude
**Категория:** SBA γ-2 / Concierge — апгрейд до «умного» агента
**Связано:**
- [second-brain/01_projects/concierge-agent.md](../../second-brain/01_projects/concierge-agent.md) (если есть; иначе создать в Фазе 7)
- [plans/tz/2026-05-23-sba-alpha-5-dialog-layer-and-cache.md](2026-05-23-sba-alpha-5-dialog-layer-and-cache.md) — исходное ТЗ dialog-layer
- [backend/src/modules/concierge/services/concierge.service.ts](../../backend/src/modules/concierge/services/concierge.service.ts)
- [backend/src/modules/dialog-layer/services/dialog.service.ts](../../backend/src/modules/dialog-layer/services/dialog.service.ts)

## Проблема

Сейчас `ConciergeService.process()` работает как «голый» tool-use loop:

1. **Не использует суммаризацию.** Cron `concierge-conversation-summarizer.cron.ts` пишет 2-3 предложения в `ConciergeConversation.summary` каждые 30 мин, но сам `process()` это поле **никогда не читает** — в контекст LLM кладутся последние 8 сообщений целиком (slice по 500 символов). В длинных диалогах модель «забывает» начало и тратит токены на повторение.
2. **Не переформулирует вопрос.** Короткие follow-up'ы вида «а почему?» уходят в LLM как есть — теряется контекст.
3. **Не делает multi-query поиск.** Поиск по графу запускается только если LLM сама вызовет tool `search_knowledge`, и только **с одной строкой**. Нет параллельного расширения вопроса в 3 переформулировки.
4. **Нет answer-кэша.** Один и тот же вопрос разных пользователей по одинаковой Org гоняет LLM с нуля.

Всё это **уже реализовано в `DialogService` модуля `dialog-layer`** и используется в Clones V2 и chat-v2. Concierge оказался единственным AI-агентом Z, который игнорирует этот pipeline.

## Цель

Подключить Concierge к существующему `DialogService` (без новой инфраструктуры) + начать читать `ConciergeConversation.summary`. Сохранить tool-use loop как ключевую фичу — Concierge остаётся «агентом с действиями», а dialog-layer добавляется как **препроцессор** перед первой LLM-итерацией.

Поведение после: для смыслового вопроса Concierge сначала контекстуализирует, классифицирует, расширяет в 3 запроса, делает параллельный поиск, при cache-hit отдаёт ответ без LLM, а только потом — обычная tool-use итерация с уже найденным контекстом.

## Не входит в этот ТЗ

- Перепись на native tool-use API провайдера (Anthropic/OpenAI tools) — отдельная задача.
- Динамическая регистрация tools через `@ConciergeTool` декоратор — оставляем статический whitelist.
- Изменение списка tools (см. отдельный раздел в чате).
- UI-изменения (фронт получает те же SSE-события).

## Архитектурное решение

Целевой `process()`:

```
process(input):
  quota check
  conversation = loadOrCreateConversation
  yield 'started'
  append user-message

  # === НОВОЕ: dialog-layer препроцессинг (за флагом) ===
  if cfg.concierge.dialogLayerEnabled and DialogService injected:
    dialog = DialogService.process({
      tenantId, userId, userMessage,
      conversationId: conv.id,
      scope: 'concierge',
      scopeRefId: conv.id,
      validAt: null,
    })
    # → standaloneQuestion, intent, queries[], cachedAnswer, confidence

    # Cache short-circuit (как в Clones V2)
    if dialog.cachedAnswer:
      yield 'thinking' "Нашёл в кэше"
      finalText = dialog.cachedAnswer.answer
      persist + yield 'message'/'done'
      return

    effectiveQuestion = dialog.standaloneQuestion
    intent            = dialog.intent
    queries           = dialog.queries  # 1..3 строки
  else:
    effectiveQuestion = userMessage
    intent            = 'factual'
    queries           = [userMessage]

  # === НОВОЕ: pre-retrieval (параллельно по queries) ===
  preHits = []
  if intent in {factual, exploratory, analytical}:
    preHits = await preRetrieve(queries, tenantId, userId, baseUrl, cookie)
    # 3 параллельных GET /api/v1/search?q=... → дедуп → top-N

  # === НОВОЕ: summary + 6 last вместо 8 last ===
  history = loadRecentHistory(conv.id, K_RECENT)  # K_RECENT=6
  summary = conv.summary  # nullable

  contextBlock = contextBuilder.build(...)
  systemPrompt = buildSystemPrompt(contextBlock, summary, preHits, intent)

  toolMessages = []
  for i in 0..MAX_TOOL_LOOP_ITERATIONS:
    userBlock = composeUserMessageForIteration({
      summary,                    # НОВОЕ
      effectiveQuestion,          # НОВОЕ (вместо input.userMessage)
      preHits: i == 0 ? preHits : [],  # только на первой итерации
      toolMessages,
      history,
    })
    out = LLM(taskType='concierge-respond', system, user, ...)
    parsed = tryParseToolCall(out.text)
    if parsed.final: break
    # tool call ... (как сейчас)

  persist assistant + yield events
```

**Ключевые инварианты:**

1. `DialogService` инджектится **`@Optional()`** — как в `ClonesService`. Это позволяет:
   - старым unit-тестам без 2 новых аргументов конструктора оставаться зелёными;
   - откатить за минуту через ENV без re-deploy.
2. **Один feature-flag** `CONCIERGE_DIALOG_LAYER_ENABLED` (default `false`) включает **всё сразу**: dialog-layer препроцессинг + pre-retrieval + чтение summary. Раздельные флаги не нужны — компоненты сильно связаны.
3. Чтение `summary` отделено в **отдельную фазу** и идёт **до** dialog-layer интеграции — это самый дешёвый win и не требует Optional-инджекта.
4. Pre-retrieval использует **тот же `ToolRouterService.execute()`** что и обычный tool-call (но без записи в `ConciergeMessage role='tool'` и без `ConciergeUndoLog`) — это переиспользует RBAC, internal HTTP, метрики. Не дублируем код.
5. SSE-контракт не меняется. Добавляются опц. поля в события `thinking` (тип `dialog_intent`/`pre_retrieved`) для observability, фронт может их игнорировать.

## Фазы

### Фаза 1 — Summary в контекст (без dialog-layer) — [ ]

Самостоятельная ценность, минимальный риск.

- [ ] 1.1. В [concierge.service.ts:286](../../backend/src/modules/concierge/services/concierge.service.ts#L286) `loadOrCreateConversation` уже возвращает полный объект — `summary` доступен.
- [ ] 1.2. Сократить `K_RECENT` с 8 до 6 в `loadRecentHistory` (константа в начале файла, не магическое число).
- [ ] 1.3. В [composeUserMessageForIteration :362](../../backend/src/modules/concierge/services/concierge.service.ts#L362) добавить блок `КРАТКОЕ СОДЕРЖАНИЕ ПРЕДЫДУЩИХ СООБЩЕНИЙ:` если `conversation.summary != null` (передаётся параметром).
- [ ] 1.4. Передать `conversation.summary` в `composeUserMessageForIteration` (новый параметр).
- [ ] 1.5. Snapshot-тест на `composeUserMessageForIteration` с/без summary.
- [ ] 1.6. Проверить, что summarizer-cron всё ещё работает (он уже зелёный — не трогаем).

**Verify:** `cd backend && bun run test:unit -- concierge` зелёный, `bun run typecheck` зелёный.

### Фаза 2 — Подключение DialogService — [ ]

- [ ] 2.1. ENV-флаг `CONCIERGE_DIALOG_LAYER_ENABLED` в [env.schema.ts](../../backend/src/common/config/env.schema.ts), default `false`. Группа `concierge.dialogLayerEnabled`.
- [ ] 2.2. В [ConciergeService](../../backend/src/modules/concierge/services/concierge.service.ts) добавить `@Optional() @Inject(DialogService) private readonly dialog: DialogService | null = null` (паттерн из `ClonesService`).
- [ ] 2.3. Helper `private isDialogLayerEnabled()` (defensive try/catch на `cfg.concierge.dialogLayerEnabled`).
- [ ] 2.4. В `process()` перед основным циклом — вызов `DialogService.process({ scope: 'concierge', scopeRefId: conv.id, ... })`. Логировать длительности шагов с уровнем `debug`.
- [ ] 2.5. **Cache short-circuit:** если `dialog.cachedAnswer != null` — пропустить tool-loop, сразу `yield 'message'` + persist + `yield 'done'`. Метрика `concierge_cache_hit_total`.
- [ ] 2.6. `effectiveQuestion = dialog.enabled ? dialog.standaloneQuestion : input.userMessage` — использовать вместо `input.userMessage` в `composeUserMessageForIteration`.
- [ ] 2.7. Сохранить `dialog.intent`/`dialog.confidence` в LLM-meta при `appendMessage(role='assistant')`, если поле есть — облегчит дебаг.
- [ ] 2.8. Unit-тест: `process()` с моком `DialogService` (1) cache-hit пропускает LLM; (2) standaloneQuestion подаётся в LLM; (3) при отключённом флаге путь старый.
- [ ] 2.9. Метрика `concierge_dialog_layer_used_total{intent}`.

**Verify:** snapshot-тесты + unit зелёные, ручной запуск `bun run dev` с включённым флагом — ответ приходит, в логах виден `dialog: intent=... confidence=... queries=N`.

### Фаза 3 — Pre-retrieval по queries[] — [ ]

- [ ] 3.1. Новый private `preRetrieve(queries, ctx)`:
  - Параллельно `ToolRouterService.execute({ toolName: 'search_knowledge', args: { q } })` для каждой query.
  - **Не пишет** в `ConciergeMessage` и в `ConciergeUndoLog` — это служебный вызов.
  - Дедуп по `id` результата (или по `(type, id)` если type есть).
  - Top-N: брать `cfg.concierge.preRetrievalTopK` (default 12).
  - Тайм-аут на каждый запрос: `cfg.concierge.preRetrievalTimeoutMs` (default 3000ms). При тайм-ауте — skip, остальные продолжают.
- [ ] 3.2. Pre-retrieval запускается **только для** `intent ∈ {factual, exploratory, analytical}`. Для `clone_roleplay` и неизвестных — skip.
- [ ] 3.3. В системный промпт добавить блок (если `preHits.length > 0`):
  ```
  === ПРЕДВАРИТЕЛЬНЫЕ РЕЗУЛЬТАТЫ ПОИСКА ===
  Вот что нашлось в графе компании по этому вопросу. Если этого достаточно — отвечай по этим данным без дополнительных вызовов. Если данных мало — ты можешь вызвать search_knowledge сам.
  <json preHits>
  ```
- [ ] 3.4. SSE-событие `thinking { text: 'Нашёл N релевантных записей' }` перед первой LLM-итерацией (UX).
- [ ] 3.5. Pre-retrieval работает **только на первой итерации** tool-loop'а, чтобы не дублировать в follow-up'ах.
- [ ] 3.6. Unit + integration тесты.
- [ ] 3.7. Метрика `concierge_pre_retrieval_hits_count` (histogram).

**Verify:** ручная проверка — вопрос «что мы решили по проекту X» возвращает ответ с цитатами **без** явного tool-вызова в логах (потому что данные уже в системе).

### Фаза 4 — Наблюдаемость и admin-debug — [ ]

- [ ] 4.1. Все новые метрики в `BusinessMetricsService` (counter + histogram).
- [ ] 4.2. В `ConciergeMessage.toolCallsJson` (role='assistant') писать дебаг-блок:
  ```json
  {
    "dialogLayer": { "enabled": true, "intent": "...", "confidence": 0.87, "queriesCount": 3, "cacheHit": false },
    "preRetrieval": { "hits": 8, "uniqueIds": 6, "queriesUsed": 3 }
  }
  ```
- [ ] 4.3. Admin-страница `concierge-analytics` ([backend/src/modules/admin/analytics/concierge-analytics.service.ts](../../backend/src/modules/admin/analytics/concierge-analytics.service.ts)) — добавить breakdown по intent / cache-hit rate.
- [ ] 4.4. Pino-структурированные логи: `{ feature: 'concierge', stage: 'dialog-layer'|'pre-retrieval'|'tool-loop', ... }`.

### Фаза 5 — Тесты и регрессии — [ ]

- [ ] 5.1. Snapshot: `buildSystemPrompt` с/без preHits.
- [ ] 5.2. Snapshot: `composeUserMessageForIteration` 4 кейса (no-summary/no-hits, summary/no-hits, no-summary/hits, summary/hits).
- [ ] 5.3. Unit: `process()` end-to-end с моками всех зависимостей — каждая ветка флага.
- [ ] 5.4. Integration: реальный `DialogService` (но мок `LlmRouterService`) — проверить, что queries[] доходят до preRetrieve и обратно.
- [ ] 5.5. Verify legacy путь (`CONCIERGE_DIALOG_LAYER_ENABLED=false`): существующие тесты `concierge.service.spec.ts` зелёные **без изменений** — это инвариант.
- [ ] 5.6. `bun run typecheck`, `bun run lint`, `bun run test:unit`, `bun run test:integration` — все зелёные.

### Фаза 6 — second-brain обновления — [ ]

- [ ] 6.1. Создать / обновить `second-brain/01_projects/concierge-agent.md` — отразить новый pipeline, флаг, метрики, отличия от старого.
- [ ] 6.2. Обновить `second-brain/02_architecture/module-map.md` — связь Concierge ↔ dialog-layer.
- [ ] 6.3. Обновить `second-brain/01_projects/ai-jobs.md` — Concierge теперь использует те же 5 LLM-задач dialog-layer'а (`dialog-contextualize`, `dialog-confidence`, `dialog-classify`, `dialog-multi-query`).

### Фаза 7 — Выкат в прод — [ ]

- [ ] 7.1. `docs/operations/prod-deploy-log.md` Шаг 1: добавить `CONCIERGE_DIALOG_LAYER_ENABLED`, `CONCIERGE_PRE_RETRIEVAL_TOP_K`, `CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS`.
- [ ] 7.2. Smoke на dev-tenant: 5 типичных запросов (factual, exploratory, follow-up, action, role-clone routing) — проверить интенты и метрики.
- [ ] 7.3. Включить флаг на staging.
- [ ] 7.4. Метрика `concierge_dialog_layer_used_total` растёт, `concierge_cache_hit_total` ненулевая через час.
- [ ] 7.5. Включить флаг в проде. Готов rollback через одну ENV.

## Файлы, которые меняются

| Файл | Что |
|---|---|
| `backend/src/common/config/env.schema.ts` | `CONCIERGE_DIALOG_LAYER_ENABLED`, `CONCIERGE_PRE_RETRIEVAL_TOP_K`, `CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS` |
| `backend/src/common/config/typed-config.service.ts` | геттер `concierge.dialogLayerEnabled` и пр. |
| `backend/src/modules/concierge/services/concierge.service.ts` | главная переделка (summary, dialog-layer, pre-retrieval) |
| `backend/src/modules/concierge/services/concierge.service.spec.ts` | новые ветки |
| `backend/src/modules/concierge/concierge.module.ts` | без изменений (DialogLayerModule @Global) |
| `backend/src/common/metrics/business-metrics.service.ts` | новые counter/histogram |
| `backend/src/modules/admin/analytics/concierge-analytics.service.ts` | intent / cache-hit breakdown |
| `second-brain/01_projects/concierge-agent.md` | актуализация |
| `second-brain/02_architecture/module-map.md` | стрелка Concierge → dialog-layer |
| `docs/operations/prod-deploy-log.md` | Шаг 1 — новые ENV |

## Критерии готовности

1. Включён флаг → в логах виден `dialog: intent=... queries=N`, `pre-retrieval: hits=N`, `cache-hit` иногда срабатывает.
2. Длинный диалог (≥20 сообщений) — `conv.summary` подмешивается в контекст, заметно по логам и snapshot-тесту.
3. Follow-up «а почему?» после конкретного вопроса — переформулируется в standalone-вопрос (видно в `dialogLayer.intent` и в LLM-meta).
4. Вопрос «что мы решили по проекту X» возвращает ответ **без** явного tool-вызова — данные пришли из pre-retrieval.
5. Метрики на `/metrics` отдают новые counter'ы.
6. Флаг выключен → поведение **идентично** старому (unit-тесты до 1.5 — зелёные).

## Риски и митигации

| Риск | Митигация |
|---|---|
| `DialogService.process()` добавляет 2-4 LLM-вызова → latency p50 +1s | Pre-retrieval запускается **параллельно** с dialog-layer last steps, кэш в Redis. Если медленно — повышаем TTL `AnswerCache`. |
| Pre-retrieval по 3 queries × 3000ms = до 9s | Запускаем `Promise.all` с per-query timeout, не блокируем основной flow. |
| Promt дрейф: больше токенов → деградация качества | Сохраняем feature-flag, делаем A/B на 1 dev-tenant перед raise. |
| Старые unit-тесты падают | `DialogService` через `@Optional()` — конструктор совместим. Legacy путь оставлен под флагом. |
| Pre-retrieval вызывает `search_knowledge` → дёргает graph N раз | RBAC проверка от userId, никаких bypass'ов. Дедуп до отправки в LLM. |

## Итог

**Статус:** план составлен, ждёт согласования. Реализация — после `OK` от Сергея.
**Реализовано целиком:** нет.
**Что осталось:** всё (Фазы 1-7).

При согласии — старт с Фазы 1 (summary в контекст), это самый дешёвый win и не требует Optional-инджекта.
