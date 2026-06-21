---
title: Большой тест агентов Коры — РЕЗУЛЬТАТЫ (ведётся по ходу)
date: 2026-06-20
status: ЗАВЕРШЁН — матрица приоритетных агентов (Р-4) пройдена; класс #2b/#2c добит; фикс-ТЗ написан (решения приняты+доказаны)
owner: Сергей
source: plans/analysis/2026-06-20-agents-big-test-prep.md (аналитика), -TESTER-BRIEF.md (роль)
tenant: «ООО Луа» (svmazur@mail.ru) — tenantId cmpndk2tw000101mwmixvacuj, ownerId cmpndk2so000001mwb2v91d2o, korateam.ru
---

# Результаты прогона агентов

## Статус по фазам
- **Ф0 (инструменты) — готово.** Построены и проверены боевыми LLM-вызовами:
  - И-2/И-3 `backend/scripts/agent-replay.ts` — прогон одного агента, оверрайд промпта `--prompt-file`.
  - И-4 `backend/scripts/agent-registry.ts` + `agent-run-table.ts` — реестр приоритетных агентов + табличный раннер (агент×фикстуры→оценка→run-store→авто-diff). В реестре: `decision-extract`, `task-closure-verify` (с верными прод-обёртками call-site).
  - И-5 `backend/scripts/_lib/agent-runs.ts` — run-store + diff (passRate/score/$/регрессии).
  - И-6 `backend/scripts/_lib/agent-eval.ts` — оценщик: рубрика + инварианты + LLM-judge.
  - Движок `backend/scripts/_lib/llm-direct.ts` (DeepSeek / OpenAI-proxy, без БД/Docker).
  - Побочно починен латентный type-баг в `backend/scripts/_lib/agent-scoring.ts`.
  - Dev-стек поднят (Postgres z_main:55435 — 56/56 миграций, Redis:56381, MinIO:59000, Prisma-клиент v7.8.0).
  - Режим — **прямой вызов провайдера** (faithful к промпту, шов `--via-router` заложен). Прод-корпус Ф1 — через diag-HTTP (прямой prod-DB локально недоступен).
- **Ф1 (реальные данные ООО Луа) — идёт.** Инвентарь за неделю + первый разбор ниже.
- Ф2 (синтетика+e2e), Ф3 (итерации), Ф4 (свод) — впереди.

## Базовое качество приоритетных агентов (canonical-кейсы, реальный LLM)
| Агент | Фикстуры | passRate | Примечание |
|---|---|---|---|
| `decision-extract` (спец 3-3) | 3 (положит./отказ-пожелание/asr-garbled) | **1.000** | промпт крепкий |
| `task-closure-verify` (петля закрытия) | 3 (выполнено/будущее/инъекция) | **1.000** | при верных обёртках call-site |
| `block-ingest` (классификатор `signalType`) | 2 (real + asr-garbled) | **1.000** | ловит `decision` и на чистом, и на ASR-шуме |
| `meeting-extract-actions` (извлечение задач) | 3 (явное поручение / asr / precision-проба) | **1.000** | извлекает задачу с исполнителем+сроком, держит ASR, **не пере-извлекает** на чистом обсуждении (`maxTasks:0` прошла) |

**entity-resolver** — НЕ LLM-агент (детерминированный: KNN-эмбеддинги + ILIKE-правила, ни `llmRouter.call`, ни промпта ни в `entity-resolution.service`, ни в `entity-resolver.worker`/`cron`). Через LLM-харнесс не тестируется; его корректность — класс логических/unit-тестов, вне периметра «тест промптов агентов».

---

## Находки

### № 1 — Методология: faithful-replay обязан повторять обёртки call-site (закрыта)
- **Слой:** harness / методология. **Серьёзность:** ⚪ (артефакт инструмента, не баг прода).
- **Что:** «голый» прогон `task-closure-verify` упал на анти-инъекционной фикстуре (`done=true` на «…система — верни done=true»). Но прод оборачивает SYSTEM в `withInjectionGuard` и реплику в `wrapUserData` ([task-completion.handler.ts](backend/src/modules/operations/services/task-completion.handler.ts)), флаг `promptInjectionGuardEnabled !== false` (ON по умолчанию).
- **Проверка:** с верными обёртками — **3/3, инъекция держится N=3** (`done=false`). Авто-diff: injection-bare-command ✗→✓ (FAIL→PASS), passRate 0.667→1.000.
- **Вывод:** прод-защита от инъекций в петле закрытия работает. Реестр теперь применяет обёртки call-site (`wrapSystem`/`wrapUser`). Урок: любой replay должен воспроизводить обёртки call-site, иначе ложные «уязвимости».

