---
type: tz
status: ready-to-implement
feature: checkin-day-report-from-graph
date: 2026-06-29
owner: владелец (Сергей)
relates_to:
  - plans/architecture/2026-06-29-checkin-day-report-from-graph.md
  - plans/analysis/2026-06-29-checkin-ingest-rebuild.md
  - plans/tz/2026-06-29-sync-bitrix-chatbox-same-time.md
  - plans/tz/2026-06-21-universal-daily-checkin-fixator-tz.md
---
> Архитектура (одобрена владельцем 2026-06-29): `plans/architecture/2026-06-29-checkin-day-report-from-graph.md` · Анализ: `plans/analysis/2026-06-29-checkin-ingest-rebuild.md` · Статус согласования: 2026-06-29 (Р1–Р7 закрыты владельцем)

# ТЗ — Дневной план и отчёт из общего анализа (4 сущности отчёта)

## Принцип

План и отчёт сотрудника собираются **не отдельным детектором**, а из разметки, которую общий ночной анализатор разговоров (`block-ingest`) уже делает по всем источникам. Тонкий сборщик (без LLM) читает размеченные блоки за день, достраивает отчёт до 4 сущностей (**сделано / не сделано / помешало / идеи**) и пишет в карточку дня. Слой `day-signal-*` сносится как дубль. «Не сделано» считается семантически — переиспользуя существующего «проверщика закрытия» (`task-closure-verify`), не текстовым совпадением.

## Цель + Зачем

**Болезненное состояние (verified, см. анализ §2–3):** фиксацию плана/отчёта делает отдельный свип `DaySignalAggregatorCron` в 21:00 локали человека, читая `RawEvent` за сегодня. Но Bitrix/chatbox попадают в `RawEvent` только следующей ночью с back-dated `occurredAt` → свип их **структурно не видит никогда**. Плюс этот свип дублирует разметку, которую `block-ingest` уже делает (`signalType ∈ {plan_item, done_item, …}`). Итог: сотрудник, отчитавшийся в рабочем чате, числится «не сдал»; отчёт фиксируется как обрывок (только «сделано»+«блокеры»).

**Что делаем:** (1) сборщик читает граф (блоки `block-ingest`) и собирает дневной отчёт из 4 сущностей; (2) «не сделано» = утренние `plan_item`, не закрытые к вечеру по смыслу (через `task-closure-verify`); (3) карточка дня расширяется полями «не сделано» и «идеи» + полнота; (4) явный негатив «не дал план/отчёт» фиксируется строкой-ожиданием; (5) слой `day-signal-*` удаляется.

**Метрика «решено»:** доля рабочих дней, где у связанного сотрудника зафиксирован план/отчёт из Bitrix/chatbox, растёт с 0; «не сделано» не содержит ложных провалов из-за перефразировки (семантическая сверка); ни одного второго LLM-прохода «детект плана» поверх `block-ingest`.

## REALITY-CHECK (verified по коду 2026-06-29)

