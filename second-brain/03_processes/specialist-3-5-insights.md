---
name: specialist-3-5-insights
title: Радар повторяющихся проблем и рисков (специалист 3-5)
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт «второго мозга»
  - инженер knowledge-core
related_plans:
  - plans/archive/2026-05-21-second-brain-agents-umbrella.md
  - plans/archive/2026-05-21-sba-beta-4-specialist-3-5-insights.md
  - plans/archive/2026-05-22-final-roadmap.md
related_projects:
  - 01_projects/insights.md
  - 01_projects/decisions.md
  - 01_projects/probe-agent.md
---

# Радар повторяющихся проблем и рисков

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Компания каждый день сталкивается с проблемами — что-то медленно работает, в каком-то процессе вечно теряется задача, какой-то клиент намекает «мы скоро уйдём». Обычно эти жалобы тонут в потоке: на одной встрече сказали — на следующей забыли. Через полгода всплывает «то же самое» — но уже как пожар.

Радар сигналов в Z делает так, чтобы повторяющаяся проблема не пряталась. Каждый раз, когда в встрече, заметке или письме всплывает что-то похожее на боль, риск или возражение, платформа добавляет это к уже известному сигналу: «вот эта же проблема упоминалась 12 раз за месяц». Дальше платформа сама считает динамику: всплеск (резко стало хуже), растёт, держится, идёт на спад. Если у проблемы вообще нет плана реагирования, а её уровень критический и она наблюдается дольше недели — платформа сама пинает админа: «у нас open-issue без mitigation plan».

На главной странице руководителя живёт виджет «Топ-5» — самые частые проблемы прямо сейчас, с лейблами «всплеск / растёт / держится». На отдельной странице `/insights` есть полная картина: фильтры по типу проблемы, по остроте, по статусу, поиск, диаграмма за 30 дней и подробная карточка с историей упоминаний, связанными решениями и планом реагирования.

Главное: радар не приклеен к встрече — он работает как отдельный «слух» компании по всем её источникам.

## 2. Что запускает (триггер)

- **Тип:** событие в графе знаний + регулярный пересчёт.
- **Что инициирует:**
  1. В графе появился новый `IdeaBlock` со `signalType ∈ {pain, risk, churn_risk, objection}` (его уже добавили специалист 3-1 или общий конвейер `core.raw-events`).
  2. Каждые 6 часов — пересчёт частоты и динамики для всех активных сигналов организации.
- **Технический источник:**
  - очередь `core.specialist-routing`, jobName=`3-5-insights` — для нового блока,
  - cron `0 */6 * * *` (`InsightClustererCron`) — для пересчёта частоты, проверки «нет плана реагирования» и обновления глобального gauge.

## 3. Шаги процесса (общий список)

1. **Платформа получает новый сигнальный блок** (про боль, риск, отказ или возражение клиента).
2. **Ищет, не упоминалась ли эта же проблема раньше** — по смыслу (KNN-поиск ближайших сигналов).
3. **Если похожий сигнал уже есть** — добавляет к нему новый источник, обновляет «последнее упоминание», пересчитывает частоту и динамику; при «всплеске» зовёт админа.
4. **Если похожего нет** — создаёт новый сигнал через LLM-извлечение (формулировка одной строкой, острота, hint затронутых сущностей).
5. **Привязывает затронутые сущности** (клиенты, проекты, продукты) и **возможные исходные решения** (через LLM-арбитра и граф связей `consequences_of`).
6. **Решает, нужен ли ручной разбор** (curation triage) или сигнал автоматически становится канон.
7. **Каждые 6 часов** пересчитывает 7-дневную и 30-дневную частоту, ставит метку динамики (`spike / growing / stable / declining`).
8. **Если сигнал острый и без плана реагирования больше 7 дней** — отправляет админу probe «нужен mitigation plan».
9. **На дашборде CEO** обновляется виджет «Топ-5», на `/insights` — диаграмма и список с динамикой.

## 4. Что получается на выходе

- **Кому:** руководителю (top-5 на дашборде), owner/admin/manager (probes), curator (deep review для critical), member (read-only список и поиск).
- **В каком виде:** запись `Insight` в БД с историей упоминаний, метками динамики, mitigationPlan; in-app + Telegram probe-уведомления; Prometheus-gauge `insights_dynamic_label_count{label}`.
- **Где это видно:**
  - `/insights` — master-detail радара (chart + фильтры + детальная карточка),
  - `/dashboard` — виджет «Топ-5 повторяющихся проблем»,
  - админ-страница `/admin/curation` — карточки на pre-approval для `severity=critical`.

