---
type: project
status: active
phase: beta
sba_step: β-4
related:
  - decisions
  - regulations
  - specialist-3-4-project-customer
  - curation
  - chat-v2
---

# SBA β-4 — Specialist 3.5 (Insights Radar) — радар повторяющихся сигналов

> Компания видит свои повторяющиеся проблемы и риски в реальном времени и реагирует до того, как они станут критическими.

## Что появилось

Specialist 3.5 — пятый специалист Слоя 3 (после α-6 Specialist 3.4, α-7 Specialist 3.1, β-2 Specialist 3.2 Knowledge Clone и β-3 Specialist 3.3 Decisions Registry). Закрывает категорию сигналов «что-то у нас не так»: повторяющиеся **проблемы / риски / блокеры / неэффективности**. Главное отличие от других специалистов — отслеживание **динамики**: сигнал не «есть/нет», а «всплеск / растёт / стабильно / снижается».

## Откуда берутся сигналы

Источник — `IdeaBlock`'и с `signalType ∈ {pain, risk, churn_risk, objection}`. Их размечает Layer-1 (α-2) в момент BlockExtraction. Router (α-3) диспатчит такие блоки в очередь `core.specialist-routing` jobName=`3-5-insights`, где consumer — `Specialist35InsightsWorker`.

Воркер передаёт блок в `Specialist35Service.processBlock`, который:

1. Загружает блок + evidence.
2. Считает embedding query из `name + trustedAnswer`.
3. KNN top-10 существующих Insight того же Org через cosine на embedding (порог `INSIGHT_CLUSTER_THRESHOLD=0.78`).
4. **Если match** — обновляет existing Insight (sourceBlockIds.push, lastObservedAt), пересчитывает frequency/dynamic, при `dynamicLabel='spike'` или при `status='mitigated'+новое упоминание` эмиттит probe.
5. **Если нет match** — LLM-вызов `insight-extract` (DeepSeek V4 pro → OpenAI gpt-5.4-mini → kie:gemini-3.1-pro; primary поднят на pro патчем `patch-task-extractor-route-pro.ts`, ollama выведён 2026-06-05) → черновик `{kind, statement, severity, affectedEntityHints, mitigationSuggestion?, confidence}`.
6. Резолв `affectedEntityIds`: для hint'ов с типами {customer, project, product, vendor} — `EntityResolutionService.findOrCreate`. `process` пока не поддерживается.
7. LLM-арбитр `insight-link-to-decisions` (опц.): top-10 KNN-Decision'ов того же Org → отбор тех, что могли спровоцировать сигнал → `relatedDecisionIds[]`.
8. Дополнительный источник linking — существующие `IdeaBlockLink.relationType='consequences_of'`: для блоков-источников Insight'а ищем link на блоки, которые включены в `Decision.sourceBlockIds`. Добавляем тех Decision'ов в `relatedDecisionIds`.
9. Записываем embedding (best-effort).
10. Triage через `CurationService.triage({resourceType: 'insight', ...})`. `insight` НЕ в critical-types default, поэтому при высокой confidence канонизируется автоматически. Для `severity='critical'` — снижаем confidence в triage до 0.3, чтобы гарантировать deep review.
11. Probe-events:
    - `insight.linked_decision_question` — если LLM нашёл candidate Decision'ы, owner/admin получает уведомление с suggestion подтвердить связь.
    - `insight.escalation_suggested` — если `dynamicLabel='spike'`.
    - `insight.recurring_after_mitigation` — если был `status='mitigated'` и появился новый блок.

## Динамика: 7d/30d ratio

`InsightClustererCron` (по умолчанию `0 *‎/6 * * *`, ENV `INSIGHT_CLUSTER_CRON`) для каждой Org для каждого active Insight'а:

- Считает `count7d` (sourceBlockIds, чьи `IdeaBlock.createdAt >= now-7d`).
- Считает `count30d` (то же, окно по ENV `INSIGHT_FREQUENCY_WINDOW_DAYS=30`).
- `avgWeekly30d = count30d / (windowDays/7)`.
- `ratio = count7d / max(avgWeekly30d, 1)`.
- `dynamicLabel`:
  - `ratio > INSIGHT_SPIKE_RATIO (default 3.0)` → `spike`.
  - `ratio > 1.3` → `growing`.
  - `ratio < 0.5` → `declining`.
  - иначе → `stable`.
- `dynamicScore` = raw ratio (Decimal(6,3)).
- `frequencyScore` = `min(1, count30d / totalOrg30d)` — нормализованная доля.

При переходе в `spike` (новый label ≠ старый) — эмиттится probe `insight.escalation_suggested`. После прохода cron'а — gauge `insights_dynamic_label_count{label}` для Prometheus.

