---
type: tz
status: ready-for-code
feature: β-8 — PersonalRelation + COO + DailyCheckIn + Goal каскад
phase: beta-8
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §β-8
  - plans/tz/2026-05-22-final-roadmap.md §β-8
---

# SBA β-8 — PersonalRelation Graph + COO Operations Dashboard + DailyCheckIn

## 1. Цель и контекст

3 связанных слоя:
1. **PersonalRelation** — граф «кто с кем работает / конфликтует / менторит» через EntityLink (базис частично есть: manages/collaborates_with).
2. **COO Agent** — операционный пульс компании, виджет «что важно сейчас».
3. **DailyCheckIn** — утренние/вечерние чек-ины через привычный канал (in_app/telegram/max), фиксация plan_item/done_item/blocker.

## 2. Scope

**Входит:**
- Worker `personal-relation-builder.worker` — детектит team_friction/process_friction signalType (α-2 wave 2) + builds EntityLink с relationType ∈ {mentors, conflicted_with, transfers_result_to, escalates_to, reports_to} (5 уже в schema из α-3 wave 2).
- Модель `DailyCheckIn` (id, tenantId, personId, kind ∈ {morning|evening}, dateLocal, plansJson?, donesJson?, blockersJson?, completedAt?, sourceMessageId?).
- Cron `daily-checkin-prompt.cron` — каждый час: для каждого active employee'а с time-of-day=09:00 local → инициировать morning checkin (через primary channel); 18:00 local → evening checkin.
- Worker `checkin-response.worker` — обработка ответа: extract plan_item/done_item/blocker через LLM, сохранить в DailyCheckIn, эмитить RawEvent для ingest.
- Сервис `OperationsDashboardService` — агрегирует данные для COO виджетов.
- Расширение `Goal.parentGoalId` (cascade goals).
- Новая RBAC роль `coo`.
- REST: `/api/v1/dashboard/operations`, `/api/v1/me/check-ins`.
- UI: `/dashboard/operations` (COO виджеты), `/me/check-ins` (личный history + manual create).
- 2 LlmTaskType: `checkin-parse`, `operations-summary`.
- Метрики.

**Не входит:**
- ProactiveWatcher — отдельный sub-ТЗ δ-2.
- Voice check-ins — δ-3.

## 3. Принятые решения

1. **DailyCheckIn — отдельная модель, не RawEvent.** Кросс-функциональный — нужен structured access для dashboard + retention.
2. **time-of-day local** — берём из Person.timezone (если нет — default Europe/Moscow). Cron работает каждый час, проверяет «сейчас 09:00 в чьей-то TZ».
3. **plansJson / donesJson / blockersJson** — Array<{ text, sourceBlockId?, priority?: number }>.
4. **Goal.parentGoalId** — m:1 (child → parent). Один parent. Cascade: completed когда все children completed; missed когда parent missed → cascade flag children.
5. **COO роль** — read-access на operations dashboard, не админ.
6. **OperationsDashboardService — derived/cached** (Redis 5 минут TTL): top blockers, missed goals, team friction count, capacity utilization.
7. **personal-relation-builder — confidence threshold** ≥ 0.6 для auto EntityLink. Ниже — probe куратору.
8. **Channel selection для checkin prompt** — из ChannelPreference user'а (см. α-1 routing). Default in_app.

## 4. Зависимости

- α-1 (готово) — ConversationalService для checkin prompts.
- α-2 wave 2 (готово) — team_friction/process_friction/plan_item/done_item/blocker signalType.
- α-3 wave 2 (готово) — EntityLinkType.
- α-7 wave 2 / α-9 wave 3 (рекомендовано) — Department/Process для operations metrics.
- α-8 wave 3 (опц., для Goal.assigneeAppointmentId) — но не блокер.

## 5. Prisma-дельта

```prisma
model DailyCheckIn {
  id              String   @id @default(cuid())
  tenantId        String
  personId        String
  kind            String                            // 'morning' | 'evening'
  dateLocal       String                            // YYYY-MM-DD
  plansJson       Json?
  donesJson       Json?
  blockersJson    Json?
  notificationId  String?                           // ссылка на исходный probe
  completedAt     DateTime?
  createdAt       DateTime @default(now())

  person          Person   @relation(fields: [personId], references: [id])
  tenant          Org      @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, personId, kind, dateLocal])
  @@index([tenantId, personId, dateLocal])
}

model Goal {
  // existing
  parentGoalId    String?
  parent          Goal?  @relation("GoalToParent", fields: [parentGoalId], references: [id])
  children        Goal[] @relation("GoalToParent")

  @@index([tenantId, parentGoalId])
}

model Person {
  // existing
  timezone        String?  @default("Europe/Moscow")
}
```

## 6. Patch / миграция данных

`backend/scripts/patch-person-timezone-default.ts` — для всех Person с timezone IS NULL → 'Europe/Moscow' (default).

