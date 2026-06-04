---
status: draft
created: 2026-05-26
type: tz
priority: low
effort: 0.5 дня
depends_on: []
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 100%.**
> Реализовано полностью (done, 100%): оба spec-файла созданы и проходят (18 тестов зелёных), Вариант А с throw на дубликат checkInId реализован в парсере, reason='invalid_element' метрика заведена, коммит 7ede43db соответс
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Unit-тесты для CheckinSentimentBatchCron + parser

> Связанный контекст: [plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md §6](2026-05-25-llm-architecture-changes-from-experiments.md) (миграция operations на batch-cron), коммит `3cba11d` (Фаза 2 миграции LLM на DeepSeek-V4-Pro), задача 2 из [plans/analysis/2026-05-26-llm-migration-followup-prompt.md](../analysis/2026-05-26-llm-migration-followup-prompt.md).

## §0. Контекст

В сессии 2026-05-25/26 был сделан 8-фазный батч миграции LLM-агентов на DeepSeek-V4-Pro. В рамках Фазы 2 (§6 главной ТЗ-копилки) в коммите `3cba11d` появилась новая batch-инфраструктура для классификации настроения вечерних чек-инов сотрудников:

- `backend/src/modules/operations/workers/checkin-sentiment-batch.cron.ts` — новый `@Cron('*/5 * * * *')`, окно 60 минут, max 100 чек-инов за прогон, группировка по `tenantId` → батчи по 10, один LLM-вызов на батч (`taskType='checkin-sentiment-batch'`, модель `deepseek-v4-pro`, tool `submit_batch_sentiments`, `maxTokens=8000`).
- `backend/src/modules/operations/prompts/checkin-sentiment.prompt.ts` — функция `parseCheckinSentimentBatchToolInput(input: unknown)`, безопасный парсер `tool_call.input`, плюс константы (`CHECKIN_SENTIMENT_BATCH_TOOL`, `CHECKIN_SENTIMENT_BATCH_SIZE=10`, `CHECKIN_SENTIMENT_BATCH_PROMPT_VERSION='prompt-batch-v1'`, `CHECKIN_SENTIMENT_BATCH_SYSTEM_PROMPT`, `buildCheckinSentimentBatchUserMessage`).

Эксперимент 4 (`backend/test/eval/operations-experiment/`) показал: batch 10× даёт точность 25/25 (vs 24/25 у single), $0.0039 vs $0.0080 (в 2× дешевле), +20% быстрее.

Старый event-worker `CheckinSentimentAnalyzerWorker` оставлен как fallback (мгновенно реагирует на отдельный чек-ин) — у него уже есть полноценный spec (`checkin-sentiment-analyzer.worker.spec.ts`, 7 кейсов). У нового же batch-cron'а **unit-тестов нет** — это закрытый gap из Фазы 2.

Cron «best-effort»: ошибка в одном батче не валит остальные; cron всегда фильтрует по `sentiment IS NULL`, поэтому дублирующая обработка с event-worker'ом исключена. Метрики переиспользуются: `coo_sentiment_analyzed_total{sentiment, tenantTop}` и `coo_sentiment_failed_total{tenantTop}` (через `BusinessMetricsService`).

## §1. Цели

1. **Покрыть unit-тестами cron** — гарантировать что batch-логика (chunk по 10, группировка по tenantId, окно 60 мин, master-flag, обработка отсутствующего/невалидного `tool_calls`, ошибки LLM) ведёт себя как описано в коде и в §6 главной ТЗ-копилки.
2. **Покрыть unit-тестами parser** — гарантировать что `parseCheckinSentimentBatchToolInput` не падает на любых вариациях `unknown` и валидирует enum sentiment + строковость `checkInId`.
3. **Снять риски регрессии** — следующая итерация миграции (RP/seeds/правки промпта) не должна тихо ломать batch-обработку.
4. **Закрепить договорённости пользователя как тест-кейсы:**
   - дубликат `checkInId` в результате batch'а → **throw** + инкремент `coo_sentiment_failed_total` (лучше упасть один батч и переобработать, чем тихо писать случайные данные);
   - пустой массив `results` на входе парсера → **пустой массив на выходе** (не ошибка);
   - отсутствующий или пустой `tool_calls` от LLM → метрика `coo_sentiment_failed_total++`, best-effort продолжаем следующий батч;
   - **невалидный JSON/sentiment-enum/checkInId в отдельном элементе → silent skip + инкремент `coo_sentiment_failed_total{reason="invalid_element"}` на каждый пропущенный элемент.** Решение пользователя (зафиксировано 2026-05-26): не throw на весь батч из-за одного кривого элемента — best-effort принцип cron'а; видимость даёт метрика с лейблом reason. Метрика инкрементится в cron'е после возврата парсера, путём сравнения длины `args.items` с длиной `parseCheckinSentimentBatchToolInput(...)` — разница = число пропусков.

