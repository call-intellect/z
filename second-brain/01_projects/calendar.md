---
title: Календарь / Events
status: MVP реализован (Фазы 1+2 завершены 2026-05-25)
owner: Sergey
---

# Календарь (Calendar MVP)

> **Назначение:** полноценный календарь поверх существующей модели Event графа знаний — события (встречи/созвоны/офлайн/блоки времени) с участниками, RSVP, напоминаниями и UI Day/Week/Month. Concierge-агент умеет создавать события, искать свободные слоты и отвечать «какие у меня сегодня встречи». Не путать с LiveKit-`Meeting` (видеовстреча), который остаётся отдельной media-сущностью и связывается через `Event.relatedMeetingId`.

**MVP границы:** ручной CRUD + Concierge-tools + 1-way ICS-feed (подписка извне). 2-way OAuth (Я.Календарь / Google / Outlook) и Motion-style auto-scheduler — Фаза 3, после валидации.

## Контекст и решения

- **Расширили существующую `Event`**, не плодили новую `CalendarEvent`. Каждое событие — узел графа знаний (`Entity{type=event}`); это базовый принцип «памяти компании».
- **`Event.visibility = company | team | personal`** (default `company`). `personal` создаёт Entity, но не индексируется в knowledge-core; чужой `personal` маскируется в `/users/:id/calendar` как «Занято» без деталей.
- **LiveKit `Meeting` — отдельная сущность.** Связь через `Event.relatedMeetingId`. При `kind=meeting` (онлайн-видео) сервис должен создавать `Meeting` через `MeetingsService`; в MVP оставлено TODO (универсального `create()` у `MeetingsService` пока нет — есть `createForUser`/`createFromCrossmark` с partner-контекстом).
- **Reminders — отдельная таблица `EventReminder`** + cron-sweep раз в минуту, доставка через `ConversationalService` (channel policy: `in_app + telegram_bot + max_bot`).
- **ICS-feed** — публичный endpoint с HMAC-токеном в URL. Один токен per user, хранится в `User.calendarFeedToken`.

## Модель данных

Расширения [Event](../../backend/prisma/schema.prisma) (Фаза 1.1, commit `800fdbd`):

| Поле | Тип | Назначение |
|---|---|---|
| `ownerId` | `String?` → `User` | Организатор. NULL только для AI-сгенерированных событий из транскриптов (legacy путь через `EntityResolutionService`). |
| `description` | `String?` | Текст-повестка. |
| `allDay` | `Boolean @default(false)` | Событие на весь день. |
| `timezone` | `String @default("Europe/Moscow")` | IANA-таймзона организатора. |
| `rrule` | `String?` | RFC-5545 RRULE. В MVP только пресеты `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY[;BYDAY=...]`. |
| `status` | `EventStatus @default(confirmed)` | `tentative` / `confirmed` / `cancelled`. |
| `visibility` | `EventVisibility @default(company)` | `company` / `team` / `personal`. |
| `externalProvider` | `String?` | Для Фазы 3: `google` / `outlook` / `ics_import`. |
| `externalEventId` | `String?` | ID у внешнего провайдера. |
| `projectId` | `String?` | Опц. привязка к Project трекера (для per-project Calendar view). |

Расширения `EventKind` enum: добавлены `call`, `offline_meeting`, `personal_block`, `deadline` (к существующим `meeting`/`incident`/`release`/`transition`/`milestone`/`other`).

Новые модели:

- **`EventParticipant`** — `{eventId, userId? | personId?, role: organizer|required|optional, rsvp: pending|accepted|declined|tentative, rsvpAt?}`. Один из (userId, personId) обязательно заполнен.
- **`EventReminder`** — `{eventId, offsetMin, channel: push|email|telegram, userId?, sentAt?}`. `userId=NULL` → всем участникам. Идемпотентность доставки через `sentAt`.

Новые enums: `EventStatus`, `EventVisibility`, `EventParticipantRole` (имя с префиксом, чтобы не пересекаться с существующим `ParticipantRole` host/guest у LiveKit), `RsvpStatus`, `ReminderChannel`.

