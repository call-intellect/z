---
type: execution-plan
phase: 5
feature: knowledge-core — Tasks-2.0 / Chapters-2.0 / Summary-2.0 поверх IdeaBlock'ов
status: completed (backend)
date: 2026-05-10
---

# Фаза 5 — backend закрыт, frontend не входит в эту фазу.

## Принципиальное решение оркестратора

**Legacy НЕ удаляется в этой фазе.** Старые `tasks-extract.worker` и `chapters.worker` продолжают работать. Причина: ТЗ требует A/B-сравнения с golden-set'ом, без legacy сравнивать не с чем + риск регрессии UX. Удаление legacy — отдельная фаза после ручного решения владельца.

V2-агенты пишут в **новые поля БД** (`Task.evidenceBlockIds` + `extractorVersion='v2'`, `MeetingChapter.evidenceBlockIds` + `extractorVersion='v2'`, `AiResult.summaryV2`). UI пока остаётся на старых полях.

Поведение через ENV `KNOWLEDGE_CORE_V2_AGENTS_ENABLED` (boolean, default `false`) — когда `false`, cron не публикует jobs, воркер бездействует.

## Backend

- [x] **Шаг 1 — Prisma schema (db push).**
  - `Task`: `evidenceBlockIds: String[]`, `extractorVersion: String?`.
  - `MeetingChapter`: `evidenceBlockIds: String[]`, `extractorVersion: String?`.
  - `MeetingHighlight`: `evidenceBlockId: String?`.
  - `AiResult`: `summaryV2`, `summaryV2Model`, `summaryV2GeneratedAt`.
  - `Meeting`: `analyzeV2Status`, `analyzeV2GeneratedAt`, `analyzeV2Error`.
  - Применено через `bun run prisma:push` (см. CLAUDE.md / skill prisma-db-push-rules).

- [x] **Шаг 2 — ENV + конфиг.**
  - `KNOWLEDGE_CORE_V2_AGENTS_ENABLED` (default `false`).
  - `MEETING_ANALYZE_V2_CRON` (default `'*/10 * * * *'`).
  - `MEETING_ANALYZE_V2_DEBOUNCE_MS` (default `120_000`).
  - Геттер `cfg.knowledgeCore.{v2AgentsEnabled, meetingAnalyzeV2Cron, meetingAnalyzeV2DebounceMs}`.

- [x] **Шаг 3 — очередь `core.meeting-analyze-v2`.**
  - В `core-queue/queues.ts`: добавлено имя `MEETING_ANALYZE_V2`, тип `MeetingAnalyzeV2JobData { meetingId }`.
  - В `core-queue.service.ts`: метод `enqueueMeetingAnalyzeV2(meetingId, opts?)`. jobId = `meeting_analyze_v2_<id>`, debounce 2 мин.

- [x] **Шаг 4 — сервисы для v2-агентов.**
  - `BlockFetchService.getCanonicalBlocksForMeeting(meetingId, tenantId)` — общий хелпер: RawEvent (sourceType='meeting') → IdeaBlockEvidence → canonical IdeaBlock + evidence. Сортировка по min `evidence.startMs` (хронология).
  - `TasksExtractorV2Service.extract(...)` — фильтр по signalType ∈ {commitment, decision}, один LLM-вызов `task-extract-v2`, JSON Schema strict, фильтр confidence ≥ 0.5.
  - `ChaptersExtractorV2Service.extract(...)` — один LLM-вызов `chapter-extract-v2`, нарезка всех блоков на главы по таймкодам и тематической связности.
  - `SummaryExtractorV2Service.extract(...)` — один LLM-вызов `summary-v2`, type-specific system-промпт (9 типов встреч), output — markdown.
  - Промпты: `prompts/{tasks-v2, chapters-v2, summary-v2}.prompt.ts`. JSON Schema для tasks/chapters, текстовый output для summary.

- [x] **Шаг 5 — Worker `meeting-analyze-v2.worker.ts`.**
  - Consumer `core.meeting-analyze-v2`, concurrency=1.
  - На job `{ meetingId }`:
    1. `meeting + aiResult` (skip если deleted/no-tenant);
    2. `analyzeV2Status='processing'`;
    3. `getCanonicalBlocksForMeeting`. Если 0 блоков — `analyzeV2Status='ready'`, error=`no_blocks`, return;
    4. `Promise.allSettled([tasks, chapters, summary])`;
    5. **Tasks-write:** для новых v2-задач — `findMany existing → filter by title (case-insensitive) → create по одной`. Не трогаем legacy задачи (`extractorVersion=null`). Дубликаты с legacy пропускаются.
    6. **Chapters-write:** `deleteMany {meetingId, extractorVersion='v2'}` → `createMany` с extractorVersion='v2'. Legacy `extractorVersion=null` остаются.
    7. **Summary-write:** `aiResult.update {summaryV2, summaryV2Model, summaryV2GeneratedAt}`. Если AiResult нет — log warn + skip.
    8. Финальный статус: `'ready' | 'partial' | 'failed'` в зависимости от количества упавших агентов.
  - На onJobFailed (5 attempts исчерпаны) — `analyzeV2Status='failed'`.