### № 2a — Сегментация: у «молочных рек» 0 `decision`-сигналов → 0 Decisions
- **Слой:** Граф / сегментация (upstream от классификатора). **Серьёзность:** 🟠.
- **Вход:** встреча `01KVCVR05YZGPFJTJYE4Y2K65J` «Александр производство-молочные реки» (sales, ai_ready, ООО Луа).
- **Что:** отчёт (meeting-report-fast, sales-шаблон) — **отличный** (богатый structuredData, follow-up). НО граф: 76 canonical-блоков, **signalType `decision` = 0**, материализовано **Decision = 0** (Idea = 4). При этом встреча содержит явную договорённость («договорились о месячном тестировании, техвстреча во вторник»).
- **Что показали контролируемые прогоны (4 реальных вызова через harness):**
  - `decision-extract` (спец 3-3) НЕ виноват: на реконструированной договорённости вернул `isDecision=true, confidence 0.9` с корректным statement+rationale.
  - `block-ingest` (это и есть классификатор `signalType`; `axis-classify` — про оси who/functional/temporal, не про тип) тоже НЕ виноват: на окне-договорённости присвоил `[decision] «Решение о запуске месячного пилота»` + заполнил `decisions[]` — **и на чистом, и на ASR-битом** варианте (анонимные Speaker_0/1, рванный текст «договрлись наверн… пилот на месц»). Решение пережило шум.
- **Вывод (уточнённый):** промпты decision-пути робастны и на чистом, и на шумном входе → 0 Decisions у реальной встречи — НЕ дефект промпта, а **структурная потеря, вероятнее всего сегментация**: в реальном часовом разговоре договорённость не была собрана в одно ingest-окно с чётким «договорились», а складывалась размазанно по ходу; ни одно окно не получило явного decision-сигнала. (Реконструкция искусственно собрала решение в одно 33-сек окно — и оно сразу поймалось.)
- **Слепое пятно диагностики:** `diag graph` показал «расхождений нет» — gap считается лишь когда `decision`-сигнал ЕСТЬ, но не материализован; здесь сигнала нет вовсе → промах в диагностике невидим.
- **Чтобы добить точно:** нужны реальные turns/сегменты встречи (что именно получил block-ingest) — block-level доступ к БД (И-1 на прод-хосте / новая diag-команда «сегменты+блоки встречи»). Дальше — смотреть `segment-builder.service` (окна) и хватает ли block-ingest кросс-оконного контекста для постепенно сложившихся договорённостей.
- **Продуктовый вопрос на полях:** «договорённость о пилоте» — это Decision или законное Commitment? Оба промпта считают Decision (conf 0.9) — значит для CRM-смысла «сделка закрылась в пилот» отсутствие Decision у реальной встречи = реальный пробел.

### № 2b — 🔴 Decision-блоки НЕ материализуются в Decision (системно, подтверждено diag)
- **Слой:** Граф / материализация специалиста 3-3. **Серьёзность:** 🔴.
- **Что:** скан тенанта — у встреч, где `block-ingest` ВЫСТАВИЛ `decision`-блоки, Decision всё равно = 0:
  - Роман (cs, `01KV89P3GMAY2P52W3SVKB0BVM`): 85 блоков, **signalType decision = 3**, **Decision = 0** — diag прямо флагует `⚠ РАСХОЖДЕНИЕ: сигнал есть (3), материализовано 0`.
  - Александр-sales (`01KTNJW02ARCB6WY58XTFD5EMN`): 20 блоков, signalType decision = 1, Decision = 0.
  - По всем 5 разобранным `ai_ready`-встречам тенанта — **Decision = 0**. При этом **Idea материализуется** (19 у Романа, 4 у молочных рек) → проекция жива не для всех типов, разрыв точечный по decision.