`Specialist35ProbeService.checkNoMitigationPlanForOrg` запускается тем же cron'ом: для всех Insight'ов с `severity ∈ {high, critical}`, `mitigationPlan IS NULL`, `firstObservedAt < now-7д`, `status='active'` — emit `insight.no_mitigation_plan` admin'ам.

## Linking с Decisions

Один из главных вкладов β-4 в продуктовую ценность: связь «эта проблема — следствие решения X». Источников linking два:

1. **LLM-арбитр `insight-link-to-decisions`** (для новых Insight). Берёт top-10 KNN-Decision'ов того же Org → возвращает массив `linkedDecisionIds` из этого списка с пояснением. Валидируем — id должны быть из candidate-списка (защита от галлюцинаций).
2. **Граф `IdeaBlockLink.relationType='consequences_of'`** (см. Фаза 3 knowledge-core). Если из блоков-источников Insight'а есть link на блок, попадающий в `Decision.sourceBlockIds`, — этот Decision добавляется в `relatedDecisionIds`.

Слияние двух источников — `Array.from(new Set(...))` (dedupe).

## Triage и data class

- `insight` НЕ в `CURATION_CRITICAL_TYPES_DEFAULT` (по умолчанию `regulation,process,decision`). Значит, при `confidence >= autoThreshold` (0.85) и без конфликта — auto-canonical.
- `severity='critical'` форсит deep review через искусственное снижение confidence до 0.3 в `triage`-вызове.
- `dataClass` Insight'а по умолчанию `internal`. Если блок-источник был `sensitive`/`private` — наследуем повышенный класс (см. §13 sub-ТЗ).

## API и UI

REST API `/api/v1/insights`:
- `GET /` — список с фильтрами `kind`/`severity`/`status`/`dynamic_label`/`q`/`affected_entity_id`/`page`/`limit`. Сортировка: severity desc → frequencyScore desc → spike поднимается принудительно в начало.
- `GET /chart?days=30` — данные для stacked-bar (kind × неделя).
- `GET /top?limit=5` — для виджета Director Dashboard.
- `GET /:id` — детали.
- `POST /:id/status` — изменить статус (+ CardVersion).
- `POST /:id/mitigation` — обновить план реагирования.
- `POST /:id/severity` — изменить остроту.

UI `/insights` — master-detail с chart-виджетом сверху, фильтрами-чипсами, списком слева, деталями справа (statement, badges, частота/динамика, affected entities, related decisions, mitigationPlan textarea, actions). Виджет Top-5 — в Director Dashboard.

С «Дня компании v2» (2026-07-01, ТЗ `day-company-report-v2`) риски/боли (`Insight`) подаются в дневной дайджест **сгруппированными по причине** (`causeCategory` ∈ process_gap/tooling/communication/role_skill/priority/resource_constraint/external) вместе с `dynamicLabel` (растёт/новое/повторяется) и числом наблюдений — и в промпт письма COO (ось «Команда» / «что помешало»), и в виджет `DaySignalsGrid` (риски по причине). Блокеры (`kind=blocker`) вынесены отдельной секцией `DayBlockers`. Новый детектор НЕ вводился — используется существующий пересчёт метрик. См. [[director-dashboard]] §«День компании v2».

CardSpecialistRegistry — обработчик `3-5-insights` (Specialist35CardHandler) возвращает insight-карточки для chat-v2 при пересечении `sourceBlockIds` с retrieval'ом + ILIKE по statement/mitigationPlan + бонусы за severity high/critical и dynamicLabel spike/growing.

## RBAC

Новый ResourceType `insight`:
- owner/admin: r/w/d.
- manager open: r/w (write нужен для записи mitigationPlan и смены статуса).
- manager strict: r self.

## Метрики

- `core_specialist_*{type='insight'}` (унифицированные специалистные).
- `insights_dynamic_label_count{label}` (gauge — обновляется cron'ом).

## ENV

- `INSIGHT_CLUSTER_THRESHOLD=0.78` — cosine-порог KNN.
- `INSIGHT_CLUSTER_CRON='0 */6 * * *'` — расписание InsightClustererCron.
- `INSIGHT_FREQUENCY_WINDOW_DAYS=30` — окно rolling-частоты.
- `INSIGHT_SPIKE_RATIO=3.0` — порог ratio для dynamicLabel='spike'.

## Что не реализовано в β-4

- Структурированный mitigation plan (steps + owner + deadline) — γ+.
- Связка Insight ↔ Risk register — γ+.
- ML-модель прогноза эскалации — γ+ (сейчас простой ratio).
- Назначение mitigation owner — γ+ (в β-4 — admin fallback).