| Что | Факт (path:line — перечитать перед правкой, номера дрейфуют) | Вывод для ТЗ |
|---|---|---|
| Модель `DailyCheckIn` | `prisma/schema.prisma:7352`, `@@unique([tenantId, personId, kind, dateLocal])`, `@@map("daily_check_ins")`; поля `plansJson/donesJson/blockersJson/completedAt/source/qualityScore Decimal(4,3)/parseConfidence/sourceContributions` | расширяем аддитивно (Ф1); merge-апсерт переиспользуем |
| `upsertFromDaySignal` | `daily-checkin.service.ts:158` — merge по `sourceRank`, не понижает явный личный ответ; `upsertInternal:360` пишет `upsertData` | расширяем под `notDone/ideas` (Ф1, Ф4) |
| Разметка `block-ingest` | enum `SignalType` `schema.prisma:412` содержит `plan_item, action_item, done_item, task_completed, result, blocker, idea, suggestion, hypothesis`; промпт различает план/обещание/выполнение `block-ingest.prompt.ts:351` | сырьё отчёта; НЕ дублировать (Ф2) |
| Авторство блока | у `IdeaBlock` **нет** общего `authorPersonId` (только `commitmentAuthorPersonId` для commitment); общий автор — `IdeaBlockEvidence.authorPersonId` + `sourceTimestamp` (`schema.prisma:3588,3593`), relation `evidence IdeaBlockEvidence[]` | сборщик группирует по `evidence.authorPersonId` (Ф2) — критично |
| «Проверщик закрытия» | `task-completion.handler.ts:455` приватный `verify({tenantId, taskTitle, signalType, quote}) → {done, confidence, rationale, positiveSignals, negativeSignals}|null`; taskType `task-closure-verify`, JSON-schema, retry×2, injection-guard | извлекаем в переиспользуемый сервис (Ф3) |
| Свип `day-signal-*` | `day-signal-aggregator.service.ts`+`workers/day-signal-aggregator.cron.ts` (`@Cron('0 * * * *')`, час=`daySignals.processLocalHour`), `day-signal-detector.service.ts`, `prompts/day-signal-detect.prompt.ts`; обвязка `operations.module.ts:31-33,103-106` | сносим целиком (Ф7) |
| Реактивный мост встреч | `workers/meeting-checkin.listener.ts` (`@OnEvent(MEETING_AI_READY)`) зовёт `day-signal-detect` | переписать на graph-derive (Ф4) |
| Дисциплина / дашборды | `operations-dashboard.service.ts:268` `getCheckinDiscipline` (Expected=кол-во строк, Completed=`completedAt!=null`), `getMissingCheckIns`; `weekly-per-person.service.ts` (текстовый матч план↔done `:225-239`), `monthly-digest` | читают `daily_check_ins` — наполняем полнее, миграция аддитивна (Ф5) |
| Плейсхолдер-ожидание | `daily-checkin-prompt.cron.ts` создаёт пустые строки только при `userId!=null` и точном часе; учитывает выходные/праздники/отпуск (`HolidayService`/`PersonLeaveService`) | переиспользуем правила рабочего дня для негатива (Ф6) |
| Крутилки | `daySignals.enabled/detectThreshold/processLocalHour` в `admin-setting-schema-registry.ts`; `daySignals.enabled` — kill-switch в `feature-flags.md` | судьба — Ф7 (см. Б8) |

## Принятые решения владельца (2026-06-29, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Отчёт собираем из разметки `block-ingest`, отдельный свип сносим | анализ §4–7, матрица A/B/C; дубль агента + сломанный тайминг |
| Р2 | «Не сделано» — семантически через `task-closure-verify`, не текстом | архитектура §3/§8; текст даёт ложные провалы при перефразировке |
| Р3 | «Идеи» добираем из графа автоматически, человека не спрашиваем | архитектура Р3/Р7 |
| Р4 | Latency чат→утро принята | забор ночной (анализ Р-3); same-day остаётся у встреч/почты/бота |
| Р5 | Полнота — **мягкий** индикатор, «сдал» при неполном отчёте не блокируем | архитектура Р5 (развилка А) |
| Р6 | Явный негатив «не дал план/отчёт» фиксируем строкой-ожиданием на рабочий день | архитектура Р6 (развилка Б) |
| Р7 | Вечерний вопрос бота остаётся коротким | архитектура Р7 (развилка В) |

## Доказательство выбора

Макро-выбор (A. перенести свип / **B. дерайв из графа** / C. писать чек-ин внутри block-ingest) доказан в анализе `2026-06-29-checkin-ingest-rebuild.md §7` — выбран **B**. Микро-решения реализации:

| # | Решение | Альтернатива | Почему так |
|---|---|---|---|
| Б1 | «Не сделано» = `plan_item` дня без семантического закрытия, через `task-closure-verify` | текстовый матч (как `weekly-per-person:225`) | текст даёт ложные провалы при перефразировке (анализ §3); проверщик уже доказан в проде |
| Б2 | Автор блока — через `evidence.authorPersonId`, группировка по нему; день — по `evidence.sourceTimestamp` в TZ Person | top-level поле блока | у `IdeaBlock` нет общего `authorPersonId` (verified) — только evidence |
| Б3 | Тайминг сборщика — фикс **05:00 МСК за вчера** | событие «день дозабран / очередь block-ingest пуста» | к 05:00 вчерашние Bitrix(00:00)+chatbox(00:00)+analyze(03:00) уже легли; событийный триггер — vNext (числовой триггер: если медиана задержки block-ingest >90 мин) |
| Б4 | «Не сделано»/«идеи» — поля **evening-строки** `DailyCheckIn`; единая точка правды | новая таблица | дашборды уже читают `daily_check_ins`; отчёт = evening row (план = morning row) |
| Б5 | Извлечь `verify` в переиспользуемый `ClosureVerifierService` | дублировать `llm.call` в сборщике | `feedback`-правило «переиспользуй, не дублируй»; один контракт проверщика |
| Б6 | Предфильтр перед `verify`: пропускать `plan_item`, у которого есть точное/почти-точное `done_item` дня | звать verify на каждый план | дёшево отсекает явные «сделал» → меньше LLM-вызовов (бюджет) |
| Б7 | `reportCompleteness` (`draft`/`full`) = `qualityScore` ≥ порог И заполнены ≥3 из 4 частей | только `qualityScore` | «полнота» = и качество, и состав (4 сущности), Р5 — мягко |
| Б8 | `daySignals.enabled` переименовать в общий kill-switch сборщика `dayReport.enabled`; `detectThreshold/processLocalHour` удалить | оставить как есть | старые крутилки относятся к сносимому свипу; нужен один рубильник новой сборки |

