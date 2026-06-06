# Аналитика бага: дублируется количество участников встречи

**Дата:** 2026-06-06
**Тип:** read-only research (код не менялся)
**Область:** `backend/src/modules/{meetings,participants,webhooks}`, `frontend` (карточка/результат встречи)

---

## Симптом

Со слов владельца:

> «Дублируется количество участников. Когда я их приглашаю/зову — они как будто сразу обозначаются (считаются). Когда они заходят по ссылке — они ещё раз обозначаются. Позвал двоих сотрудников — встреча показала 5 участников.»

То есть счётчик участников встречи завышен: **приглашение (invite) создаёт строку Participant, а вход (join) при определённых условиях создаёт ВТОРУЮ строку** того же человека. Дедуп по человеку при этом не срабатывает.

**Предполагаемая арифметика 2→5** (доказана ниже):

| Источник строки | Кол-во |
|---|---|
| Хост (владелец) — `host:<userId>` (создаётся при `createForUser`, переиспользуется на join) | 1 |
| Приглашённый №1 — pre-seed `invitee:<token1>` (`invitationStatus='invited'`) | 1 |
| Приглашённый №2 — pre-seed `invitee:<token2>` | 1 |
| Вход №1 без матча pre-seed → новый `guest:<nanoid>` | 1 |
| Вход №2 без матча pre-seed → новый `guest:<nanoid>` | 1 |
| **Итого в карточке (`participants.length`)** | **5** |

Двое приглашённых дают по 2 строки каждый (invite-строка + join-строка), плюс хост → 1 + 2 + 2 = **5**. Точно совпадает с жалобой.

---

## Где создаются участники

### Модель `Participant` (единая таблица для invite И join)

`backend/prisma/schema.prisma:1280`

```prisma
model Participant {
  id               String  @id @default(cuid())
  meetingId        String
  livekitIdentity  String
  name             String
  role             ParticipantRole               // host | guest
  isRegisteredUser Boolean @default(false)
  userId           String?
  personId         String?
  invitationStatus ParticipantInvitationStatus @default(none)  // none | invited | joined
  inviteToken      String? @unique
  invitedAt        DateTime?
  joinedAt         DateTime?
  leftAt           DateTime?
  ...
  @@unique([meetingId, livekitIdentity])   // ← единственный дедуп-ключ
  @@index([meetingId])
}
```

Ключевой факт: **дедуп существует только по `(meetingId, livekitIdentity)`**. Нет уникальности по `(meetingId, userId)` или `(meetingId, personId)`. Значит одного и того же человека можно вставить дважды, если у двух строк разные `livekitIdentity`.

Enum статуса (`schema.prisma:102`): `none | invited | joined`.

### Invite-путь — создаёт pre-seed строку с identity `invitee:<token>`

`backend/src/modules/meetings/meetings.service.ts:318-341` (внутри `createForUser`):

```ts
const inviteToken = nanoid();
await tx.participant.create({
  data: {
    meetingId,
    livekitIdentity: `invitee:${inviteToken}`,   // ← identity = invitee:<token>
    name: resolvedName,
    role: 'guest',
    isRegisteredUser: Boolean(invitee.userId),
    userId: invitee.userId ?? null,
    personId: invitee.personId ?? null,
    invitationStatus: 'invited',
    inviteToken,
    invitedAt: new Date(),
  },
});
```

Доставка — личная ссылка `/m/<meetingId>?inv=<inviteToken>` (`meetings.service.ts:408`).

Хост добавляется отдельно тем же методом (`meetings.service.ts:277-286`) с `livekitIdentity: 'host:<userId>'`.

### Join-путь — `ParticipantsService.join`

`backend/src/modules/participants/participants.service.ts:73-122`. Порядок резолва:

1. **`inviteToken` есть и матчится** (`:89-96`) → `joinAsInvited` — переиспользует pre-seed строку, обновляет `invitationStatus='joined'`. **Дубля НЕТ.**
2. **Залогинен и владелец** (`:98-100`) → `joinAsHost` — ищет/переиспользует `host:<userId>`. **Дубля НЕТ.**
3. **Залогинен, не владелец, есть pre-seed с тем же `userId` и `invitationStatus='invited'`** (`:104-115`) → `joinAsInvited`. **Дубля НЕТ.**
4. **Иначе** → `joinAsGuest` (`:117`).

`joinAsGuest` (`:211-301`) — если нет валидной guest-cookie и есть имя:

```ts
const guestId = nanoid();
const livekitIdentity = `guest:${guestId}`;     // ← НОВЫЙ identity каждый раз
const participant = await this.prisma.participant.create({
  data: { meetingId, livekitIdentity, name: cleanName, role: 'guest', isRegisteredUser: false },
});
```

