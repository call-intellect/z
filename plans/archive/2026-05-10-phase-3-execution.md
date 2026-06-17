---
type: execution-plan
phase: 3
feature: knowledge-core — связи блок↔блок, сущность↔сущность, reframing
status: completed
date: 2026-05-10
---

# Фаза 3 — статус ✅ закрыта (4 коммита)

- [x] **Шаг 1.** Prisma schema: `IdeaBlockLink`, `EntityLink`, enum'ы (7+6 типов связей). Коммит `c7a129d`.
- [x] **Шаг 2.** `BlockLinkService` + `BlockLinkerWorker` (consumer `core.block-linker`). Порог `LINKER_MIN_BLOCKS=50`, KNN top-10, LLM-арбитр `block-linker`. Коммит `53672ba`.
- [x] **Шаги 3+4.** `EntityGraphService` (co-mentioned pairs), `EntityGraphBuilderCron` (`@Cron('0 * * * *')`), `ReframingCron` (`@Cron('0 3 * * *')` — архивация связей `confidence<0.5`, `dynamicScore` decay, LLM split/merge analysis). Коммит `54fa63d`.
- [x] **Шаг 5.** Graph API: `GET .../blocks/:id/links`, `.../entities/:id/links`, `.../graph/neighbors` (BFS depth 1-3, limit 100). Routes для `entity-graph-builder`. Документация. Коммит `3a4a109`.

## Что вне Фазы 3

- Темы (Theme) и кластеризация — Фаза 4.
- ReframingLog таблица — Фаза 7 (Z-Admin).
- Frontend для графа — vNext.
