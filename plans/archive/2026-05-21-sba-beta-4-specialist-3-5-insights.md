---
type: tz
status: done
feature: SBA β-4 — Specialist 3.5 Insights Radar (повторяющиеся проблемы, риски, блокеры)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: beta
depends_on:
  - tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md (signalType='problem'/'risk'/'blocker')
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (референс)
  - tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md (linking insights ↔ decisions)
covers_matrix_rows: [C2, J1..J11, L6]
---

# ТЗ β-4: Specialist 3.5 — Insights Radar

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Контракт специалиста §5** — реализация по образцу α-6.

---

## 1. Цель

После β-4:
- Insight модель: повторяющиеся problems / risks / blockers / inefficiencies.
- Воркер `insight-detector` кластеризует упоминания в Insight'ы и считает динамику (frequencyScore + dynamicScore).
- Linking с Decisions: «эта проблема — следствие решения X» (через `IdeaBlockLink relationType='consequences_of'`).
- Дашборд `/insights` с графиком динамики + master-detail.
- Виджет в Director Dashboard «Топ-5 повторяющихся проблем».

---

## 2. Зависимости

**Зависит от:** α-2, α-3, α-4, α-6, β-3 (Decision для linking).

**Используется:** Director Dashboard (расширение существующего из [Phase 8](2026-05-10-phase-8-director-dashboard.md)).

---

## 3. Scope

### Входит

- Prisma-модель `Insight`.
- Воркер `insight-detector.worker` (consumer `core.specialist-routing` jobName '3-5-insights').
- Cron `insight-clusterer.cron` — переоценка кластеров раз в N часов.
- Embedding-кластеризация повторов (порог `INSIGHT_CLUSTER_THRESHOLD`).
- Связывание с Decisions через KNN + LLM (или через граф `IdeaBlockLink`).
- 2 новых `LlmTaskType` с 3 provider'ами.
- Probe-events: «проблема Y повторилась N раз — эскалировать?».
- Conflict-events (если разные источники говорят про одну проблему противоречиво).
- API + UI `/insights` (master-detail + chart).
- Расширение Director Dashboard виджетом.
- Регистрация в `CardSpecialistRegistry`.
- HNSW индекс.
- RBAC: `insight`.

### Не входит

- Workflow «mitigation plan» с responsible person — γ+ (в β-4 только текстовое `mitigationPlan`).
- Автоматическое связывание Insight ↔ Risk register (если у компании есть формальный risk-management) — γ+.
- ML-модель «прогноз эскалации» — γ+.

---

## 4. Модель данных

```prisma
model Insight {
  id              String   @id @default(uuid())
  tenantId        String
  entityId        String?  @unique
  kind            InsightKind  // 'problem' | 'risk' | 'blocker' | 'inefficiency'
  statement       String   @db.Text
  severity        InsightSeverity  // 'low' | 'medium' | 'high' | 'critical'
  frequencyScore  Decimal  @db.Decimal(6, 3)   // нормализованная частота (N упоминаний за окно)
  dynamicScore    Decimal  @db.Decimal(6, 3)   // тренд (растёт / стабильно / падает) — числовое
  dynamicLabel    InsightDynamic  // 'growing' | 'stable' | 'declining' | 'spike'
  affectedEntityIds String[]  // Project / Customer / Process на которые влияет
  relatedDecisionIds String[]  // Decision'ы которые могли спровоцировать
  mitigationPlan  String?  @db.Text   // текстовый план (в β-4 текст; в γ+ структурируем)
  firstObservedAt DateTime
  lastObservedAt  DateTime
  status          InsightStatus  // 'active' | 'mitigating' | 'mitigated' | 'archived' | 'false_alarm'
  sourceBlockIds  String[]
  personSubjectIds String[]
  confidence      Decimal  @db.Decimal(4, 3)
  dataClass       DataClass
  currentVersionId String?
  embedding       Unsupported("vector(1536)")?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([tenantId, status, severity])
  @@index([tenantId, kind])
  @@index([tenantId, dynamicLabel])
}
```

