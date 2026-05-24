---
type: tz
status: done
feature: γ-3 — CrossFunctionalProcess + Handoff Tracker
phase: gamma-3
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §γ-3
  - plans/tz/2026-05-22-final-roadmap.md §γ-3
---

# SBA γ-3 — CrossFunctionalProcess + Handoff Tracker

## 1. Цель и контекст

Над ProcessTemplate (α-7 wave 2) и FunctionalDomain/Department (α-9 wave 3) — добавить детект и трекинг сквозных процессов: те, которые проходят через несколько отделов/доменов. Эти процессы — главный источник «process_friction» и «handoff не работает» — нужен мониторинг и UI «слабые места между командами».

## 2. Scope

**Входит:**
- Расширение `ProcessTemplate` полем `isCrossFunctional Boolean @default(false)` + computed `crossFunctionalScore Decimal(4,3)` (на основе количества unique departments в шагах).
- Worker `cross-functional-detector.worker.ts` — анализирует ProcessHandoff между ProcessTemplate'ами + smart heuristic on ProcessStep.assigneeRoleId × Role.departmentId → detects cross-department flows.
- Cron `cross-functional-friction-aggregator.cron` (`@Cron('0 5 * * *')`) — аггрегирует process_friction signalType блоки + ProcessHandoff'ы с slaViolations → группирует по cross-functional process.
- REST `/api/v1/processes/cross-functional`.
- UI: extension `/processes` с tabs «Локальные | Сквозные» (Local|Cross-functional). Cross-functional tab показывает граф процессов + friction-points.
- 1 LlmTaskType `cross-functional-friction-summary`.
- RBAC + Метрики.

## 3. Принятые решения

1. **isCrossFunctional — auto-computed**, не manual.
2. **crossFunctionalScore формула:** `unique_departments / total_steps`. Если ≥ 0.5 — точно cross-functional.
3. **`process_friction` блоки** — сворачиваются в `CrossFunctionalFrictionReport` (новая модель) с FK на ProcessTemplate, severity, recommended_action.
4. **UI tabs над существующей /processes (α-7 wave 2)** — не отдельная страница.

## 4. Зависимости

- α-7 wave 2 (parallel — coder в работе) — ProcessTemplate, ProcessHandoff. **БЛОКЕР** — sub-ТЗ запускать после завершения α-7 wave 2.
- α-9 wave 3 (parallel) — FunctionalDomain, Department.
- α-2 wave 2 (готово) — process_friction signalType.

## 5. Prisma-дельта

```prisma
model ProcessTemplate {
  // existing
  isCrossFunctional      Boolean @default(false)
  crossFunctionalScore   Decimal? @db.Decimal(4,3)
  @@index([tenantId, isCrossFunctional])
}

model CrossFunctionalFrictionReport {
  id                   String   @id @default(cuid())
  tenantId             String
  processTemplateId    String
  severity             String   // 'low' | 'medium' | 'high'
  description          String   @db.Text
  sourceBlockIds       String[]
  involvedDepartmentIds String[]
  recommendedAction    String?  @db.Text
  resolvedAt           DateTime?
  resolvedByUserId     String?
  createdAt            DateTime @default(now())

  processTemplate      ProcessTemplate @relation(fields: [processTemplateId], references: [id])
  tenant               Org             @relation(fields: [tenantId], references: [id])

  @@index([tenantId, severity, resolvedAt])
  @@index([tenantId, processTemplateId])
}
```

## 6. Patch / миграция данных

Нет.

## 7. REST API

`/api/v1/processes/cross-functional`:
- `GET /` (list cross-functional templates).
- `GET /:id/friction` (friction reports for given template).
- `POST /friction/:id/resolve` body `{ resolvedByUserId }`.

## 8. BullMQ worker'ы и cron'ы

- `cross-functional-detector.worker.ts` — listens to ProcessTemplate.create/update; recomputes crossFunctionalScore.
- `cross-functional-friction-aggregator.cron` — daily 05:00.
- Idempotent.

## 9. LlmTaskType регистрация

```ts
{ taskType: 'cross-functional-friction-summary', priority: 'primary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'cross-functional-friction-summary', priority: 'secondary', provider: 'openai', model: 'gpt-4o-mini' }
{ taskType: 'cross-functional-friction-summary', priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
```

## 10. RBAC ResourceType

- `process_template.cross_functional.read` (employee, coo, admin).
- `process_template.cross_functional.resolve_friction` (admin, coo).

## 11. Метрики Prometheus

- `cross_functional_processes_total{tenant_top}` gauge.
- `cross_functional_friction_active_total{tenant_top, severity}` gauge.
- `cross_functional_friction_resolution_time_seconds{tenant_top}` histogram.

## 12. Frontend

- `frontend/app/(authenticated)/processes/page.tsx` — добавить tabs Local|Cross-functional (вместе с α-7 wave 2 UI).
- Cross-functional tab — граф процессов + friction sidebar.
- API extension `processes.api.ts`.
- `Remove-Item -Recurse -Force .next\types`.

## 13. ENV переменные

- `CROSS_FUNCTIONAL_DETECTOR_ENABLED: boolean (default true)`.
- `CROSS_FUNCTIONAL_SCORE_THRESHOLD: number (default 0.5)`.

## 14. Связь с существующим кодом

- `backend/src/modules/processes/` (после α-7 wave 2).
- `backend/src/modules/knowledge-core/specialists/` (паттерн).
- schema.prisma: ProcessTemplate, ProcessHandoff, Department.

## 15. DoD

- [x] schema-изменения.
- [x] Worker + cron работают.
- [x] REST + UI tabs.
- [x] LlmTaskType + RBAC + Metrics.
- [x] typecheck/lint/tests.

## 16. Тесты

- **unit:** `cross-functional-detector.worker.spec.ts`.
- **unit:** `cross-functional-friction-aggregator.cron.spec.ts`.
- **integration:** REST endpoints.

## 17. Риски и mitigation

- **Двойной счёт friction** — `@@unique` constraint по `(tenantId, processTemplateId, sourceBlockIds[0])`.
- **Schema merge с α-7 wave 2** — кодер сначала проверяет, что ProcessTemplate уже содержит новые поля; если α-7 wave 2 закрыт, добавление isCrossFunctional как отдельный schema-edit.
- **`.next/types/`** — Remove-Item.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- Модель `CrossFunctionalFrictionReport` (schema.prisma:4140) + `ProcessTemplate.isCrossFunctional` / `crossFunctionalScore`.
- `CrossFunctionalDetectorService` + `CrossFunctionalFrictionService` + `ProcessHandoffService` в `backend/src/modules/processes/services/`.
- Cron `cross-functional-friction-aggregator.cron.ts` (daily 05:00).
- REST `cross-functional.controller.ts` + DTO `cross-functional.dto.ts`.
- LlmTaskType seed: `backend/scripts/seed-llm-task-routes-cross-functional.ts`.
- Frontend: `/processes` страница с tabs (см. `ProcessTemplatesClient.tsx`).
- Spec: `cross-functional-detector.service.spec.ts`.
