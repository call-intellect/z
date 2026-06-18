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

Закрыто в Polish (commit `5c4c6c1`, 2026-05-25):
- ✅ LiveKit Meeting auto-create при `kind=meeting` через `MeetingsService.createForCalendarEvent`, joinUrl в EventDto, кнопка «Войти во встречу» в EventForm.
- ✅ Cancel связанного Meeting при softDelete Event через `cancelScheduledForCalendarEvent`.
- ✅ Email-канал доставки reminders через `MailService.sendPlain` (русские склонения времени, fallback в text/plain).
- ✅ Серверный `?projectId=` фильтр в `/me/calendar` и `/users/:id/calendar`, клиентская фильтрация снята.
- ✅ EventForm.participants → `ParticipantPicker` (4 сценария: коллега / контакт / свободный ввод / пусто).

Осталось:

1. **Push-уведомления** в браузере — заглушка с TODO. Push требует service worker, отложено. Email + Telegram перекрывают MVP.
2. **Полный RFC-5545 RRULE** (BYSETPOS, EXDATE) — Фаза 3.
3. **2-way OAuth Я.Календарь / Google / Outlook** — детальный план в [calendar-external-sync.md](../../plans/tz/2026-05-25-calendar-external-sync.md), 17-22 дня на F1-F4.
4. **Motion-style autoscheduler** — Фаза 3 после валидации спроса.
5. **UI не тестировался в браузере** в сессиях (нет MCP playwright). Golden path задокументирован, typecheck/lint чистые.
6. **EventForm edit-режим не показывает participants** — `CalendarEventDomain.participants[]` приходит только id-ами без `name`, ParticipantPicker требует `{type, id, name}`. Решение: либо enrich EventDto именами участников, либо отдельный fetch.
7. **Egress stop при cancel активной LiveKit-встречи** — `cancelScheduledForCalendarEvent` пишет warn и полагается на webhook `room_finished` для остановки Egress. Альтернативы: добавить `actorUserId` в контракт или `RecordingsService.forceStopByMeetingId()` без owner-check.
8. **joinUrl без JWT-токена** — `{publicFrontendUrl}/m/{id}` без deep-link токена. Для внешних guest'ов через email-рассылку — нужен JWT с TTL≥недели. Сейчас работает только для аутентифицированных через cookie.

## Связи

- [tracker](tracker.md) — `Issue.dueDate` микшируется с Events в `/me/calendar`; per-project Calendar view заменил заглушку Sprint 4
- [concierge-agent](concierge-agent.md) — Concierge AI-агент получил 5 новых tools для календаря
- [conversational-channels](conversational-channels.md) — доставка reminders через `event.reminder` notification (registry + policy)
- [knowledge-core](../02_architecture/knowledge-core.md) — Events с `visibility != personal` индексируются как Entity{type=event} (legacy путь через `EntityResolutionService`)
- LiveKit `Meeting` — связь через `Event.relatedMeetingId` (TODO авто-создание из Event при kind=meeting)

## Дополнения от Polish (2026-05-25, commit `5c4c6c1`)

**Новые backend endpoints:**

| Метод | Эндпоинт | RBAC | Описание |
|---|---|---|---|
| `GET` | `/api/v1/org-members/search?q=&limit=` | авторизованный member | Поиск User+Person по имени/email в Org, dedup, сортировка |
| `POST` | `/api/v1/persons/quick-create` | `event_card.write` | Создать Person с relationship=external (dedup по email/name) |

**Новые методы MeetingsService:**
- `createForCalendarEvent({tenantId, ownerUserId, title, scheduledFor, eventId})` → `{meetingId, joinUrl}` — универсальный конструктор Meeting под календарное событие (нет partner-контекста).
- `cancelScheduledForCalendarEvent({meetingId, reason})` — soft-delete + failureReason, идемпотентен.

**Новый общий UI-компонент:** [ParticipantPicker.tsx](../../frontend/src/ui/shared/ParticipantPicker.tsx) — переиспользуем для трекера/прав доступа/чатов в будущем.