---

## 5. Воркер `insight-detector`

```ts
@Processor(CORE_QUEUE_NAMES.SPECIALIST_ROUTING)
export class InsightDetectorWorker {
  @Process('3-5-insights')
  async handle(job: Job<RoutedBlock>) {
    const block = await this.prisma.ideaBlock.findUnique(...);
    if (!['problem', 'risk', 'blocker', 'inefficiency'].includes(block.signalType)) return;

    // 1. KNN cosine top-10 существующих Insight того же tenant с близким embedding (порог 0.78)
    // 2. Если есть match — обновить existing Insight (sourceBlockIds.push, lastObservedAt, increment counters)
    //    Если нет — создать draft Insight
    // 3. LLM-вызов insight-extract для черновика (если новый)
    // 4. LLM-вызов insight-link-to-decisions (опц.) — найти Decision'ы которые могли спровоцировать
    // 5. CurationService.triage(card='insight', ...) — НЕ critical-type (но severity='critical' → deep review)
    // 6. На approve → Insight create/update + CardVersion
    // 7. Метрики
  }
}
```

`insight-clusterer.cron` (раз в 6 часов):
- Пересчёт frequencyScore (N упоминаний за rolling 30d / общее число встреч за период).
- Пересчёт dynamicLabel (сравнение 7d vs 30d частоты).
- При резком росте → probe-event «эскалировать?».

---

## 6. Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `insight.escalation_suggested` | dynamicLabel='spike' OR (severity='high' AND frequency↑↑) | owner/admin Org |
| `insight.no_mitigation_plan` | severity='high'/'critical' AND mitigationPlan IS NULL AND age > 7d | mitigation owner если есть, иначе admin |
| `insight.linked_decision_question` | LLM нашёл candidate Decision — link установить? | owner/admin |
| `insight.recurring_after_mitigation` | status='mitigated' но появилось новое упоминание | mitigation owner |

---

## 7. ENV

```
INSIGHT_CLUSTER_THRESHOLD=0.78
INSIGHT_CLUSTER_CRON="0 */6 * * *"
INSIGHT_FREQUENCY_WINDOW_DAYS=30
INSIGHT_SPIKE_RATIO=3.0  # если 7d-частота в 3+ раза выше 30d-средней → spike
```

---

## 8. RBAC

`insight` — read: member, write/delete/status: owner/admin/curator. `mitigationPlan` правка — owner/admin.

---

## 9. Метрики

```
core_specialist_cards_total{type='insight', kind, status}
core_specialist_pipeline_duration_seconds{type='insight'}
core_specialist_llm_tokens_total{type='insight', model, tier}
core_specialist_probe_events_total{type='insight', reason}
core_specialist_conflict_events_total{type='insight'}
insights_dynamic_label_count{label}  # gauge — сколько каждого вида сейчас
```

---

## 10. LLM (3 уровня)

**2 новых `LlmTaskType`:**

1. `insight-extract` — из блока + кластера → черновик Insight (statement, severity, mitigation suggestion).
2. `insight-link-to-decisions` — для каждого Insight → найти candidate Decision'ы которые могли спровоцировать.

Цепочки primary/secondary/tertiary через `seed-llm-task-routes-insights.ts`.

---

## 11. UI

### `/insights` master-detail

Левая:
- Фильтры: kind, severity, status, dynamicLabel
- Сортировка: dynamicLabel='spike' first, severity desc, frequencyScore desc
- Chart-виджет сверху: stacked bar — N insights по типам за rolling 30d

Правая:
- Statement + severity + status badges
- Frequency + dynamic chart (line по неделям)
- Affected entities (chips)
- Related Decisions (chips → /decisions/:id)
- Mitigation plan (editable, для owner/admin)
- Provenance (sourceBlockIds)
- `<CurationBanner>` если pending
- Действия: status update, severity update

### Director Dashboard widget

«Топ-5 повторяющихся проблем» — таблица: kind / severity / frequency / dynamic. Клик → `/insights/:id`.