## Scope

**Входит:** расширение `DailyCheckIn` (Ф1); graph-read сборки блоков (Ф2); переиспользуемый `ClosureVerifierService` + расчёт «не сделано» (Ф3); сборщик-cron + реактивный мост встреч на graph-derive (Ф4); `reportCompleteness` + проброс `notDone/ideas/completeness` в дашборд-DTO (Ф5); явный негатив строкой-ожиданием (Ф6); снос `day-signal-*` + крутилки/флаг (Ф7); backfill + метрики + prod-deploy (Ф8).

**Не входит (с судьбой):**
- Событийный триггер сборщика (Б3) — vNext, числовой триггер «медиана задержки block-ingest >90 мин».
- Правка `upsertFromParser` (telegram-путь) и `createOrUpsertManual` (веб-кабинет) — не трогаем; они «главнее» автоматики по `sourceRank`.
- Расширение вечернего вопроса бота до 4 частей — Р7, не делаем.
- Авто-связь `BitrixUser/ChatboxMember→Person` — вне scope (анализ Р-3), несвязанные сотрудники не покрываются; метрика отброшенных.
- UI-доработка карточки дня под 4 части и индикатор полноты — отдельное FE-ТЗ (этот контракт даёт DTO; визуал — `frontend-design`/`impeccable` после).
- Единый забор 00:00 МСК — реализован отдельным ТЗ `2026-06-29-sync-bitrix-chatbox-same-time.md`.

## Pre-flight (gate перед Ф2 — обязателен)

**R0.** Перед реализацией Ф2 — на проде (qa-кабинет, read-only) подтвердить recall разметки: выборка реальных Bitrix/chatbox-сообщений с планом/отчётом → проверить, что `block-ingest` создал блоки `plan_item`/`done_item`/`task_completed` с корректным `evidence.authorPersonId`. Если recall < 0.7 по выборке — СНАЧАЛА точечно усилить правила `block-ingest.prompt.ts` (НЕ заводить второй агент), затем продолжать. Результат выборки зафиксировать в `plans/analysis/2026-06-29-checkin-ingest-rebuild.md` (раздел «Проверка recall»). **Закрывает: R0.**

## Граничные контракты

- **`block-ingest`** — читаем его выход (`IdeaBlock`+`IdeaBlockEvidence`), адаптер не меняем (кроме точечной правки правил при R0). Формы: блок несёт `signalType`, evidence несёт `authorPersonId`+`sourceTimestamp`+`rawEventId`.
- **`task-closure-verify`** — переиспуём промпт/taskType/JSON-schema как есть; меняем только место вызова (выносим `verify`).
- **Дашборды** — контракт чтения `daily_check_ins` не ломаем; только добавляем поля в DTO.

## Фазы

Зависимости: **Ф1 → Ф2 → Ф3 → Ф4 → Ф5 ; Ф6 || Ф4(после Ф1) ; Ф7 после Ф4 ; Ф8 финал**. R0 (pre-flight) — строго до Ф2.

```
R0 (recall-gate)
Ф1 (Prisma extend) → Ф2 (graph-read) → Ф3 (ClosureVerifier + notDone) → Ф4 (сборщик cron + мост встреч) → Ф5 (completeness + DTO)
                                                                          Ф6 (явный негатив) ┘
Ф7 (снос day-signal-*) после Ф4 · Ф8 (backfill+метрики+флаг+deploy) финал
```

### Ф1 — Prisma: расширить `DailyCheckIn` (4 сущности + полнота)