Расширение `User`: `calendarFeedToken String? @db.VarChar(80)` + `ownedEvents Event[] @relation("EventOwner")` + `eventParticipations EventParticipant[]`.

## REST API

Все под `CookieAuthGuard + TenantGuard`, RBAC ресурс `event_card` (`owner/admin: read/write/delete`, `manager: read`), кроме явно публичного ICS-feed.

| Метод | Эндпоинт | RBAC | Описание |
|---|---|---|---|
| `GET` | `/api/v1/events?from=&to=&kind=&q=&page=&limit=` | `event_card.read` | Список (legacy от α-3) |
| `GET` | `/api/v1/events/:id` | `event_card.read` | Детали |
| `POST` | `/api/v1/events` | `event_card.write` | Создать; авто-Entity + участники + reminders + (TODO) LiveKit Meeting |
| `PATCH` | `/api/v1/events/:id` | `event_card.write` + owner/organizer | Обновить |
| `DELETE` | `/api/v1/events/:id` | `event_card.delete` + owner/organizer | Soft delete, статус `cancelled` |
| `POST` | `/api/v1/events/:id/rsvp` | participant only | `{status: accepted|declined|tentative}` |
| `POST` | `/api/v1/events/find-free-slot` | `event_card.read` | `{participantUserIds[], durationMin, withinDays?, workingHoursOnly?}` |
| `GET` | `/api/v1/me/calendar?from=&to=` | self (без чека) | Микс Event + Issue.dueDate |
| `GET` | `/api/v1/users/:userId/calendar?from=&to=` | self OR manager+ | То же для другого user; `personal` маскируются |
| `POST` | `/api/v1/me/calendar/feed/generate` | self | Выдаёт постоянную ссылку с HMAC-токеном |
| `DELETE` | `/api/v1/me/calendar/feed` | self | Обнуляет токен для перевыпуска |
| `GET` | `/api/v1/calendar/:userId.ics?token=` | публичный (token-check) | iCalendar 2.0, окно `[now-30д, now+90д]` |

Дефолтные `EventReminder` создаются автоматически для `kind ∈ {meeting, call, offline_meeting}`: за 15 минут и за 1 день до `startAt`, channel=`telegram`.

## Concierge tools (γ-2)

В [service-map-generator.service.ts](../../backend/src/modules/concierge/services/service-map-generator.service.ts) (Фаза 1.3) — 5 новых tools (всего whitelist стал 11):

| Tool | RBAC | Использование |
|---|---|---|
| `create_event` | `event_card.write` | «запиши встречу с N на 3-е», «забронируй мне время» |
| `list_my_events` | `event_card.read` | «какие у меня встречи сегодня» |
| `list_user_events` | `event_card.read` | «что у Васи на этой неделе» (personal → «Занято») |
| `find_free_slot` | `event_card.read` | «найди время на этой неделе для созвона с Васей на час» |
| `delete_event` | `event_card.delete` | «отмени встречу с N»; `create_event.undoableVia = delete_event` |

## Reminders pipeline

```
EventReminderSchedulerCron (@Cron('* * * * *'))
  → SELECT EventReminder WHERE sentAt IS NULL AND deletedAt IS NULL
                          AND (event.startAt - offsetMin*60s) <= now
                          AND event.startAt > now
                       LIMIT 200
  → enqueue в core.event-reminders (jobId = reminderId, идемпотентно)
      ↓
EventRemindersWorker (concurrency=4)
  → достаёт Event + участников
  → ConversationalService.sendNotification({eventType: 'event.reminder', ...})
      // channel policy: in_app + telegram_bot + max_bot (см. conversational.service.ts)
  → EventReminder.sentAt = now
```

Метрики (Prometheus):
- `calendar_events_created_total{tenant, kind, visibility}`
- `calendar_reminders_sent_total{tenant, channel, success}`
- `calendar_find_free_slot_total{tenant, found}`

Cardinality риск (известный, общий для tracker/calendar): label `tenant` напрямую. Миграция на top-N bucket — Sprint 7.

## Frontend

