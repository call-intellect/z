---
type: tz
status: done
feature: β-6 — Experiment Tracker (Specialist 3.9)
phase: beta-6
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §β-6
  - plans/tz/2026-05-22-final-roadmap.md §β-6
---

# SBA β-6 — Experiment Tracker (целиком новый специалист)

## 1. Цель и контекст

Институциональная память «что мы пробовали и что вышло». Specialist 3.9 собирает Experiment-карточки из signalType={hypothesis, result, lesson} (добавлены в α-2 wave 2), отслеживает переходы Experiment ↔ Insight ↔ Decision (когда эксперимент привёл к решению), эмитит probe-events «эксперимент без результата».

## 2. Scope

**Входит:**
- Модель `Experiment` (id, tenantId, name, hypothesis, status, ownerEntityId?, sourceBlockIds[], currentResult?, lessons?, startedAt?, completedAt?, currentVersionId?, confidence, entityId?).
- Модель `ExperimentVersion` (immutable snapshots при изменении).
- Worker `experiment-detector.worker.ts` — подписан на core.specialist-routing, signalType={hypothesis, result, lesson}.
- Cron `experiment-status-resolver.cron` (`@Cron('0 */6 * * *')`) — resolves status: hypothesis → running → completed (с лестницей по наличию result/lesson блоков).
- Cron `EntityTransitionCron` (`@Cron('0 7 * * *')`) — определяет переходы Experiment→Insight (когда result → Insight.evidence) и Experiment→Decision (когда lesson → Decision.context).
- 3 probe-trigger'а: «эксперимент без owner'а», «эксперимент в running >30 дней без результата», «result без lesson'а».
- 2 LlmTaskType: `experiment-extract`, `experiment-summarize-lessons`.
- REST `/api/v1/experiments/*`.
- UI `/experiments` master-detail.
- RBAC `experiment.read|write`.
- Метрики `experiments_total{tenant_top, status}`, `experiments_lessons_extracted_total{tenant_top}`.

**Не входит:**
- A/B test infrastructure (separate concern).
- Auto-create Decision/Insight — только эмит EntityLink predicate'ов (`derived_from`, `evidences`).

## 3. Принятые решения

1. **Experiment — first-class card.** Не подкатегория Decision/Insight. Может быть автономной (running без результата 90 дней) или закрытой.
2. **Status machine:** `hypothesis → running → completed | dropped`. Дополнительный `paused` опц.
3. **Auto-status transitions:** hypothesis → running когда добавлен ≥1 plan_item или явный «начали»/«запустили». running → completed когда добавлен result + lesson. Cron делает только в `confidence ≥ 0.7`, иначе оставляет «hypothesis» + probe.
4. **EntityTransitionCron — не модифицирует Insight/Decision, только эмитит EntityLink** (`result_supports_insight`, `lesson_informs_decision`).
5. **lessonsJson** — Array<{ text, sourceBlockId, type ∈ {what_worked|what_failed|next_time}}>. Multi-faceted.
6. **§5 contract спец-ист обязателен**: triage, probe, getCitations, метрики.

## 4. Зависимости

- α-2 wave 2 (готово) — signalType={hypothesis, result, lesson}.
- α-3 wave 2 (готово) — Entity, EntityLink.
- α-1, α-4 (готово) — Probe + Curation.

## 5. Prisma-дельта

```prisma
model Experiment {
  id              String   @id @default(cuid())
  tenantId        String
  name            String
  hypothesisText  String   @db.Text
  ownerEntityId   String?
  status          String   @default("hypothesis")  // hypothesis|running|completed|dropped|paused
  currentResult   String?  @db.Text
  lessonsJson     Json?
  startedAt       DateTime?
  completedAt     DateTime?
  sourceBlockIds  String[]
  personSubjectIds String[]
  currentVersionId String?
  confidence      Decimal  @db.Decimal(4,3) @default(0.5)
  entityId        String?  // ссылка в Entity-граф
  lastConfirmedAt DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  tenant          Org      @relation(fields: [tenantId], references: [id])
  versions        ExperimentVersion[]

  @@index([tenantId, status])
  @@index([tenantId, ownerEntityId])
}

model ExperimentVersion {
  id             String   @id @default(cuid())
  experimentId   String
  versionNumber  Int
  snapshotJson   Json
  createdAt      DateTime @default(now())

  experiment     Experiment @relation(fields: [experimentId], references: [id])

  @@unique([experimentId, versionNumber])
}
```

## 6. Patch / миграция данных

Нет (новая сущность, no legacy).

## 7. REST API

