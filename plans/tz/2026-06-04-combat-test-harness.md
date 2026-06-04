---
type: tz
status: draft
area: knowledge-core / qa-harness
created: 2026-06-04
owner: sergrv80
related:
  - plans/analysis/2026-06-04 — аудит агентов Z (38 багов / 7 корневых причин)
  - second-brain/02_architecture/knowledge-core.md
  - second-brain/02_architecture/module-map.md
---

# Харнесс боевого теста на синтетике (combat-test-harness)

Локальный, env-driven, read-after-write харнесс, который **вбрасывает синтетические данные в КАЖДУЮ
точку входа в knowledge-core** и проверяет прохождение цепочки до графа/проекций/задач. Выдаёт матрицу
`pass/fail` по каналам × узлам цепочки и зачищает за собой синтетический тенант.

> Это **инструмент диагностики**, а не фикс. Он подтверждает/опровергает баги аудита (transcribe-loop,
> specialist-routing, draft→canonical, projection skillTrait, cypher/AGE, пороги linker/theme/entity) на
> живом стенде, и после фиксов служит регрессионным e2e-прогоном. Код продукта НЕ меняем.

---

## 0. Контекст из аудита (что харнесс должен поймать)

Сводка узлов из `pipelineMap` первого прогона (15 узлов) и 38 подтверждённых багов:

