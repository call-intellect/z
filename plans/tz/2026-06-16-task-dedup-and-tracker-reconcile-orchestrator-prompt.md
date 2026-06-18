# Orchestrator-prompt — Дедуп задач + петля разговор→статус в трекере

Запусти skill `tz-orchestrator` для реализации ТЗ [plans/tz/2026-06-16-task-dedup-and-tracker-reconcile.md](2026-06-16-task-dedup-and-tracker-reconcile.md). Это контракт — не пересматривай развилки (все 6 подтверждены владельцем), реализуй фаза за фазой.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-правило, Prisma-миграции, Ship-On).
2. ТЗ целиком: `plans/tz/2026-06-16-task-dedup-and-tracker-reconcile.md` (особенно §2 REALITY-CHECK, §7 контракты, §8 методология промптов, §9 требования R1-R13, §10 фазы).
3. Анализ-источник `plans/analysis/2026-06-15-task-dedup-and-conversation-to-tracker-reconcile.md` (§11-bis — почему именно так; не переисследуй).
4. Методология промптов `docs/methodology/prompts/README.md` + эталон `examples/probe-formulate.md` — перед написанием ЛЮБОГО нового промпта (Ф1 `task-dedup-arbiter`, Ф2 `task-closure-verify`).
5. Код-якоря (перечитать перед правкой — номера строк дрейфуют, искать по символу):
   - Эталон петли: `operations/services/commitment-response.handler.ts` (@OnEvent + LLM-верификатор + withInjectionGuard) — Э2 копирует его.
   - `knowledge-core/services/router.service.ts` case `'commitment_status'` (~379-399) — образец emit.
   - `tracker/services/similar-issues.service.ts:findSimilar` — рефактор в `findSimilarByVector`.
   - `pending-actions/providers/intake.provider.ts` — калька нового провайдера.
   - `operations/workers/decision-implementation.cron.ts` + `.service.ts` — образец суточного reconcile + condition-UPDATE.
   - `backend/scripts/postgres-init.sql` блок `Issue_embedding_hnsw_cosine_idx` (~478) — образец HNSW для Goal (Ф5).

## Инструменты
- vexp `run_pipeline` первым для картографии (при живом демоне Grep/Glob блокируются хуком); `get_skeleton` для осмотра. Fallback при выключенном демоне — Read/Grep/Explore.
- Context7 для внешних либ (Prisma vector, BullMQ, nestjs-zod) — не угадывать API.
- Поведение фреймворка в спорном — мини-e2e/чтение `node_modules`, не интуиция.

## Режим исполнения — ВЕСЬ ТЗ ЗА ОДИН ЗАХОД, АВТОНОМНО (директива владельца 2026-06-16)
Реализуй **все 6 фаз целиком, без остановок и без вопросов**. Не задавай развилок, не жди подтверждений. Любая новая неоднозначность, не покрытая ТЗ: реши сам (два прохода → доказать лучшее → двигаться), зафиксируй `[ASSUMPTION: … — потому что …]` inline и продолжай. **Единственная сохранённая точка подтверждения — `git push`** (правило проекта); всё до push — коммиты по фазам — автономно.

## Граф фаз (порядок исполнения за один заход)
- **Ф0** (гейт на создании) → разблокирует Ф1 и Ф2.
- **Ф1** (дедуп) и **Ф2** (петля) — после Ф0, разные точки врезки, каждая отдельной волной с независимой приёмкой.
- **Ф3** (reconcile + reopen + kill-switch) — строго после Ф2.
- **Ф4** (supersede review) — независима, после Ф0.
- **Ф5** (вектор целей) — последняя, **входит в заход** (полный выделенный `Goal.embedding`; маршрут через Entity-граф ОТВЕРГНУТ, см. Р5 ТЗ). Не пропускать, не спрашивать.

Между фазами: зелёная верификация → commit по фазе → следующая фаза в том же заходе, без остановок. По завершении всех 6 фаз — один запрос на `git push`.

## Факт-чек (не верь отчёту суб-агента)
- После каждой фазы — греп ключевых маркеров в файлах: `findSimilarByVector` (Ф1), `task.completion_signalled` + `TaskClosureCandidate` (Ф2), `task-reconcile` (Ф3), `closureReviewState` (Ф4), `goal-embed` (Ф5). Суб-агент мог пометить `[x]` без реальных правок.
- Каждый новый `taskType` — проверить, что он И в union `LlmTaskType`, И в `ALL_LLM_TASK_TYPES`, И есть seed-route в `apply-prod-deploy.ts STEPS` (типичная грабля — теряются и едут по DEFAULT_FALLBACK_CHAIN).
- Промпты новых агентов — пройти чек-лист `docs/methodology/prompts/README.md` (7 блоков, few-shot ≥3, чистый русский, человеческий вход не машинный код, cache-friendly); удачный → эталон в `examples/`.
- Prisma: только версионируемые миграции (`prisma:migrate`), HNSW — в `postgres-init.sql`, не в schema. В скриптах `createPrismaClient()`.
- R13 (главный инвариант): грепнуть, что нет `issue.update`/`transitionState` из LLM-обработчика напрямую — только через подтверждение человека/детерминированный гейт.

## Определение «фаза закрыта»
Acceptance фазы (машинные предикаты из §10) выполнены + `bun run typecheck && bun run lint && bun run build` зелёные + `bunx vitest run` по затронутым файлам зелёный + строка `Закрывает: Rn` соответствует реальности.

## Failure-modes (типичные провалы — предотврати)
- Авто-закрытие/авто-merge «чтобы удобнее» — ЗАПРЕЩЕНО (Р1/Р2). Только обратимый кандидат/suggest.
- Матч по `sourceBlockIds` для Э2 — НЕ работает (блок разговора ≠ блок задачи), только семантический KNN (Р3).
- `findSimilar(issueId)` для дедупа свежей задачи — вернёт `[]` (embedding async null), использовать синхронный embed + `findSimilarByVector`.
- Доставка статуса через событие как гарантия — событие теряется (нет Outbox); надёжность даёт reconcile-cron по БД.
- Новый pending-провайдер на CurationItem — натяжка; только `TaskClosureCandidate` + `PendingActionsProvider`.
- Флаг «дефолт OFF» — нарушение Ship-On; kill-switch ON по умолчанию, строка в `docs/operations/feature-flags.md`.

## Прод-инструкция после реализации
По шаблону CLAUDE.md: Шаг 4 (модель `TaskClosureCandidate`, колонки `Issue.closureReview*`, `Goal.embedding`+`embeddingHash`), Шаг 5 (HNSW Goal — Ф5), Шаг 8 (backfill целей — Ф5), Шаг 12 (smoke taskType/провайдер/cron), seed-route в STEPS. После push — блок «📋 Prod-инструкция» (diff команд) в чат.
