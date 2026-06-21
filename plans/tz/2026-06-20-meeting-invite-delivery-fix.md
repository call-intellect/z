---
type: tz
status: in-progress
feature: Доставка приглашений на встречу (почта + Telegram) для приглашённых-Person
date: 2026-06-20
---

# ТЗ: Доставка приглашений на встречу для приглашённых-Person (почта + Telegram)

> Диагностика и доказательство: эта сессия (живой кабинет `korateam.ru` + прод-логи `diag.ts` + доказательные unit-тесты).
> Доказательный тест: `backend/src/modules/meetings/meetings.service.invite-delivery-bug.spec.ts`.

## Цель

Приглашённый на встречу, добавленный как сотрудник-карточка (Person) или как внешний email-контакт, должен получать приглашение **и на почту, и в Telegram** — так же, как уже работает приглашение зарегистрированного пользователя (User).

## Контекст и симптом

Жалоба владельца: «приглашаю сотрудников — в Telegram им ничего не приходит; на почту приходит то иногда, то совсем нет». При этом регистрационные письма (логин/пароль) приходят стабильно — значит SMTP и Telegram-транспорт исправны.

В прод-логах за неделю — **ноль** уведомлений `eventType=meeting.invite`, а почти все уведомления идут `channels=[in_app]` (получатели не привязали бота). Это указывало, что приглашения на встречу **вообще не доходят до отправки**.

## Корневая причина (доказана кодом + сетевым запросом)

Фронт отправляет приглашённого-не-пользователя как `personId` с `email:null` (снято с боевого запроса `POST /api/v1/meetings`):
```json
"invitees":[{"userId":null,"personId":"cmqlti2qd…","email":null,"sendVia":["email"]}]
```
Дальше ломается в трёх местах:

1. **Фронт — email превращается в имя.** [`ParticipantPicker.handleQuickCreate`](../../frontend/src/ui/shared/ParticipantPicker.tsx) зовёт `personsApi.quickCreate({ name: debouncedQuery })` — введённый адрес уходит в **имя** персоны, поле `email` не передаётся. Person создаётся с пустым email, в payload `email:null`.

2. **Бэкенд — не достаёт email из Person.** [`seedInviteeInTx`](../../backend/src/modules/meetings/meetings.service.ts) в ветке `personId` делал `select: { name: true }` — email не читал; `resolvedEmail` оставался `null` → [условие `&& invite.email`](../../backend/src/modules/meetings/meetings.service.ts) ложно → письмо не отправлялось.

3. **Бэкенд — Telegram для Person не отправляется.** [`deliverMeetingInvites`](../../backend/src/modules/meetings/meetings.service.ts) шлёт Telegram только при заданном верхнеуровневом `invite.userId`. У приглашённого-Person он `null` (хотя у связанной персоны `person.userId` может быть привязан к боту) — код не резолвил `person.userId` → Telegram пропускался молча.

**Итог:** приглашённый-Person не получал ни почты, ни Telegram. Работал только путь через `userId` (резолв email из `user.email`, Telegram при привязке).

## Scope

**Входит:**
- Бэкенд: резолв `person.email` и `person.userId` в `seedInviteeInTx` → доставка по обоим каналам для приглашённых-Person.
- Фронт: при добавлении внешнего контакта сохранять введённый email (в `quickCreate` и в payload приглашения).
- Тест-доказательство (unit) рабочего и сломанного пути.

**Не входит:**
- Массовая привязка сотрудников к боту (организационная задача; без привязки Telegram физически недоставим — это не баг доставки).
- Наблюдаемость email-пути (вынесено в отдельную доработку — см. «Риски/долги»).

## Технические изменения

### Backend — СДЕЛАНО (Фаза 1, доказано тестами)
- `meetings.service.ts` → `seedInviteeInTx`, ветка `personId`:
  - `select: { name: true, email: true, userId: true }`;
  - `resolvedEmail ??= p.email || null`;
  - `resolvedUserId = invitee.userId ?? p.userId`.