`/api/v1/experiments` (TenantGuard + `experiment.read`):
- `GET /` filters status/owner/search.
- `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (soft archive).
- `POST /:id/transition` body `{ to: 'running'|'completed'|'dropped' }`.

Все DTO через Zod.

## 8. BullMQ worker'ы и cron'ы

- `experiment-detector.worker` — очередь core.specialist-routing.
- `experiment-status-resolver.cron` — every 6h.
- `experiment-transitions.cron` (= EntityTransitionCron) — daily 07:00.
- JobId паттерны идемпотентны.

## 9. LlmTaskType регистрация

`backend/scripts/seed-llm-task-routes-experiment.ts`:
```ts
{ taskType: 'experiment-extract',           priority: 'primary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'experiment-extract',           priority: 'secondary', provider: 'openai', model: 'gpt-4o-mini' }
{ taskType: 'experiment-extract',           priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'experiment-summarize-lessons', priority: 'primary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'experiment-summarize-lessons', priority: 'secondary', provider: 'openai', model: 'gpt-4o-mini' }
{ taskType: 'experiment-summarize-lessons', priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
```

## 10. RBAC ResourceType

- `experiment.read` (employee).
- `experiment.write` (admin, employee).
- `experiment.admin` (admin, super_admin).

## 11. Метрики Prometheus

- `experiments_total{tenant_top, status}` gauge.
- `experiments_running_duration_days{tenant_top}` histogram (для probe «running >30d»).
- `experiments_lessons_extracted_total{tenant_top}` counter.
- `experiment_detector_runs_total{tenant_top, result}` counter.

## 12. Frontend

- `frontend/app/(authenticated)/experiments/page.tsx` — master-detail.
- `frontend/app/(authenticated)/experiments/[id]/page.tsx` — детальный (hypothesis/result/lessons tabs + transitions actions).
- API client + Domain mapper.
- NAV link.
- `<ConciergeSlot>`.
- Remove `.next\types` после правок.

## 13. ENV переменные

- `EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED: boolean (default true)`.
- `EXPERIMENT_RUNNING_PROBE_THRESHOLD_DAYS: number (default 30)`.

## 14. Связь с существующим кодом

- `backend/src/modules/knowledge-core/specialists/` (паттерн §5 эталон — `specialist-3-4-card-handler.service.ts`).
- `backend/src/modules/probe/probe.service.ts`.
- `backend/src/common/graph/graph.service.ts` для EntityLink.
- `backend/src/modules/knowledge-core/services/router.service.ts` — расширить matchSpecialists для hypothesis/result/lesson.

## 15. DoD

- [x] 2 модели + relations.
- [x] Worker детектит + создаёт Experiment.
- [x] 2 cron'а работают.
- [x] 3 probe-trigger'а эмитят.
- [x] REST + UI работают.
- [x] §5 контракт пройден.
- [x] typecheck/lint/tests зелёные.

## 16. Тесты

- **unit:** `experiment.service.spec.ts`, `experiment-detector.worker.spec.ts`, `experiment-status-resolver.cron.spec.ts`.
- **integration:** API + tenant guard.

## 17. Риски и mitigation

- **Schema merge с другими wave-3** — добавляем 2 модели в конец schema; кодер проверяет, что параллельный coder не добавил Experiment/ExperimentVersion.
- **False-positive auto-transition** — confidence threshold 0.7; ниже — оставляем + probe.
- **`.next/types/` кэш** — Remove-Item.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- Модели `Experiment` + `ExperimentVersion` в `backend/prisma/schema.prisma` (строки 5811, 5861).
- REST CRUD: `backend/src/modules/experiments/experiments.controller.ts` + `services/experiments.service.ts` + `dto/experiments.dto.ts`.
- Worker `experiment-detector.worker.ts` + 2 cron'а (`experiment-status-resolver.cron.ts` + `experiment-transitions.cron.ts`) в `backend/src/modules/knowledge-core/workers/`.
- 3 probe-trigger'а через `Specialist39ExperimentProbeService` (`backend/src/modules/knowledge-core/services/specialist-3-9-experiment-probe.service.ts`): no-owner, running-too-long, result-without-lesson.
- LlmTaskType seed: `backend/scripts/seed-llm-task-routes-experiments.ts`.
- RBAC `experiment` ResourceType в `policy.csv` (read/write/delete/manage для owner/admin, manager open).
- Frontend: `frontend/app/(authenticated)/experiments/page.tsx` + `[id]/page.tsx` (master-detail с tabs hypothesis/result/lessons), API client `frontend/src/api/experiments.api.ts`.
- Prompt: `backend/src/modules/knowledge-core/prompts/experiment-extract.prompt.ts`.