## Доработки 2026-06-18 (помощник × календарь)

**Источник:** ТЗ [`plans/tz/2026-06-18-assistant-calendar-master.md`](../../plans/tz/2026-06-18-assistant-calendar-master.md) (8 фаз, ветка `feature/assistant-calendar-fixes`, коммиты `25e316d6..00a9858a`). Миграция `20260618120000_person_work_profile_event_online_counterparty`. Схема/поля — [[../02_architecture/data-model]]; эндпоинты — [[api-layer]]; UI — [[frontend-pages]].

**Онлайн-формат развязан с `kind` (Ф6).** Новое поле **`Event.online Boolean @default(false)`** — именно оно теперь определяет создание видеокомнаты LiveKit (раньше комната создавалась по `kind==='meeting'`). Идемпотентный перевод офлайн→онлайн:
- `POST /api/v1/events/:id/make-online` → `EventsService.makeEventOnline` (создаёт/привязывает Meeting через общий `attachLivekitRoom`, DRY с путём создания).
- Инструмент помощника `make_event_online`.
- Маппер `frontend/src/domain/calendar.ts`: `isOnline = api.online` (раньше выводился из `kind`).

**Контрагент vs место (Ф5).** Новое поле **`Event.counterparty String? @db.VarChar(300)`** — «с кем / какая компания», **отдельно** от `location` (физическое место). Правило закреплено в описании инструмента `create_event`. В `EventForm` — отдельное поле «Клиент/контрагент».

**Окно дня и `find_free_slot` в таймзоне человека (Ф2/Ф3).** Помощник считает «сегодня»/«на неделе» по локальным суткам человека: таймзона по цепочке `Person.timezone → Org.timezone → Europe/Moscow`. `resolveCalendarWindow(from,to,timezone)` + `find_free_slot` берёт рабочие часы из `Person.workStartHour/workEndHour/workingDays` (дефолты — `AdminSetting work_hours_default_*` / `work_days_default`); `create_event` по умолчанию ставит таймзону организатора. Утилиты — `operations/utils/local-date.ts`.

**Рабочий профиль человека (Ф4).** Новые поля `Person.workStartHour Int?` / `workEndHour Int?` / `workingDays Int[] @default([])` (0=вс..6=сб). Управление — `GET/PATCH /api/v1/me/work-profile` (UI «Настройки → Профиль → Рабочее время», `WorkProfileSection`) и инструмент `set_my_work_profile`; когда `Person.timezone` пуст — помощник проактивно спрашивает таймзону. Seed дефолтов — `seed-admin-setting-work-hours.ts`.

**Различение list-инструментов (Ф7).** В `service-map-generator.service.ts` уточнены описания: `list_meetings` — журнал встреч **без фильтра даты**; `list_my_events` — события **календаря/сегодня в TZ**.

**Приём входящих помощника (Ф1).** Дедуп Telegram `update_id` / MAX `mid` + ранний ACK через очередь `assistant.inbound` — см. [[conversational-channels]] §«Дедуп входящих + ранний ACK» и [[workers-queues]].

## План реализации

- Базовый ТЗ: [`plans/archive/2026-05-25-calendar-mvp.md`](../../plans/archive/2026-05-25-calendar-mvp.md) — три фазы (1+2 закрыты).
- Polish ТЗ: [`plans/archive/2026-05-25-calendar-mvp-polish.md`](../../plans/archive/2026-05-25-calendar-mvp-polish.md) — 4 фазы (P1-P4) закрыты.
- External sync ТЗ: [`plans/tz/2026-05-25-calendar-external-sync.md`](../../plans/tz/2026-05-25-calendar-external-sync.md) — F1-F4 для интеграций (планируется).
- Коммиты: `800fdbd` (Фаза 1 — backend), `6e5fd62` (Фаза 2 — UI+ICS), `13b6a66` (second-brain), `5c4c6c1` (Polish P1-P4).
- Тесты: 63 unit + integration зелёных (+1 skipped) в events/persons/org-members/meetings, frontend typecheck 0.