## 5. Технический разрез (по шагам)

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Новый сигнальный блок прилетел | RouterService.dispatch ставит job в `core.specialist-routing` с jobName=`3-5-insights` после canonical для `signalType ∈ {pain, risk, churn_risk, objection}` | `backend/src/modules/knowledge-core/services/router.service.ts`, `backend/src/modules/knowledge-core/workers/specialist-3-5-insights.worker.ts:44` | `core.specialist-routing` (jobName=`3-5-insights`) | — (читает `IdeaBlock`) | ✅ |
| 2 | Поиск похожего сигнала | Эмбеддинг `name + trustedAnswer` → KNN top-10 по `Insight.embedding` той же Org через cosine, порог `cfg.insights.clusterThreshold` (0.78) | `backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts` (метод `processBlock`) | внутри worker | — | ✅ |
| 3 | Сигнал найден — обновляем | sourceBlockIds.push(blockId), lastObservedAt=now, `recalcMetrics` (frequencyScore/dynamicScore/dynamicLabel), при переходе в `spike` — probe `insight.escalation_suggested`; при `status='mitigated'` + новое упоминание — probe `insight.recurring_after_mitigation` | `backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts`, `specialist-3-5-probe.service.ts` | — | `Insight.sourceBlockIds`, `lastObservedAt`, `frequencyScore`, `dynamicScore`, `dynamicLabel` | ✅ |
| 4 | Сигнал не найден — создаём | LLM `insight-extract` (DeepSeek V4 Flash → OpenAI mini → Ollama qwen3:30b) → черновик `{kind, statement, severity, affectedEntityHints, mitigationSuggestion?, causeCategory?, confidence}`; embedding записывается best-effort | `backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts`, `backend/src/modules/knowledge-core/prompts/insight-extract.prompt.ts` | LLM `insight-extract` | `Insight` (новая запись) | ✅ |
| 5 | Привязка сущностей и решений | `EntityResolutionService.findOrCreate` для customer/project/product/vendor; LLM `insight-link-to-decisions` (top-10 KNN-Decision) + поиск через `IdeaBlockLink.relationType='consequences_of'` | `specialist-3-5-insights.service.ts`, `entity-resolution.service.ts`, `backend/src/modules/knowledge-core/prompts/insight-link-to-decisions.prompt.ts` | LLM `insight-link-to-decisions` | `Insight.affectedEntityIds`, `relatedDecisionIds` | ✅ |
| 6 | Curation triage | `CurationService.triage({resourceType:'insight', ...})`; для `severity='critical'` confidence искусственно занижается до 0.3 — гарантированный deep review; probe `insight.linked_decision_question` если LLM нашёл candidate Decision'ы | `backend/src/modules/curation/services/curation.service.ts`, `specialist-3-5-insights.service.ts`, `specialist-3-5-probe.service.ts` | — | `CurationItem`, `CardVersion`, `Insight.status` | ✅ |
| 7 | Пересчёт частоты и динамики | Cron `0 */6 * * *` для каждой Org проходит до 500 active/mitigating Insight'ов: `count7d`, `count30d`, `avgWeekly30d`, `ratio`, `dynamicLabel`; gauge `insights_dynamic_label_count{label}` обновляется через groupBy | `backend/src/modules/knowledge-core/workers/insight-clusterer.cron.ts:47` (`sweep`, `recalcAllForOrg`, `refreshDynamicLabelGauge`), `specialist-3-5-insights.service.ts` (`recalcMetrics`) | `@Cron('0 */6 * * *')` | `Insight.frequencyScore`, `dynamicScore`, `dynamicLabel` | ✅ |
| 8 | Probe «нет плана реагирования» | Тот же cron вызывает `Specialist35ProbeService.checkNoMitigationPlanForOrg`: фильтр `severity ∈ {high, critical}` + `mitigationPlan IS NULL` + `firstObservedAt < now-7d` + `status='active'` → emit `insight.no_mitigation_plan` | `backend/src/modules/knowledge-core/services/specialist-3-5-probe.service.ts`, `insight-clusterer.cron.ts:59` | через ProbeService → `core.probe-events` | `ProbeEvent` | ✅ |
| 9 | UI и API | REST `/api/v1/insights` (list / chart / top / detail / status / mitigation / severity); `/insights` master-detail + chart-виджет + Top-5 в Director Dashboard | `backend/src/modules/insights/insights.controller.ts:69`, `frontend/app/(authenticated)/insights/InsightsListClient.tsx:44`, `frontend/app/(authenticated)/dashboard/widgets/InsightsTopWidget.tsx` | `GET /api/v1/insights`, `/chart`, `/top`, `POST /:id/status`, `/mitigation`, `/severity` | `Insight.status`, `mitigationPlan`, `severity`, `CardVersion` | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType ∈ {pain, risk, churn_risk, objection}, status='canonical')
  ↓ RouterService.dispatch → core.specialist-routing jobName='3-5-insights'
Insight (kind, statement, severity, frequencyScore, dynamicScore, dynamicLabel,
         sourceBlockIds, affectedEntityIds, relatedDecisionIds, mitigationPlan,
         causeCategory, embedding vector(1536))
  ↓ recalcMetrics — cron 0 */6 * * *