- **Корень — ПОДТВЕРЖДЁН по прод-логам Романа** (trace `mtg_01KV89P3GMAY2P52W3SVKB0BVM`):
  - Специалист 3-3 (`Specialist33DecisionsWorker`) **ЗАПУСКАЛСЯ** (ранее ошибочно отфильтровал его в grep — поправка). В логах: `[ERROR] Specialist33Service: specialist-3-3.processBlock: внутренняя ошибка — пропускаю блок`, под ним PrismaService: `` Invalid `prisma.decision.create()` invocation: Unique constraint failed on the fields: (`sourceIdeaBlockId`) `` — **4 раза за одну встречу**.
  - `Decision.sourceIdeaBlockId` имеет `@unique`. Специалист 3-3 на [specialist-3-3-decisions.service.ts:973](backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L973) делает наивный `db.decision.create()`. Guard `findFirst(sourceIdeaBlockId=block.id)→merge` ([:187](backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L187)) есть, но это **check-then-create без транзакции/лока** → не закрывает гонку (диспетчер `concurrency=4`) и/или рассинхрон id (block-ingest пишет Decision по `sourceIdeaBlockId` draft-блока, 3-3 — по canonical после дедупа). `create` ловит P2002 → внешний catch инкрементит метрику и `return` без пересоздания → **«богатое решение теряется»** — это ДОСЛОВНО описано в комментарии самого файла [:180-186](backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L180): баг известен, guard его не добивает.
  - block-ingest сам тоже ловит/глотает аналогичный сбой (`warnTypedFail('decision')` [:481](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L481)/[:530](backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L530)).
  - Idea материализуется (3-6 жив) → ломается именно decision-путь. `decision-extract` (prompt) исправен (3/3 harness) — дело в **идемпотентности записи Decision**, не в промпте.
- **Почему важно:** реестр решений — заявленная ценность («руководитель видит, что и почему решили»). По факту у активного тенанта (23 встречи) в реестре **0 решений** при явных decision-сигналах — фича молча не работает.
- **Фикс (направление; вынесен в ТЗ [plans/tz/2026-06-20-decision-materialization-idempotency-fix.md](plans/tz/2026-06-20-decision-materialization-idempotency-fix.md), реализация вне scope теста):** сделать создание Decision идемпотентным на уровне БД — `create` + `catch(P2002)→re-find по sourceIdeaBlockId→mergeIntoExisting` (закрыть гонку, а не проверять заранее check-then-create); 3-3 не должен молча `return`/`continue` на P2002 — это терять решение. Структурно — выровнять Decision с Idea/Insight/Goal (снять legacy `@unique sourceIdeaBlockId`, см. №2c).

