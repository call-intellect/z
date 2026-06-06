---
type: tz
status: needs-owner-go
feature: participant-count-dedup
date: 2026-06-06
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-06-participant-count-duplication-research.md
---
> Анализ-источник: `plans/analysis/2026-06-06-participant-count-duplication-research.md` (read-only research, root cause доказан чтением кода). Открыто по запросу владельца 2026-06-06 («дублируется количество участников — позвал двоих, показало 5»).

# ТЗ. Дедуп участников встречи (один человек = одна строка)

## Цель
Один человек = одна строка `Participant` на встречу; счётчик «участников» показывает реальных людей, а не сумму invite-строк и дубль-join-строк. Сейчас «позвал двоих → показывает 5».

## Корень (доказано, см. анализ)
1. **Нет дедупа по человеку.** Единственный уникальный ключ — `(meetingId, livekitIdentity)` (`schema.prisma:1306`). Нет уникальности по `userId`/`personId`. Invite-строка `invitee:<token>` и join-строка `guest:<nanoid>` одного человека имеют разный identity → индекс их не схлопывает.
2. **`joinAsGuest` всегда `create`.** Pre-seed (`invitee:`) переиспользуется только при `?inv=<token>` (ветка 1) или совпадении `userId` (ветка 3). Гость без токена / приглашённый по email/`personId` с `userId=null` → ветка 4 `joinAsGuest` → новый `guest:` поверх существующего `invitee:` (`participants.service.ts:104-121, 260-270`).
3. **Счётчик = `participants.length` сырой** (UI `MeetingsJournalReal.tsx:957`, DTO `meetings.service.ts:910-944`) — без фильтра по присутствию/дедупа. Завышение протекает и в ROI-метрику (`meeting-roi-scorer`, `pulse-patterns`) и в AI-промпты (`quality-score`, `behavior-metrics`).

Арифметика: хост(1) + 2 invite-строки + 2 join-строки = **5** на двух приглашённых.

## Принятые решения владельца
| # | Вопрос | Статус |
|---|---|---|
| Р1 | Что показывать в крупной цифре «участников»: только присутствовавших (`joinedAt!=null`/`joined`) с подписью «приглашено N, присутствовало M», или всех? | **нужно решение владельца** (рекомендация: присутствовавших + подпись) |
| Р2 | Вводить ли DB-инвариант (partial-unique по `userId`/`personId`) с backfill-схлопыванием дублей? | **нужно решение владельца** (рекомендация: да, Фаза 4, после A/B/C) |

## Scope / фазы

### Фаза 1 — Дедуп на входе (корень) `[ ]`
**Файл:** `backend/src/modules/participants/participants.service.ts` (`join` + матч-хелпер).
**Что входит:** перед `joinAsGuest` расширить переиспользование pre-seed: матчить `invited`-строку не только по `userId`, но и по `personId` и по `email` (когда invite заведён по email/personId, а человек залогинен/представился). Найден матч → `joinAsInvited` (перевести строку в `joined`), не плодить `guest:`.
**Acceptance:** приглашённый по email/personId, входящий без `?inv=`, переиспользует свою `invitee:`-строку (не создаёт `guest:`); юнит-тест на каждый матч-путь (userId/personId/email/none); идемпотентность (повторный join того же человека — no-op по строкам).

### Фаза 2 — Гарантировать доставку и проброс `?inv=` `[ ]`
**Файлы:** `frontend` — `GuestNameForm.tsx:46` (шлёт join БЕЗ `invite_token`), лобби/`MeetingPageShell` (проброс `inviteToken`).
**Что входит:** при наличии `?inv=<token>` гостевая форма обязана прокидывать `invite_token` в `join` (сейчас теряет) и не запрашивать имя заново; проверить, что `inv` не теряется при логине/редиректе.
**Acceptance:** вход по личной ссылке `/m/<id>?inv=<token>` всегда идёт через ветку 1 (переиспользование), POST `/join` содержит `invite_token`; e2e/мини-проверка флоу.

### Фаза 3 — Честный счётчик `[ ]`
**Файлы:** `backend/src/modules/meetings/meetings.service.ts` (DTO деталей), `MeetingsJournalReal.tsx`/`MeetingResultPageReal.tsx`, производные (`pulse-patterns`, `meeting-roi-scorer`, `quality-score`, `behavior-metrics`).
**Что входит (по Р1):** крупная цифра = фактически вошедшие (`joinedAt!=null` ИЛИ `invitationStatus='joined'`); «приглашено N, присутствовало M» отдельной подписью. При остаточных дублях — `DISTINCT` по `COALESCE(userId, personId, lower(email), livekitIdentity)`. Завышение убрать и из ROI/AI-источников.
**Acceptance:** карточка/результат показывают присутствовавших (не сумму строк); ROI/AI-контекст получают то же число; тесты на агрегат.

### Фаза 4 — DB-инвариант (по Р2) `[ ]`
**Файлы:** `backend/prisma/schema.prisma` + миграция + `backfill-participant-dedup.ts` (схлопывание существующих дублей ДО индекса) + регистрация в `apply-prod-deploy.ts`.
**Что входит:** partial-unique `(meetingId, userId) WHERE userId IS NOT NULL` и `(meetingId, personId) WHERE personId IS NOT NULL`; анонимные гости (оба null) остаются на `livekitIdentity`. Backfill сначала схлопывает дубли (иначе индекс не создастся).
**Acceptance:** СУБД физически не даёт второй строки на того же сотрудника; backfill идемпотентен (повторный прогон no-op); прод-выкат через `prod-deploy-log` (Шаги 4/8).

### Фаза 5 — Webhook `joinedAt` для `invitee:` `[ ]`
**Файл:** `backend/src/modules/webhooks/livekit-events.handler.ts:254-264`.
**Что входит:** в префиксном fallback (когда `kind` отсутствует в payload) принимать и `invitee:`-identity (реальные люди) — иначе приглашённым по личной ссылке не проставляется `joinedAt` и фильтр «присутствовал» (Фаза 3) промахивается.
**Acceptance:** у вошедшего по `?inv=` проставляется `joinedAt`; служебные (egress/agent/sip) по-прежнему отсекаются.

## Вне scope
- Слияние гостя с графом знаний / Person — отдельная фича.
- Изменение модели приглашений (токены/каналы доставки) сверх проброса `?inv=`.

## Риски
- Дедуп по email требует, чтобы invite и join знали один email; для анонимного гостя без email дедуп невозможен — остаётся отдельная строка (честно).
- Фаза 4 — миграция + backfill: схлопывать дубли осторожно (сохранять `joined`-строку, переносить `joinedAt`).
- Семантика счётчика (Р1) — продуктовое решение; согласовать до Фазы 3.

## DoD
- typecheck/lint/build зелёные; юнит-тесты матч-путей (Ф1), агрегата счётчика (Ф3), идемпотентности backfill (Ф4).
- Прод: Ф4 добавляет миграцию+backfill → записи в `prod-deploy-log.md` (Шаги 4/8) + `apply-prod-deploy.ts`.

## Итог
_(заполнит оркестратор при реализации.)_