То есть **ветка 4 всегда плодит новую `guest:<nanoid>` строку**, даже если на этого же человека уже есть pre-seed `invitee:<token>`. Дедуп `@@unique([meetingId, livekitIdentity])` тут не помогает — identity заведомо другой (`guest:` vs `invitee:`).

### Когда join попадает в ветку 4 (создаёт дубль) — это реальные сценарии

Pre-seed переиспользуется ТОЛЬКО если:
- пришёл `?inv=<token>` (ветка 1), **или**
- пользователь залогинен И pre-seed заведён с тем же `userId` (ветка 3).

Дубль возникает, если ни одно не выполнено:
- **Гость без `?inv=`** — открыл лобби по «общей» ссылке `/m/<id>` (а не по личной), либо `?inv` потерялся при пересылке/редиректе. Гостевая форма `frontend/src/ui/components/lobby/GuestNameForm.tsx:46` вызывает `meetingsApi.join(meetingId, { guest_name })` **без `invite_token`** → ветка 4 → новый `guest:` row.
- **Приглашён по email/`personId` без `userId`** — pre-seed создан с `userId=null` (`meetings.service.ts:326`). Даже если человек залогинится, ветка 3 (`:104-111`) ищет по `userId` и не находит → ветка 4 → дубль. Личная ссылка `?inv=` тут единственное, что спасает.
- **Залогинен, но pre-seed заведён на другой `userId`** (другой аккаунт/почта) — ветка 3 не матчит → дубль.

### Webhook `participant_joined` — НЕ источник этого дубля (но есть связанный изъян)

`backend/src/modules/webhooks/livekit-events.handler.ts:225-309`. Логика корректная:
- фильтрует служебных участников по `ParticipantKind` (`:238-247`): создаёт строку только для `STANDARD`; `EGRESS/AGENT/SIP/INGRESS/...` → no-op. Egress/agent НЕ считаются людьми (это правильно).
- upsert по `(meetingId, livekitIdentity)` (`:266-281`): если строка есть — только `joinedAt`, не плодит.

НО: при отсутствии `kind` в payload (proto3 опускает дефолт STANDARD=0) срабатывает fallback по префиксу identity (`:254-264`), который принимает только `host:` / `guest:` и **отбрасывает `invitee:`**:

```ts
if (!participantInfo.identity.startsWith('host:') &&
    !participantInfo.identity.startsWith('guest:')) {
  // 'participant_joined: identity не host/guest ... — no-op'
  return;
}
```

Приглашённый, вошедший по `?inv=`, держит identity `invitee:<token>` (см. `joinAsInvited` — `participants.service.ts:131-157`, токен генерится на тот же identity). В этом fallback-режиме его `joinedAt` через webhook не проставится (no-op). Это **не создаёт дубль** (строка уже есть от invite), но искажает «кто реально присутствовал». Отдельный, менее критичный изъян — отметить.

---

## Где считается счётчик, видимый владельцу

**Главная поверхность** — карточка/детали встречи в журнале:

`frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx:912,957`

```tsx
const participants = data.participants ?? [];
...
<Users size={12} />
{participants.length} участников
```

То же на странице результата встречи: `frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx` (секция «Участники», тот же `participants.length`).

`data.participants` приходит из backend без фильтрации и без дедупа:

`backend/src/modules/meetings/meetings.service.ts:910-944` (`getMeetingForOwner` / детали):

```ts
const meeting = await this.prisma.meeting.findUnique({
  where: { id: meetingId },
  include: { participants: true, recording: true, transcript: true, aiResult: true },
});
...
participants: meeting.participants.map((p) => ({ id, name, role, joinedAt, leftAt, isRegisteredUser })),
```

Возвращаются **все** строки Participant (включая pre-seed `invited` и каждую `guest:`-строку). Источник числа = `COUNT` строк таблицы `participant` по `meetingId`, **без `DISTINCT` по userId/email и без фильтра статуса/kind**.

Те же сырые `_count.participants` используются в дашборде (`dashboard/services/pulse-patterns.service.ts:230,241`, `dashboard/agents/meeting-roi-scorer.worker.ts:118,147`) и в AI-промптах (`quality-score.worker.ts:193`, `behavior-metrics.worker.ts:252`) — значит завышение протекает и в ROI-метрику, и в AI-контекст, не только в UI.