Integration-тест с реальной Prisma **не требуется** (пользователь подтвердил) — cron простой, юнит-кейсы покрывают.

## §2. Список тест-кейсов

### 2.1 `backend/src/modules/operations/workers/checkin-sentiment-batch.cron.spec.ts` (новый файл)

Шаблон mock-инфраструктуры — взять из `checkin-sentiment-analyzer.worker.spec.ts` (тот же `prisma`/`llm`/`metrics` через `vi.fn()`), но с поправкой:
- mock `prisma.dailyCheckIn.findMany` — список pending чек-инов (`{ id, tenantId, rawResponseText }`);
- mock `prisma.dailyCheckIn.update` — `vi.fn().mockResolvedValue(...)`;
- mock `cfg.betaOps.sentimentEnabled`;
- mock `llm.call` — возвращает `{ text, modelUsed, toolCalls: [{ name: 'submit_batch_sentiments', input: { results: [...] } }] }`;
- mock `metrics.incCooSentimentAnalyzed` / `metrics.incCooSentimentFailed`;
- `resolveOperationsTenantTop(tenantId)` — не мочить, использовать как есть (чистая ф-ция).

Тестируем публичный метод `runOnce(now: Date)` (специально выделен для тестов с произвольным `now`). Кейсы:

**Кейс 1 — 25 чек-инов одного tenant → 3 батча (10+10+5), все классифицированы.**
- `findMany` возвращает 25 строк одного `tenantId='t1'`.
- `llm.call` отвечает корректным `submit_batch_sentiments` с `results.length === item.length` (для каждого вызова — свои id).
- Ожидаем: `llm.call` вызван **ровно 3 раза**; `prisma.dailyCheckIn.update` — 25 раз; `incCooSentimentAnalyzed` — 25 раз с правильным `sentiment`; `incCooSentimentFailed` — 0; возврат `{ totalCheckIns: 25, batches: 3, classified: 25, failed: 0 }`.

**Кейс 2 — `toolCalls` отсутствует (модель ответила свободным текстом) → метрика failed += размер батча, best-effort идёт дальше.**
- 12 чек-инов одного tenant → 2 батча (10+2).
- Первый вызов `llm.call` возвращает `{ text: 'свободный текст без tool_call', toolCalls: [] }` (или `toolCalls: undefined`).
- Второй вызов — нормальный `submit_batch_sentiments` с 2 элементами.
- Ожидаем: `incCooSentimentFailed` вызван **10 раз** за первый батч; для второго — 2 успешных `incCooSentimentAnalyzed`; `prisma.dailyCheckIn.update` — 2 раза (только за второй батч); возврат `{ totalCheckIns: 12, batches: 2, classified: 2, failed: 10 }`.

**Кейс 3 — один невалидный элемент в результате батча → классифицируется только валидный.**
- 2 чек-ина одного tenant в одном батче (ids `cin-a`, `cin-b`).
- `llm.call` возвращает `toolCalls[0].input.results = [{ checkInId: 'cin-a', sentiment: 'green', rationale: 'ок' }, { checkInId: 'cin-b', sentiment: 'PURPLE', rationale: 'bad' }]` — второй элемент имеет невалидный enum.
- Ожидаем: парсер `parseCheckinSentimentBatchToolInput` молча отбросит второй; `prisma.dailyCheckIn.update` вызван 1 раз (только `cin-a`); `incCooSentimentAnalyzed` — 1 раз (`green`); `incCooSentimentFailed` — 1 раз (за `cin-b`, который остался не классифицированным); возврат `{ classified: 1, failed: 1 }`.

**Кейс 4 — `cfg.betaOps.sentimentEnabled = false` → ранний return, никаких вызовов.**
- Конфиг с `sentimentEnabled: false`.
- Вызывается публичный `run()` (не `runOnce`) — это путь cron'а, проверяем master-flag.
- Ожидаем: `prisma.dailyCheckIn.findMany` **не вызван**; `llm.call` **не вызван**; `prisma.dailyCheckIn.update` **не вызван**; метрики не дёрнуты. Логгер пишет `debug` (можно не проверять).