## 7. REST API

`/api/v1/dashboard/operations` (TenantGuard + `dashboard.operations.read` — coo/admin):
- `GET /overview` — pulse metrics: blockers count, missed goals, team friction count, capacity, top recent events.
- `GET /blockers` — list active blockers с owners.
- `GET /team-frictions` — list team_friction EntityLinks.
- `GET /capacity` — Appointment loadPercent aggregated.

`/api/v1/me/check-ins` (TenantGuard + auth):
- `GET /?date=YYYY-MM-DD&kind=morning|evening` — list.
- `POST /` — create manual checkin.
- `GET /history?days=30` — past checkins.

`/api/v1/personal-relations` (TenantGuard + admin):
- `GET /?personId=&relationType=` — list EntityLinks с people.

## 8. BullMQ worker'ы и cron'ы

- `personal-relation-builder.worker` — очередь core.specialist-routing, фильтр signalType in {team_friction, process_friction, manages, collaborates_with}.
- `daily-checkin-prompt.cron` — `@Cron('0 * * * *')` каждый час, фильтрует employees по local TZ.
- `checkin-response.worker` — listens for Notification.responded events с metaJson.kind='checkin'.
- JobId паттерны идемпотентны.

## 9. LlmTaskType регистрация

```ts
{ taskType: 'checkin-parse',        priority: 'primary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'checkin-parse',        priority: 'secondary', provider: 'openai', model: 'gpt-4o-mini' }
{ taskType: 'checkin-parse',        priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'operations-summary',   priority: 'primary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'operations-summary',   priority: 'secondary', provider: 'openai', model: 'gpt-4o-mini' }
{ taskType: 'operations-summary',   priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
```

## 10. RBAC ResourceType

- Новая роль `coo`: read access на dashboard.operations + appointments + maturity.
- `dashboard.operations.read` (coo, admin, super_admin).
- `daily_checkin.read|write` (self for write, admin for read all).
- `personal_relation.read` (admin, coo); `personal_relation.write` — internal-only (worker).

Регистрация роли `coo` в `backend/policies/policy.csv` (новая строка).

## 11. Метрики Prometheus

- `daily_checkins_completed_total{tenant_top, kind}` counter.
- `daily_checkins_skipped_total{tenant_top, kind}` counter.
- `operations_blockers_total{tenant_top, severity}` gauge.
- `team_frictions_total{tenant_top}` gauge.
- `goal_cascade_misses_total{tenant_top}` counter.

## 12. Frontend

- `frontend/app/(authenticated)/dashboard/operations/page.tsx` — COO виджеты (Recharts).
- `frontend/app/(authenticated)/me/check-ins/page.tsx` — личный history + manual create form.
- API clients + Domain mappers.
- NAV: «Операции» (COO group); «Мои чек-ины» (Me group).
- Remove `.next\types`.

## 13. ENV переменные

- `DAILY_CHECKIN_ENABLED: boolean (default true)`.
- `DAILY_CHECKIN_MORNING_LOCAL_HOUR: number (default 9)`.
- `DAILY_CHECKIN_EVENING_LOCAL_HOUR: number (default 18)`.
- `OPERATIONS_DASHBOARD_CACHE_TTL_SECONDS: number (default 300)`.

## 14. Связь с существующим кодом

- `backend/src/modules/conversational/` для отправки checkin prompt.
- `backend/src/modules/knowledge-core/specialists/` (паттерн).
- `backend/src/modules/probe/` для probe-events.
- `backend/src/common/graph/` для EntityLink.
- `backend/policies/policy.csv` — добавить роль coo.
- schema.prisma: DailyCheckIn (new), Goal (extend), Person (timezone field).

## 15. DoD

- [ ] 3 model изменения (DailyCheckIn new, Goal.parentGoalId, Person.timezone).
- [ ] 1 worker + 2 cron'а + 1 service работают.
- [ ] Goal cascade тестируется (completed children → parent completed).
- [ ] COO role в policy.csv.
- [ ] REST + 2 UI страницы.
- [ ] typecheck/lint/tests.
- [ ] Remove `.next\types`.

## 16. Тесты

- **unit:** `daily-checkin-prompt.cron.spec.ts` (TZ-фильтр).
- **unit:** `personal-relation-builder.worker.spec.ts`.
- **unit:** `operations-dashboard.service.spec.ts`.
- **unit:** `goal-cascade.spec.ts`.
- **integration:** checkin flow end-to-end (prompt → reply → parse → save).

## 17. Риски и mitigation

- **TZ некорректен** — default Europe/Moscow; person может править через `/me/settings`.
- **Checkin spam** — anti-spam: skip если уже completed today.
- **EntityLink дубли** — `@@unique([sourceEntityId, targetEntityId, relationType])` constraint.
- **Schema merge** — Goal/Person changes малы; кодер аккуратно.
- **`.next/types/` кэш** — Remove-Item.