| # | Узел цепочки | Статус аудита | Что харнесс проверяет |
|---|---|---|---|
| 1 | `LivekitEventsHandler → enqueueTranscribe` | works | косвенно (только в режиме VOX_LIVE) |
| 4 | `TranscribeWorker + VoxService` | **broken** (блокер #1) | только VOX_LIVE; по умолчанию обходим |
| 5 | `MergeWorker → transcription_ready` | unknown | VOX_LIVE / прямой вброс Transcript.turns |
| 6 | `AnalyzeWorker → ai_ready` | unknown | VOX_LIVE |
| 7 | `МОСТ ingestMeeting` | **broken** | прямой вброс Transcript.turns + RawEvent(meeting) |
| 8 | `IngestService.ingest → RawEvent + enqueueRawReceived` | works | все HTTP-каналы |
| 9 | `BlockIngestWorker → IdeaBlock + Entity(Б) + Decision` | **broken** (AGE) | счётчики IdeaBlock vs typed-entity |
| 10 | `EntityResolver / findOrCreateEntity` | unknown | Entity count |
| 11 | `AxisClassifier` | works | (косвенно — блок canonical) |
| 12 | `RouterService.dispatch` | works (enqueue), но **#15/#16/#24** consumer'ы | проекции терминалов |
| 13 | `BlockLinker (block↔block)` | **broken** (порог 50, #18/#35) | IdeaBlockLink count |
| 14 | `ProjectionRebuilder` | **broken** (skillTrait.tenantId, #17/#21/#25/#29/#38) | проекции пересобираются |
| 15 | `Рождение задач/обещаний/записей` | **broken** | commitment-блоки, Card, Goal, IntakeIssue |

Ключевые корневые причины, под которые делаем отдельные проверки в матрице:
- **#1 transcribe-loop** — Vox вечно `PROCESSING`, poll-потолок 120с (`backend/src/modules/ai/services/vox.service.ts:20`, `backend/src/modules/ai/workers/transcribe.worker.ts:311`). → канал meeting через Vox изолируем за флагом `VOX_LIVE`.
- **#7 МОСТ ingestMeeting** вызывается только из `backend/src/modules/ai/workers/analyze.worker.ts:374` после `ai_ready` → недостижим. → тестируем низ цепочки **в обход Vox** (`backend/src/modules/ingest/adapters/meeting.adapter.ts:62`).
- **#15 specialist-routing**: 14 Worker'ов на одной очереди, `job.name` не маршрутизирует, ~13/14 блоков молча completed (`backend/src/modules/knowledge-core/workers/specialist-3-14-goals.worker.ts:91`).
- **#16/#24 draft→canonical ordering**: специалисты диспатчатся на `status='draft'`, но обрабатывают только `canonical`; нет re-dispatch (`backend/src/modules/knowledge-core/workers/block-distill.worker.ts:164`, `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:559`).
- **#3/#11/#12 cypher/AGE**: рантайм-пул не делает `LOAD age`/`search_path=ag_catalog`, `cypher()` не резолвится даже при установленном AGE (`backend/src/common/graph/graph.service.ts:551`). → типизированные сущности группы Б откатываются.
- **#17/#21/#25/#29/#38 projection skillTrait**: `prisma.skillTrait.findMany({ where:{ tenantId } })` — у `SkillTrait` нет `tenantId` (`backend/src/modules/knowledge-core/services/projection-rebuilder.service.ts:204`, `backend/prisma/schema.prisma:7087`). Один битый запрос в `Promise.all` роняет ВСЕ 10 проекций.
- **#18/#35 linker**, **#36 theme**, **#37 entity-graph** — пороги гейтят граф на свежем/малом тенанте; AdminSetting-крутилка мертва (`backend/src/modules/knowledge-core/workers/block-linker.worker.ts:122`).

---

## 1. Цели

1. **Покрыть каждую точку входа** синтетикой: `web_form/dump`, `free_note`, `meeting` (низ цепочки в обход Vox + опц. полный путь через Vox), low-level `RawEvent → core.raw-events`.
2. **Верифицировать прохождение** до графа/проекций/задач прямыми Prisma-запросами по синтетическому тенанту: счётчики `IdeaBlock / Entity / EntityLink / Decision / Theme / IdeaBlockLink / Card / Goal / IntakeIssue` + проверка specialist-routing/projections + AGE-узлов (если включён).
3. **Выдать матрицу** `канал × узел` с `pass / fail / skip / n/a` и понятным резюме (что доехало, где обрыв).
4. **Безопасность**: env-driven, по умолчанию локальный dev; жёсткий guard против прода (`ALLOW_PROD=1`); полный teardown синтетического тенанта.
5. **Регресс после фиксов**: тот же скрипт — приёмочный прогон для ТЗ фиксов (#1, #15/#16/#24, #17, #3, пороги).

### Не-цели
- Не чинить баги (отдельные ТЗ).
- Не поднимать LiveKit/Egress (медиа не в скоупе; полный Vox-путь — опционально, требует живого ASR-прокси).
- Не гонять в CI по умолчанию (нужна реальная БД + Redis + LLM-ключи + запущенный backend-процесс с воркерами).

---

## 2. Архитектурная модель харнесса (важно — иначе двойная регистрация воркеров)

В Z **воркеры BullMQ живут в том же процессе, что и HTTP-app** (`new Worker(...)` в `onModuleInit` провайдеров: `TextIngestAdapter`, `BlockIngestWorker`, специалисты и т.д.). Отдельного `workers/main.ts` НЕТ (вопреки старому комментарию в README — это баг #4 аудита). Подтверждено: в `backend/package.json` нет `worker:dev`, нет `backend/src/workers/main.ts`.

Следствие для дизайна (подтверждено эмпирически паттерном `backend/scripts/smoke-ingest-fase1.ts` / `backend/scripts/smoke-knowledge-core-fase2.ts`):

> **Харнесс НЕ поднимает свой Nest-контекст.** Иначе он второй раз зарегистрирует те же `new Worker`
> на тех же очередях и будет конкурировать за jobs с настоящим backend. Вместо этого харнесс —
> **внешний инжектор + поллер**: пишет данные через Prisma и кладёт jobs в Redis ровно теми же
> jobId/payload/именами, что и продакшен-код (`enqueueRawReceived → core.raw-events`, jobId `raw_<id>`,
> см. `backend/src/modules/core-queue/core-queue.service.ts:123`), а обработку выполняет
> **уже запущенный backend-процесс** (`bun run dev` / `bun dist/main.js`).

Два режима инжекта на каждый канал:
- **HTTP-режим** (`MODE=http`/`both`): бьём в реальные эндпоинты (`POST /api/v1/ingest`, `/api/v1/ingest/dump`, `/api/v1/conversational/notifications/free-note`) — проверяет и слой контроллеров/гардов.
- **Direct-режим** (`MODE=direct`, дефолт): пишем `RawEvent` + `enqueueRawReceived` напрямую — не требует cookie-сессии/ingest-токена, проверяет ровно ядро.

Meeting-низ-цепочки всегда идёт через Direct (синтетический `Meeting + Transcript(turns)` → payload mirror `meeting.adapter.ts` → RawEvent(meeting) → `enqueueRawReceived`), потому что реальный `ingestMeeting` доступен только внутри Nest-процесса.

---

## 3. Точки вброса (каналы)

| Канал | Реальная точка входа в коде | Как вбрасывает харнесс |
|---|---|---|
| **web_form / «запись мысли»** | `WebFormDumpController POST /api/v1/ingest/dump` → `DumpService.createDump` (`backend/src/modules/ingest/adapters/web-form/dump.service.ts:47`). С Person → Document→`core.dump-created`→`TextIngestAdapter`; без Person → legacy RawEvent | HTTP: POST `/ingest/dump` (cookie). Direct: эмулируем legacy-payload `{text,authorUserId,authorName}` в RawEvent(web_form) + enqueue |
| **free_note** | `ConversationalController POST /conversational/notifications/free-note` (`backend/src/modules/conversational/conversational.controller.ts:265`) → `ConversationalIngestAdapter.ingestFreeNote` (`backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts:38`); payload `{kind:'free_note',userId,text,metadata}` Source(type=conversational) | HTTP: POST free-note (cookie+X-Org-Id). Direct: RawEvent(conversational) payload free_note + enqueue |
| **meeting — низ цепочки (обход Vox)** | мост `MeetingIngestAdapter.ingestMeeting` (`backend/src/modules/ingest/adapters/meeting.adapter.ts:62`) формирует payload `{meetingId,type,...,transcript:{turns},roomChat}` Source(type=meeting) | Direct: создаём `Meeting + Transcript(turns)` + RawEvent(meeting) payload-mirror + enqueue |
| **meeting — полный путь** (опц., `VOX_LIVE=1`) | `ai.transcribe → TranscribeWorker → Vox → MergeWorker → AnalyzeWorker → ingestMeeting` | НЕ дефолт. Требует живого ASR-прокси и синтетического аудио; иначе `skip` (см. блокер #1) |
| **low-level RawEvent** | `IngestService` публикует `core.raw-events`, jobId `raw_<id>` (`backend/src/modules/core-queue/core-queue.service.ts:123`) | Direct: RawEvent(web_form/internal) + `q.add('raw-received',{rawEventId},{jobId:'raw_<id>'})` |

Все Source создаются с тегом синтетического тенанта (lazy upsert по `@@unique([tenantId,type,name])`), чтобы teardown сносил их каскадом по Org. Имена очередей и jobId взяты из кода (`CORE_QUEUE_NAMES.RAW_EVENTS='core.raw-events'`, `backend/src/modules/core-queue/queues.ts:22`).

---

## 4. Что проверяем на каждом узле (верификация)

После вброса харнесс поллит БД по `tenantId` синтетического тенанта (бэкофф: интервалы 1с, до `VERIFY_TIMEOUT_MS`, дефолт 90000) и сверяет счётчики и факты:

| Узел | Проверка (Prisma по tenantId) | Подтверждает/ловит баг |
|---|---|---|
| RawEvent принят | `rawEvent.count` ≥ ожидаемого; `processingStatus` ушёл из `received` | узел #8 works |
| IdeaBlock создан | `ideaBlock.count > 0` | узел #9 частично works |
| IdeaBlock canonical | `ideaBlock.count({status:'canonical'}) > 0` (через distill-debounce) | distill works |
| Entity / IdeaBlockEntity | `entity.count`, `ideaBlockEntity.count` | узел #10 |
| **Typed group-Б** | `decision+process+regulation+policy+tool+metric` vs число IdeaBlock | **ловит #3/#11 (AGE rollback): блоки есть, typed=0** |
| **EntityLink** | `entityLink.count` | **ловит #14 (addEdge rollback при AGE)** |
| **IdeaBlockLink** | `ideaBlockLink.count` | **ловит #18/#35 (порог linker 50)** |
| **Theme** | `theme.count` | **ловит #36 (порог theme)** |
| **Specialist-проекции (терминалы)** | `decision/insight/idea/experiment.count` после canonical | **ловит #15/#16/#24 (routing / draft→canonical): блоки canonical есть, проекций 0** |
| commitment-блоки | `ideaBlock.count({signalType:'commitment'})` | узел #15 (обещания) |
| Card / Goal | `card.count`, `goal.count` | выход цепочки |
| IntakeIssue (трекер) | `intakeIssue.count` | meeting→tracker мост |
| **AGE-узлы** | `SELECT count(*) FROM ag_catalog.cypher('z_graph', $$ MATCH (n) WHERE n.tenant_id=... RETURN n $$) AS (n agtype)` (fallback на голый `cypher`) | **ловит cypher/AGE: 42883 → AGE-проверка `N/A`/`FAIL`** |

Матрица: строки — каналы (`low_level`, `web_form`, `free_note`, `meeting_direct`, опц. `meeting_vox`) + агрегатная строка по узлам цепочки; столбцы — узлы (`raw_event`, `idea_block`, `canonical`, `entity`, `typed_group_b`, `entity_link`, `block_link`, `theme`, `terminal_projection`, `commitment`, `card`, `goal`, `tracker`, `age_node`). Значения: `PASS / FAIL / SKIP / N/A`.

> **Тонкость verify-окна.** distill-debounce = 30с, linker гейт = `LINKER_MIN_BLOCKS` (50 по ENV-дефолту, баг #18). На синтетике из 1-3 блоков linker **никогда не сработает by design** → ожидаемый `SKIP` (не `FAIL`), если порог не понижен. Харнесс читает фактический порог через `AdminSetting('knowledge.linkerMinBlocks')`/ENV и помечает `block_link` как `SKIP (порог N > blocks M)`, отличая «гейт» от «баг». То же для theme.

> **Машинный гард (caveat из аудита).** `tsc` структурно слеп к лишним ключам вложенного `where`/`data` Prisma — поэтому `skillTrait.tenantId` проходит typecheck, но падает в рантайме. Все verify-запросы харнесса используют ТОЛЬКО реальные колонки (`signalType`, `status`, `processingStatus`, `tenantId` лишь на моделях, где он есть). Единственные `as never`-касты — для enum-литералов `SourceType`/`DataClass` (тот же паттерн, что в существующих smoke-скриптах).

---

## 5. Безопасность

- **Env-driven**: `BASE_URL`, `X_ORG_ID` (опц.), `INGEST_TOKEN` (для `/api/v1/ingest`), `SESSION_COOKIE` (для cookie-эндпоинтов), `DATABASE_URL`, `REDIS_URL`, `VERIFY_TIMEOUT_MS`, `MODE` (`direct|http|both`), `VOX_LIVE` (0/1), `KEEP_TENANT` (0/1), `GRAPH_AGE_ENABLED`, `LINKER_MIN_BLOCKS`.
- **Жёсткий guard против прода**: если `DATABASE_URL`/`REDIS_URL`/`BASE_URL` указывают на не-localhost/не-приватный хост — скрипт **отказывается стартовать** без `ALLOW_PROD=1`. Эвристика: host в `{localhost,127.0.0.1,::1,postgres,redis,host.docker.internal}` или приватный диапазон (10./192.168./172.16-31./короткое docker-имя без точек) — иначе блок. Сообщение с инструкцией.
- **Синтетический тенант изолирован**: все сущности под новой Org `slug='cmbt-<rand>-org'`, тег в name. Никаких записей в чужие Org. HTTP-проверки используют ТОЛЬКО `X-Org-Id` синтетического тенанта.
- **PrismaClient** — через `createPrismaClient()` из `backend/scripts/_lib/prisma.ts` (driver adapter, Prisma 7). Никогда `new PrismaClient()`.
- **Teardown** в FK-порядке (дети → Org → User), идемпотентно, в `finally`. `KEEP_TENANT=1` — пропустить (печатает `tenantId`).
- **`.ts` исполняется Bun напрямую**: `bun run scripts/smoke-pipeline-e2e.ts`. Никакого билда.

---

## 6. Как запускать

Backend с воркерами должен быть **уже запущен** (`bun run dev` из `backend/`, либо `docker compose up -d backend`). Затем из `backend/`:

```bash
# Локальный dev, ядро без HTTP (быстрее всего, не нужны cookie/токен):
MODE=direct bun run scripts/smoke-pipeline-e2e.ts

# Полная матрица, включая HTTP-каналы (нужен токен/cookie):
MODE=both BASE_URL=http://localhost:3000 INGEST_TOKEN=... SESSION_COOKIE='z_session=...' \
  bun run scripts/smoke-pipeline-e2e.ts

# С полным meeting-путём через живой Vox (медленно, известный блокер #1):
VOX_LIVE=1 MODE=direct bun run scripts/smoke-pipeline-e2e.ts

# Оставить тенант для ручного разбора (без teardown):
KEEP_TENANT=1 MODE=direct bun run scripts/smoke-pipeline-e2e.ts
```

В докер-проде (не дефолт, осознанно) — только через явный гард:
```bash
ALLOW_PROD=1 MODE=direct docker compose exec backend bun run scripts/smoke-pipeline-e2e.ts
```

Выход — таблица-матрица в stdout + exit code. Флаги: `--audit` (default — known-bug `FAIL` не роняет exit, диагностика) / `--gate` (любой `FAIL` роняет, регресс после фиксов).

---

## 7. Чек-лист реализации (фазы)

### Фаза 1 — Каркас и безопасность `[x]`
- [x] `backend/scripts/_lib/combat-harness.ts`: чтение env, prod-guard, `createPrismaClient`, Redis/Queue фабрики, типы матрицы, рендер таблицы.
- [x] Bootstrap синтетического тенанта: `User + Org + Membership(owner) + Person(linked userId)`.
- [x] Teardown в FK-порядке; `KEEP_TENANT`.

### Фаза 2 — Инжекторы каналов `[x]`
- [x] `injectLowLevel` — RawEvent(web_form) + `enqueueRawReceived` (mirror jobId `raw_<id>`).
- [x] `injectWebForm` — direct (legacy RawEvent web_form) + http (POST `/ingest/dump`).
- [x] `injectFreeNote` — direct (RawEvent conversational free_note) + http (POST free-note).
- [x] `injectMeetingDirect` — `Meeting(id=pseudo-ULID, roomName) + Transcript(turns)` + RawEvent(meeting) payload-mirror + enqueue.
- [x] `meeting_vox` (опц., `VOX_LIVE`) — каркас + ранний `skip` (нет ASR-прокси, блокер #1).

### Фаза 3 — Верификация и матрица `[x]`
- [x] `loadCounts` / `pollUntil` — все счётчики из раздела 4, поллинг с таймаутом.
- [x] `probeAge` — квалифицированный/неквалифицированный cypher (ловит 42883 → `FAIL`/`N/A`).
- [x] Различение `SKIP (порог)` vs `FAIL (bug)` для linker/theme (чтение порога из AdminSetting/ENV).
- [x] `renderMatrix` + `computeExitCode` (`--audit` / `--gate`).

### Фаза 4 — Прогон и протокол `[ ]`
- [ ] Прогон `MODE=direct` на dev → зафиксировать фактическую матрицу (ожидаемо: typed_group_b/terminal_projection — FAIL по аудиту, block_link/theme — SKIP по порогу).
- [ ] Прогон `MODE=both` (HTTP) → проверить слой контроллеров (нужны cookie/токен стенда).
- [ ] (после фиксов) `--gate` прогон как регресс.

---

## 8. Связь с фиксами (как харнесс закрывает баги)

Когда выйдут ТЗ-фиксы, харнесс становится приёмкой:
- Фикс #1 (vox poll budget) → `VOX_LIVE=1` канал `meeting_vox` доходит до `terminal_projection`.
- Фикс #15/#16/#24 (один диспетчер + dispatch на canonical) → `terminal_projection = PASS` на всех каналах.
- Фикс #17 (skillTrait via relation) → projection-rebuild не падает.
- Фикс #3/#11/#12 (`ag_catalog.cypher` + `search_path`) → `typed_group_b > 0`, `entity_link > 0`, `age_node = PASS`.
- Фикс #18/#35/#36/#37 (пороги в AdminSetting + дефолты) → `block_link/theme` перестают быть вечным `SKIP` на малом тенанте.

---

## 9. Итог

**Каркас реализован (Фазы 1-3), осталась Фаза 4 — прогоны на стенде.** Поставка: план (этот файл) + `backend/scripts/smoke-pipeline-e2e.ts` (оркестратор) + `backend/scripts/_lib/combat-harness.ts` (хелперы), готовые к запуску `bun run` под стек Z. Скрипты написаны на проверенном паттерне `smoke-ingest-fase1`/`smoke-knowledge-core-fase2` (Prisma через `createPrismaClient`, BullMQ через `ioredis`, env-driven, prod-guard, teardown) и **прошли изолированный `tsc --noEmit` (0 ошибок)** против реального сгенерированного Prisma-клиента — это подтвердило корректность имён полей моделей (Meeting `roomName`/`ownerId`, Transcript `turns`, Person `name`/`email`, Source `@@unique`, RawEvent, AdminSetting, все count-запросы). Что осталось: довести HTTP-инжекторы под реальную аутентификацию стенда (cookie/токен), включить `VOX_LIVE`-ветку при наличии ASR-прокси, и прогнать как регресс после каждого фикса аудита. Код продукта НЕ менялся.
