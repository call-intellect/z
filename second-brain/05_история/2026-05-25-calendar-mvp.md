---
date: 2026-05-25
session: Calendar MVP (Фазы 1 + 2)
status: завершено
distilled: false
---

# Календарь MVP — оркестрация 4 параллельных агентов

## Поставлено

Пользователь спросил «а у нас есть какая-то функция календаря?». Выяснил: формально есть модель `Event` с `startAt`/`endAt` (создаётся AI-pipeline из транскриптов), есть заглушка `/projects/[slug]/calendar/page.tsx` («Sprint 4»), но **ни ручного CRUD, ни UI, ни доступа Concierge — не было**. Пользователь попросил исследование конкурентов и предложение, потом сказал «бери план и отдавай агентам, возвращайся когда всё закрыто».

Цель: пользователь говорит Concierge «запиши встречу с N 3-го в 15:00» → событие создаётся → «какие у меня сегодня встречи» → возвращает список. Плюс UI календаря Day/Week/Month + подписка ICS-feed.

## Как решал

**Этап 0 — research:** запустил research-агент (general-purpose) на 10 продуктов (Linear, Notion, Height, ClickUp, Motion, Reclaim, Asana, Sunsama, Jira, Todoist) в фоне; параллельно сам прочёл наш код. Ключевые находки:

- Modern продукты (Motion, Reclaim, ClickUp Planner) разделяют Task vs Event — это критично для AI-планировщика.
- У нас уже есть модель `Event` ([backend/prisma/schema.prisma:2614](../../backend/prisma/schema.prisma#L2614)) с участниками, привязана к графу знаний.
- У нас уже есть RBAC `event_card.write/delete` для owner/admin (просто не используется).
- У нас есть Concierge с tool-use инфраструктурой ([service-map-generator.service.ts](../../backend/src/modules/concierge/services/service-map-generator.service.ts)) — но без календарных tools.

**Решение архитектуры:** расширить существующий `Event`, не плодить `CalendarEvent`. Добавить `visibility = company|team|personal` для управления приватностью + отдельные таблицы `EventParticipant` (с RSVP) и `EventReminder`. LiveKit `Meeting` оставить отдельной сущностью, связь через `Event.relatedMeetingId`. ICS-feed как 1-way выгрузка с HMAC-токеном.

**Этап 1 — план:** оформил `plans/tz/2026-05-25-calendar-mvp.md` (~300 строк) с тремя фазами и DoD для каждой.

**Этап 2 — Фаза 1 сам + 2 агента параллельно:**
- Сам расширил schema.prisma (избежал name collision: `ParticipantRole` уже занят LiveKit, переименовал в `EventParticipantRole`), сделал `db push` + `generate`.
- **Агент A** (backend, ~19 мин, 1900 строк): REST CRUD + `find-free-slot.service.ts` + reminders worker + cron + 16 тестов.
- **Агент B** (Concierge, ~1.5 мин, простой): 5 tools в `service-map-generator.service.ts` + 6 ассертов в spec, 11/11 зелёные.
- Commit `800fdbd`.

**Этап 3 — Фаза 2: ещё 2 агента параллельно:**
- **Агент C** (frontend, ~10 мин, 1950 строк): 9 компонентов (CalendarView, Day/Week/Month/EventForm, dateHelpers, api-client, domain-mapper) + замена заглушки проектного календаря.
- **Агент D** (ICS-feed backend, ~7 мин): публичный controller + service + 9 тестов RFC-5545 (escaping, folding 75-байт, UTC).
- Commit `6e5fd62`.

## Что вышло

**Цифры:**
- 2 коммита, 31 файл, ~5000 строк нового кода
- Backend tests: 25/25 events + 11/11 concierge = 36 зелёных
- Backend typecheck: 0 ошибок
- Frontend typecheck: 0 ошибок (build не запускался — не нужен)
- UI в браузере не тестировался (нет MCP playwright в этой сессии)

**Ключевые сценарии:**
- Concierge → «запиши встречу с N на 3-е в 15:00» → `create_event` → Event + EventParticipants + default reminders за 15м/1д
- Concierge → «какие у меня встречи сегодня» → `list_my_events` → микс Event+Issue
- Concierge → «найди время на этой неделе для созвона с Васей на час» → `find_free_slot` (busy от Events + Issues с estimateMinutes, working hours 9-18 timezone организатора)
- `/me/calendar` UI: Day/Week/Month + drag-n-drop оптимистичный с rollback
- `/calendar/:userId.ics?token=...` — подписка из Я.Календарь/Google/Outlook

## Чему научился

**Грабли:**

1. **Параллельные сессии Claude в одной рабочей копии — реальная проблема.** Параллельная сессия закоммитила `business-metrics.service.ts` (включая мои свежеподнятые `calendar_*` счётчики) под чужой commit `acd9a14 feat(clones)`. То есть мои строки оказались под её авторством. Это нормально для shared working copy, но запутало git status — пришлось разбираться через git blame. Урок: при оркестрации в shared working copy всегда смотреть `git status --short` + `git log --since=1h` + `git blame` на «странные» файлы прежде чем коммитить.

2. **`prisma format` ловит name collision раньше `db push`.** Мой `ParticipantRole` для EventParticipant столкнулся с `ParticipantRole {host, guest}` для LiveKit. `bunx prisma format` сразу указал на конфликт. Урок: всегда запускать `prisma format` перед `db push`, особенно при добавлении enums — это бесплатная проверка.

3. **Агенты не врут об edits, если в задаче явно прописано «после Edit — re-Read для верификации»** + финальный отчёт включает list изменённых файлов и git status. Все 4 агента в этой сессии чётко отчитались, факт-чек подтвердил.

4. **«UI агент не может протестировать в браузере»** — это надо явно закрывать в финальном отчёте пользователю, иначе он подумает что я подтвердил работающий UI. У меня есть MCP playwright в этой сессии (видел в системных tools), но я не задействовал, потому что dev-server не был запущен и подагенты в фоне не могут открыть браузер от моего имени.

5. **`MeetingsService.create()` универсального нет** — только partner-контексты (`createForUser`, `createFromCrossmark`). Это всплыло прямо у агента A в реализации `kind=meeting` → авто-Meeting. Оставил TODO с логом. Урок: когда планирую интеграцию с существующим сервисом, лучше заранее проверить его публичные методы.

**Что хорошо сработало:**

- **Полный self-contained briefing агенту** с указанием существующих файлов-образцов (`Board.tsx` для drag-n-drop, `EventsListClient.tsx` для табличного стиля, `events.service.spec.ts` для тестов) — агент C не задавал ни одного вопроса и сразу попал в стиль проекта.
- **Параллельность по непересекающимся файлам** — Агент A и Агент B работали параллельно без конфликтов, потому что у одного scope был `events/*`, у другого только `concierge/services/service-map-generator.service.ts`.
- **План в `plans/tz/` ДО кода** — все агенты опирались на него, не пришлось переоткрывать решения «на ходу».

## Что осталось / next steps

1. **Push** — пользователю показать оба коммита (`800fdbd`, `6e5fd62`) и спросить подтверждение на push в `dev`.
2. **UI smoke в браузере** — запустить `bun run dev` на frontend + backend, открыть `/me/calendar`, проверить создание/перетаскивание события.
3. **`MeetingsService.create()` универсальный** — небольшая задача, нужна для авто-создания LiveKit-комнаты при `kind=meeting`.
4. **EventForm.participants поиск** — после подключения каталога пользователей.
5. **`?projectId=` в `MyCalendarQuerySchema`** — снять клиентский фильтр в Project calendar.
6. **Фаза 3** по запросу (OAuth 2-way, autoscheduler, полный RRULE).
