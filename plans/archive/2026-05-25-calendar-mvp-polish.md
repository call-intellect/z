# Calendar MVP Polish — добор недоделок Фаз 1-2

**Дата:** 2026-05-25
**Статус:** черновик, ждёт подтверждения по §5
**Срок:** 1 человеко-неделя
**Owner:** Sergey
**Базовый план:** [plans/tz/2026-05-25-calendar-mvp.md](2026-05-25-calendar-mvp.md) (Фазы 1+2 закрыты в commit'ах `800fdbd` / `6e5fd62` / `13b6a66`)

## Контекст

После Фаз 1-2 у нас работает базовый календарь: CRUD событий, 5 Concierge tools, UI Day/Week/Month, ICS-feed. Но 4 функциональных пробела не дают MVP считаться «целостным»:

1. При `kind=meeting` (онлайн-видео) **не создаётся LiveKit-комната**, при удалении события — **не отменяется**. Заглушка с логом, без работы в проде.
2. Reminders уходят **только в Telegram**. Email-канал не подключён.
3. Per-project Calendar view **фильтрует на клиенте**, грузит лишние события.
4. EventForm.participants требует **внутренний userId через запятую** — UI фактически непригоден без программистского контекста.

Все 4 — простые задачи, которые целиком закрывают MVP «можно отдавать пользователю».

## Фазы

### Фаза P1 — LiveKit Meeting auto-create/cancel

**Проблема:** при `POST /api/v1/events` с `kind=meeting` сервис должен создать LiveKit-комнату и записать её id в `Event.relatedMeetingId`. Сейчас стоит заглушка с логом `TODO: создание LiveKit Meeting...`, потому что `MeetingsService` имеет только partner-bound методы (`createForUser`, `createFromCrossmark`). При `DELETE` Event — связанная комната не отменяется.

**Решение:**
1. Добавить в `MeetingsService` метод `createForCalendarEvent({tenantId, ownerUserId, title, scheduledFor: Date, eventId: string}): Promise<{meetingId: string, joinUrl: string}>`:
   - Создаёт Meeting со статусом `scheduled`, `ownerId=ownerUserId`, `tenantId`, type=`other` (или новый type `calendar_event`).
   - Возвращает meetingId + публичный joinUrl (для рассылки участникам).
2. Добавить `MeetingsService.cancelScheduled({meetingId, reason: 'event_deleted'}): Promise<void>`:
   - Soft-delete Meeting (`status=cancelled`), помечает причину в audit.
   - Если запись Egress активна — останавливает (защита от ghost-комнаты).
3. В `EventsService.create()` при `kind=meeting` (и `kind=call`, если хочется генерации видеоссылки) — вызвать `createForCalendarEvent`, записать `relatedMeetingId` в Event.
4. В `EventsService.softDelete()` при `event.relatedMeetingId != null` — вызвать `cancelScheduled`.
5. Возвращать `joinUrl` в EventDto (новое поле). UI показывает кнопку «Войти в видеовстречу» когда `joinUrl != null`.

**Тесты:** unit на `createForCalendarEvent` (Meeting создаётся с правильным статусом + tenant) + integration на event create with `kind=meeting` → Meeting есть в БД, joinUrl возвращается.

**Время:** 2-3 часа.

### Фаза P2 — Email-канал для reminders

**Проблема:** `EventRemindersWorker` уважает только `channel=telegram` (через `ConversationalService`). `channel=email` и `channel=push` — заглушки с TODO. Email — реальный канал для большой части аудитории (нет Telegram у клиентов, корп. правила).

**Решение:**
1. `EventRemindersWorker` для `channel=email`:
   - Получить email участника (из `User.email` или `Person.email`).
   - Сформировать письмо: тема «Напоминание: {event.title} через {N мин/часов}», тело — title + startAt в локальной TZ + location + кнопка-ссылка на `/events/{id}`.
   - Отправить через существующий `MailService` (найди модуль `mail` или подобный, см. backend/src/modules/).
   - Дождаться `messageId`, записать в `EventReminder.metadata.emailMessageId` (новое поле в EventReminder? Возможно использовать существующее поле, или добавить generic `metadata Json?`).
2. Учитывать, что у пользователя может быть отключён email-канал глобально (`ChannelBinding` / preferences) — пропускать с метрикой.
3. Channel policy в `conversational.service.ts` для `event.reminder` оставить как было (`in_app + telegram_bot + max_bot`); добавить опцию доставки email **как явный параметр** в EventReminder, не через policy (потому что reminders создаются с явным `channel`-полем).

**Тесты:** reminder с `channel=email` → MailService.send вызван с правильным телом + recipient.

**Время:** 2-3 часа (если MailService есть и работает).

### Фаза P3 — ProjectId-фильтр на сервере

**Проблема:** `/projects/[slug]/calendar` фильтрует events/issues клиентски — загружает все события user'а и отсеивает по projectId в браузере.

**Решение:**
1. Расширить `MyCalendarQuerySchema` в [events.dto.ts](../../backend/src/modules/events/dto/events.dto.ts): `projectId: z.string().optional()`.
2. В `EventsService.getMyCalendar()` — если `projectId` задан, добавить `where.projectId = projectId` для Events и `where.projectId = projectId` для Issues.
3. В `frontend/src/api/calendar.api.ts` — `getMyCalendar(from, to, projectId?)`.
4. В `CalendarView.tsx` при `mode='project'` — передавать `projectSlug` в API, убрать клиентскую фильтрацию (TODO-комментарий).

**Время:** 1 час.

### Фаза P4 — ParticipantPicker (общий компонент выбора участника)

**Проблема:** EventForm.participants требует userId через запятую — нерабочий UX. Но также реальные события часто **не имеют участников из нашей Org**: «созвон с клиентом», «встреча с партнёром», «обед», «поход в больницу». Решение: компонент с поиском по имени из **трёх источников** + свободный ввод, переиспользуемый в трекере / правах доступа.

**Четыре сценария использования:**
1. **Без участников** — для `kind=personal_block` / `deadline` поле вообще скрывается; для `meeting`/`call`/`offline_meeting` — опционально (можно пустое: «созвон с клиентом» без указания кто именно).
2. **Коллега из Org** — выбор из `User` через поиск по имени → создаётся `EventParticipant { userId }`.
3. **Внешний контакт** — выбор из существующего `Person { relationship: 'external' }` (клиенты, партнёры) → `EventParticipant { personId }`.
4. **Свободный ввод** — «Иван Иванов из Спортмастера», без выбора из списка → автоматически создаём `Person { name, relationship: 'external', tenantId, email: null }` → `EventParticipant { personId }`.

**Backend:**
1. Новый эндпоинт `GET /api/v1/org-members/search?q=Иван&limit=10` — RBAC `event_card.read` (или общий `org_member.read` если хочешь):
   - Возвращает массив объединённых результатов:
     ```
     items: [
       { type: 'user', userId, name, email, primaryRole?, avatarUrl? },
       { type: 'person', personId, name, email?, relationship: 'external'|'employee', primaryDepartment? }
     ]
     ```
   - Поиск по `name LIKE %q%` OR `email LIKE %q%` в обеих таблицах (`User`+`Membership` для tenant + `Person` для tenant).
   - Сортировка: точное совпадение начала имени → User'ы выше Person'ов (коллеги приоритетнее) → по алфавиту.
   - Limit ≤ 20.
2. Новый эндпоинт `POST /api/v1/persons/quick-create` — для свободного ввода:
   - Тело: `{ name: string, email?: string, phone?: string }`.
   - Создаёт `Person { name, email?, relationship: 'external', tenantId }` (минимальный набор).
   - Дубль-защита: если в Org уже есть Person с таким email или (name + пустой email) — возвращает существующий вместо создания нового.
   - Возвращает `{ personId, name, email }`.
3. RBAC: любой авторизованный member своей Org может искать (нет sensitive данных, кроме email). Quick-create требует `event_card.write` (раз использовали при создании события).

**Frontend:**
4. Новый общий компонент `frontend/src/ui/shared/ParticipantPicker.tsx`:
   - Radix Combobox (или Popover + Input + список).
   - Принимает `value: ParticipantPickerItem[]` (`{type: 'user', userId, name} | {type: 'person', personId, name}`) + `onChange`. Multi-select.
   - Debounce 250мс на ввод → `orgMembersApi.search(q)`.
   - SWR-кэш по `q` (TTL 60с).
   - Рендерит chips (выбранные с иконкой 👤 для user / ◯ для external) + input для добавления + dropdown с результатами + последним пунктом всегда «➕ Добавить «{введённый текст}» как внешний контакт» (если q.length >= 2 и нет точного совпадения) → вызывает `personsApi.quickCreate({name: q})` → добавляет в выбранные.
5. Встроить `ParticipantPicker` в `EventForm`:
   - Поле «Участники» — `ParticipantPicker` вместо строки.
   - Прячется когда `kind ∈ {personal_block, deadline}`.
   - Опционально для остальных `kind` (можно не заполнять).
6. **(Опционально)** Встроить в `IssueForm` трекера для assignee/subscribers. Если уже есть `AssigneeAvatar` с собственным select — оставить, не трогать (это отдельная задача). Если хочется минимизировать — пропустить, оставить TODO.

**Тесты:**
- backend: unit на org-members-search возвращает оба type'а, quick-create dedup'ит по email.
- frontend: компонент рендерит результаты, свободный ввод создаёт Person, multi-select работает.
- integration: EventForm создаёт событие с миксом userId+personId участников.

**Время:** 5-7 часов (расширилось с 4-6 из-за trех источников + quick-create).

## Impact list

**Прямые изменения:**
- `backend/src/modules/meetings/services/meetings.service.ts` — новые методы `createForCalendarEvent` / `cancelScheduled`
- `backend/src/modules/events/services/events.service.ts` — раскомментировать TODO для LiveKit + email-channel в worker
- `backend/src/modules/events/workers/event-reminders.worker.ts` — email branch
- `backend/src/modules/events/dto/events.dto.ts` — `projectId` в MyCalendarQuerySchema, `joinUrl` в EventDto
- `backend/src/modules/users/users.controller.ts` (или новый search controller) — `/users/search`
- `frontend/src/api/calendar.api.ts` — `projectId` параметр + `joinUrl` в типах
- `frontend/src/ui/calendar/CalendarView.tsx` — серверная фильтрация
- `frontend/src/ui/shared/UserPicker.tsx` — НОВЫЙ
- `frontend/src/ui/calendar/EventForm.tsx` — заменить participants input на UserPicker

**Косвенные:**
- `second-brain/01_projects/calendar.md` — TODO-секция уменьшается на 4 пункта
- Метрики prom-client: `calendar_reminders_sent_total{channel='email'}` — уже есть, начнёт собираться

## Открытые вопросы

1. **Подтвердить P4 (UserPicker)** — пользователь не ответил «да/нет» явно. Без P4 EventForm нерабочая, рекомендую делать. **Если откладываем — отметить как TODO и описать workaround (создание событий только через Concierge).**
2. **Email-канал для reminders — какой email брать?** `User.email` (логин) или `Person.email` (профиль в Org)? Возможно у внешнего Person в EventParticipant нет User — для него только Person.email.
3. **`kind=call` — создавать ли LiveKit-комнату?** Сейчас планирую только для `kind=meeting`. Call — может быть телефонный, без видео.

## DoD

- [ ] LiveKit Meeting auto-create при `kind=meeting`, joinUrl в EventDto, кнопка в UI
- [ ] LiveKit Meeting cancel при softDelete Event
- [ ] Email-канал доставки reminders работает (smoke на тестовом аккаунте)
- [ ] `?projectId=` фильтр серверный, клиентская фильтрация снята
- [ ] UserPicker компонент + поиск + встроен в EventForm (если P4 одобрена)
- [ ] typecheck backend + frontend: 0 ошибок
- [ ] Все существующие тесты зелёные + новые на каждую фазу
- [ ] second-brain/01_projects/calendar.md обновлён (TODO уменьшен)