**Ценность:** как сборщик отчёта, получаю поля для «не сделано» и «идей», чтобы хранить полный дневной отчёт в единой точке правды.
**Файлы:** `backend/prisma/schema.prisma` (модель `DailyCheckIn :7352`), новая версионируемая миграция `prisma/migrations/*`.
**Контракт (добавить в модель, после `blockersJson`):**
```prisma
  /// Не сделано за день: Array<{ text, sourcePlanText?, verdictConfidence? }>.
  /// Заполняется сборщиком из plan_item без семантического закрытия (ТЗ Ф3). NULL до сборки.
  notDoneJson  Json?
  /// Идеи за день: Array<{ text, sourceBlockId? }>. Из signalType idea/suggestion/hypothesis. NULL до сборки.
  ideasJson    Json?
  /// Полнота отчёта: 'draft' | 'full' (ТЗ Ф5, Б7). NULL до расчёта.
  reportCompleteness String? @db.VarChar(8)
```
**Что НЕ входит:** изменение существующих полей/индексов; логика заполнения (Ф3–Ф5).
**Acceptance:**
- `bun run prisma:migrate -- --name daily_checkin_report_4_entities` создаёт миграцию (аддитивную, nullable — без дефолт-бэкфилла); `bun run prisma:generate` зелёный.
- grep `schema.prisma`: модель `DailyCheckIn` содержит `notDoneJson`, `ideasJson`, `reportCompleteness`.
- `bun run typecheck` зелёный (тип Prisma Client расширен).
**Закрывает: R1.**

### Ф2 — Graph-read: собрать блоки дня по человеку

**Ценность:** как сборщик отчёта, получаю по (человек, день) размеченные куски «план/сделано/блокер/идея», чтобы собрать из них отчёт, не вызывая LLM.
**Новый файл:** `backend/src/modules/operations/services/day-report-collector.service.ts` (read-часть).
**Контракт:**
```ts
interface DayReportRaw {
  personId: string;
  dateLocal: string;            // YYYY-MM-DD по TZ Person
  plans: Array<{ text: string; blockId: string }>;       // plan_item, action_item
  dones: Array<{ text: string; blockId: string }>;       // done_item, task_completed, result
  blockers: Array<{ text: string; blockId: string }>;    // blocker
  ideas: Array<{ text: string; blockId: string }>;       // idea, suggestion, hypothesis
}
collectForDay(args: { tenantId: string; dateLocal: string; personIds?: string[] }): Promise<DayReportRaw[]>
```
**Поведение (R2):**
- Карта `signalType → ведро`: `{plan_item, action_item}→plans`, `{done_item, task_completed, result}→dones`, `{blocker}→blockers`, `{idea, suggestion, hypothesis}→ideas` (вынести в константу `DAY_REPORT_SIGNAL_BUCKETS`).
- Запрос: `prisma.ideaBlock.findMany({ where: { tenantId, signalType: { in: ALL_BUCKET_TYPES } }, include: { evidence: true } })`; **автор и день — из `evidence`** (Б2): для каждого блока берём evidence с `authorPersonId != null`, день = `getLocalDate(evidence.sourceTimestamp, person.timezone)`; блок попадает в (authorPersonId, dateLocal). Блоки/evidence без `authorPersonId` — пропуск + метрика `day_report_block_dropped_no_person_total`.
- Текст пункта — `IdeaBlock.trustedAnswer`/`name` (перечитать поле в коде; использовать человеческую формулировку, не служебную).
- Дедуп внутри ведра по нормализованному тексту (`trim().toLowerCase()`).
- `tenantId` в каждом запросе; `@@index([tenantId, signalType])` уже есть.
**Что НЕ входит:** запись чек-ина; «не сделано»; LLM.
**Acceptance:**
- Unit `day-report-collector.service.spec.ts`: фикстуры блоков (plan_item автор A; done_item автор A; idea автор B; блок без evidence-автора) → `collectForDay` возвращает для A `{plans:[1], dones:[1]}`, для B `{ideas:[1]}`; блок без автора отброшен, метрика инкрементнута.
- `bunx vitest run src/modules/operations/services/day-report-collector.service.spec.ts` зелёный.
**Закрывает: R2.**

### Ф3 — `ClosureVerifierService` + расчёт «не сделано»