- `PendingInvite.userId` теперь возвращает `resolvedUserId` (а не только `invitee.userId`) → `deliverMeetingInvites` шлёт Telegram на привязанного пользователя персоны без правок самого `deliverMeetingInvites`.

### Frontend — ОСТАЛОСЬ (Фаза 2)
- `ParticipantPicker.handleQuickCreate`: распознавать email во вводе и передавать его в `quickCreate({ name, email })`; в `addParticipant` класть `email: created.email ?? <введённый email>`. Тогда `CreateMeetingFormV2` (маппинг `email: v.email ?? null`) отправит адрес в payload, и письмо уйдёт даже без backend-резолва.
- UX: для контакта без привязанного аккаунта (нет `userId`) прятать/дизейблить кнопку «Телеграм» с подсказкой «нет привязанного аккаунта» (сейчас канал предлагается заведомо вхолостую).

### База данных
- Изменений нет. Миграций нет.

### Интеграции
- Без новых сервисов/очередей. Используются существующие `MailService.sendMeetingInvite` и `ConversationalService.sendNotification`.

## Критерии готовности (DoD)

- [x] Бэкенд: приглашённый-Person с `person.email` → письмо уходит на этот адрес (unit-тест).
- [x] Бэкенд: приглашённый-Person с `person.userId` → `sendNotification(meeting.invite)` на этот userId (unit-тест).
- [x] Регрессия: путь через `userId` цел; `typecheck` чист.
- [ ] Фронт: внешний email-контакт сохраняет email → приходит письмо (живая проверка в кабинете на gmail-адрес).
- [ ] Фронт: кнопка «Телеграм» скрыта для контактов без привязанного аккаунта.
- [ ] Живая проверка: приглашение сотрудника с привязанным ботом → приходит Telegram.
- [ ] Second Brain обновлён (`02_architecture/code-pitfalls.md` — ловушка «personId-приглашённый теряет доставку»).

## Риски и ограничения

- **Self-invite через person-карточку:** если у Person `userId === host`, после резолва хост мог бы получить уведомление о собственной встрече. Текущий guard ([строка 129](../../backend/src/modules/meetings/meetings.service.ts)) проверяет только `invitee.userId`. Захардить: после резолва пропускать, если `resolvedUserId === hostUserId`. (Хардening, не блокер.)
- **Нулевая наблюдаемость email-пути:** приглашения-письма не пишут ни записи в БД, ни строки в запрашиваемый лог-стор (`diag.ts logs`) — сбои невидимы. Долг: логировать исход `sendMeetingInvite` в общий лог-стор / метрику.
- **Telegram без привязки:** даже после фикса сотрудник без привязки к `@KoraSprintBot` Telegram не получит — это ожидаемо.

## Фазы реализации

- [x] **Фаза 1 — Backend-резолв `person.email`/`person.userId`** (сделано, доказано: `meetings.service.invite-delivery-bug.spec.ts` + регрессия `createForUser.spec.ts`, typecheck чист). НЕ закоммичено.
- [ ] **Фаза 2 — Frontend: сохранение email внешнего контакта + UX кнопки «Телеграм»** (`ParticipantPicker`).
- [ ] **Фаза 3 — Хардening + наблюдаемость:** guard self-invite по `resolvedUserId`; лог/метрика исхода email-приглашения.
- [ ] **Фаза 4 — Живая приёмка в кабинете:** письмо на gmail внешнему контакту; Telegram сотруднику с привязкой.

## Итог

Корень найден и доказан тестами против реального кода. Фаза 1 (бэкенд) реализована и проверена (17 тестов зелёные, typecheck чист), в рабочем дереве, не закоммичена. Осталось: фронт (Фаза 2), хардening/наблюдаемость (Фаза 3), живая приёмка (Фаза 4).
