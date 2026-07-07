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

> ⚠️ **Файл уровня Фазы 0a (2026-05-21), частично устарел.** Уровень 1 (`Mission`/`Vision`/`Strategy`) фактически **dormant** — см. ниже. Актуальный профиль компании (миссия/видение/стратегия) живёт в модуле `company-foundation` (`CompanyProfile.*Json`), а `Metric` — в модуле `kpi`.

## Что это
Модели, существующие в БД с Фазы 0a, но БЕЗ UI до Фазы γ. Наполняются автоматически через `BlockExtractionService` (Фаза 0b) с провенансом.

## Модели
- **Уровень 1 «Зачем» — DORMANT/DEPRECATED:** таблицы `Mission`, `Vision`, `Strategy` есть в схеме (`schema.prisma`), но не пишутся и не читаются (0 read/write-ссылок в коде), авто-извлечение выключено (`ai.extractionEnableTopLevel` / `EXTRACTION_ENABLE_TOP_LEVEL` = false по умолчанию). Фактические миссия/видение/стратегия компании теперь материализуются в `CompanyProfile.missionJson / visionJson / strategyJson` (модуль `company-foundation`, крон `company-summary-compiler`), а не в этих таблицах.
- **Уровень 3 «Как работа течёт»:** `Process` (+ProcessStep), `Regulation` (category=regulation|standard), `Policy`.
- **Уровень 4 «На чём работает»:** `Tool`.
- **Уровень 5 «Учится»:** `Metric` — теперь отдельный модуль `kpi` (`Metric` + `/api/v1/kpi`; backend есть, UI/крон/алерты пока нет). Review/Retrospective — через расширение `MeetingType` enum (+2 значения).
- **Доп.:** `Decision` (миграционный долг с IdeaBlock.signalType='decision').

> Актуальный источник о профиле компании — модуль `backend/src/modules/company-foundation` (модели `CompanyProfile` / `FunctionalDomain`, крон-конвейер company-profile-builder / company-summary-compiler / department-detector / domain-expander / maturity-scorer). KPI — `backend/src/modules/kpi`.

> **Авто-описание «чем занимается компания» (`company-summary-compiler`, с 2026-07-07):** короткий паспорт `CompanyProfile.summaryJson.contentMd` (4–6 предложений, ≤1000 симв.), обновляется **инкрементально** — LLM получает текущее описание + новые «долговечные» факты (`signalType ∈ DURABLE_SIGNAL_TYPES`, `orderBy createdAt`; штурм/идеи/гипотезы отфильтрованы), возвращает флаг `changed`; «нет изменений» → только сдвиг `generatedAt`. Пересчёт раз в неделю (`companyProfile.summaryRebuildHours`=168). `summaryPinned` замораживает авто-обновление. Это же описание короткой капсулой «## О компании» (+`orgContext`) прокидывается в извлекающие агенты — см. [[ai-jobs]].

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