**Ценность:** как сборщик отчёта, получаю по каждому утреннему плану вердикт «закрыт/не закрыт к вечеру по смыслу», чтобы честно показать «не сделано» без ложных провалов.
**Файлы:** новый `backend/src/modules/operations/services/closure-verifier.service.ts` (извлечь `verify` из `task-completion.handler.ts:455`); рефактор `task-completion.handler.ts` на использование сервиса (поведение не меняется); `day-report-collector.service.ts` (метод `computeNotDone`).
**Контракт:**
```ts
// ClosureVerifierService — переиспользует TASK_CLOSURE_VERIFY_* (промпт/taskType/schema) как есть
verify(args: { tenantId: string; taskTitle: string; signalType: string; quote: string }):
  Promise<{ done: boolean; confidence: number; rationale: string;
            positiveSignals: string[]; negativeSignals: string[] } | null>
```
**Поведение (R3, Б1/Б5/Б6):**
- `task-completion.handler` теперь зовёт `closureVerifier.verify(...)` — идентичная сигнатура/поведение (retry×2, injection-guard, parse), регрессий нет.
- `computeNotDone(raw: DayReportRaw)`: для каждого `plans[i]` — **предфильтр (Б6):** если есть `dones[j]` с нормализованным текстом ≈ план (точное совпадение) → считается сделанным, verify не зовём. Иначе `verify({ taskTitle: plan.text, signalType: 'plan_item', quote: <склейка dones+blockers дня, лимит ~2000 симв> })`. `done===false` (или null) → пункт в «не сделано» с `verdictConfidence=confidence`. `done===true` → исключаем.
- Гейт стоимости: «не сделано» считаем только для **завершённых** evening-чек-инов и только если у человека есть утренний план дня; нет плана → notDone пуст.
**Совместимость с prompt caching:** SYSTEM `TASK_CLOSURE_VERIFY_SYSTEM_PROMPT` — стабильная константа (не трогаем); переменное (`taskTitle`, `quote`) — в user (как сейчас).
**Что НЕ входит:** изменение промпта проверщика; запись в БД (Ф4).
**Acceptance:**
- `closure-verifier.service.spec.ts`: `verify` с моком llm → корректно парсит `{done,confidence,…}`; null при невалидном JSON после retry.
- `task-completion.handler.spec.ts` (существующие) — зелёные после рефактора (регрессии нет).
- `computeNotDone`: план «дожать договор» + dones без совпадения + мок verify `done=false` → пункт в notDone; план «позвонить клиенту» + done «созвонился с заказчиком» + мок verify `done=true` → НЕ в notDone; план с точным done-совпадением → verify НЕ вызван (мок не дёрнут, предфильтр).
- `bunx vitest run src/modules/operations/services/closure-verifier.service.spec.ts` зелёный.
**Закрывает: R3, R4.**

### Ф4 — Сборщик: cron за вчера + реактивный мост встреч

**Ценность:** как руководитель, наутро вижу честный «сдал/не сдал» и полный отчёт сотрудника из всех каналов, включая Bitrix/chatbox.
**Файлы:** `day-report-collector.service.ts` (метод `assembleAndUpsert`); новый `workers/day-report-collector.cron.ts`; переписать `workers/meeting-checkin.listener.ts` (graph-derive вместо `day-signal-detect`); `daily-checkin.service.ts` (`upsertFromDaySignal`/`upsertInternal` — принять `notDone`/`ideas`).
**Поведение (R5, Б3):**
- `upsertInternal`/`upsertFromDaySignal` расширить: писать `notDoneJson`, `ideasJson` (как `plansJson` сейчас). evening-строка несёт `dones/notDone/blockers/ideas`; morning-строка — `plans`.
- `assembleAndUpsert(tenantId, dateLocal)`: `collectForDay` → для каждого человека: morning upsert (`plans`), evening upsert (`dones`, `blockers`, `ideas`, `notDone` из `computeNotDone`), `source` = преобладающий источник блоков дня (переиспользовать логику `pickDominantSource`/`sourceRank`), `completed: true`.
- **Cron** `day-report-collector.cron.ts`: `@Cron('0 5 * * *', { timeZone: 'Europe/Moscow' })` (05:00 МСК, Б3); для каждого активного `Org` собрать за **вчера** (по TZ Person). Идемпотентность: Redis NX `dayreport:collect:{tenantId}:{dateLocal}` EX 25ч; повторный прогон — no-op. Kill-switch `dayReport.enabled` (Ф7/Б8): OFF → no-op.
- **Реактивный мост встреч:** `meeting-checkin.listener` на `MEETING_AI_READY` — после того как блоки встречи построены `block-ingest`, дернуть `collectForDay`/`assembleAndUpsert` для участников встречи за день встречи (same-day). Если блоки ещё не готовы на момент события — мост best-effort, дневной cron добьёт наутро. Убрать вызовы `DaySignalDetectorService`/`DaySignalExtractorService` отсюда.
**Что НЕ входит:** completeness (Ф5); негатив-ожидание (Ф6); снос свипа (Ф7).
**Acceptance:**
- `day-report-collector.service.spec.ts` (доп.): `assembleAndUpsert` с моком collector+verifier → один morning upsert (plans) и один evening upsert (dones/notDone/blockers/ideas) на человека; повторный прогон через Redis NX — 0 новых upsert.
- grep `day-report-collector.cron.ts`: `@Cron('0 5 * * *'` и `timeZone: 'Europe/Moscow'` и `dayreport:collect:`.
- grep `meeting-checkin.listener.ts`: НЕ содержит `DaySignalDetectorService`.
- `bunx vitest run src/modules/operations/services/day-report-collector.service.spec.ts` зелёный.
**Закрывает: R5, R6.**