- [x] **Шаг 6 — Cron `meeting-analyze-v2.cron.ts`.**
  - `@Cron('*/10 * * * *')` (литерал — Nest cron-decorator вычисляется до DI).
  - Если `cfg.knowledgeCore.v2AgentsEnabled=false` — log + return.
  - SQL: meeting.status='ai_ready' AND tenantId IS NOT NULL AND aiResult exists AND (analyzeV2Status IS NULL OR (failed AND updatedAt > now-1d)) AND updatedAt > now-7d, LIMIT 50.
  - Для каждого — `coreQueue.enqueueMeetingAnalyzeV2(meetingId)`. Идемпотентность через jobId.

- [x] **Шаг 7 — регистрация в модулях.**
  - `KnowledgeCoreModule` — добавлены `BlockFetchService`, `TasksExtractorV2Service`, `ChaptersExtractorV2Service`, `SummaryExtractorV2Service` в providers + exports.
  - `WorkersModule` (ai/workers.module.ts) — `MeetingAnalyzeV2Worker` и `MeetingAnalyzeV2Cron` в providers.

- [x] **Шаг 8 — verification.**
  - `bun run prisma:push` — successful.
  - `bun run typecheck` — зелёный (пришлось добавить новые поля AiResult в `analyze.worker.spec.ts` mock).

## Что НЕ сделано (вне Фазы 5)

- UI карточки встречи (отображение evidence-ссылок, переключение на summaryV2/v2-задачи) — отдельная фаза.
- Удаление legacy `tasks-extract.worker` / `chapters.worker` — отдельная фаза после A/B.
- Backfill legacy задач/глав значением `extractorVersion=null` — Prisma default делает `[]` для evidenceBlockIds; `extractorVersion` остаётся NULL для существующих записей естественным образом.
- Highlights generator поверх блоков — `MeetingHighlight.evidenceBlockId` колонка добавлена, но генератор (highlights-v2) — vNext.

## Затронутые файлы

### Schema / config
- `backend/prisma/schema.prisma` — Task, MeetingChapter, MeetingHighlight, AiResult, Meeting (новые поля).
- `backend/src/common/config/env.schema.ts` — KNOWLEDGE_CORE_V2_AGENTS_ENABLED, MEETING_ANALYZE_V2_CRON, MEETING_ANALYZE_V2_DEBOUNCE_MS.
- `backend/src/common/config/typed-config.service.ts` — геттер cfg.knowledgeCore.{v2AgentsEnabled, meetingAnalyzeV2Cron, meetingAnalyzeV2DebounceMs}.

### Очередь
- `backend/src/modules/core-queue/queues.ts` — CORE_QUEUE_NAMES.MEETING_ANALYZE_V2, MeetingAnalyzeV2JobData.
- `backend/src/modules/core-queue/core-queue.service.ts` — enqueueMeetingAnalyzeV2.

### Knowledge-core
- `backend/src/modules/knowledge-core/services/block-fetch.service.ts` — новый.
- `backend/src/modules/knowledge-core/services/tasks-extractor-v2.service.ts` — новый.
- `backend/src/modules/knowledge-core/services/chapters-extractor-v2.service.ts` — новый.
- `backend/src/modules/knowledge-core/services/summary-extractor-v2.service.ts` — новый.
- `backend/src/modules/knowledge-core/prompts/tasks-v2.prompt.ts` — новый.
- `backend/src/modules/knowledge-core/prompts/chapters-v2.prompt.ts` — новый.
- `backend/src/modules/knowledge-core/prompts/summary-v2.prompt.ts` — новый.
- `backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts` — новый.
- `backend/src/modules/knowledge-core/workers/meeting-analyze-v2.cron.ts` — новый.
- `backend/src/modules/knowledge-core/knowledge-core.module.ts` — providers + exports.

### Workers module
- `backend/src/modules/ai/workers.module.ts` — providers.

### Test fixtures
- `backend/src/modules/ai/workers/analyze.worker.spec.ts` — добавлены поля summaryV2/summaryV2Model/summaryV2GeneratedAt в мок AiResult.

## DoD

- [x] Prisma schema обновлён, db push прошёл.
- [x] ENV `KNOWLEDGE_CORE_V2_AGENTS_ENABLED` добавлен (default `false`).
- [x] Очередь `core.meeting-analyze-v2` зарегистрирована.
- [x] 4 сервиса (block-fetch + 3 extractor-v2) реализованы.
- [x] Worker + Cron реализованы.
- [x] typecheck зелёный.
- [x] План + decisions-log дополнены.
