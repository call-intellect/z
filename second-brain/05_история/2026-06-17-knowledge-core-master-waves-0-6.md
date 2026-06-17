---
distilled: false
---

# 2026-06-17 — knowledge-core MASTER: волны 0–6 (промпты + аудит + task-dedup)

## Что было поставлено

Зонтичное ТЗ `plans/tz/2026-06-16-knowledge-core-MASTER.md` (+ 6 промпт-ТЗ и
ТЗ `task-dedup-and-tracker-reconcile`) — единым релизом закрыть **три пласта**
модуля усвоения knowledge-core:

- **Пласт A — промпты:** перенести/реконструировать 30 промпт-агентов
  knowledge-core по единой методологии (`docs/methodology/prompts/`).
- **Пласт B — аудит-баги:** прогнать накопленный backlog находок аудита
  (HIGH/MED/LOW + G1–G8) и починить класс, а не кейс.
- **Пласт task-dedup:** дедуп задач на входе + петля «разговор → кандидат
  закрытия задачи» + reconcile + вектор целей.

Работа велась в изолированном worktree `C:/work/z-kcore` на ветке
`feature/knowledge-core-master` (от `origin/dev`), чтобы не пересекаться с
параллельными сессиями в основном `c:/work/z`.

## Как решал

Оркестрация суб-агентами по волнам, зелёная верификация → коммит → следующая
волна без остановок:

- **Волна 0** — фундамент пласта A: словарь `signal-type-label.ts`
  (`SIGNAL_TYPE_LABEL`, 56/56 значений enum `SignalType`) + `signalTypeLabel()`
  с fallback + машинный гард полноты, привязанный к рантайм-enum.
- **Волна 1 (HIGH аудит)** — Б1 P2002-в-tx (pre-check вместо catch внутри
  транзакции), Б2 soft-delete рёбер (`ACTIVE_LINK_FILTER` в 18 ридерах +
  `status:archived`), Б3/48/49 коллизия decision (guard + enrich + tx), Б4
  reconcile draft-блоков (новый `BlockDistillReconcileCron`).
- **Волна 2 (промпты)** — 30 агентов knowledge-core переписаны (ingest A1–A3/
  B1–B3, экстракторы C1–C5/D1–D4, dedup-supersede, linking, cluster-rollup,
  final-misc) + парс-фиксы Б38/Б40/Б58/Б59; `signalTypeLabel` разведён в
  USER-builder'ы. Каждый промпт закрыт snapshot-тестом.
- **Волна 3 (33 MED)** — K1 partial-unique (ConflictItem/KnowledgeGroup/
  ExecutablePersona role в `postgres-init.sql`), K2 soft-delete/gate, K3
  orderBy, K4 source-block дедуп + concurrency block-distill 2→1, K5 dataClass=
  max при merge, K6 cost-runaway (negative-cache + LATERAL HNSW top-1), K7
  reconcile, K8–K14. **Удалена мёртвая очередь `core.idea-clusterer`** (Б9 K10
  — on-create-дедуп никем не питался; кластеризация полностью на `@Cron`).
- **Волна 4 (task-dedup, 6 фаз)** — Ф0 гейт качества задачи (детерминированный,
  без LLM); Ф1 дедуп + промпт `task-dedup-arbiter` (новый taskType) +
  `IntakeIssue.suggestedDuplicateOfIssueId`; Ф2 петля разговор→кандидат: модель
  `TaskClosureCandidate`, промпт `task-closure-verify` (новый taskType),
  `TaskCompletionHandler` (`@OnEvent('task.completion_signalled')`),
  `TaskClosurePendingProvider`; Ф3 `TaskReconcileCron` + reopen-метрика
  `task_closure_reopen_rate`; Ф4 `Issue.closureReviewState/Reason/At` +
  `TaskReviewPendingProvider`; Ф5 `Goal.embedding/embeddingHash` +
  `GoalEmbedWorker` + очередь `core.goal-embed` + backfill + specialist-3-14
  KNN-дедуп.
- **Волна 5 (15 LOW)** + **Волна 6 (G1–G8)** — G1 entitlement `feature.graph`
  на entity-/block-centric граф-эндпоинты (`/entities/:id/graph`+`/links`,
  `/blocks/:id/links`+`/reasoning-chain`) + throttle на `mark-wrong`; G2
  vector-literal guard (`buildVectorLiteral`) на READ-пути; G3 батчинг BFS;
  G4a/G6 condition-UPDATE; G7 дедуп preference-dataset.

Новые миграции: `20260616233329_task_dedup_intake_suggested_duplicate`,
`20260617000614_task_closure_candidate`, `20260617002427_issue_closure_review`,
`20260617005105_goal_embedding`. Применялись на dev-БД, версионируемые файлы
коммичены вместе с кодом (на проде — `migrate deploy` авто).

## Что вышло

- **18 коммитов** (`ee96aea7..9c5218aa` поверх `origin/dev`).
- **59 аудит-багов** (HIGH+MED+LOW+G), **30 переписанных промптов**, **task-dedup
  6 фаз**, **G1–G8**.
- Верификация: **typecheck / build / eslint зелёные**, целевые + регресс-тесты
  модуля зелёные (промпты — snapshot, новые сервисы/cron'ы/провайдеры покрыты
  spec'ами).
- 4 новых taskType-пары/модели (`task-dedup-arbiter`, `task-closure-verify`,
  `TaskClosureCandidate`, `Goal.embedding`) + новая очередь `core.goal-embed`,
  удалена мёртвая `core.idea-clusterer`.
- **Статус: код в ветке, ждёт прод-выката.** Промпты — code-fallback (едут с
  деплоем); сиды task-dedup-маршрутов + `apply-postgres-init` (HNSW Goal) +
  backfill эмбеддингов целей — в `apply-prod-deploy.ts` STEPS.
- G5 (DLQ + per-queue override `CORE_DEFAULT_JOB_OPTIONS`) **осознанно отложен**
  (ТЗ-заглушка `plans/tz/2026-06-17-knowledge-core-queue-dlq-per-queue-config.md`)
  — острое класса уже снято Б32/Б33.

## Чему научился

- **CRLF-шум снапшотов на Windows.** Snapshot-тесты промптов на Windows ловят
  расхождение по концам строк (CRLF↔LF) — нужно следить за `.gitattributes` /
  нормализацией, иначе диф «зелёный по смыслу, красный по байтам».
- **spec'и не ловятся vitest, но ловятся tsc.** Часть проблем в spec-файлах
  (например `mock.calls[0]` под `noUncheckedIndexedAccess` — `T | undefined`)
  vitest пропускает, а `tsc --noEmit` валит. Гонять typecheck по всему дереву,
  не только тесты — иначе сборка падает на CI.
- **`@Cron` живут в двух модулях.** Knowledge-core/AI-кроны регистрируются в
  `ai/workers.module.ts`, operations-кроны — в `operations.module.ts`. Новый
  cron надо класть в правильный модуль, иначе он молча не стартует.
- **G8 опровергнут проверкой схемы — verify-before-fix спас от регрессии.**
  Один из заявленных G-пробелов при чтении реальной схемы оказался уже закрытым
  — «фикс» внёс бы регрессию. Подтверждает правило: сверять находку с кодом до
  правки, не чинить по описанию.
- **Worktree-изоляция работает.** Отдельный `C:/work/z-kcore` позволил вести
  большой 18-коммитный релиз, не задевая параллельные сессии в `c:/work/z`.