### Ф5 — Полнота отчёта + проброс в дашборд-DTO

**Ценность:** как руководитель, вижу, отчёт полный или черновой, и новые части (не сделано/идеи) в карточке — но «сдал» не зависит от полноты (Р5).
**Файлы:** `day-report-collector.service.ts` (расчёт `reportCompleteness`); `dto/daily-check-in.dto.ts` (+ `notDone`, `ideas`, `reportCompleteness`); `daily-checkin.service.ts` `toDto:452`; `dto/checkin-discipline.dto.ts`/`weekly-per-person.dto.ts` при необходимости; фронт `src/api/my-check-ins.api.ts` (+ поля в `DailyCheckInApi`).
**Поведение (R7, Б7, Р5):**
- `reportCompleteness` (на evening-строке): `full` если `qualityScore >= dayReport.completenessQualityThreshold` (крутилка, дефолт 0.5) И заполнено ≥3 из 4 частей (dones/notDone/blockers/ideas непусты); иначе `draft`. **На `completedAt`/«сдал» НЕ влияет** (Р5).
- `toDto` отдаёт `notDone`, `ideas`, `reportCompleteness`; `getCheckinDiscipline`/`getMissingCheckIns` логику «сдал» НЕ меняют (Expected/Completed как есть).
- Фронт DTO дополнить; русские подписи частей.
**Что НЕ входит:** визуальная вёрстка карточки (отдельное FE-ТЗ); изменение формулы «сдал».
**Acceptance:**
- `daily-checkin.service.spec.ts`: evening с 4 непустыми частями + `qualityScore=0.7` → `reportCompleteness='full'`; только dones + `qualityScore=0.3` → `'draft'`; в обоих `completedAt` не зависит от полноты.
- `getCheckinDiscipline` тест: чек-ин `reportCompleteness='draft'` всё равно считается `completed` (Р5).
- Фронт `bun run typecheck` зелёный; новые поля в `DailyCheckInApi`.
**Закрывает: R7.**

### Ф6 — Явный негатив «не дал план/отчёт»

**Ценность:** как руководитель, отличаю «человек промолчал» от «система не поймала» — вижу реальный факт «не дал».
**Файлы:** `day-report-collector.cron.ts` или новый `workers/checkin-expectation.cron.ts`; переиспользовать `HolidayService`/`PersonLeaveService`/`workingDays` (как `daily-checkin-prompt.cron.ts`).
**Поведение (R8, Р6):**
- На рабочий день для каждого связанного сотрудника (`relationship='employee'`, рабочий день по `workingDays`, не праздник, не отпуск) гарантировать наличие **строки-ожидания** morning и evening (`completedAt=NULL`, пустые части) — идемпотентный upsert по `(tenantId, personId, kind, dateLocal)`, НЕ перетирающий заполненную строку.
- Запускать ДО/в составе сборщика (порядок: ожидания → сборка наполняет). Тогда «не дал» = строка осталась с `completedAt=NULL` после сборки → `getCheckinDiscipline` числит `missed` (уже умеет).
- Выходные/праздники/отпуск — ожидание не заводим (паритет с `daily-checkin-prompt.cron`).
**Что НЕ входит:** уведомления о негативе; эскалации.
**Acceptance:**
- `checkin-expectation.spec.ts`: рабочий день, сотрудник без активности → после прохода есть morning+evening строки с `completedAt=NULL`; выходной → строк нет; заполненная строка не перетёрта.
- `getCheckinDiscipline` тест: такой сотрудник числится `morningMissed/eveningMissed`, не выпадает из знаменателя.
**Закрывает: R8.**

### Ф7 — Снос слоя `day-signal-*` + крутилки/флаг

