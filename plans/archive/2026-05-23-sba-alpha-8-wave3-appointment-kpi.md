---
type: tz
status: done
feature: α-8 wave 3 — Appointment модель + миграция PersonRole + расширение Metric (KPI fields)
phase: alpha-8
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-23-roadmap-data-models-batch.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-8
  - plans/tz/2026-05-22-final-roadmap.md §α-8
---

# SBA α-8 wave 3 — Appointment + KPI миграции

## 1. Цель и контекст

Wave 2 (data model) закрыт: Role расширена, RoleProfile расширена, 5 нормализованных моделей (ResponsibilityElement, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, Interaction) созданы. Wave 3 закрывает две большие миграции данных и API-готовности:
1. **Appointment** — новая модель, замена `PersonRole` с расширенными полями (departmentId, loadPercent, status).
2. **Metric расширение полями KPI** — `attachedToResponsibilityElementId`, `attachedToRoleId`, `attachedToDepartmentId`, `currentValue`, `lastMeasuredAt`, `frequency`.

## 2. Scope

**Входит:**
- Модель `Appointment` в schema.prisma + relations.
- Расширение `Metric` полями KPI (см. §5).
- Patch-script `patch-migrate-person-role-to-appointment.ts` — копирует данные PersonRole → Appointment с резолвом departmentId.
- Маркировка `PersonRole` `// @deprecated, use Appointment` в schema.
- Обновление `PersonsService` для чтения из Appointment (с fallback на PersonRole в течение transition периода).
- Обновление EntityLink `executes_role` — теперь это связь Appointment→Role (а не PersonRole→Role) на новых записях; legacy остаются.
- REST API `/api/v1/appointments/*`, `/api/v1/kpi/*`.
- RBAC, метрики.
- Backward-compat: PersonRole не удаляется, остаётся читаемым для legacy consumers.

**Не входит:**
- Удаление PersonRole — отдельный sub-ТЗ через 1 месяц после wave 3 в проде.
- UI для Appointment — wave 4 (вместе с role-map UI).
- KPI dashboard widget — отдельный sub-ТЗ в δ-фазе.

## 3. Принятые решения

1. **Appointment рядом, не rename.** PersonRole используется минимум в 2 местах (PersonsService + EntityLink executes_role). Rename через @@map потребует ALTER TABLE и breaks legacy consumers. Parallel model + migration script — нулевой риск + clean future.
2. **DepartmentId резолв в миграции** — если PersonRole не имеет departmentId, попытаться через `EntityLink (PersonRole.personId → Person, departmentId)` найти текущий Department. Если не найдено — оставить NULL (admin доделает руками).
3. **status default 'active'** для existing PersonRole с validTo IS NULL; 'former' для validTo IS NOT NULL AND validTo < now(); 'acting' — не выставляется автоматически (admin указывает руками для интерим-назначений).
4. **loadPercent default 100** (полная ставка). Не угадываем — оставляем 100 если данных нет.
5. **PersonsService** — добавить feature-flag `USE_APPOINTMENT` (default false на prod, true на staging). При flag=true читает Appointment, иначе PersonRole. После прода и backfill — flip flag, потом deprecate.
6. **Metric расширение** — добавляем поля БЕЗ rename модели. KPI = Metric с заполненным `attachedTo*Id`. Это subset, не отдельная сущность.
7. **EntityLink relationType `executes_role`** — остаётся, но meaning extends: source может быть Person ИЛИ Appointment. На новых записях — Appointment. Через 1 месяц можем добавить новый relationType `appointed_as` чтобы разделить семантику.

## 4. Зависимости

- α-8 wave 2 (готово) — Role, RoleProfile, 5 нормализованных моделей.
- α-9 wave 2 (готово) — Department.
- α-9 wave 3 (параллельно) — Department service; не блокер, можно работать параллельно.

## 5. Prisma-дельта