API:
- `GET /insights` (фильтры + chart-data endpoint `/insights/chart?days=30`)
- `GET /insights/:id`
- `POST /insights/:id/status`, `POST /insights/:id/mitigation`
- `GET /insights/top?limit=5` — для dashboard widget

---

## 12. Фазы реализации

- [x] **β-4.1** Prisma-модель `Insight` + enum'ы + HNSW + `bun run prisma:push`.
- [x] **β-4.2** Воркер `insight-detector.worker`.
- [x] **β-4.3** Cron `insight-clusterer.cron` (frequency + dynamic recalc).
- [x] **β-4.4** Промпты `insight-extract.prompt.ts`, `insight-link-to-decisions.prompt.ts` (placeholder + TODO).
- [x] **β-4.5** Seed `seed-llm-task-routes-insights.ts` с 3 provider'ами + playbook.
- [x] **β-4.6** CurationService.triage интеграция (severity='critical' → deep review).
- [x] **β-4.7** Probe-events (4 trigger'а).
- [x] **β-4.8** Связывание с Decisions через `IdeaBlockLink relationType='consequences_of'` (если уже есть в графе) + LLM для непокрытых случаев.
- [x] **β-4.9** Регистрация в `CardSpecialistRegistry`.
- [x] **β-4.10** API + DTO + Swagger (включая chart-data endpoint).
- [x] **β-4.11** UI `/insights` master-detail + chart.
- [x] **β-4.12** Director Dashboard widget «Топ-5 повторяющихся проблем».
- [x] **β-4.13** RBAC: `insight` ResourceType.
- [x] **β-4.14** Метрики + glossary + second-brain (новый файл `01_projects/insights.md`).

---

## 13. Открытые вопросы

1. **dynamicLabel computation** — упрощённое (ratio 7d/30d) или ML-модель прогноза? Рекомендация — упрощённое. ML — γ+ если потребуется.
2. **mitigation plan** — текст или структурированный (steps + owner + deadline)? Рекомендация — текст в β-4, структурируем в γ+.
3. **Linking с Risk register** (если есть отдельная сущность в Org) — отложить на γ+.
4. **false_alarm status** — кто может выставлять? Рекомендация — owner/admin/curator.

---

## 14. DoD

- Insight модель + HNSW, `bun run prisma:push` зелёный.
- Воркер + cron работают.
- 2 промпта placeholder + seed с 3 provider'ами + playbook.
- 4 probe trigger'а работают.
- CurationService интеграция.
- API + UI `/insights` + chart + dashboard widget.
- chat-v2 находит insights в выдаче на вопросы «какие у нас проблемы с X».
- `CardSpecialistRegistry.register()` вызывается.
- Метрики, RBAC, glossary, second-brain.

---

## 15. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** компания видит свои повторяющиеся проблемы и риски в реальном времени, директор получает виджет «топ-5 болей» с динамикой.

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Модель `Insight` + `causeCategory String?` (доставлено отдельным расширением, 8 категорий, см. коммит 31fd270): `backend/prisma/schema.prisma:4560-4632`.
- Worker + cron: `backend/src/modules/knowledge-core/workers/specialist-3-5-insights.worker.ts`, `insight-clusterer.cron.ts`.
- Сервисы: `specialist-3-5-{insights,card-handler,probe}.service.ts` + spec `specialist-3-5-insights.normalize-cause-category.spec.ts`.
- Промпты: `knowledge-core/prompts/insight-extract.prompt.ts`, `insight-link-to-decisions.prompt.ts`.
- Seed: `backend/scripts/seed-llm-task-routes-insights.ts`.
- REST + UI: `backend/src/modules/insights/{controller,service}` + `frontend/app/(authenticated)/insights/page.tsx` + `feed/insights/page.tsx` + Director Dashboard widget.
- EntityTransitionCron = `ExperimentTransitionsCron` из β-6 (`backend/src/modules/knowledge-core/workers/experiment-transitions.cron.ts:10`).

**Осталось:** —