Insight.dynamicLabel + Prometheus gauge insights_dynamic_label_count{label}
  ↓ probe-triggers
ProbeEvent → core.probe-events → ConversationalService.sendNotification
```

4 enum'а: `InsightKind` (schema.prisma:808), `InsightSeverity` (:817), `InsightDynamic` (:829), `InsightStatus` (:842). Модель `Insight` — schema.prisma:5121, индексы по `(tenantId, status, severity)`, `(tenantId, kind)`, `(tenantId, dynamicLabel)`, `(tenantId, lastObservedAt)`, `(tenantId, causeCategory)`. HNSW-индекс на `embedding` создаётся через `backend/scripts/postgres-init.sql` (см. `01_projects/data-model.md`).

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 4 | `insight-extract` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/insight-extract.prompt.ts` |
| 5 | `insight-link-to-decisions` (опц.) | DeepSeek V4 Flash | OpenAI mini → Ollama | `backend/src/modules/knowledge-core/prompts/insight-link-to-decisions.prompt.ts` |

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `core_specialist_pipeline_duration_seconds{type='insight'}` — длительность обработки блока (worker → service).
- `core_specialist_cards_total{type='insight', status}` — создания/обновления Insight'ов.
- `core_specialist_llm_tokens_total{type='insight', model, tier}` — расход токенов.
- `insights_dynamic_label_count{label}` — gauge, обновляется cron'ом (4 метки: `growing/stable/declining/spike`).

**BullMQ очереди** (видно в `/admin/platform/workers`):
- `core.specialist-routing` (jobName=`3-5-insights`).
- `core.probe-events` (probe-уведомления).

**Логи:** `Specialist35InsightsWorker`, `Specialist35Service`, `Specialist35ProbeService`, `InsightClustererCron`. Контекст — `blockId`, `tenantId`, `insightId`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- `@Cron` в NestJS принимает только литералы — ENV `INSIGHT_CLUSTER_CRON` есть в схеме, но в декораторе зашит `0 */6 * * *`. Изменение ENV не действует без пересборки.
- Cosine-порог `0.78` чувствителен к качеству эмбеддинга `name+trustedAnswer` — при пустом `trustedAnswer` мердж может промахиваться.
- LLM `insight-link-to-decisions` обязан возвращать id только из переданного top-10 — иначе галлюцинация. Валидация в сервисе.

**Кнопки админки:** `/admin/curation` (deep review для critical), `/admin/platform/workers` (повторить упавший job), `/admin/llm-routes` (примарь модель `insight-extract`).

## 7. Связанные процессы

- [[meeting-post-processing]] — главный источник блоков с `signalType=pain|risk|churn_risk|objection` (Шаг 7б).
- [[raw-event-to-graph]] — общий конвейер `IdeaBlock` (Шаг 1 здесь — выход оттуда).
- [[specialist-3-3-decisions]] — `relatedDecisionIds` linking тянется отсюда.
- [[probe-question-flow]] — 4 probe-trigger'а отсюда уходят на доставку.
- [[card-rollup-v2]] — параллельная пересборка карточек клиентов/проектов, если Insight затронул `affectedEntityIds`.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ и реализовано без расхождений:**
- 4 probe-trigger'а (`escalation_suggested`, `no_mitigation_plan`, `linked_decision_question`, `recurring_after_mitigation`) — все на месте (`specialist-3-5-probe.service.ts`).
- Gauge `insights_dynamic_label_count{label}` — реализован через `BusinessMetricsService.setInsightsDynamicLabelCount` (см. `insight-clusterer.cron.ts:136`).
- Linking через `IdeaBlockLink.relationType='consequences_of'` — реализован параллельно с LLM-арбитром.

**Реализовано, но не описано в исходном ТЗ:**
- Поле `Insight.causeCategory` (LLM ставит «process_gap / tooling / role_skill / communication / priority / resource_constraint / external / unknown») — добавлено в βwave-2 (2026-05-23) для приоритизации δ-2 ProactiveWatcher и агрегации γ-2 Concierge. См. `schema.prisma:5149-5155`.

**Заложено, но реализовано иначе:**
- Cron-выражение `INSIGHT_CLUSTER_CRON` фактически зашито литералом `'0 */6 * * *'` в декораторе `@Cron`. ENV-переменная в `env.schema.ts` есть, но не подхватывается. См. NB-комментарий в `insight-clusterer.cron.ts:27-30`. Реальная настройка cron — только через пересборку.

**Отложено:**
- Структурированный mitigation plan (steps + owner + deadline) — γ+.
- ML-прогноз эскалации (сейчас простой ratio) — γ+.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-23 | `causeCategory` + UI «Топ-5» виджет | βwave-2 |
| 2026-05-21 | Запуск β-4 — Specialist 3.5 | `01_projects/insights.md` |
