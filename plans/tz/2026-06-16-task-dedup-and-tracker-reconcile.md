---
type: tz
status: ready-to-implement
feature: task-dedup-and-tracker-reconcile
date: 2026-06-16
owner: владелец (Сергей, sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-15-task-dedup-and-conversation-to-tracker-reconcile.md
  - plans/tz/2026-06-15-intent-questions-are-not-commitments.md
  - second-brain/02_architecture/knowledge-core.md
  - docs/methodology/prompts/README.md
---
> Анализ: `plans/analysis/2026-06-15-task-dedup-and-conversation-to-tracker-reconcile.md` (research-complete, §11-bis перепроверка по коду) · Статус согласования развилок: 2026-06-16 (все 6 подтверждены владельцем).

# ТЗ — Дедуп задач между каналами + петля «разговор → статус в трекере»

**Принцип реализации.** Это не новая подсистема, а **достройка существующих механизмов**. Э2 — зеркало уже работающей петли обещаний (`CommitmentResponseHandler`). Дедуп — расширение готового `SimilarIssuesService`. Кандидаты — новый провайдер в готовом `PendingActionsService`. **Везде, где есть образец в коде — копировать образец, не изобретать.**

**Главные инварианты решения (не оптимизировать по-своему):**
1. **Suggest, не авто-действие.** Ни авто-merge задач, ни авто-закрытие. Всё необратимое — через обратимое предложение человеку.
2. **БД — источник правды, не событие.** Статусные петли — детерминированный пересчёт (как `decision-implementation`), события `EventEmitter2` — только триггер (теряются при сбое, см. REALITY-CHECK).
3. **Ship-On.** Каждая фаза выкатывается включённой; единственный флаг — аварийный kill-switch (ON по умолчанию).

## Режим исполнения (директива владельца, 2026-06-16)
**ТЗ реализуется ЦЕЛИКОМ за один заход — все фазы Ф0…Ф5, без остановок и без вопросов к владельцу.** Все развилки уже закрыты (§3). Если по ходу возникает НОВАЯ неоднозначность, не покрытая ТЗ:
- решай её сам по принципу «два прохода → доказать лучшее → двигаться дальше»;
- фиксируй выбор inline как `[ASSUMPTION: … — потому что …]` и продолжай реализацию **не останавливаясь**;
- НЕ задавай вопросов, НЕ предлагай развилок, НЕ жди подтверждения.
**Единственная сохранённая точка подтверждения — `git push`** (жёсткое правило проекта, CLAUDE.md). Вся работа до push — коммиты по фазам — выполняется автономно. После полной реализации — один запрос на push.

## Вне scope / отложено владельцем
- **Авто-закрытие задач без человека** — запрещено владельцем (Р1). Даже при высокой уверенности — только кандидат.
- **Авто-merge дублей** — запрещено (Р2). Только suggest.
- **Авто-снос задач при отмене решения** — запрещено (Р4). Только пометка «под вопросом».
- **Классификация intent≠обещание на создании** — владеет смежное ТЗ [intent-questions](plans/tz/2026-06-15-intent-questions-are-not-commitments.md); здесь только потребляем её результат (см. «Граничные контракты»).
- **Двусторонний live-синк статуса с внешними трекерами (Jira/Asana)** — vNext, не в этом ТЗ.

---

## 1. Цель + Зачем

**Болезненное состояние (по факту кода и аудита кабинета):**
- Одно поручение из встречи + Telegram + отчёта порождает несколько Issue — единой точки дедупа перед трекером нет (`IssuesService.create` пишет напрямую).
- Выполненные в разговоре задачи висят открытыми: LLM **распознаёт** «сделал/закрыл» (`block-ingest.prompt.ts`), но это создаёт блок в графе и **не трогает Issue**.
- Авто-перевод решений `approved → implemented` (`decision-implementation`) почти не срабатывает — первое звено (закрытие задач) разорвано.
- Отменили решение — задачи под ним висят (`supersede` трогает только `Decision`).

**Чем решение лучше:** замыкает контур «память ↔ исполнение» через гейт доверия — дедуп до записи + сигнал доведения (не авто-закрытие). Рыночный gap: ни один конкурент (зарубеж/РФ) не делает кросс-канальный семантический дедуп задач и закрытие из разговора; лидеры избегают авто-закрытия **намеренно** (цена ложного закрытия задокументирована — stale-bot/Zendesk; см. анализ §5, §8, §11).

---

## 2. REALITY-CHECK (по коду, проход 2 от 2026-06-15)

| Узел | Факт по коду | Следствие для ТЗ |
|---|---|---|
| Создание задач | **Нет единого chokepoint.** Два класса: (A) `IntakeIssue` → auto-triage → `IssuesService.create`; (B) прямой `IssuesService.create` в обход intake — email `project-inbox.service.ts:267`, self-task `me-tasks.service.ts:64` | Гейт дедупа на **двух уровнях** (Ф1) |
| `Issue.embedding` | Считается **async** `issue-embed.worker`; `create` делает fire-and-forget `void enqueueEmbed(...)` (`issues.service.ts:274`) → на свежей задаче `embedding IS NULL` | `findSimilar(issueId)` вернёт `[]` → нужен синхронный embed кандидата + `findSimilarByVector` (Ф1) |
| `SimilarIssuesService` | `findSimilar({tenantId, issueId})` грузит вектор существующей задачи (`similar-issues.service.ts:45-129`); вызывается ТОЛЬКО из read-эндпоинта `issues.controller.ts:424` | Вынести KNN-шаг в публичный `findSimilarByVector` (Ф1) |
| Дубль-связь | У `Issue` НЕТ `duplicateOfIssueId`; есть `IssueRelation.relationType` со значениями `duplicates`/`duplicated_by` (`schema.prisma:9460-9474`) | Переиспользовать `IssueRelation('duplicates')`, не новой колонкой (Ф1) |
| Петля обещаний | Полный прецедент Э2: `router.service.ts:379-399` emit `commitment.status_received` → `commitment-response.handler.ts:82-272` (@OnEvent → LLM-верификатор + `withInjectionGuard` → resolves-ребро → обновление статуса, идемпотентно, гард терминального статуса) | Э2 для задач — зеркало этого (Ф2) |
| Router switch | `done_item` = явный no-op (`router.service.ts:369`); `task_completed`/`task_status_changed` в switch **отсутствуют** → сигнал из разговора никуда не идёт | Добавить case → emit (Ф2) |
| Кандидат-очередь | `PendingActionsService` держит массив провайдеров (`pending-actions.service.ts:99`), `IntakePendingProvider` — готовая калька; контракт `countForUser/listForUser` + confirm/snooze | Новый провайдер `task_closure_candidate` (Ф2). CurationItem НЕ переиспользовать (очередь карточек графа) |
| Reopen-детект | `issues.service.ts:770-779` обнуляет `completedAt` при reopen + пишет `IssueActivity(status_changed)` | Reopen-rate измерим **без новых таблиц** (Ф3) |
| Суточный reconcile | `decision-implementation.cron.ts:36-118` — per-Org @Cron + try/catch + kill-switch; `decision-implementation.service.ts:117-137` — идемпотентный condition-UPDATE без LLM | Образец для Ф3 |
| Issue review-флаг | У `Issue` **нет** статус-enum (статус = FK на `IssueState`) и нет флага review | Нужна **новая колонка** (Ф4) — честно, не готовый кирпич |
| Goal вектор | У `Goal` **нет** `embedding` (в отличие от Issue/Decision/Idea/Entity); дедуп 3-14 по `ILIKE` 2 слов | Полный набор vector — самая дорогая фаза (Ф5, входит в заход) |
| Outbox/CDC | **Нет** в репо; `EventEmitter2` fire-and-forget, теряет события при сбое | «Статус обратно» = reconcile-cron по БД, не push (Ф3) |

---

## 3. Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Э2 = обратимый «кандидат на закрытие» + объяснение; авто-закрытие запрещено | Вход зашумлён >35%, LLM-confidence завышен (ECE 0.43), HITL слепо принимает; лидеры избегают авто намеренно (анализ §11) |
| Р2 | Дедуп Э1 = suggest, не авто-merge; гейт на двух уровнях входа | Авто-склейка разных задач необратима; нет единого chokepoint (REALITY-CHECK) |
| Р3 | Матч сигнал→Issue = семантический KNN по `Issue.embedding` + LLM-арбитр + обязательный NIL | `sourceBlockIds`-матч не работает (блок разговора ≠ блок задачи); защита от привязки к чужой похожей |
| Р4 | supersede решения → пометка задач «под вопросом», не авто-снос | CASCADE-катастрофа при ошибочной/временной отмене |
| Р5 | Вектор целей — **полный выделенный `Goal.embedding`+HNSW+воркер+backfill** (Ф5, последняя фаза, **входит в этот заход**). Обходной путь через `Entity{type=goal}.embedding` ОТВЕРГНУТ | (1) консистентность: у Issue/Decision/Idea/Insight/Entity/SkillTrait свой `vector(1536)` — Goal единственное исключение; (2) развязка: Entity-маршрут зависит от тайминга entity-resolution/проекции графа → цель может не иметь резолвнутой Entity → дедуп ненадёжен; (3) сам анализ помечал Entity-путь «обходной/промежуточный»; цена разовая, паттерн = копия `issue-embed.worker` |
| Р6 | Scope = оба класса входа задач (IntakeIssue + прямой create); Э2-вход = блок из разговора (отдельная ось) | Правило «чини весь класс» — иначе email/self-task без покрытия |
| Р7 | Реализация — **целиком за один заход, автономно, без вопросов/развилок**; новые неоднозначности решаются доказательством лучшего + `[ASSUMPTION]`, без остановки | Директива владельца 2026-06-16 (см. «Режим исполнения») |

---

## 4. Доказательство выбора
Полная матрица вариантов (A/B/C для Э1 и Э2), gap-таблица «конкурент × Z», технические паттерны (confidence-gate, reconcile, mention→record), состязательный red-team — в анализе `plans/analysis/2026-06-15-...md` §9, §11, §11-bis. Здесь не дублируется. Все 6 развилок прошли пере-проверку по коду (вердикты в анализе §13).

---

## 5. Scope

**Входит (всё за один заход):** Ф0 объективный гейт на создании · Ф1 дедуп задач (suggest, 2 уровня) · Ф2 петля разговор→кандидат на закрытие · Ф3 суточный reconcile + reopen-метрика + kill-switch · Ф4 supersede review-пометка · Ф5 вектор целей.

**Не входит:** см. «Вне scope». Каждый хвост закрыт решением или ссылкой на vNext.

---

## 6. Граничные контракты с другими ТЗ

- **intent-questions ([plans/tz/2026-06-15-intent-questions-are-not-commitments.md](plans/tz/2026-06-15-intent-questions-are-not-commitments.md)):** ВЛАДЕЕТ классификацией «вопрос/намерение ≠ обещание/задача» на этапе извлечения. Здесь Ф0 **потребляет** результат: если блок классифицирован как вопрос/намерение — задача из него не создаётся. НЕ реализовывать классификацию здесь; если её ещё нет в коде — Ф0 ставит детерминированный гейт по тем сигналам, что доступны (`signalType`, наличие owner/срока), и помечает зависимость.
- **Петля обещаний (`CommitmentResponseHandler`):** НЕ трогать. Э2 — отдельный параллельный обработчик по образцу; обещания и задачи остаются разными сущностями (связь Commitment↔Issue — vNext).
- **`decision-implementation`:** НЕ переписывать. Ф3 reconcile задач работает рядом; авто `approved→implemented` начнёт срабатывать как следствие закрытия задач через Ф2 (естественно, без правки `decision-implementation`).

---

## 7. Новые контракты (канон для копипасты)

> ⚠️ Номера строк — на момент написания (2026-06-16). Перед правкой перечитать файл по символу-якорю.

### 7.1 Prisma — новая модель `TaskClosureCandidate` (Ф2)
Обратимый кандидат на закрытие. Идемпотентность — `@@unique`. Reversibility — `status`. Применение закрытия — НЕ здесь (через `transitionState` на confirm).
```prisma
/// Э2 (TZ 2026-06-16) — обратимое предложение закрыть задачу по сигналу из
/// разговора. НЕ меняет Issue сам: человек подтверждает в очереди pending-actions.
/// Закрытие применяется через IssuesService.transitionState(category='completed')
/// только при confirm. status: pending → accepted | rejected | expired.
model TaskClosureCandidate {
  id              String    @id @default(cuid())
  tenantId        String
  issueId         String    /// задача-кандидат на закрытие
  sourceBlockId   String    /// IdeaBlock-сигнал выполнения из разговора
  status          String    @default("pending") @db.VarChar(16)
  matchSimilarity Decimal?  @db.Decimal(4, 3)   /// cosine similarity матча блок↔Issue
  confidence      Decimal?  @db.Decimal(4, 3)   /// откалиброванная уверенность верификатора
  rationale       String?   @db.Text            /// «почему считаем сделанным» — человеческим языком, +/- сигналы
  evidenceQuote   String?   @db.Text            /// цитата из разговора (для показа человеку)
  decidedByUserId String?
  decidedAt       DateTime?
  expiresAt       DateTime?                      /// авто-протухание pending (sweep, как IntakeIssue)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  /// Идемпотентность: один сигнал-блок → максимум один кандидат на задачу.
  @@unique([tenantId, issueId, sourceBlockId])
  @@index([tenantId, status])
  @@index([issueId])
}
```

### 7.2 Prisma — review-пометка на `Issue` (Ф4)
У `Issue` нет статус-enum (статус = FK `IssueState`), поэтому новая отдельная ось. Строкой, не enum (правило: enum нельзя DROP VALUE).
```prisma
  /// Р4 (TZ 2026-06-16) — задача помечена «под вопросом» после отмены/замены
  /// связанного решения (supersede). null — обычная задача. НЕ авто-снос:
  /// показывается человеку в pending-actions, снимается при ручном решении.
  closureReviewState  String?   @db.VarChar(24)  // null | superseded_decision
  closureReviewReason String?   @db.Text
  closureReviewAt     DateTime?
```
+ индекс (в блоке `@@index` модели `Issue`): `@@index([tenantId, closureReviewState])`.

### 7.3 Prisma — вектор `Goal` (Ф5)
```prisma
  /// Ф5 (TZ 2026-06-16) — pgvector embedding цели (text-embedding-3-small, 1536).
  /// Генерируется goal-embed.worker. HNSW-индекс — в postgres-init.sql (Prisma не умеет).
  embedding     Unsupported("vector(1536)")?
  embeddingHash String?
```
HNSW (только в `backend/scripts/postgres-init.sql`, DO-блок по образцу `Issue_embedding_hnsw_cosine_idx:478`):
```sql
DO $$ BEGIN
  IF EXISTS (SELECT FROM information_schema.columns WHERE table_name='Goal' AND column_name='embedding') THEN
    CREATE INDEX IF NOT EXISTS goal_embedding_hnsw_cosine_idx
      ON "Goal" USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;
  END IF;
END $$;
```

### 7.4 `SimilarIssuesService.findSimilarByVector` (Ф1)
Вынести KNN-шаг (текущие строки `82-128`) в публичный метод; `findSimilar(issueId)` становится обёрткой (грузит вектор → зовёт `findSimilarByVector`).
```ts
async findSimilarByVector(args: {
  tenantId: string;
  embedding: string;            // pgvector text-literal '[v1,v2,...]'
  limit?: number;
  threshold?: number;           // по distance; default DEFAULT_THRESHOLD
  excludeIssueId?: string;      // исключить саму задачу/кандидата
  openOnly?: boolean;           // true → только незакрытые (completedAt IS NULL) — для дедупа
}): Promise<SimilarIssueDto[]>
```
`openOnly` добавляет в WHERE `AND "completedAt" IS NULL` — дедуп ищет среди **открытых** задач, матч на закрытие (Ф2) — наоборот среди открытых тоже (закрытую закрывать не нужно).

### 7.5 BullMQ-событие + новый таскТайп
- Событие (EventEmitter2, не BullMQ-очередь — по образцу `commitment.status_received`): `'task.completion_signalled'` payload `{ tenantId: string; blockId: string; signalType: string; sourceType: string }`. `sourceType` обязателен — для гарда от зацикливания (трекер сам эмитит `task_completed`).
- Новые `taskType` (зарегистрировать И в union `LlmTaskType`, И в `ALL_LLM_TASK_TYPES`, `llm-router.service.ts` ~48-870; seed-route в `apply-prod-deploy.ts STEPS`):
  - `task-dedup-arbiter` (Ф1) — «та же задача или разные» с NIL.
  - `task-closure-verify` (Ф2) — «правда ли задача выполнена» (верификатор).
  Цепочка — `CHEAP_CHAIN` (`deepseek-v4-flash → gpt-5.4-mini → qwen3.5:9b`) по образцу `seed-llm-task-routes-goal-task-link.ts`.

### 7.6 AdminSetting-крутилки (не хардкод, не ENV)
| Ключ | Назначение | Дефолт (code-fallback) |
|---|---|---|
| `taskDedup.suggestThreshold` | similarity, выше которой зовём арбитр дедупа | 0.88 |
| `taskClosure.matchThreshold` | similarity матча блок↔Issue для кандидата | 0.85 |
| `taskClosure.autoConfirmThreshold` | порог, выше которого кандидат помечается `canQuickConfirm` (всё равно человек жмёт) | 0.95 |
| `taskClosure.reopenRateAlert` | доля reopen, выше которой алерт владельцу (бэктест) | 0.10 |
Пороги прогонять через `ConfidenceCalibrationService.calibrate(raw, taskType)` (`confidence-calibration.service.ts:50`) перед сравнением.

### 7.7 Новый `PendingActionsProvider` (Ф2)
`TaskClosurePendingProvider implements PendingActionsProvider` — калька `IntakePendingProvider` (`pending-actions/providers/intake.provider.ts`). `source = 'task_closure'`, `resourceType = 'task_closure_candidate'`, читает `TaskClosureCandidate(status='pending')`, `confirm(approve)` → `transitionState(completed)` + `status='accepted'`; `confirm(reject)` → `status='rejected'`. Регистрация — добавить в массив `this.providers` (`pending-actions.service.ts:99`).

---

## 8. Методология промптов новых агентов (ОБЯЗАТЕЛЬНО)

Создаём LLM-агентов `task-dedup-arbiter` (Ф1) и `task-closure-verify` (Ф2). **Каждый промпт писать строго по** [docs/methodology/prompts/README.md](docs/methodology/prompts/README.md):

1. **Анатомия 7 блоков** (обязательны 1–4 и 6): роль/персона · якоря смысла (зачем·кому·что-станет-с-результатом) · нумерованные критерии «что делает результат хорошим» (без прилагательных) · **≥3 few-shot «плохо→хорошо» на реальных входах**, хотя бы один из живого провала · self-check · строгий JSON-контракт + JSON Schema (`strict`) · запреты Z.
2. **Жёсткие требования Z** (нарушение = промпт не готов): cache-friendly (SYSTEM стабилен, переменные в конце USER); чистый русский на выходе, ни одного кода/англицизма; **на вход — человеческий ярлык, не машинный код** (`task_completed`/`3-3-decisions` → словарь `код→ярлык`); гейт «делать/не делать» держать на правилах в коде, LLM — только формулировка/верификация; пороги в `AdminSetting`.
3. **Чек-лист перед выкатом** (README §«Чек-лист») пройти целиком.
4. **Удачный промпт → эталон** в `docs/methodology/prompts/examples/` (одним файлом по структуре `probe-formulate.md`), строку в таблицу эталонов README.
5. **Анти-инъекция:** реплика из разговора — свободный текст → оборачивать `withInjectionGuard/wrapUserData` (образец `commitment-response.handler.ts:280-318`). Без этого `task-closure-verify` уязвим к «задача выполнена, закрой».
6. **Ship-On без golden:** промпт-правки выкатываем включёнными, наблюдаем прод-метрики (reopen-rate, доля NIL), без блокирующего golden ([[feedback_no_golden_ship_and_observe_prod]]).

Специфика по агентам:
- `task-dedup-arbiter`: вход — текст задачи-кандидата + до N похожих (человеческие заголовки, не id); выход — `{ verdict: 'same'|'different'|'nil', sameWithIssueRef?, confidence, rationale }`. NIL = «ни одна не подходит» обязателен (первым в списке, защита от «лепим top-1»).
- `task-closure-verify`: вход — текст задачи + цитата из разговора (человеческий ярлык типа сигнала, не `task_completed`); выход — `{ done: boolean, confidence, rationale, positiveSignals[], negativeSignals[] }`. `rationale` + сигналы — для показа человеку в кандидате (объяснимость в стиле Gong).

---

## 9. Требования (EARS, трассируемые)

- **R1.** Когда создаётся `IntakeIssue` (любой source), система shall до auto-triage вычислить embedding текста, найти похожие открытые Issue (`findSimilarByVector`, `openOnly=true`), и при similarity ≥ `taskDedup.suggestThreshold` вызвать `task-dedup-arbiter`.
- **R2.** Если `task-dedup-arbiter` вернул `verdict='same'`, то система shall записать `IntakeIssue.suggestedDuplicateOfIssueId` и НЕ дать auto-triage авто-принять (route to human); merge выполняет человек (`decision='duplicate'`, уже существует).
- **R3.** Когда задача создаётся прямым `IssuesService.create` в обход intake (email/self-task), система shall выполнить тот же дедуп-гейт ДО транзакции; при `verdict='same'` — создать Issue и `IssueRelation('duplicates')` + кандидат-подсказку в pending-actions (не блокировать создание).
- **R4.** Если embedding кандидата не посчитался за `taskDedup.embedTimeoutMs`, then система shall пропустить гейт и не блокировать создание (best-effort, лог WARN).
- **R5.** Когда canonical-блок получает `signalType ∈ {task_completed, task_status_changed, done_item}` из источника-разговора (`sourceType ≠ tracker`), система shall эмитить `task.completion_signalled`.
- **R6.** Когда обработчик получил `task.completion_signalled`, система shall найти открытую Issue семантически (`findSimilarByVector`, similarity ≥ `taskClosure.matchThreshold`), при неоднозначности/ниже порога — НЕ создавать кандидата (NIL).
- **R7.** Если матч найден, система shall вызвать `task-closure-verify`; при `done=true` — создать `TaskClosureCandidate(status='pending')` идемпотентно (`@@unique`), НЕ закрывая Issue.
- **R8.** Когда человек подтверждает кандидат (`confirm approve`), система shall закрыть Issue через `transitionState(category='completed')` и `status='accepted'`; при reject — `status='rejected'`, Issue не трогать.
- **R9.** Когда Issue, закрытая через accepted-кандидат, переоткрывается (`completedAt` обнулён, `IssueActivity status_changed`), система shall зачесть это в reopen-rate метрику.
- **R10.** Каждые сутки система shall пересчитать состояние (reconcile-cron, per-Org, condition-UPDATE): протухание pending-кандидатов, reopen-rate, подчистка пропущенных событием матчей; при reopen-rate > `taskClosure.reopenRateAlert` — алерт владельцу.
- **R11.** Когда `specialist-3-3` выносит `verdict='supersedes'` (решение заместило старое), система shall пометить связанные через `DecisionTaskLink` задачи `closureReviewState='superseded_decision'` (НЕ закрывать/не отменять) и показать в pending-actions.
- **R12.** (Ф5) Когда создаётся/обновляется Goal, система shall сгенерировать `Goal.embedding`; `specialist-3-14` shall дедуплицировать цели по KNN вместо ILIKE.
- **R13.** Все необратимые действия (закрытие, merge, пометка) — только через подтверждение человека или детерминированный гейт; ни один LLM-арбитр не меняет Issue напрямую.

---

## 10. Фазы

Граф зависимостей: Ф0 → Ф1; Ф0 → Ф2; Ф2 → Ф3; Ф4 независима (после Ф0); Ф5 независима (последняя). Ф1 и Ф2 после Ф0 идут разными точками врезки, Ф3 строго после Ф2. **Все 6 фаз выполняются за один заход** (директива «Режим исполнения»): закрыл фазу → commit → следующая, без остановок и без вопросов; ни одна фаза не пропускается.

### Ф0 — Объективный гейт качества на создании задачи
**Цель:** не создавать задачу из «мусора» (вопрос/намерение без owner/срока) — фундамент, иначе дедуп и закрытие масштабируют мусор.
**Входит:** детерминированная функция-гейт (правила в коде, НЕ LLM) перед созданием IntakeIssue/Issue из AI: требовать (тип = поручение/решение, не вопрос) И (есть явный owner ИЛИ срок ИЛИ источник=решение). Потребление классификации intent из смежного ТЗ (boundary §6).
**Файлы:** `tracker/services/meeting-extract-actions.service.ts` (создание IntakeIssue из встречи), `tracker/services/intake.service.ts:createFromMeetingNextStep`, `conversational/.../telegram-task-parser.service.ts`. Якорь — место перед `intakeIssue.create`.
**Что НЕ входит:** сам LLM-классификатор intent (смежное ТЗ); правка прямых email/self-task путей (там источник доверенный — человек/почта).
**Acceptance:** греп показывает вызов гейт-функции перед каждым AI-создающим `intakeIssue.create`; unit-тест: блок-вопрос без owner → задача не создаётся; блок-поручение с owner → создаётся; `bun run typecheck && bun run lint`.
**Закрывает:** R13 (частично — гейт на создании).

### Ф1 — Дедуп задач (suggest, два уровня входа)
**Цель:** одно поручение из N источников → не N задач.
**Входит:**
1. `SimilarIssuesService.findSimilarByVector` (рефактор §7.4) + `findSimilar` как обёртка.
2. Синхронный embed кандидата на лету: `EmbeddingFallbackService.embed([title+desc])` с таймаутом `taskDedup.embedTimeoutMs`, best-effort (R4). Образец вызова — `issue-embed.worker.ts:157`.
3. `task-dedup-arbiter` LLM (§7.5, §8) с NIL.
4. Уровень A (intake): гейт в `IntakeService.create`/`createFromMeetingNextStep` + новое поле `IntakeIssue.suggestedDuplicateOfIssueId` + блок auto-triage авто-accept при найденном дубле (`intake-auto-triage.worker.ts:400-432` — добавить проверку).
5. Уровень B (прямой create): гейт в `issues.service.ts:create` ДО транзакции (email/self-task) → `IssueRelation('duplicates')` + кандидат-подсказка.
6. Пороги — AdminSetting (§7.6).
**Файлы:** `tracker/services/similar-issues.service.ts:45-129`, `tracker/services/issues.service.ts:144` (create, до tx), `tracker/services/intake.service.ts:209,288`, `tracker/workers/intake-auto-triage.worker.ts:400-432`, `embeddings/services/embedding-fallback.service.ts:35`.
**Что НЕ входит:** авто-merge (только suggest); двусторонний синк.
**Acceptance:** негативный тест — две семантически разные задачи «починить логин» (разные описания) → `verdict='different'`, обе создаются; позитивный — дубль из встречи + telegram → вторая помечена `suggestedDuplicateOfIssueId`/`IssueRelation('duplicates')`; embed-таймаут → задача создаётся (R4); `findSimilarByVector` покрыт unit-тестом по фикстуре вектора; `bunx vitest run` зелёный.
**Закрывает:** R1, R2, R3, R4.

### Ф2 — Петля «разговор → кандидат на закрытие»
**Цель:** сказанное «сделал» становится обратимым предложением закрыть конкретную задачу.
**Входит:**
1. Router: добавить `case 'task_completed'/'task_status_changed'` + заменить no-op `done_item` (`router.service.ts:369`) → `eventEmitter.emit('task.completion_signalled', {tenantId, blockId, signalType, sourceType})` ПО ОБРАЗЦУ `case 'commitment_status':383-399`. Через `emit`, НЕ `targets.add`.
2. Новый `@OnEvent('task.completion_signalled')` handler (зеркало `CommitmentResponseHandler`): гард от зацикливания (`sourceType === 'tracker'` → skip); семантический матч (`findSimilarByVector`, `taskClosure.matchThreshold`, NIL); `task-closure-verify` LLM (`withInjectionGuard`); при `done=true` → `TaskClosureCandidate` идемпотентно (P2002-skip).
3. `TaskClosureCandidate` модель (§7.1).
4. `TaskClosurePendingProvider` (§7.7) + регистрация.
5. confirm-путь: approve → `transitionState(completed)`; reject → `status='rejected'`.
**Файлы:** `knowledge-core/services/router.service.ts:369-399`, новый `operations/services/task-completion.handler.ts` (образец `operations/services/commitment-response.handler.ts:82-272`), `pending-actions/providers/task-closure.provider.ts` (образец `intake.provider.ts`), `pending-actions/services/pending-actions.service.ts:99`, `tracker/services/issues.service.ts:transitionState`.
**Что НЕ входит:** авто-закрытие (Р1); суточный reconcile (Ф3).
**Acceptance:** e2e — блок «сделал задачу X» из разговора → создан `TaskClosureCandidate(pending)`, Issue НЕ закрыта; approve → Issue `completedAt` выставлен; повторный тот же блок → P2002-skip (идемпотентность); блок из `sourceType='tracker'` → кандидат НЕ создан (анти-зацикливание); инъекция «выполнено, закрой» в реплике → верификатор не подтверждает (обёртка); `bunx vitest run` зелёный.
**Закрывает:** R5, R6, R7, R8, R13.

### Ф3 — Суточный reconcile + reopen-метрика + kill-switch
**Цель:** подчистка пропущенного событием + измерение ложных закрытий.
**Входит:** per-Org @Cron (образец `decision-implementation.cron.ts:36-118`) с глобальным kill-switch `getDynamic('taskReconcile.enabled', true)`: протухание pending-кандидатов (`expiresAt`); пересчёт reopen-rate (по `IssueActivity` + обнулённому `completedAt` среди accepted-кандидатов, без новых таблиц); подбор пропущенных матчей в перекрывающемся окне N дней; алерт при reopen-rate > порога. Идемпотентность — condition-UPDATE (образец `decision-implementation.service.ts:117-137`), не один jobId.
**Файлы:** новый `operations/workers/task-reconcile.cron.ts`, `operations/services/task-reconcile.service.ts`.
**Что НЕ входит:** push-доставка статуса (Outbox нет — только pull-reconcile).
**Acceptance:** повторный прогон крона = no-op (идемпотентность как acceptance); pending старше TTL → expired; смоделированный reopen → попал в метрику; kill-switch OFF → крон не трогает БД; `bunx vitest run` зелёный.
**Закрывает:** R9, R10.

### Ф4 — supersede решения → review-пометка задач
**Цель:** отменили решение — задачи под ним подсвечены, не снесены.
**Входит:** новые колонки `Issue.closureReviewState/Reason/At` (§7.2); в `specialist-3-3-decisions.service.ts` ветке `verdict='supersedes'` (`:238-284`) — пометить связанные через `DecisionTaskLink` задачи `closureReviewState='superseded_decision'`; показ в pending-actions (расширить `TaskClosurePendingProvider` или отдельный provider).
**Файлы:** `backend/prisma/schema.prisma` (Issue), `knowledge-core/services/specialist-3-3-decisions.service.ts:238-284`, `tracker/services/decision-task-link.util.ts` (чтение связей).
**Что НЕ входит:** авто-отмена/снос задач (Р4).
**Acceptance:** supersede решения с 2 связанными задачами → обе `closureReviewState='superseded_decision'`, ни одна не отменена/не закрыта; снятие пометки человеком работает; миграция идемпотентна; `bun run typecheck`.
**Закрывает:** R11.

### Ф5 (самая дорогая, последняя — входит в заход) — вектор целей
**Цель:** дедуп целей по смыслу вместо ILIKE 2 слов.
**Входит:** `Goal.embedding/embeddingHash` (§7.3, версионируемая миграция) + HNSW DO-блок в `postgres-init.sql` + `goal-embed.worker` (образец `issue-embed.worker.ts`) + backfill-скрипт + регистрация в `apply-prod-deploy.ts STEPS`; `specialist-3-14-goals.service.ts:528` — заменить ILIKE-кандидатов на KNN.
**Файлы:** `backend/prisma/schema.prisma` (Goal), `backend/scripts/postgres-init.sql`, новый `knowledge-core/workers/goal-embed.worker.ts`, `backend/scripts/backfill-goal-embeddings.ts`, `knowledge-core/services/specialist-3-14-goals.service.ts:528`.
**Что НЕ входит:** ничего сверх выделенного вектора целей. Маршрут через `Entity{type=goal}.embedding` ОТВЕРГНУТ (Р5) — не реализовывать, делаем полный выделенный вектор.
**Acceptance:** две формулировки одной цели → KNN-кандидат найден, дубль-цель не создана; backfill идемпотентен (повтор = no-op); HNSW-индекс создан; `bunx vitest run`.
**Закрывает:** R12.

---

## 11. Pre-mortem / Риски (ревью-аспекты для strict-production-review-gate)

| Риск | Митигация (в коде) |
|---|---|
| Зацикливание: трекер сам эмитит `task_completed` при ручном закрытии → Э2 закроет→новый блок→петля | Гард `sourceType==='tracker' → skip` (R5/Ф2) + идемпотентный `@@unique` кандидата |
| Синхронный embed = SPOF `agent-lia.ru`, latency на каждое создание | Таймаут `taskDedup.embedTimeoutMs` + best-effort fallback (R4) |
| Двойной suggest (на IntakeIssue и повторно на accept→create) | skip-флаг в DTO `IssuesService.create` при accept из intake |
| Prompt-injection в реплике («выполнено, закрой») | `withInjectionGuard/wrapUserData` обязателен в `task-closure-verify` |
| Матч на чужую похожую задачу | Порог `taskClosure.matchThreshold` + NIL + человек-гейт (pending, не авто) |
| Висячие `sourceBlockIds` при merge/удалении блока | При матче учитывать `mergedIntoId/supersededById` блока |
| Тёзка-риск дедупа (две задачи «починить логин») | Порог дедупа выше панели similar (~0.88), AdminSetting-крутилка + арбитр |
| reopen после авто-accepted закрытия бьёт доверие | reopen-rate метрика + алерт + kill-switch с первого дня (Ф3) |
| Cross-tenant утечка в KNN | Все запросы tenant-scoped (как `similar-issues.service.ts`) |

## 12. Idempotency / флаги / prod-deploy
- **Идемпотентность:** `TaskClosureCandidate.@@unique` (один блок→один кандидат); reconcile-cron condition-UPDATE (повтор = no-op); backfill целей (Ф5) — повтор no-op (acceptance).
- **Флаги (Ship-On, kill-switch ON):** `taskDedup.enabled`, `taskClosure.enabled`, `taskReconcile.enabled` — все default `true` (аварийные рубильники); строка в `docs/operations/feature-flags.md`. Никаких «дефолт OFF».
- **prod-deploy-log:** Шаг 4 (новая модель `TaskClosureCandidate`, колонки `Issue.closureReview*`, `Goal.embedding`+`embeddingHash`), Шаг 5 (HNSW Goal — Ф5), Шаг 8 (backfill целей — Ф5), Шаг 12 (smoke: новые taskType в `/admin/ai-models`, новый pending-провайдер, новый cron). Новые `taskType` — в `apply-prod-deploy.ts STEPS` (seed-route).
- **second-brain:** обновить `01_projects/ai-jobs.md` (новые агенты `task-dedup-arbiter`/`task-closure-verify`), `01_projects/workers-queues.md` (reconcile-cron, completion-handler), `02_architecture/data-model.md` (`TaskClosureCandidate`, `Issue.closureReview*`), `01_projects/api-layer.md` если новый эндпоинт confirm.

## 13. DoD
- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные.
- `bunx vitest run` по новым/затронутым файлам — зелёные.
- Промпты новых агентов прошли чек-лист методологии (§8); эталоны добавлены в `examples/`.
- Все необратимые действия — за подтверждением человека (R13 верифицирован грепом: нет `issue.update`/`transitionState` из LLM-обработчика напрямую).
- second-brain + prod-deploy-log + feature-flags обновлены.
- Рефлексия записана.

## 14. Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось, какие фазы отложены.)_