**Контр-поверхность (НЕ баг):** живой счётчик в самой комнате — `frontend/src/ui/components/meeting-room/ParticipantsPanel.tsx:51,72` через LiveKit `useParticipants()`. Он считает реально подключённых к SFU и pre-seed-«приглашённых» не видит. Поэтому «5 вместо 2» владелец видит именно на **карточке/результате после встречи**, а не во время разговора.

---

## Root cause

1. **Нет дедупа по человеку (`userId`/`personId`/email) при создании участника.** Единственный уникальный ключ — `(meetingId, livekitIdentity)` (`schema.prisma:1306`). Invite-строка и join-строка одного человека имеют разные identity (`invitee:<token>` vs `guest:<nanoid>`), поэтому уникальный индекс их не схлопывает.

2. **`joinAsGuest` всегда `create`, а ветки переиспользования pre-seed узкие.** Pre-seed переиспользуется только при `?inv=<token>` (ветка 1) или `userId`-матче (ветка 3). Гость без токена и приглашённый по email/personId (userId=null) проваливаются в `joinAsGuest` → новая `guest:`-строка поверх существующей `invitee:`-строки (`participants.service.ts:104-121, 260-270`).

3. **Счётчик = `participants.length` без фильтра.** UI и backend-DTO считают все строки таблицы, включая ещё-не-вошедших `invited` и дубль-`guest`-строки (`MeetingsJournalReal.tsx:957`, `meetings.service.ts:937`).

Пункты 2 и 3 совместно дают «2 позвал → 5 показал»: pre-seed (+2) и фактический join без матча (+2) складываются, плюс хост (+1).

---

## Класс бага

Это **комбинация двух классов**, причём первый — корневой:

- **Основной: «нет дедупа по человеку» + «invite и join — разные identity в одной таблице складываются».** invite-строка (`invitee:`) и join-строка (`guest:`) одного человека не схлопываются, потому что дедуп завязан на `livekitIdentity`, а не на личность.
- **Вторичный (усиливающий): «счётчик считает сырые строки без фильтра по статусу».** Даже без второй проблемы pre-seed-`invited`, кто не пришёл, всё равно попал бы в число «участников».

Это **НЕ** «не фильтруются служебные LiveKit-участники» — egress/agent/sip отсекаются корректно (`livekit-events.handler.ts:238-247` и `recordings.service.ts:424`). Служебные участники в дубле не виноваты.

---

## Рекомендация по фиксу (без кода)

Цель — один человек = одна строка Participant на встречу; счётчик показывает реальных людей.

### A. Дедуп на входе (корень) — приоритет 1
В `ParticipantsService.join`, перед `joinAsGuest`, расширить переиспользование pre-seed:
- Сейчас ветка 3 матчит только `userId` + `invitationStatus='invited'`. Добавить матч по **`personId`** и по **email** (если invite заведён по email/personId, а человек залогинен/представился).
- Для незалогиненных гостей с известным email — матчить pre-seed по email.
- Если матч найден — идти в `joinAsInvited` (переиспользовать строку, перевести в `joined`), а не плодить `guest:`.

**Риск:** средний. Сопоставление по email требует, чтобы invite и join знали один и тот же email (для анонимного гостя email может быть неизвестен — тогда дедуп невозможен, останется отдельная строка; это допустимо честно). Затронуто: `participants.service.ts` (`join` + новый матч-хелпер).

### B. Гарантировать доставку личной ссылки `?inv=` — приоритет 1 (дёшево, снимает большинство кейсов)
Большинство дублей — оттого что join приходит без `?inv=`. Проверить, что:
- все каналы доставки (email/Telegram) ведут именно на `/m/<id>?inv=<token>`, а не на «общую» ссылку (`meetings.service.ts:408` — уже так; проверить, что фронт не теряет `inv` при редиректах/логине);
- при наличии `?inv=` гостевая форма не должна вообще запрашивать имя заново и обязана прокидывать `invite_token` (сейчас `GuestNameForm.tsx:46` шлёт join БЕЗ `invite_token` — если человек попал в лобби с активным `inv`, токен теряется).

**Риск:** низкий. Затронуто: `frontend` (`MeetingPageShell`/`GuestNameForm`/`Lobby` — пробросить `inviteToken` в гостевую форму), без изменения схемы.

### C. Счётчик считать по людям, а не по строкам — приоритет 2 (страховка)
Даже после A/B сделать число «участников» осмысленным:
- В UI/DTO считать **только фактически вошедших** (`joinedAt != null` ИЛИ `invitationStatus='joined'`), отделив «приглашён, но не пришёл» в отдельную подпись («приглашено N, присутствовало M»).
- При наличии остаточных дублей — `DISTINCT` по `COALESCE(userId, personId, lower(email), livekitIdentity)`.