```prisma
model Appointment {
  id              String   @id @default(cuid())
  tenantId        String
  personId        String
  roleId          String
  departmentId    String?
  loadPercent     Int      @default(100)
  status          String   @default("active")     // 'active' | 'former' | 'acting'
  validFrom       DateTime
  validTo         DateTime?
  sourceBlockIds  String[]                        // блоки-источники назначения
  confidence      Decimal  @db.Decimal(4,3) @default(1.0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  person          Person     @relation(fields: [personId], references: [id])
  role            Role       @relation(fields: [roleId], references: [id])
  department      Department? @relation(fields: [departmentId], references: [id])
  tenant          Org        @relation(fields: [tenantId], references: [id])

  @@index([tenantId, personId, status])
  @@index([tenantId, roleId, status])
  @@index([tenantId, departmentId, status])
  @@unique([tenantId, personId, roleId, validFrom])   // не дубл. одного назначения
}

// расширение Metric
model Metric {
  // ... существующие поля
  attachedToResponsibilityElementId  String?
  attachedToRoleId                   String?
  attachedToDepartmentId             String?
  currentValue                       Decimal? @db.Decimal(18,4)
  currentValueUnit                   String?
  lastMeasuredAt                     DateTime?
  frequency                          String?   // 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'adhoc'

  responsibilityElement              ResponsibilityElement? @relation(fields: [attachedToResponsibilityElementId], references: [id])
  attachedRole                       Role?                  @relation("MetricToRole", fields: [attachedToRoleId], references: [id])
  attachedDepartment                 Department?            @relation("MetricToDepartment", fields: [attachedToDepartmentId], references: [id])

  @@index([tenantId, attachedToRoleId])
  @@index([tenantId, attachedToDepartmentId])
}
```

Не забыть обратные relations в Role / Department / ResponsibilityElement.

## 6. Patch / миграция данных

`backend/scripts/patch-migrate-person-role-to-appointment.ts`:
```
1. SELECT все PersonRole WHERE NOT EXISTS Appointment с тем же personId+roleId+validFrom (idempotency).
2. Для каждого:
   a. Резолв departmentId: попытка через EntityLink (Person → Department) на дату validFrom.
   b. Резолв status: 'former' if validTo<now(), 'active' otherwise.
   c. INSERT Appointment с теми же validFrom/validTo, loadPercent=100, confidence=PersonRole.confidence ?? 1.0.
3. Log сводку: N migrated, M skipped (already in Appointment), K failed.
```
Идемпотентно. Без дропа PersonRole.

`backend/scripts/patch-link-existing-metrics-to-roles.ts` (опц.): по semantic similarity (Metric.name ↔ Role.name + ResponsibilityElement) проставляет `attachedToRoleId`. Confidence-based, only ≥ 0.85.

## 7. REST API

`/api/v1/appointments`:
- `GET /?personId=&roleId=&departmentId=&status=` (list filterable).
- `POST /` (create).
- `GET /:id`, `PATCH /:id`, `DELETE /:id` (soft archive — status='former' + validTo=now()).
- `GET /persons/:personId/timeline` — все назначения person'а упорядоченные по validFrom.

`/api/v1/kpi` (subset endpoints для расширенного Metric):
- `GET /?attachedToRoleId=&attachedToDepartmentId=&attachedToResponsibilityElementId=` (filter).
- `POST /` (создать новый Metric с KPI-полями).
- `PATCH /:id/measurement` body `{ currentValue, currentValueUnit, measuredAt? }` — обновляет currentValue+lastMeasuredAt атомарно.

## 8. BullMQ worker'ы и cron'ы

Нет новых.

Расширение existing: `appointment-detector.worker` опционально (но рекомендован) — extracts Appointment из IdeaBlock'ов signalType=`commitment` или text-патернов «начал работать как», «теперь Y», «временно исполняет». Если не делаем в wave 3 — отделяется в wave 4.

## 9. LlmTaskType регистрация

Нет новых.

## 10. RBAC ResourceType

`policy.csv`:
- `appointment.read` (employee, admin, super_admin, hr).
- `appointment.write` (admin, super_admin, hr).
- `kpi.read` (employee, admin, super_admin, coo).
- `kpi.write` (admin, super_admin, coo).
- `kpi.measurement` (admin, super_admin, coo, kpi_owner — если будет такая роль; пока admin).

## 11. Метрики Prometheus

- `appointments_total{tenant_top, status}` gauge.
- `kpi_measurements_total{tenant_top}` counter.
- `kpi_overdue_measurements_total{tenant_top, frequency}` gauge (KPI с lastMeasuredAt > frequency-окно).
- `person_role_to_appointment_migration_progress{tenant_top}` gauge (% migrated).

