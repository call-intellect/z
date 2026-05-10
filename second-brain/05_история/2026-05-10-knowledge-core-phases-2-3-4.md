---
type: reflection
date: 2026-05-10
phases: [2, 3, 4]
distilled: false
---

# Knowledge-core — Фазы 2, 3, 4 (backend Фазы 4)

## Что было поставлено

Закрыть три фазы knowledge-core подряд через делегирование субагентам. Оркестратор (Claude Opus 4.7) запускает субагентов, делает приёмку, фиксирует решения, коммитит и пушит. Без остановок до достижения лимита контекста.

## Как решали

### Аудит Фаз 0/1 (старт сессии)
- Прочитали ТЗ, сравнили с состоянием кода.
- Schema, RBAC, IngestService, meeting-adapter — на месте; typecheck зелёный.
- Frontend pages нашлись в `(authenticated)/settings/organization`, `(authenticated)/invitations/[token]` (изначально пропустил из-за route-group).
- Главный gap Фазы 0 — `LlmRouter` без DeepSeek/Ollama/A-B/LlmModelPrice — перенесён в Фазу 2 Шаг 0 (так в детализации ТЗ Фазы 2).

### Фаза 2 (5 субагентов запусков ⇒ 7 коммитов)
- Шаг 0+1: LLM-инфра + Prisma schema (DeepSeekService, OllamaService, JSON Schema, LlmModelPrice через БД, IdeaBlock+Entity+связи).
- Шаг 2+3: block-ingest.worker + block-distill.worker (segment-builder, block-extraction, embedding, KNN cosine, LLM judge).
- Шаг 4+5+6: entity-resolver (cron + on-event), Search API (`/api/v1/knowledge/*` префикс из-за коллизии с существующим `/search`), smoke degraded-mode, second-brain.

### Фаза 3 (1 субагент ⇒ 4 коммита)
- IdeaBlockLink + EntityLink + 4 enum'а.
- BlockLinkerWorker (порог LINKER_MIN_BLOCKS=50, KNN top-10).
- EntityGraphBuilderCron (раз в час, co-mentioned pairs).
- ReframingCron (3:00 nightly, archive слабых связей, dynamicScore decay, LLM split/merge analysis в Logger).
- Graph API: `blocks/:id/links`, `entities/:id/links`, `graph/neighbors` (BFS depth 1-3, limit 100).

### Фаза 4 backend (1 субагент ⇒ 4 коммита)
- Theme + ThemeIdeaBlock + ThemeEntity + Card.entityId/relatedEntityIds/bornFromThemeId/cachedTopThemeIds.
- ThemeClustererCron (KNN-greedy union-find на TS — O(N²)D, для N≤1000 OK).
- ThemeClassificationService (LLM `theme-classify` JSON Schema strict, 12 веток delivery).
- CardRollupV2Worker (старый card-rollup.worker не трогаем — параллельная работа).
- ReframingCron расширен под темы (merges транзакционно, splits — только лог).
- Themes API + `GET /api/v1/cards/:id/themes`.

## Что вышло

- **16 коммитов** в одной сессии:
  - 95d0313 → 0fac6e1 (15 feat-коммитов knowledge-core).
  - 1cd9f6f (docs/plans).
- **typecheck зелёный** после каждого коммита.
- **Push** на origin/dev по ходу.
- **decisions-log.md** ведётся живым — все agent decisions зафиксированы.
- **plans/** содержит execution-планы Фаз 2, 3, 4.

### Незакрытое в Фазе 4
- Frontend `/themes`, `/themes/:id`, секция «AI-темы» на Card — отложено в следующую сессию.

### Ручная работа пользователя (накопилось)
1. `bun run prisma:push --accept-data-loss` (Фазы 2/3/4 добавляли модели).
2. `bun run apply-postgres-init` (HNSW + ts_vector GIN).
3. `bun run scripts/seed-llm-task-routes-knowledge-core.ts --update-existing`.
4. Перезапуск worker-процесса (поднимет 7 новых workers/cron).
5. Перезапуск HTTP-процесса (поднимет новые controllers).
6. (Опционально) `bun run scripts/smoke-llm-router-phase2-step0.ts` и `smoke-knowledge-core-fase2.ts`.

## Чему научился

### Делегирование через субагентов
- Один субагент закрывает 1-3 шага Фазы или 1 фазу целиком, если шаги не пересекаются по файлам.
- Параллельный запуск субагентов в одну фазу опасен — конфликты в `knowledge-core/services/`. Лучше последовательно.
- Промпт субагенту должен быть полностью самодостаточным: точные пути файлов, контекст что уже сделано, что НЕ делать. 5-10к токенов на промпт — норма.
- Каждый субагент возвращает 30-50к токенов отчёта. Это главный ограничитель — за сессию реально 5-6 запусков.

### Архитектура knowledge-core
- **JSON Schema strict** через DeepSeek + OpenAI Responses API оказалось простым; Ollama бросает `LlmFormatNotSupportedError` → роутер делает fallback.
- **Cron в NestJS** — литерал в декораторе обязателен (вычисляется до DI). ENV для будущего `SchedulerRegistry`.
- **`@Global()` модуль** упрощает доступ к knowledge-core сервисам из worker-процесса без импорта.
- **pgvector embedding** — Prisma не умеет vector type, обновление через `$executeRawUnsafe`.
- **ts_vector GENERATED колонка** — Prisma не умеет, через `postgres-init.sql`.

### ТЗ как источник правды
- Очень детальная детализация ТЗ Фазы 2 (строки 668-963) дала субагентам почти готовый план шагов.
- Наличие точных JSON Schema, ENV-имён и SQL-запросов в ТЗ резко ускорило делегирование.

## Что вне сессии (для следующих)

- **Фаза 4 frontend** (1 малый субагент).
- **Фаза 5** — Tasks-2.0 / Chapters-2.0 / Summary-2.0 поверх блоков, удаление старых extractor'ов.
- **Фаза 6** — chat-v2, дроп `MeetingTranscriptChunk`.
- **Фазы 7-12** — Z-Admin/Org-Admin, Dashboard директора, Strategic alignment, доп. источники, retention/security/152-ФЗ, тарифы.

Реалистичный темп: 1 фаза на сессию, при сохранении журнала решений и плана.
