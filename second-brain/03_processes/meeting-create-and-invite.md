---
name: meeting-create-and-invite
title: Создание встречи и приглашение гостя
trigger_type: user_action
status_overall: implemented
last_audited: 2026-05-30
owners_human:
  - продакт встреч
  - инженер frontend-команды встреч
related_plans:
  - plans/archive/2026-05-08-mvp-fullstack-tz.md
  - plans/archive/2026-05-22-final-roadmap.md
related_projects:
  - 01_projects/meeting-types.md
  - 01_projects/recording.md
  - 01_projects/conversational-channels.md
---

# Создание встречи и приглашение гостя

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Это самая первая точка встречи в Z. Хост — например, основатель компании или его руководитель отдела — заходит в раздел «Встречи» и нажимает «Создать встречу». Платформа спрашивает две вещи: какого типа встреча (продажа, планёрка, разбор проекта, ретроспектива, кастдев и так далее — всего девять типов) и как её назвать. По желанию хост может прицепить встречу к карточке клиента (тогда AI-отчёт пойдёт в карточку этого клиента), задать дополнительные инструкции для AI-отчёта (например, «в этой встрече не делай списка задач») и решить — записывать или нет (по умолчанию запись включена).

После нажатия «Создать» платформа делает четыре вещи разом: списывает одну встречу из накопительного баланса тарифа, создаёт запись встречи в базе данных, создаёт техническую комнату на медиа-движке LiveKit (через которую потом пойдёт картинка и звук) и автоматически добавляет самого хоста участником с ролью «host». Хост сразу попадает на страницу `/m/<id>` — это и есть его встреча.

Приглашение гостя сейчас — это копирование ссылки `https://<наш-домен>/m/<id>` и отправка её гостю любым удобным способом. Гость переходит по ссылке, вводит имя — и попадает в комнату как «гость» без какой-либо регистрации. Никакой автоматической рассылки приглашений в Telegram или почту платформа на этом шаге пока не делает — это сценарий, который ещё на горизонте.

## 2. Что запускает (триггер)

- **Тип:** действие пользователя.
- **Кто инициирует:** хост (залогиненный пользователь с подпиской) нажимает «Создать встречу» в `/meetings/create`.
- **Технический источник:** `POST /api/v1/meetings` (cookie-auth, `RequireSubscription`).

Альтернативные входы в этот же процесс:
- через партнёрский Crossmark API — `POST /integrations/crossmark/v1/meetings` (внешняя система просит создать встречу под пользователя по `external_id`);
- через календарь — `EventsService.createForCalendarEvent` при создании события календаря с `kind=meeting`.

## 3. Шаги процесса (общий список)

1. **Хост открывает форму создания встречи**, выбирает шаблон (один из 9 системных типов или свой кастомный) и заполняет название.
2. **Платформа проверяет, что у тарифа хоста ещё есть «нерасходованные» встречи**, и списывает одну единицу.
3. **В базе создаётся запись о встрече**, к ней сразу добавляется сам хост как «host»-участник. Если был выбран клиент — встреча привязывается к его карточке.
4. **Идентификатор встречи (ULID) сразу же становится именем комнаты LiveKit** — отдельной команды «создать комнату» здесь не нужно. Реальная LiveKit-комната создаётся либо при первом входе участника, либо явно при нажатии «Войти».
5. **Хосту даётся ссылка `/m/<id>`** — это и его страница «лобби», и страница, которую он копирует и пересылает гостям.
6. **Когда хост открывает `/m/<id>`** и страница понимает, что он host, она автоматически дёргает join и получает host-токен LiveKit с правами «admin» в комнате (TTL до 4 часов).
7. **Когда гость открывает `/m/<id>`** без cookie, страница показывает форму ввода имени; после ввода — guest-token LiveKit с правами «обычного участника» и cookie `guest_session_<meetingId>` на повторный вход.
8. **Авто-приглашение по Telegram/email** — не выполняется в этом процессе. Хост рассылает ссылку вручную. Crossmark-флоу возвращает партнёру специальный deep-link с одноразовым JWT (`?t=<jwt>`), которым партнёр шлёт «уже залогиненную» ссылку.

## 4. Что получается на выходе

