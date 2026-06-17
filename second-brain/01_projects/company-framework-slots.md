---
title: Слоты каркаса 5 уровней (группа Б)
phase: 0a
status: implemented
date: 2026-05-21
references:
  - plans/archive/2026-05-21-phase-0a-data-model-and-graph-infra.md §4.2
  - plans/analysis/2026-05-21-ontology-process-regulation.md §10
---

# Группа Б — слоты каркаса 5 уровней

## Что это
Модели, существующие в БД с Фазы 0a, но БЕЗ UI до Фазы γ. Наполняются автоматически через `BlockExtractionService` (Фаза 0b) с провенансом.

## Модели
- **Уровень 1 «Зачем»:** `Mission`, `Vision`, `Strategy` (поле markets/bets/horizon).
- **Уровень 3 «Как работа течёт»:** `Process` (+ProcessStep), `Regulation` (category=regulation|standard), `Policy`.
- **Уровень 4 «На чём работает»:** `Tool`.
- **Уровень 5 «Учится»:** `Metric`. Review/Retrospective — через расширение `MeetingType` enum (+2 значения).
- **Доп.:** `Decision` (миграционный долг с IdeaBlock.signalType='decision').

## Где видны в Фазе 0
- В Фазе 0 UI нет.
- Доступно через `/api/v1/search?types[]=process,regulation,...` (только admin/owner — по policy.csv).
- Счётчик `/api/v1/{processes,regulations,policies,metrics}/count` — для preview-страниц.
- Provenance в детальной странице документа `/documents/:id` (readonly список с confidence).

## Как наполняется
1. Document/Meeting → `RawEvent` → `BlockExtractionService`.
2. LLM возвращает JSON со списками `processes/decisions/regulations/policies/metrics/tools` + confidence + sourceBlockIndex.
3. `EntityResolutionService` дедуплицирует (cosine + LLM-arbiter).
4. Сохранение через `GraphService.upsertEntity({ type, data, sourceProvenance })` — двойная запись Postgres + AGE.

## Что НЕ делать в Фазе 0
- НЕ создавать UI для CRUD группы Б (UI — Фаза γ).
- НЕ извлекать Mission/Vision/Strategy автоматически (флаг `EXTRACTION_ENABLE_TOP_LEVEL=false`).

## Риски
- Шумные сущности на больших объёмах — митигируется минимальным confidence + ручной проверкой в γ через CuratorAgent (Фаза δ).
