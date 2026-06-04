> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 100%.**
> Фазы 1 и 2 реализованы целиком и подтверждены кодом (Prisma-модели, 11 эндпоинтов, 5 Concierge-tools, cron+worker+очередь, ICS-feed, find-free-slot, frontend Day/Week/Month/EventForm, тесты) и тремя коммитами. Фаза 3 соз
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`

# Календарь MVP — расширение модуля Events + Concierge tools

**Дата:** 2026-05-25
**Статус:** в работе
**Срок:** Фазы 1+2 за одну оркестрационную сессию
**Owner:** Sergey (sergrv80)
**Orchestrator:** Claude

## Контекст и цели

Сейчас в Z нет полноценного календаря: задачи трекера имеют `dueDate`, но нет понятия «встреча/созвон/блок времени», нет UI календарного представления, нет доступа Concierge к датам встреч. Страница [projects/[slug]/calendar/page.tsx](../../frontend/app/(authenticated)/projects/[slug]/calendar/page.tsx) — заглушка «Sprint 4».

При этом фундамент частично есть:
- Модель `Event` ([schema.prisma:2614](../../backend/prisma/schema.prisma#L2614)) с `startAt/endAt/location/participantsPersonIds/relatedMeetingId`, привязана к графу знаний через `Entity{type=event}`.
- Модуль `events` с read-only API (`GET /api/v1/events`, `GET /api/v1/events/:id`) и RBAC ресурсом `event_card`.
- RBAC-политики `event_card.write/delete` для owner/admin уже в [policy.csv:344-350](../../backend/src/modules/rbac/policies/policy.csv#L344).
- `HolidayCalendar` РФ.
- Concierge с tool-use инфраструктурой ([service-map-generator.service.ts](../../backend/src/modules/concierge/services/service-map-generator.service.ts)) — но без календарных tools.

**Цель MVP:** пользователь говорит Concierge «запиши встречу с N 3-го в 15:00» → событие создано → «какие у меня сегодня встречи» → возвращает список. Плюс UI календарного представления и подписка на ICS-feed (формат iCalendar) для импорта в Я.Календарь/Google/Outlook.

## Архитектурные решения (зафиксировано)

1. **Расширяем существующую `Event`**, не плодим новую `CalendarEvent`. Каждое событие — узел графа знаний (= суть «памяти компании»).
2. **`Event.visibility: company | team | personal`** (default `company`). `personal` не индексируется в графе.
3. **LiveKit `Meeting` — отдельная сущность.** Связь через `Event.relatedMeetingId`. При `Event.kind=meeting` (онлайн-видео) авто-создаётся Meeting через MeetingsService.
4. **Доступ Concierge** — через RBAC `event_card.read` + проверка `visibility` + участники события всегда видят детали.
5. **Reminders** — отдельная таблица `EventReminder`, доставка через push + Telegram.
6. **Внешний синк** — только ICS-подписка (1-way) в MVP. 2-way OAuth — фаза 3 после валидации.

## Impact list

**Прямые изменения:**
- `backend/prisma/schema.prisma` — расширить `Event`, новые `EventParticipant`, `EventReminder`
- `backend/src/modules/events/*` — write-логика, контроллеры, DTO, ICS-feed, воркер reminders
- `backend/src/modules/concierge/services/service-map-generator.service.ts` — +4 tool definitions
- `frontend/app/(authenticated)/me/calendar/page.tsx` — новая страница
- `frontend/src/ui/calendar/*` — компоненты Day/Week/Month/EventForm
- `frontend/src/api/calendar.api.ts` + `frontend/src/domain/calendar.ts` — API client + domain
- `frontend/app/(authenticated)/projects/[slug]/calendar/page.tsx` — замена заглушки

**Косвенные (second-brain после Фаз):**
- `02_architecture/data-model.md` — Event/EventParticipant/EventReminder
- `01_projects/api-layer.md` — новые эндпоинты
- `01_projects/frontend-pages.md` — /me/calendar
- `01_projects/workers-queues.md` — event-reminders worker
- `01_projects/concierge.md` (создать если нет) — 4 новых tools

**Затронутые слои:** backend API, frontend UI, DB schema (db push), BullMQ queue, reminders/cron. LiveKit/Egress/AI-prompts — не затрагиваются.

---

## Фаза 1 — фундамент (backend + Concierge)

### 1.1. Расширение Prisma-схемы

Расширить `Event`:
- `ownerId String` (FK на User, required) — организатор
- `description String? @db.Text`
- `endAt` — уже есть, **сделать обязательным для kind != personal_block/deadline** (через app-валидацию, не на уровне БД)
- `allDay Boolean @default(false)`
- `timezone String @default("Europe/Moscow") @db.VarChar(64)`
- `rrule String?` — RFC-5545 (в MVP только пресеты, см. ниже)
- `status EventStatus @default(confirmed)` — enum `tentative|confirmed|cancelled`
- `visibility EventVisibility @default(company)` — enum `company|team|personal`
- `externalProvider String?` — `google|outlook|ics_import` (для Фазы 3)
- `externalEventId String?`
- `projectId String?` — опц. привязка к Project трекера (для per-project Calendar view)
- Расширить `EventKind` enum: добавить `call`, `offline_meeting`, `personal_block`, `deadline`

Новая таблица `EventParticipant`:
```
model EventParticipant {
  id        String          @id @default(cuid())
  eventId   String
  event     Event           @relation(fields: [eventId], references: [id], onDelete: Cascade)
  userId    String?         // если приглашён существующий пользователь
  personId  String?         // если приглашён Person (external контакт)
  role      ParticipantRole @default(required) // organizer|required|optional
  rsvp      RsvpStatus      @default(pending)  // pending|accepted|declined|tentative
  rsvpAt    DateTime?
  createdAt DateTime        @default(now())

  @@index([eventId])
  @@index([userId])
  @@index([personId])
}
```

Новая таблица `EventReminder`:
```
model EventReminder {
  id        String           @id @default(cuid())
  eventId   String
  event     Event            @relation(fields: [eventId], references: [id], onDelete: Cascade)
  offsetMin Int              // за сколько минут до startAt
  channel   ReminderChannel  // push|email|telegram
  userId    String?          // null = всем участникам
  sentAt    DateTime?        // null = не отправлен
  createdAt DateTime         @default(now())

  @@index([eventId])
  @@index([sentAt])
}
```

**Команда применения:** `bun run prisma:push && bun run prisma:generate` (никаких migrate — см. skill `prisma-db-push-rules`).

**RRule в MVP — только пресеты** (хранятся как RFC-5545 строки):
- `FREQ=DAILY` — каждый день
- `FREQ=WEEKLY` — каждую неделю
- `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` — по будням
- `FREQ=MONTHLY` — каждый месяц
- `FREQ=YEARLY` — каждый год

Парсер полного RRULE — фаза 3.

### 1.2. REST API (CRUD + RSVP + /me/calendar)

Расширить [events.controller.ts](../../backend/src/modules/events/events.controller.ts):

| Метод | Эндпоинт | Доступ |
|---|---|---|
| `POST` | `/api/v1/events` | `event_card.write` |
| `PATCH` | `/api/v1/events/:id` | `event_card.write` + owner OR organizer |
| `DELETE` | `/api/v1/events/:id` | `event_card.delete` + owner OR organizer (soft-delete) |
| `POST` | `/api/v1/events/:id/rsvp` | participant only |
| `GET` | `/api/v1/me/calendar?from=&to=` | свой user — без RBAC чека |
| `GET` | `/api/v1/users/:userId/calendar?from=&to=` | manager+ OR self |

`/me/calendar` возвращает микшированный список `{ events: Event[], issues: Issue[] }`:
- `events` — где user в `participants` ИЛИ `ownerId=user` ИЛИ `visibility=company`.
- `issues` — где `assigneeId=user`, `dueDate BETWEEN from AND to`.

DTO в [events.dto.ts](../../backend/src/modules/events/dto/events.dto.ts):
- `CreateEventSchema` — title, startAt, endAt?, kind, visibility?, location?, description?, participants?, reminders?, rrule?, projectId?
- `UpdateEventSchema` — partial всех полей
- `RsvpSchema` — status enum
- `CalendarItemDto` — union тип `{ type: 'event' | 'issue', ... }`

При создании Event с `kind=meeting` (онлайн-видео) сервис автоматически создаёт LiveKit `Meeting` через `MeetingsService.create()` и сохраняет id в `Event.relatedMeetingId`.

При создании Event переиспользовать `EntityResolutionService` для создания `Entity{type=event}` — см. `entity-resolution.service.ts:504-523`. Для `visibility=personal` создаём Entity, но не эмитим RawEvent в knowledge-core (не засоряем граф).

### 1.3. Concierge tools

Добавить в [service-map-generator.service.ts](../../backend/src/modules/concierge/services/service-map-generator.service.ts):

```
{
  name: 'create_event',
  description: 'Создать событие календаря (встреча, созвон, блок времени). Используй для запросов «запиши встречу с N на 3-е», «забронируй мне время».',
  method: 'POST',
  path: '/api/v1/events',
  parameters: { title, startAt, endAt?, kind?, participants?, location?, visibility? },
  required: ['title', 'startAt'],
  rbacResource: 'event_card', rbacAction: 'write',
  undoableVia: 'delete_event',
},
{
  name: 'list_my_events',
  description: 'Получить мои события календаря в диапазоне дат. Используй для «какие у меня встречи сегодня», «что у меня на этой неделе».',
  method: 'GET',
  path: '/api/v1/me/calendar',
  parameters: { from?, to? },  // default = сегодня 00:00 — завтра 00:00
  rbacResource: 'event_card', rbacAction: 'read',
},
{
  name: 'list_user_events',
  description: 'Получить события календаря другого пользователя по userId. Требует прав manager+ или быть участником события. Используй для «что у Васи на этой неделе».',
  method: 'GET',
  path: '/api/v1/users/:userId/calendar',
  parameters: { userId, from?, to? },
  required: ['userId'],
  rbacResource: 'event_card', rbacAction: 'read',
},
{
  name: 'find_free_slot',
  description: 'Найти ближайший общий свободный слот заданной длительности среди участников. Используй для «найди время на этой неделе на час с N».',
  method: 'POST',
  path: '/api/v1/events/find-free-slot',
  parameters: { participantUserIds: string[], durationMin: number, withinDays?: number, workingHoursOnly?: boolean },
  required: ['participantUserIds', 'durationMin'],
  rbacResource: 'event_card', rbacAction: 'read',
},
{
  name: 'delete_event',
  description: 'Отменить (мягко удалить) событие по id.',
  method: 'DELETE',
  path: '/api/v1/events/:id',
  parameters: { id },
  required: ['id'],
  rbacResource: 'event_card', rbacAction: 'delete',
}
```

`find_free_slot` алгоритм: для каждого пользователя получить busy-окна за `withinDays` (из `Event.participants` где user участвует + `Issue.dueDate` с `estimateMinutes`), пересечь свободные интервалы, вернуть первый длиной ≥ `durationMin`. По умолчанию учитывать только рабочее время Пн-Пт 9-18 в timezone организатора.

### 1.4. Reminders worker

- Очередь BullMQ `event-reminders` (`backend/src/modules/core-queue/queues.ts` — добавить константу).
- Cron `EventReminderSchedulerCron @Cron('* * * * *')` — каждую минуту сканирует `EventReminder where sentAt IS NULL AND eventStartAt - offsetMin <= now` и пушит в очередь.
- Worker `event-reminders.worker.ts` — для каждого `userId`:
  - Если `channel=telegram` — `ConversationalService.sendNotification({ eventType: 'event.reminder' })` (наш Telegram-бот).
  - Если `channel=push` — `PushService` (если есть).
  - Если `channel=email` — `MailService`.
  - После доставки `EventReminder.sentAt = now`.
- Дефолтные reminders при создании Event: за 15 минут + за 1 день через `kind=meeting/call/offline_meeting`.

### 1.5. Тесты (Vitest)

- `events.service.spec.ts` — create/update/delete + RSVP + visibility (personal не виден другим).
- `calendar.service.spec.ts` — `/me/calendar` микширует Event + Issue.
- `find-free-slot.service.spec.ts` — несколько пользователей, busy-окна, working hours.
- `event-reminders.worker.spec.ts` — доставка по каналам + idempotency (sentAt).
- `tool-router.spec.ts` (расширить) — 4 новых tool работают через loopback.

### DoD Фазы 1
- [ ] `bunx prisma db push` прошёл без ошибок, `bunx prisma generate` обновил типы
- [ ] `cd backend && bunx tsc --noEmit` — 0 ошибок
- [ ] `cd backend && bun run lint` — 0 ошибок
- [ ] `cd backend && bun run build` — успех
- [ ] Unit/integration тесты выше — зелёные
- [ ] Swagger в `/api/docs` показывает новые эндпоинты
- [ ] Smoke: создать Event через `POST /api/v1/events` → виден в `GET /me/calendar` → удалить
- [ ] Concierge smoke: «создай встречу с testuser завтра в 15:00» → возвращает id события

---

## Фаза 2 — UI + ICS

### 2.1. Глобальный календарь /me/calendar

Новые файлы:
- `frontend/app/(authenticated)/me/calendar/page.tsx` — точка входа
- `frontend/src/ui/calendar/CalendarView.tsx` — main shell с переключателем Day/Week/Month
- `frontend/src/ui/calendar/DayView.tsx`, `WeekView.tsx`, `MonthView.tsx`
- `frontend/src/ui/calendar/EventForm.tsx` — модалка создания/правки
- `frontend/src/api/calendar.api.ts` — `getMyCalendar`, `createEvent`, `updateEvent`, `deleteEvent`, `rsvp`
- `frontend/src/domain/calendar.ts` — ApiDto → DomainModel мапперы

Требования (по skill `frontend-rules`):
- Слои `ApiDto → DomainModel → UiModel`
- Единый `apiClient`
- SWR для data-fetching
- Все строки на русском (skill `admin_ui_russian_only`)
- Drag-n-drop для reschedule — через `react-dnd` (если уже в зависимостях) или нативный HTML5 DnD
- Микширование Issue + Event в одной таймлайне — у Issue показываем дедлайн как «точку», у Event — блок `startAt-endAt`

### 2.2. ICS-подписка

- `backend/src/modules/events/ics-feed.controller.ts` — публичный (без `CookieAuthGuard`) `GET /api/v1/calendar/:userId.ics?token=<hmac>`
- Токен — HMAC от `(userId, secret)`, генерируется один раз на user в `User.calendarFeedToken` (новое поле). Кнопка «Сгенерировать ссылку» в `/me/settings/calendar`.
- Возвращает iCalendar 2.0 (BEGIN:VCALENDAR/VEVENT) со всеми Event + Issue.dueDate где user участвует/назначен, за окно `[-30d, +90d]`.
- Headers: `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`.

### 2.3. Замена заглушки /projects/[slug]/calendar

- Использовать тот же компонент `CalendarView`, передать `projectFilter={projectSlug}`.
- API дернёт `GET /api/v1/events?projectId=...&from=&to=` + `GET /api/v1/projects/:slug/issues?dueFrom=&dueTo=`.

### DoD Фазы 2
- [ ] `cd frontend && bun run typecheck` — 0 ошибок
- [ ] `cd frontend && bun run lint` — 0 ошибок
- [ ] `cd frontend && bun run build` — успех
- [ ] `/me/calendar` рендерится: видны мои Issue (по dueDate) и Event (по startAt)
- [ ] Создание Event через EventForm → событие появляется в календаре
- [ ] Drag Event на другой день → PATCH прошёл, событие переместилось
- [ ] `/api/v1/calendar/<userId>.ics?token=...` отдаёт валидный iCalendar (проверка через `ical.js` или подпиской в Я.Календарь)
- [ ] `/projects/[slug]/calendar` показывает только события/задачи проекта

---

## Фаза 3 — отложено

- 2-way OAuth Я.Календарь / Google / Outlook.
- Motion-style auto-scheduler.
- Полный RFC-5545 RRULE (BYSETPOS, EXDATE и т.п.).
- Push-уведомления через service worker (если push ещё не реализован).

Активируется по запросу пользователя после валидации MVP.

---

## Журнал работы

_(заполняется оркестратором по мере выполнения)_

- 2026-05-25: план создан.