**Кейс 5 — окно 60 минут (`LOOKBACK_MS`).**
- `findMany` вызвать как реальный mock — проверить аргумент `where.completedAt.gte` равен `new Date(now.getTime() - 60*60*1000)`.
- Установить фиксированный `now = new Date('2026-05-26T12:00:00Z')`.
- Ожидаем: `prisma.dailyCheckIn.findMany.mock.calls[0][0].where.completedAt.gte` равен `new Date('2026-05-26T11:00:00Z')`. Также проверить `where.kind === 'evening'`, `where.sentiment === null`, `where.rawResponseText.not === null`, `orderBy.completedAt === 'asc'`, `take === 100`.

**Кейс 6 — группировка по `tenantId`: 2 tenant'а в одной выборке = 2 независимых LLM-вызова.**
- `findMany` возвращает 6 строк: 3 с `tenantId='t1'`, 3 с `tenantId='t2'`.
- Все — один батч на tenant (6 < 10).
- Ожидаем: `llm.call` вызван **ровно 2 раза**; в первом вызове `args.tenantId === 't1'`, во втором `'t2'` (или наоборот — порядок не гарантирован Map'ом, не проверять порядок, проверять наборы); каждый вызов содержит свой `userMessage` со своими 3 id; `prisma.dailyCheckIn.update` — 6 раз.

**Дополнительный кейс 7 (опционально, можно опустить если экономим время) — `runOnce` возвращает `{ totalCheckIns: 0 }` при пустом `findMany`:**
- `findMany` возвращает `[]`.
- Ожидаем: `llm.call` не вызван; возврат `{ totalCheckIns: 0, batches: 0, classified: 0, failed: 0 }`.

### 2.2 `backend/src/modules/operations/prompts/checkin-sentiment.prompt.spec.ts` (новый файл)

Чисто-функциональные тесты, без моков. Тестируем экспортированную `parseCheckinSentimentBatchToolInput`.

**Кейс 1 — валидный input с 10 элементами.**
- Input: `{ results: [10 объектов { checkInId, sentiment, rationale }] }`, sentiment чередуется по всем трём значениям.
- Ожидаем: массив из 10 элементов, порядок и значения сохранены; `rationale` обрезано по 1000 символов (можно проверить отдельно — см. кейс 6).

**Кейс 2 — невалидный `input` (не объект / null / undefined / строка / число) → пустой массив.**
- Несколько подкейсов: `parseCheckinSentimentBatchToolInput(null)`, `(undefined)`, `('строка')`, `(42)`, `([])`.
- Ожидаем: каждый возврат — `[]`. **Throw не бросается** — это вопрос задания: «невалидный JSON → throw». Уточнение: в текущей реализации `parseCheckinSentimentBatchToolInput` принимает `unknown` и **возвращает `[]` на «вообще не объект»** — это безопаснее, чем throw. Тест фиксирует фактическое поведение. См. §6.

**Кейс 3 — `input.results` не массив → пустой массив.**
- Input: `{ results: 'строка' }`, `{ results: null }`, `{ results: {} }`.
- Ожидаем: возврат `[]`.

**Кейс 4 — невалидный sentiment-enum → элемент молча пропускается.**
- Input: `{ results: [{ checkInId: 'a', sentiment: 'green', rationale: 'ок' }, { checkInId: 'b', sentiment: 'PURPLE', rationale: 'bad' }, { checkInId: 'c', sentiment: 'red', rationale: '!' }] }`.
- Ожидаем: возврат `[{ checkInId: 'a', sentiment: 'green', ... }, { checkInId: 'c', sentiment: 'red', ... }]` — длина 2, без `b`.
- Это **уточнение**: в задании написано «невалидный sentiment-enum → throw», но реальная реализация молча пропускает (см. строки 169–176 `checkin-sentiment.prompt.ts`). Тест фиксирует фактическое поведение. См. §6.

**Кейс 5 — `checkInId` не строка → элемент пропускается.**
- Input: `{ results: [{ checkInId: 42, sentiment: 'green', rationale: '!' }, { checkInId: 'b', sentiment: 'green', rationale: '!' }] }`.
- Ожидаем: возврат содержит только элемент `b`.

**Кейс 6 — `rationale` отсутствует или не строка → подставляется `''`; длинный rationale обрезается по 1000 символов.**
- Подкейс a: `{ results: [{ checkInId: 'a', sentiment: 'green' /* без rationale */ }] }` → `[{ ..., rationale: '' }]`.
- Подкейс b: `{ results: [{ checkInId: 'a', sentiment: 'green', rationale: 42 }] }` → `rationale: ''`.
- Подкейс c: `rationale: 'X'.repeat(2000)` → `rationale.length === 1000`.

**Кейс 7 — пустой массив `results` → пустой массив на выходе (решение принято).**
- Input: `{ results: [] }` → `[]`. Не ошибка.

**Кейс 8 — дубликат `checkInId` в результате batch'а.**
- **Решение пользователя (принято):** throw + инкремент `coo_sentiment_failed_total`. «Лучше упасть на одном пакете и переобработать, чем тихо писать случайные данные в БД.»
- **Текущая реализация `parseCheckinSentimentBatchToolInput` дубликаты НЕ детектирует** (нет проверки уникальности `checkInId`). Что делать:
  - **Вариант А (рекомендуется):** добавить в `parseCheckinSentimentBatchToolInput` проверку: если в `results` встречается дубликат `checkInId` — `throw new Error('checkin-sentiment-batch: дубликат checkInId в результате LLM: <id>')`. В cron'е обернуть `parseCheckinSentimentBatchToolInput` в try/catch: при throw — инкремент `metrics.incCooSentimentFailed` на каждый элемент батча, лог `logger.warn`, возврат `{ classified: 0, failed: args.items.length }`.
  - **Вариант Б:** оставить парсер без изменений, проверку дубликатов делать в cron'е (после парсера) — отдельный блок, throw наружу, тот же try/catch перехватывает.
  - Решает реализующий — главное, чтобы поведение совпадало с принятым решением: throw → failed metric на весь батч.
- Тест парсера (если выбран Вариант А):
  - Input: `{ results: [{ checkInId: 'a', sentiment: 'green', rationale: '!' }, { checkInId: 'a', sentiment: 'red', rationale: '!' }] }`.
  - Ожидаем: `expect(() => parseCheckinSentimentBatchToolInput(input)).toThrow(/дубликат/)`.
- **Парный тест в `checkin-sentiment-batch.cron.spec.ts` (дополнительный к §2.1):**
  - **Кейс «дубликат в результате батча → failed на весь батч».** 3 чек-ина одного tenant; `llm.call` возвращает `results` с дубликатом одного `checkInId`.
  - Ожидаем: `prisma.dailyCheckIn.update` **не вызван** (или вызван 0 раз); `incCooSentimentFailed` вызван 3 раза (на каждый элемент батча); `incCooSentimentAnalyzed` — 0 раз; возврат `{ classified: 0, failed: 3 }`. Лог `logger.warn` с упоминанием дубликата (можно не проверять текст).

## §3. Затронутые файлы

**Создаются:**
- `backend/src/modules/operations/workers/checkin-sentiment-batch.cron.spec.ts` — 6–7 unit-кейсов на cron (см. §2.1).
- `backend/src/modules/operations/prompts/checkin-sentiment.prompt.spec.ts` — 8 кейсов на parser (см. §2.2).

**Возможно правится (Кейс 8, выбор Варианта А):**
- `backend/src/modules/operations/prompts/checkin-sentiment.prompt.ts` — добавить детекцию дубликата `checkInId` и throw в `parseCheckinSentimentBatchToolInput`.
- `backend/src/modules/operations/workers/checkin-sentiment-batch.cron.ts` — обернуть `parseCheckinSentimentBatchToolInput` в try/catch (если throw парсера ещё не ловится текущим внешним catch'ем — проверить; внешний catch на весь batch уже есть, строки 269–283, и он считает весь батч failed — это совпадает с принятым решением, **дополнительная обвязка может не понадобиться**).

**Источники, на которые опираемся (не правим):**
- `backend/src/modules/operations/workers/checkin-sentiment-analyzer.worker.spec.ts` — паттерн моков, стиль.
- `backend/src/modules/operations/workers/commitment-followup.cron.spec.ts` — паттерн моков для `@Cron`-классов.
- `backend/test/eval/operations-experiment/fixtures/checkins-week.json` — готовая фикстура (25 чек-инов). **Не обязательна для unit-тестов** (моки сами генерируют id), но полезна для smoke-проверки реалистичности данных. Можно использовать частично — например, взять оттуда несколько `rawText` для семантической натуральности.

## §4. Acceptance criteria

- [ ] `cd backend && bunx vitest run src/modules/operations/workers/checkin-sentiment-batch.cron.spec.ts` — все кейсы зелёные.
- [ ] `cd backend && bunx vitest run src/modules/operations/prompts/checkin-sentiment.prompt.spec.ts` — все кейсы зелёные.
- [ ] `cd backend && bun run test:unit` — общий прогон не сломан (нет регрессий в соседних spec'ах).
- [ ] `cd backend && bun run typecheck` — 0 ошибок.
- [ ] `cd backend && bun run lint` (для новых файлов) — 0 ошибок (warnings — по существующему уровню репозитория).
- [ ] Покрыты **все 6 (или 7) кейсов cron'а** и **все 8 кейсов парсера** из §2 (включая дубликат `checkInId`).
- [ ] Mock'и `LlmRouterService` возвращают структуру, **совпадающую с реальным API** (`text`, `modelUsed`, `toolCalls: Array<{ name, input }>`) — сверить с типом `LlmCallResult` в `backend/src/modules/ai/services/llm-router.service.ts`.
- [ ] В тестах используется `vi.fn()`, `expect`, `describe`/`it` — стиль из `checkin-sentiment-analyzer.worker.spec.ts`.
- [ ] В spec-файле есть верхний docstring (`/** ... */`) — короткое описание что и зачем тестируется, ссылка на источник (§6 ТЗ-копилки и/или коммит `3cba11d`). Стиль см. в `checkin-sentiment-analyzer.worker.spec.ts:1-13`.
- [ ] Никаких реальных вызовов LLM, никаких реальных вызовов Prisma — только моки.
- [ ] Все строки на русском (включая docstring, описания `it(...)` — допустимы русские).

## §5. Roadmap

Один коммит, без фаз (объём 0.5 дня).

- [ ] Коммит `test(operations): unit-тесты для CheckinSentimentBatchCron + parseCheckinSentimentBatchToolInput`
  - создать `checkin-sentiment-batch.cron.spec.ts` (см. §2.1, 6–7 кейсов);
  - создать `checkin-sentiment.prompt.spec.ts` (см. §2.2, 8 кейсов);
  - если выбран Вариант А по дубликату — обновить `checkin-sentiment.prompt.ts` (throw) и при необходимости `checkin-sentiment-batch.cron.ts` (доп. лог о дубликате);
  - прогнать `bun run typecheck`, `bun run lint`, `bunx vitest run src/modules/operations/**` — всё зелёное;
  - закомитить и пушнуть с подтверждением пользователя.

После пуша — **рефлексия** в `second-brain/05_история/2026-05-26-checkin-batch-cron-tests.md` (по правилам CLAUDE.md, триггер 1).

## §6. Открытые вопросы

1. **Кейс 8 «дубликат `checkInId`» — где именно делать throw: в `parseCheckinSentimentBatchToolInput` (Вариант А) или в cron'е после парсера (Вариант Б)?** Решение пользователя «throw + failed metric» зафиксировано; место throw — на усмотрение реализующего. Рекомендация: Вариант А (чистота парсера, throw — это его контракт). Если в коде встретится явная гайдлайн-причина — задокументировать в коммите.

2. ~~Расхождение silent skip vs throw для невалидного JSON/sentiment-enum.~~ **ЗАКРЫТО 2026-05-26**: оставляем silent skip (best-effort принцип cron'а), видимость через метрику `coo_sentiment_failed_total{reason="invalid_element"}` на каждый пропущенный элемент. См. §1 пункт 4 и §2.2 Кейсы 2/4. Парные тесты в cron'е (`checkin-sentiment-batch.cron.spec.ts`) должны проверять что метрика инкрементируется правильное число раз при N пропусках в одном батче.
   
   **Действие реализующего:** перед началом — задать вопрос пользователю «оставляем silent-skip или меняем на throw?». Если непонятно — оставлять silent-skip (текущая реализация, безопасный default), и тесты подтверждают это поведение. Дубликат `checkInId` (Кейс 8) — отдельная история, там решение пользователя однозначно: **throw**.