## 12. Frontend

В wave 3 — минимум, основные UI в wave 4 (role-map UI). В wave 3 только:
- `/persons/[id]` (existing) — добавить вкладку «Назначения» с timeline (basic).
- API клиент: `frontend/src/api/appointments.api.ts`.

KPI UI — отдельный sub-ТЗ.

## 13. ENV переменные

- `USE_APPOINTMENT_FOR_PERSON_ROLES: boolean (default false)` — feature-flag.
- `APPOINTMENT_DETECTOR_ENABLED: boolean (default false)`.

## 14. Связь с существующим кодом

- `backend/src/modules/persons/services/persons.service.ts` (line ~30-35) — добавить feature-flag conditional.
- `backend/src/common/graph/graph.service.ts` — EntityLink `executes_role`.
- `backend/src/modules/persons/dto/` (через vexp) — DTOs для расширения.
- schema.prisma: PersonRole (deprecate), Appointment (new), Metric (extend), Role, Department, ResponsibilityElement.

## 15. DoD

- [x] Appointment модель + Metric расширение в schema, prisma:generate/push зелёные.
- [x] Patch-script PersonRole→Appointment запущен на test-data, идемпотентен.
- [x] PersonsService поддерживает оба источника через feature-flag.
- [x] REST endpoints зарегистрированы.
- [x] Минимальный UI на /persons/[id] вкладка «Назначения».
- [x] RBAC + метрики.
- [x] `bun run typecheck` + `bun run lint` + unit-tests зелёные.

## 16. Тесты

- **unit:** `appointment.service.spec.ts` — CRUD, unique constraint, status transitions.
- **unit:** `patch-migrate-person-role-to-appointment.spec.ts` — idempotency, resolve departmentId.
- **integration:** `persons.service.feature-flag.spec.ts` — USE_APPOINTMENT flag toggle, оба пути возвращают эквивалент.
- **integration:** `kpi-measurement.spec.ts` — атомарное обновление currentValue+lastMeasuredAt.

## 17. Риски и mitigation

- **Дубли при первом запуске patch-script на проде** — `@@unique([tenantId, personId, roleId, validFrom])` + WHERE NOT EXISTS Appointment.
- **PersonRole.departmentId не резолвится** — миграция продолжает с NULL, log warnings, admin доделывает руками. Acceptable degradation.
- **EntityLink executes_role конфликт** — на новых Appointment создаём новые EntityLink (source: appointment.id). Legacy остаются.
- **Schema merge с α-9 wave 3** — Department relations в Metric/Appointment могут конфликтовать с Department relations добавляемых α-9. Кодер добавляет relations осторожно, проверяя текущее состояние schema.prisma непосредственно перед правкой.
- **Feature-flag tests на CI** — оба пути в matrix test.
- **`.next/types/`** — minimal frontend changes, но Remove-Item на всякий случай.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- Модель `Appointment` в `schema.prisma:3485-3512` с `@@unique([tenantId, personId, roleId, validFrom])` и индексами по status. PersonRole остаётся (deprecated).
- Метрика-расширение: `attachedToResponsibilityElementId/Role/Department`, `currentValue`, `currentValueUnit`, `lastMeasuredAt`, `frequency` в schema.prisma:4419-4442 + 3 relations (`MetricToRole`, `MetricToDepartment`, ResponsibilityElement).
- Модуль `backend/src/modules/appointments/`: `appointments.service.ts`, `appointments.controller.ts`, DTO, тесты.
- Модуль `backend/src/modules/kpi/`: `kpi.service.ts`, `kpi.controller.ts`, DTO (включая endpoint `PATCH /:id/measurement` для атомарного обновления).
- Patch-script `backend/scripts/patch-migrate-person-role-to-appointment.ts` (dry-run по умолчанию).
- PersonsService с feature-flag `USE_APPOINTMENT_FOR_PERSON_ROLES` в `persons.service.ts:54` + `persons.spec.ts` для обоих путей.
- Frontend `app/(authenticated)/persons/[id]/appointments/` (page.tsx + PersonAppointmentsClient.tsx).
- ENV `USE_APPOINTMENT_FOR_PERSON_ROLES`, `APPOINTMENT_DETECTOR_ENABLED` в env.schema.ts.