- **Хосту:** запись `Meeting` со статусом `scheduled`, Participant с `role=host`, страница `/m/<id>` в браузере. По возврате `POST /meetings` фронт делает редирект на `/m/<id>`.
- **Гостю:** возможность зайти по `/m/<id>` без регистрации — после ввода имени получает Participant с `role=guest` и cookie на 30 дней.
- **Карточке клиента (если `cardId`):** инкремент `meetingCount`, обновление `lastMeetingAt`.
- **Балансу тарифа:** минус одна встреча (через `MeetingsBalanceService.consume`).
- **Org:** проставление `firstMeetingCreatedAt`, если это первая встреча (онбординг v2).
- **Бизнес-метрика:** `meeting_created_total{type}`.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Форма создания | Wizard «шаблон → параметры», `useSWR` подгружает `templates.list()` и (если есть `?cardId`) — `cards.get()` | `frontend/app/(authenticated)/meetings/create/page.tsx`, `frontend/src/ui/components/create-meeting-form/CreateMeetingFormV2.tsx:77` | `GET /api/v1/templates`, `GET /api/v1/cards/:id` | — (read-only) | ✅ |
| 2 | Списание из баланса | `consumeMeetingFromBalance` резолвит единственный membership пользователя, дёргает `MeetingsBalanceService.consume(tenantId, 1)`; при недостатке — `ForbiddenException` (бизнес-блок), при инфра-сбое — fail-open | `backend/src/modules/meetings/meetings.service.ts:103-129` | inline в `POST /api/v1/meetings` | `MeetingsBalance` (списание), `MeetingsBalanceLedger` | ✅ |
| 3 | Создание Meeting + host-Participant | Транзакция: `resolveDefaultTenant` → `meetings.create({id=ULID,...})` → `participant.create({role:'host',livekitIdentity:'host:<userId>'})` → опц. `card.update({meetingCount:+1, lastMeetingAt:now})` | `backend/src/modules/meetings/meetings.service.ts:199-282` | `POST /api/v1/meetings` (cookie-auth + `RequireSubscription`) | `Meeting`, `Participant`, `Card` (опц.) | ✅ |
| 4 | LiveKit-комната | Отдельного шага «создать room» при `POST /meetings` нет — room создаётся лениво в `joinAsHost`/`joinAsGuest` через `LivekitService.ensureRoom` (idempotent: на «already exists» молча возвращает null, на сетевую ошибку — warning, надежда на auto-create при подключении SDK) | `backend/src/modules/livekit/livekit.service.ts:113-142`, `backend/src/modules/participants/participants.service.ts:127,162,216` | LiveKit Server SDK `RoomServiceClient.createRoom` | `LivekitRoom` отдельно не материализуется — состояние в LiveKit | ✅ |
| 5 | Возврат `{id, url:'/m/<id>'}` | Контроллер отдаёт фронту id и относительный путь, фронт делает `router.push('/m/<id>')` | `backend/src/modules/meetings/meetings.controller.ts:127-142` | `POST /api/v1/meetings` ответ 201 | — | ✅ |
| 6 | Host-join и host-токен | Страница `/m/<id>` (server component) рендерит `<ExchangeAndRender>` → `<MeetingPageShell>`. Hook `useMeetingAccess` дёргает `GET /api/v1/meetings/:id/access` (`OptionalAuth`, throttle 30/мин); при `role==='host'` и status `scheduled`/`active` авто-join'ит `POST /api/v1/meetings/:id/join`. `joinAsHost` upsert'ит host-Participant'а, делает `ensureRoom`, `generateHostToken` (TTL ≤ min(4ч, до endedAt+5мин), max 8ч; grant `roomJoin/canPublish/canSubscribe/canPublishData/canUpdateOwnMetadata/roomAdmin:true`) | `frontend/app/(public)/m/[id]/page.tsx`, `frontend/app/(public)/m/[id]/MeetingPageShell.tsx:42-58`, `backend/src/modules/participants/participants.service.ts:98-144`, `backend/src/modules/livekit/livekit.service.ts:46-105` | `GET /api/v1/meetings/:id/access`, `POST /api/v1/meetings/:id/join` | `Participant` (upsert host), — | ✅ |
| 7 | Guest-join и guest-токен | Если `role==='none'` — рендерится `<Lobby>` с формой имени. Сервис sanitize'ит имя (убирает `<>&"'/`, max 80 симв), генерирует `nanoid` для `livekitIdentity='guest:<nanoid>'`, создаёт Participant с `role=guest`, выдаёт guest-cookie (HttpOnly, Lax, SameSite, TTL = `jwt.guestSessionTtlSeconds`) и `generateGuestToken` (grant как у хоста, но `roomAdmin:false`). При повторном заходе с cookie — переиспользует Participant, перевыдаёт токен | `backend/src/modules/participants/participants.service.ts:148-238`, `backend/src/modules/participants/participants.controller.ts:50-90`, `frontend/src/ui/components/lobby/Lobby.tsx` (не читался — TODO для лобби) | `POST /api/v1/meetings/:id/join` (`OptionalAuth`, throttle 30/мин) | `Participant` (role=guest), cookie `guest_session_<id>` | ✅ |
| 8 | Авто-приглашение гостя | Crossmark-флоу: `createFromCrossmark` подписывает deep-link JWT (`jwt.signDeepLink`, TTL = `cfg.auth.deepLinkTtlSeconds`), возвращает партнёру `{deep_link:'<frontend>/m/<id>?t=<jwt>'}`. Партнёр шлёт ссылку в свой канал. In-app-флоу не шлёт ничего — хост копирует ссылку руками | `backend/src/modules/meetings/meetings.service.ts:133-189`, `backend/src/modules/meetings/meetings.crossmark.controller.ts` | Crossmark `POST /integrations/crossmark/v1/meetings` | `DeepLinkToken` (JWT, в БД не хранится) | ⚠️ только Crossmark — для in-app встреч авто-доставки приглашения в Telegram/email нет |

### 5.1 Структуры данных, через которые проходит процесс

```
User (host) + Org (tenant)
  ↓ POST /meetings