**Ценность:** как система, перестаю гонять второй LLM-проход по тем же данным и держать мёртвый сломанный свип.
**Файлы:** удалить `services/day-signal-aggregator.service.ts`(+spec), `workers/day-signal-aggregator.cron.ts`, `services/day-signal-detector.service.ts`(+spec), `prompts/day-signal-detect.prompt.ts`; проверить и решить судьбу `services/day-signal-extractor.service.ts` (Б: если используется только day-signal — удалить; если ещё где-то — оставить); `operations.module.ts:31-33,103-106` (убрать провайдеры/cron); `ai/services/llm-router.service.ts` (убрать `day-signal-detect` из `ALL_LLM_TASK_TYPES`); `seed-llm-routing.ts`/`backend/scripts/*` (убрать маршрут `day-signal-detect`); `admin-setting-schema-registry.ts` (Б8: `daySignals.detectThreshold`/`processLocalHour` — удалить; `daySignals.enabled` → переименовать в `dayReport.enabled`, kill-switch); `docs/operations/feature-flags.md`.
**Поведение (R9, Б8):**
- После сноса grep `day-signal-detect`/`DaySignalAggregator`/`DaySignalDetector` по `backend/src` — 0 совпадений (кроме истории/доков).
- `dayReport.enabled` — kill-switch (Ship-On, дефолт ON), строка в `feature-flags.md`; `dayReport.completenessQualityThreshold` (0.5) — крутилка в registry+сид.
- `seed`-маршрут `task-closure-verify` уже существует (переиспользуем) — не трогаем.
**Что НЕ входит:** изменение `task-closure-verify`-маршрута; миграции данных (старые чек-ины остаются).
**Acceptance:**
- grep `backend/src`: `DaySignalAggregatorService|DaySignalDetectorService|day-signal-detect` → 0.
- grep `admin-setting-schema-registry.ts`: нет `daySignals.detectThreshold`/`processLocalHour`; есть `dayReport.enabled`, `dayReport.completenessQualityThreshold`.
- `feature-flags.md` содержит `dayReport.enabled` (kill-switch · ON).
- `bun run typecheck`/`lint`/`build` зелёные.
**Закрывает: R9, R10.**

### Ф8 — Backfill + метрики + prod-deploy

**Ценность:** как владелец, получаю исторические отчёты по уже построенным блокам и наблюдаемость покрытия, и понятную прод-инструкцию.
**Файлы:** новый `backend/scripts/backfill-day-report.ts` (`createPrismaClient()` из `_lib/prisma`, импорт из `../src`); регистрация в `backend/scripts/apply-prod-deploy.ts` `STEPS` (`phase:'backfill'`, `skipBootstrap:true`); метрики `business-metrics.service.ts` (`day_report_collected_total`, `day_report_block_dropped_no_person_total`, `day_report_not_done_verify_calls_total`); `docs/operations/prod-deploy-log.md` Шаги 4/7/8/12; `docs/operations/feature-flags.md`.
**Поведение (R11):**
- `backfill-day-report.ts --days N`: прогнать `assembleAndUpsert` за последние N дней по уже построенным блокам (без LLM, кроме notDone-verify); идемпотентно (повторный прогон = no-op по merge-апсерту).
- Метрики инкрементятся в сборщике (Ф2/Ф4).
- prod-deploy-log: Шаг 4 (миграция Ф1), Шаг 8 (backfill-скрипт), Шаг 12 (smoke: новый `@Cron` `DayReportCollectorCron`; отсутствие `day-signal-detect`-маршрута).
**Что НЕ входит:** новые дашборд-виджеты.
**Acceptance:**
- `backfill-day-report.ts` зарегистрирован в `STEPS` с `phase:'backfill'`,`skipBootstrap:true`; повторный прогон на тех же днях не создаёт дублей (merge).
- grep `business-metrics.service.ts`: три новые метрики.
- prod-deploy-log Шаги 4/8/12 обновлены; `apply-prod-deploy.ts` содержит backfill-шаг.
**Закрывает: R11, R12.**

## Требования (трассировка)