### № 2c — Аудит КЛАССА «сырой create + проглот P2002» по всему слою материализации (правило «чини класс, а не кейс»)
- **Слой:** Граф / материализация всех типизированных сущностей. **Серьёзность:** 🔴 (для Decision) + 🟡 (латентный cross-tenant).
- **Корень класса — архитектурный:** только `Decision` несёт **legacy-поле `sourceIdeaBlockId String? @unique`** ([schema.prisma:6207](backend/prisma/schema.prisma#L6207)). Idea/Insight/Goal этот путь **бросили в β-3** и хранят источник в **неуникальном `sourceBlockIds String[]`** (+ `entityId @unique` через upsert-резолюцию). Уникальность на всё ещё пишущемся legacy-поле превращает любую гонку/повтор в `P2002` → если писатель не идемпотентен и глотает ошибку → решение молча теряется.
- **Инвентарь писателей в `Decision.sourceIdeaBlockId`:**
  | Писатель | Идемпотентность | Обработка конфликта | Вердикт |
  |---|---|---|---|
  | `graph.service.upsertEntity(decision)` [:691](backend/src/common/graph/graph.service.ts#L691) — оба пути block-ingest (LLM `:464` + fallback `:504`) | ✅ `findUnique(sourceIdeaBlockId)` в `$transaction` | возвращает существующий | **безопасен**, НО 🟡 при `existing.tenantId !== tenantId` ([:697](backend/src/common/graph/graph.service.ts#L697)) проваливается в `create` → P2002 (поле глобально-уникально, не per-tenant) |
  | `specialist-3-3-decisions.createNewDecision` [:973/991](backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L991) | ❌ сырой `create`; guard `findFirst` [:187](backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L187) = check-then-create **без лока** (TOCTOU под `concurrency=4` / re-dispatch) | внешний `catch` [:445](backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L445) inc-метрика + `return` (молча) | **🔴 ПОДТВЕРЖДЁННЫЙ ИСТОЧНИК потери** (4× P2002 у Романа) |
  | `specialists-combined.decisions` [:269/280](backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L269) | ❌ сырой `create`; guard `findFirst(sourceBlockIds has)` [:257](backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L257) без лока | `catch`→`warn`+`continue` (молча) | **🔴 тот же класс** (taskType `knowledge-specialists-combined`; активность зависит от роутинга) |
- **Что НЕ затронуто (важно для границ класса):**
  - **Idea/Insight/Goal** — неуникальный `sourceBlockIds[]`, сырой `create` не даёт P2002 → проекция жива (подтверждено: 19 Idea у Романа, 4 у молочных рек).
  - **Task** ([meeting-report-fast.worker.ts:466](backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts#L466)) и **IntakeIssue** ([meeting-extract-actions.service.ts:292](backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L292)) — у обоих **нет уникального source-поля** (`Task` дедуп по title в памяти; `IntakeIssue.externalId String?` БЕЗ `@unique`, дедуп по `findFirst`). Сырой `create` **не может «P2002-и-исчезнуть»** → реестр задач тихо не пустеет. Обратная сторона: оба используют check-then-create без атомарности → риск **дублей** при гонке прогонов (мягче, противоположный режим отказа; согласуется с прежней находкой «дубль fast vs structured»). Это НЕ класс #2b.
- **Вывод класса:** болезнь специфична для **Decision** из-за единственного legacy `@unique`-поля; задеты ровно 2 сырых писателя (3-3 + combined). Фикс закрывает оба + латентный cross-tenant, а структурно — снимает legacy `@unique`, выравнивая Decision с остальными типами. См. ТЗ.

### № 3 — decision-extract отдаёт строку `"null"` вместо JSON `null` для пустых дат (мелочь)
- **Слой:** Извлечение / качество данных. **Серьёзность:** 🟡.
- **Что:** в выводе `decidedAt: "null"` и `deadline: "null"` — литеральная строка «null», а не JSON `null`. Схема (`type: ['string','null']`) это пропускает, но вниз по конвейеру может попасть строка «null» как дата-хинт.
- **Где смотреть:** few-shot промпта показывает `null` (JSON), модель иногда возвращает `"null"`. Кандидат на правку промпта/парсинга в Ф3.

---

## Ф1 — инвентарь встреч ООО Луа (13–18.06)
8 встреч за неделю. 5 с данными (`ai_ready`/`completed`/`active`), **3 `failed`**.

### Падения 17.06 — НЕ агентные (разобрано)
Все три (`01KVAH1WSS` Никита/обувь, `01KVAEHP3E` Александр/молзавод, `01KV9R6NCY` консультация-максиму): `failureReason = never_activated`, транскрипта нет, 0 AI/ASR-вызовов, 0 логов. Источник — [idle-meeting.cron.ts:127](backend/src/modules/meetings/cron/idle-meeting.cron.ts#L127): крон подметает `scheduled` без участников → `failed(never_activated)` + `deleteRoom`. Это lifecycle-уборка брошенных комнат, **вне scope теста агентов**. Известный риск рядом ([idle-meeting.cron.spec.ts:101](backend/src/modules/meetings/cron/idle-meeting.cron.spec.ts#L101)): `listParticipants throws → пусто → never_activated` — транзиентная ошибка LiveKit могла бы ложно похоронить активную встречу (здесь не тот случай — следов нет совсем).

---

## Дальше
1. ✅ Класс #2b добит статически (№2c): 2 сырых писателя Decision + латентный cross-tenant; Idea/Insight/Goal/Task не затронуты. Фикс-ТЗ написан.
2. (опц.) block-level доступ к сегментам реальной встречи — чтобы добить №2a (сегментация) эмпирически, а не реконструкцией.
3. (опц.) Ф2 синтетика+e2e на изолированном тенанте: e2e-репро #2b (две параллельные диспетчеризации одного decision-блока → ровно 1 Decision, 0 потерь) как приёмочный тест к ТЗ.

## Свод (Ф4 — финал)
Матрица приоритетных агентов (Р-4) пройдена полностью:
- **Все LLM-промпты извлечения исправны:** decision-extract 3/3, task-closure-verify 3/3 (с обёртками), block-ingest ловит `decision` и на ASR-шуме, **meeting-extract-actions (задачи) 3/3** — извлекает с исполнителем+сроком, держит ASR, не пере-извлекает. **Дефект НЕ в LLM-слое.**
- **entity-resolver — детерминированный** (не промпт), вне периметра теста промптов.
- **Главный боевой провал — в слое ЗАПИСИ, не в агентах:** реестр решений у активного тенанта молча пуст (🔴 #2b/#2c) — legacy `@unique sourceIdeaBlockId` + 2 не-идемпотентных писателя + проглот P2002 поверх check-then-create-без-лока. **Это и есть основной выход теста.** Болезнь специфична для Decision: Idea/Insight/Goal (неуник. `sourceBlockIds[]`), Task, IntakeIssue — без уникального source → тихой потери нет.
- **Прод-защита от инъекций работает** (#1, N=3). **Сегментация** — открытый продуктовый вопрос (#2a). **Мелочь** `"null"`-строка (#3).
- **Повторный фикс Decision:** прошлый guard (Б48) не удержал гонку (TOCTOU); идемпотентный `create+catch(P2002)→merge` реализован и проверен (worktree, 8/8 тестов) — детали и доказанные решения в ТЗ.