MeetingsBalance.consume(tenantId, 1)
  ↓
Meeting{id=ULID, status='scheduled', recordByDefault=true, cardId?}
  + Participant{role='host', livekitIdentity='host:<userId>', userId}
  + (опц.) Card.meetingCount++, Card.lastMeetingAt=now
  + (опц.) Org.firstMeetingCreatedAt=now
  ↓ /m/<id> → /meetings/:id/access → /meetings/:id/join
LiveKit room (ленивая ensureRoom) + host JWT (ttl≤4ч)
  ↓ гость идёт по той же ссылке
Participant{role='guest', livekitIdentity='guest:<nanoid>'} + guest cookie + guest JWT
```

### 5.2 LLM-вызовы внутри процесса

Нет. На этом шаге LLM не вызывается. Все AI-агенты включаются позднее, после `recording_ready` (см. [[meeting-post-processing]]).

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `meeting_created_total{type}` — счётчик созданных встреч (`BusinessMetricsService.incMeetingCreated`).
- `crossmark_api_requests_total{endpoint,status}` — только для Crossmark-флоу.

**BullMQ очереди:** нет. Этот процесс синхронный, без воркеров.

**Логи:**
- `MeetingsService` — `«Создана встреча <id> (тип=..., owner=...)»`.
- `LivekitService` — `«LiveKit room создана: <id>»` / `«LiveKit недоступен при ensureRoom... полагаемся на auto-create»`.
- `ParticipantsService` — `«Создан host-Participant <id> для встречи <mid>»`.

**Известные грабли:**
- LiveKit может быть недоступен в момент `ensureRoom` — мы НЕ блокируем join, полагаемся на auto-create при подключении SDK. На практике в первые секунды это даёт race: трек публикуется быстрее, чем приходит наш webhook `room_started`. Это норма.
- `nanoid` для guest-identity — 21 символ, в `livekitIdentity='guest:<nanoid>'` помещается в LiveKit-лимит 256 символов.
- `consumeMeetingFromBalance` — fail-open при инфра-сбое. Это умышленно: лучше дать бесплатную встречу, чем заблокировать клиента из-за упавшего Redis/PG.
- Если у пользователя ровно одна Org-membership — `consume` идёт; если несколько — пропускается (без явного X-Org-Id мы не угадываем). В UI один-Org — норма (`feedback_conversational_channels_principles`).

**Кнопки админки:** `/admin/meetings` — список и принудительная отмена встречи (через `meetings-admin.controller.ts`).

## 7. Связанные процессы

- [[meeting-in-progress]] — что происходит, пока встреча активна (этот процесс заканчивается ровно на «гость зашёл по ссылке»).
- [[meeting-end-and-recording]] — продолжение, когда встреча кончается.
- [[meeting-post-processing]] — пост-обработка (включает все шаги после `recording_ready`).
- [[notification-dispatch]] — куда мог бы пойти авто-инвайт гостя через Telegram/email, если бы такая фича была.
- [[signup-and-onboarding-wizard]] — куда впервые попадает гость, если решает зарегистрироваться.

## 8. Расхождения «задумано vs реализовано»

**Закрытые расхождения (история):**
- ~~**Авто-приглашение гостя в Telegram/email**~~ — **закрыто продуктовым решением 2026-05-29**: делаем модель Zoom. `POST /meetings` возвращает одну ссылку `/m/{id}`, хост сам шлёт куда угодно. Гость представляется именем при входе ([Lobby.tsx](../../frontend/src/ui/components/lobby/Lobby.tsx) + [GuestNameForm.tsx:46](../../frontend/src/ui/components/lobby/GuestNameForm.tsx#L46)).
- ~~**Переименование гостя после встречи**~~ — **закрыто 2026-05-30 (Фаза 3 commercial-reliability pack)**: `PATCH /api/v1/meetings/:id/participants/:pid` (хост-only, только `isRegisteredUser=false`) + inline-edit в UI результата (`ParticipantsSection` в [MeetingResultPageReal.tsx](../../frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx)). Метрика `participant_renamed_total`. AI-отчёт показывает обновлённое имя автоматически (имена резолвятся на чтении из `Participant.name`).

**Заложено в ТЗ / messaging, но не реализовано:**
- **Subtitles (live ASR во время встречи)** — компоненты в `frontend/src/ui/components/meeting-room/` (ChatPanel, ControlsBar, RecordingIndicator, RaiseHandButton, ParticipantsPanel) есть, но subtitle-компонента нет, hook'а live-распознавания нет. Live-режим распознавания не реализован — расшифровка только пост-фактум (см. [[meeting-post-processing]]).

**Реализовано иначе:**
- **«Создать LiveKit-комнату при создании встречи»** — НЕ материализуется при `POST /meetings`. Room создаётся лениво при первом `join` (через `ensureRoom`). Это сознательно: дешевле и надёжнее (если хост передумал — комнаты в LiveKit вообще не было).
- **Гостевая cookie** ставится на меетинг-уровне (`guest_session_<meetingId>`), а не глобально. Это значит, что cookie действительна только для конкретной встречи и не «утекает» между встречами того же гостя.
- **TTL host-токена** — динамический: меньшее из `(endedAt+5мин)` и 8 часов, при отсутствии `endedAt` — 4 часа. Это страховка от висящих сессий после окончания встречи.

**Реализовано, но не описано в ТЗ:**
- **Календарный сценарий** (`createForCalendarEvent`) — создание встречи под событие календаря, без `cardId`, всегда `type='team'`. Не отдельный процесс, но другой entry-point. Стоит зафиксировать в `01_projects/calendar.md`.
- **Soft-delete + hard-delete grace** — встреча, помеченная `deletedAt`, через `cfg.retention.softDeleteGraceDays` (30 дней) удаляется `RetentionExtrasCron.hardDeleteMeetings`. Это часть retention-процесса, но триггерится из самого создания/удаления.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-30 | Zoom-rename: `PATCH /meetings/:id/participants/:pid` + inline-edit UI хоста для гостей. Закрыт §1.6 (auto-invite) Zoom-моделью. `status_overall: partial → implemented`. | plans/tz/2026-05-29-commercial-reliability-package.md Фаза 3 |
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-25 | Параметр `record_by_default` в форме создания | [[01_projects/recording]] |
| 2026-05-08 | Базовый сценарий MVP (Crossmark + in-app) | [[plans/tz/2026-05-08-mvp-fullstack-tz]] |