- **R0** Перед сборкой система shall пройти проверку recall разметки `plan_item`/`done_item` на проде; при recall<0.7 — сперва правка правил `block-ingest`. (Pre-flight)
- **R1** `DailyCheckIn` shall иметь поля `notDoneJson`, `ideasJson`, `reportCompleteness`. (Ф1)
- **R2** Сборщик shall собрать по (человек, день) блоки 4 вёдер из графа, атрибутируя по `evidence.authorPersonId`+`sourceTimestamp`. (Ф2)
- **R3** `verify` проверщика закрытия shall быть переиспользуемым сервисом без регресса `task-completion.handler`. (Ф3)
- **R4** «Не сделано» shall = `plan_item` дня без семантического закрытия (через verify), с предфильтром точных совпадений. (Ф3)
- **R5** Когда наступает 05:00 МСК, система shall собрать отчёт за вчера и записать в `DailyCheckIn` (идемпотентно); встречи — реактивно same-day. (Ф4)
- **R6** Сборщик shall писать `dones/notDone/blockers/ideas` (evening) и `plans` (morning) через merge-апсерт, не понижая явный личный ответ. (Ф4)
- **R7** Система shall проставлять `reportCompleteness` (`draft`/`full`) и отдавать `notDone/ideas/completeness` в DTO; полнота shall НЕ влиять на «сдал». (Ф5)
- **R8** В рабочий день для связанного сотрудника без активности система shall оставить строку-ожидание (`completedAt=NULL`) → числится `missed`; в выходной/отпуск — не заводить. (Ф6)
- **R9** Слой `day-signal-*` shall быть удалён (0 ссылок в `backend/src`). (Ф7)
- **R10** Kill-switch shall быть `dayReport.enabled` (ON); устаревшие `daySignals.detectThreshold/processLocalHour` — удалены. (Ф7)
- **R11** Backfill shall пере-собрать отчёты за N дней идемпотентно; метрики покрытия shall инкрементироваться. (Ф8)
- **R12** prod-deploy-log/feature-flags shall быть обновлены. (Ф8)

## Границы фичи

- ✅ Always: `tenantId` в каждом запросе; merge без перезатирания явного ответа; переиспользование `task-closure-verify`/`upsertFromDaySignal`; русские подписи; идемпотентность cron (Redis NX) и backfill.
- ⚠️ Ask first: менять промпт `task-closure-verify`; менять формулу «сдал»; вводить событийный триггер сборщика; менять `upsertFromParser`/telegram-путь.
- 🚫 Never: второй LLM-агент «детект плана» поверх `block-ingest`; текстовый матч вместо verify для «не сделано»; `process.env.*`; `new PrismaClient()` в скриптах; хардкод порогов вместо AdminSetting; OFF-флаг «понаблюдаем→включим».

## Сквозные аспекты

- **RBAC/tenant:** все запросы `IdeaBlock`/`DailyCheckIn` несут `tenantId`; sentiment-поля по-прежнему скрываются по роли (`stripSentimentForRole`). Новые части (notDone/ideas) — видимость как у dones (сотрудник видит свой день).
- **Observability:** 3 метрики (Ф8) + pino-логи в сборщике/cron.
- **Errors/идемпотентность:** Redis NX (cron), merge-апсерт (backfill), verify→null трактуется как «не подтверждено».
- **Миграции:** аддитивная nullable (Ф1), backfill отдельным шагом (Ф8).
- **Rollout/флаг:** `dayReport.enabled` kill-switch ON (Ship-On).
- **Тесты:** unit на collector/verifier/completeness/expectation; регресс task-completion.

## Idempotency / флаг / prod-deploy

- Cron сборщика — Redis NX на (tenant, день); merge-апсерт идемпотентен по ключу; backfill повторно = no-op.
- `dayReport.enabled` — kill-switch ON (`feature-flags.md`).
- prod-deploy-log: Шаг 4 (миграция Ф1), Шаг 7 (сид крутилок `dayReport.*` + удаление маршрута `day-signal-detect`), Шаг 8 (`backfill-day-report.ts`), Шаг 12 (smoke `@Cron DayReportCollectorCron`, отсутствие `day-signal-detect`). Все — через `docker compose exec backend ...`.

## DoD

- `bun run typecheck` (вкл. `.spec`), `lint`, `build` — зелёные (backend и frontend).
- Все фазовые vitest зелёные; регресс `task-completion.handler` зелёный.
- second-brain обновлён: `01_projects/operations.md`/`ai-jobs.md`/`workers-queues.md` (новый cron, снос свипа, переиспользование verify), `02_architecture/data-model.md` (поля `DailyCheckIn`), `04_не-сделано/README.md` — строку про противофазу закрыть/обновить.
- prod-deploy-log Шаги 4/7/8/12 + feature-flags обновлены.
- Рефлексия в `05_история/`.

## Итог

_(заполняется оркестратором: реализованные фазы, коммиты, верификация.)_
