---
type: tz
status: implemented
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
| # | Вопрос | Решение |
|---|---|---|
| Р1 | Что показывать в крупной цифре «участников»? | **Только присутствовавших** (владелец 2026-06-06: «приглашённые, но не пришедшие — не участники; считаем только тех, кто реально пришёл»). Реализовано предикатом `invitationStatus != 'invited'` (без отдельной подписи «приглашено N» — простой счётчик присутствовавших). |
| Р2 | Вводить ли DB-инвариант (partial-unique по `userId`/`personId`) с backfill? | **Отложено** (Фаза 4). App-дедуп (Ф1) + фильтр счётчика (Ф3) уже решают видимый баг; partial-unique миграция рискованна на фоне незавершённого прод-baseline миграций, маржинальная ценность мала. Внести отдельно после прогона baseline на проде. |

## Scope / фазы

### Фаза 1 — Дедуп на входе (корень) `[x]`
> Реализовано (коммит `1f370d98`): `join` резолвит Person по `userId` и матчит pre-seed `invited`-строку по `userId` ИЛИ `personId` → переиспользует (`joinAsInvited`), не плодит `guest:`. Email-матч не вводил: на `Participant` нет поля email (только userId/personId), а personId-матч закрывает кейс приглашения по сотруднику. Тесты: дедуп по personId + негатив.
**Файл:** `backend/src/modules/participants/participants.service.ts` (`join` + матч-хелпер).
**Что входит:** перед `joinAsGuest` расширить переиспользование pre-seed: матчить `invited`-строку не только по `userId`, но и по `personId` и по `email` (когда invite заведён по email/personId, а человек залогинен/представился). Найден матч → `joinAsInvited` (перевести строку в `joined`), не плодить `guest:`.
**Acceptance:** приглашённый по email/personId, входящий без `?inv=`, переиспользует свою `invitee:`-строку (не создаёт `guest:`); юнит-тест на каждый матч-путь (userId/personId/email/none); идемпотентность (повторный join того же человека — no-op по строкам).

### Фаза 2 — Гарантировать доставку и проброс `?inv=` `[x]`
> Реализовано (коммит `f991e18c`): `inviteToken` протянут `MeetingPageShell → Lobby → GuestNameForm → join({ guest_name, invite_token })`. Раньше ручная гостевая форма теряла токен (auto-join залогиненных слал его уже). RTL-тест (с токеном/без).
**Файлы:** `frontend` — `GuestNameForm.tsx:46` (шлёт join БЕЗ `invite_token`), лобби/`MeetingPageShell` (проброс `inviteToken`).
**Что входит:** при наличии `?inv=<token>` гостевая форма обязана прокидывать `invite_token` в `join` (сейчас теряет) и не запрашивать имя заново; проверить, что `inv` не теряется при логине/редиректе.
**Acceptance:** вход по личной ссылке `/m/<id>?inv=<token>` всегда идёт через ветку 1 (переиспользование), POST `/join` содержит `invite_token`; e2e/мини-проверка флоу.

### Фаза 3 — Честный счётчик `[x]`
> Реализовано (коммит `6b645c71`): общий предикат `participant-presence.ts` (`isPresentParticipant` / `PRESENT_PARTICIPANT_WHERE` = `invitationStatus != 'invited'`). `getResult`-DTO фильтрует участников до присутствовавших (карточка журнала `participants.length` + result-страница); `_count.participants` в ROI-scorer/pulse-patterns тоже present-only (инфляция не течёт в метрики). Тест-сценарий 5→3. (DISTINCT-по-человеку не понадобился — предикат робастен к остаточным дублям: не-пришедшую `invited`-строку исключает, реальную join-строку считает один раз.)
**Файлы:** `backend/src/modules/meetings/meetings.service.ts` (DTO деталей), `MeetingsJournalReal.tsx`/`MeetingResultPageReal.tsx`, производные (`pulse-patterns`, `meeting-roi-scorer`, `quality-score`, `behavior-metrics`).
**Что входит (по Р1):** крупная цифра = фактически вошедшие (`joinedAt!=null` ИЛИ `invitationStatus='joined'`); «приглашено N, присутствовало M» отдельной подписью. При остаточных дублях — `DISTINCT` по `COALESCE(userId, personId, lower(email), livekitIdentity)`. Завышение убрать и из ROI/AI-источников.
**Acceptance:** карточка/результат показывают присутствовавших (не сумму строк); ROI/AI-контекст получают то же число; тесты на агрегат.

### Фаза 4 — DB-инвариант (по Р2) `[ ]` — ОТЛОЖЕНО (Р2)
**Файлы:** `backend/prisma/schema.prisma` + миграция + `backfill-participant-dedup.ts` (схлопывание существующих дублей ДО индекса) + регистрация в `apply-prod-deploy.ts`.
**Что входит:** partial-unique `(meetingId, userId) WHERE userId IS NOT NULL` и `(meetingId, personId) WHERE personId IS NOT NULL`; анонимные гости (оба null) остаются на `livekitIdentity`. Backfill сначала схлопывает дубли (иначе индекс не создастся).
**Acceptance:** СУБД физически не даёт второй строки на того же сотрудника; backfill идемпотентен (повторный прогон no-op); прод-выкат через `prod-deploy-log` (Шаги 4/8).

### Фаза 5 — Webhook `joinedAt` для `invitee:` `[x]`
> Реализовано (коммит `1f370d98`): `livekit-events.handler` в fallback (kind отсутствует) принимает и `invitee:`-identity → у вошедших по личной ссылке обновляется `joinedAt`. Egress приходит как `EG_` (не `invitee:`) — безопасно. (Счётчик корректен и без этого: `joinAsInvited` сам ставит `joined`+`joinedAt`; webhook улучшает точность присутствия на reconnect.) Тест добавлен.
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
**Реализовано (ветка `sergdev`, 3 коммита):** Ф3 счётчик present-only `6b645c71` · Ф1 дедуп по personId + Ф5 webhook `1f370d98` · Ф2 проброс `?inv=` `f991e18c`. Видимый баг «позвал двоих → показало 5» закрыт (счётчик считает только пришедших, робастно к остаточным дублям); корень закрыт (дедуп на входе + проброс токена не дают плодить новые дубли). typecheck/lint/build зелёные, тесты по каждой фазе.
**Отложено (Р2):** Фаза 4 — DB-инвариант + backfill схлопывания существующих дублей. Вносить после прогона прод-baseline миграций. Существующие дубли в БД останутся видимы корректно (счётчик их не считает), но физически в таблице будут до backfill'а.
**Прод-операций нет:** схема/ENV/seed/миграции не менялись → пересборка backend + деплой фронта.