**Риск:** низкий, но семантический — согласовать с владельцем, что показывать в крупной цифре (присутствовавших). Затронуто: `meetings.service.ts` (DTO), `MeetingsJournalReal.tsx`/`MeetingResultPageReal.tsx`, а также производные (`pulse-patterns`, `meeting-roi-scorer`, AI-промпты `quality-score`/`behavior-metrics`) — чтобы завышение не текло в ROI и AI.

### D. (Опционально) DB-инвариант — приоритет 3
Рассмотреть partial-unique индекс по `(meetingId, userId)` где `userId IS NOT NULL` и по `(meetingId, personId)` где `personId IS NOT NULL`, чтобы СУБД физически не дала второй строки на того же сотрудника. Анонимные гости (оба NULL) остаются на `livekitIdentity`.

**Риск:** выше (миграция + предварительный backfill-схлопывание существующих дублей, иначе индекс не создастся). Делать после A/B/C.

### E. Webhook `joinedAt` для `invitee:` — приоритет 3 (точность присутствия)
Расширить fallback в `livekit-events.handler.ts:254-264`, чтобы при отсутствии `kind` принимать и `invitee:`-identity (это реальные люди), иначе у приглашённых по личной ссылке не проставляется `joinedAt` и фильтр «присутствовал» из пункта C промахнётся. **Риск:** низкий.

---

## Открытые вопросы (требуют прод-проверки / диага)

1. **Точная пропорция кейсов.** Чтения кода достаточно, чтобы доказать механизм, но не долю. Нужен запрос в прод (через `backend/scripts/diag.ts`, только с явным «можно в прод»): для встречи с жалобой выгрузить все строки `participant` и посмотреть распределение `livekitIdentity`-префиксов (`host:`/`invitee:`/`guest:`) и `invitationStatus`. Это покажет, сколько строк дал invite, сколько — дубль-join, и подтвердит арифметику 1+2+2=5 на реальных данных.
2. **Теряется ли `?inv=` на фронте при логине/редиректе.** Гипотеза B опирается на то, что в части кейсов токен не доходит до join. Доказать можно только прогоном сценария «приглашение по email → клик → (возможный логин) → вход» с осмотром итогового POST `/join` (есть ли `invite_token` в теле).
3. **Приходит ли `participant.kind` в проде в webhook-payload.** От этого зависит, насколько часто срабатывает префиксный fallback (и теряется `joinedAt` у `invitee:`). Проверяется по `meeting_event` payload в проде.
4. **Считает ли владелец «5» именно на карточке/результате, а не во время встречи.** По коду это карточка (DB-count), но стоит подтвердить у владельца, чтобы не чинить не ту поверхность (живой счётчик в комнате через LiveKit ведёт себя иначе и багу не подвержен).

---

## Доказательная сводка (path:line)

| Факт | Место |
|---|---|
| Единственный дедуп-ключ — `(meetingId, livekitIdentity)`, нет уник. по userId/personId | `backend/prisma/schema.prisma:1306` |
| invite-строка с identity `invitee:<token>`, `invitationStatus='invited'`, `userId` может быть null | `backend/src/modules/meetings/meetings.service.ts:318-341` |
| host-строка `host:<userId>` (не дублируется) | `backend/src/modules/meetings/meetings.service.ts:277-286` |
| join: переиспользование pre-seed только по `inv`-токену или `userId` | `backend/src/modules/participants/participants.service.ts:89-115` |
| `joinAsGuest` всегда `create` новый `guest:<nanoid>` | `backend/src/modules/participants/participants.service.ts:260-270` |
| Гостевая форма шлёт join БЕЗ `invite_token` | `frontend/src/ui/components/lobby/GuestNameForm.tsx:46` |
| Счётчик владельца = `participants.length` (сырые строки) | `frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx:957` |
| DTO возвращает все строки без фильтра/дедупа | `backend/src/modules/meetings/meetings.service.ts:910-944` |
| Служебные LiveKit-участники (egress/agent/sip) отсекаются корректно — НЕ причина | `backend/src/modules/webhooks/livekit-events.handler.ts:238-247` |
| Webhook fallback отбрасывает `invitee:` при отсутствии kind (вторичный изъян — теряется joinedAt) | `backend/src/modules/webhooks/livekit-events.handler.ts:254-264` |
| Завышение протекает в ROI/AI-метрики | `dashboard/services/pulse-patterns.service.ts:230,241`, `dashboard/agents/meeting-roi-scorer.worker.ts:118,147` |