| Файл | Назначение |
|---|---|
| [calendar.api.ts](../../frontend/src/api/calendar.api.ts) | ApiDto + клиент (`getMyCalendar`, `getUserCalendar`, `createEvent`, `updateEvent`, `deleteEvent`, `rsvp`, `findFreeSlot`) |
| [domain/calendar.ts](../../frontend/src/domain/calendar.ts) | `CalendarEventDomain` / `CalendarIssueDomain` мапперы + словари меток и Tailwind-стилей по kind |
| [ui/calendar/CalendarView.tsx](../../frontend/src/ui/calendar/CalendarView.tsx) | Корневой компонент: Day/Week/Month переключатель, SWR, drag-n-drop с rollback, модалки |
| `ui/calendar/{Day,Week,Month}View.tsx` | Subviews. WeekView 7×17 (06-22, 30-мин сетка). MonthView 7×6, до 3 событий + «+ещё N». |
| [ui/calendar/EventForm.tsx](../../frontend/src/ui/calendar/EventForm.tsx) | Radix Dialog. Поля title/kind/startAt/endAt/location/description/visibility/participants. Валидация: длительность встречи ≥ 5 мин. |
| `ui/calendar/dateHelpers.ts` | startOf/endOf Day/Week/Month, форматирование на русском, расчёт позиции блока |
| [app/(authenticated)/me/calendar/page.tsx](../../frontend/app/(authenticated)/me/calendar/page.tsx) | Точка входа — `/me/calendar` |
| [app/(authenticated)/projects/[slug]/calendar/page.tsx](../../frontend/app/(authenticated)/projects/[slug]/calendar/page.tsx) | Тот же `CalendarView` в `mode="project"` (замена заглушки «Sprint 4») |

Цветовая кодировка по `kind`: meeting=синий, call=зелёный, offline_meeting=оранжевый, personal_block=серый, deadline=красный. Issue показывается отдельной «дедлайн-плашкой» / точкой.

## Известные TODO

1. **LiveKit Meeting auto-create при `kind=meeting`** — у `MeetingsService` нет универсального `create()` (только partner-контексты). Сейчас просто логируется. Когда появится — сразу подключить.
2. **Cancel связанного Meeting при softDelete Event** — аналогично.
3. **push/email доставка reminders** — стоят заглушки с TODO. Telegram-доставка работает через `ConversationalService` уже.
4. **projectId-фильтр в `/me/calendar`** — пока клиентский (CalendarView фильтрует items). Когда добавим `?projectId=` в `MyCalendarQuerySchema` — переключить на серверный.
5. **EventForm.participants** — MVP принимает userId через запятую. Поиск по имени/email — после подключения каталога пользователей в UI.
6. **Полный RFC-5545 RRULE** (BYSETPOS, EXDATE) — Фаза 3.
7. **2-way OAuth Я.Календарь / Google / Outlook** — Фаза 3 после валидации.
8. **Motion-style autoscheduler** — Фаза 3 после валидации.
9. **UI не тестировался в браузере** в этой сессии (нет MCP playwright). Golden path задокументирован, typecheck/lint чистые.

## Связи

- [tracker](tracker.md) — `Issue.dueDate` микшируется с Events в `/me/calendar`; per-project Calendar view заменил заглушку Sprint 4
- [concierge-voice](concierge-voice.md) — Concierge AI-агент получил 5 новых tools для календаря
- [conversational-channels](conversational-channels.md) — доставка reminders через `event.reminder` notification (registry + policy)
- [knowledge-core](../02_architecture/knowledge-core.md) — Events с `visibility != personal` индексируются как Entity{type=event} (legacy путь через `EntityResolutionService`)
- LiveKit `Meeting` — связь через `Event.relatedMeetingId` (TODO авто-создание из Event при kind=meeting)

## План реализации

- ТЗ: [`plans/tz/2026-05-25-calendar-mvp.md`](../../plans/tz/2026-05-25-calendar-mvp.md) — три фазы (1+2 закрыты).
- Коммиты: `800fdbd` (Фаза 1 — backend), `6e5fd62` (Фаза 2 — UI+ICS).
- Тесты: 25 unit + integration в `backend/src/modules/events/*.spec.ts` (events.service: 11, find-free-slot: 5, ics-feed: 9). Service-map-generator: 11/11. typecheck backend+frontend: 0 ошибок.
