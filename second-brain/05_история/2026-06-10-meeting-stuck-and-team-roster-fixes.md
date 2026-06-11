---
date: 2026-06-10
title: Зависание встречи в scheduled + дубли/статусы в разделе «Команда» (Ф1–Ф6)
tags: [meetings, fsm, livekit-webhooks, persons, team-roster, dedup, postgres-init, backfill, idle-cron]
distilled: false
---

# Зависание встречи в `scheduled` + дубли/ложный статус в «Команда» (Ф1–Ф6)

## Что было поставлено

ТЗ [`plans/tz/2026-06-10-meeting-stuck-and-team-roster-fixes.md`](../../plans/tz/2026-06-10-meeting-stuck-and-team-roster-fixes.md) — багфикс-пакет из двух независимых прод-проблем одной сессии диагностики (`backend/scripts/diag.ts`, прод `korateam.ru`) + один инфра-блокер:

1. **Встреча навсегда застревала в `scheduled`.** Владелец нажал «Завершить» — `POST …/finish → 409` (4 повтора), встреча не закрывалась. Технический след пуст: backend не получил ни одного вебхука LiveKit по встрече (но 401 нет → вебхуки не доходят физически, а не отбраковываются по подписи). Совпало с переездом `meet.crossmark.ru → korateam.ru`.
2. **Раздел «Команда»: дубли + «не приглашён» у всех.** Один email — две строки (аккаунтная карточка ⊕ ручная «Добавить сотрудника»); статус «не приглашён» у всех, включая владельца.
3. **Инфра-блокер (Баг A, ВНЕ кода):** сама доставка вебхуков LiveKit→backend сломана после переезда — корень зависания. Ф5/Ф6 — лишь страховка устойчивости; корень чинит владелец (правка `infra/livekit/livekit.yaml` `webhook.urls` + nginx-проксирование `/webhooks/` на backend).

## Как решал

Порядок: сначала трек «Команда» (низкий риск, без зависимости от инфры), затем трек «Встречи». 6 фаз, пофазный коммит.

- **Ф1 — ростер «Команда» (чтение)** — `backend/src/modules/orgs/orgs.service.ts`, `listTeamRoster`. `invitationStatus = membership ? 'accepted' : (invitations[0]?.status ?? 'none')` (активный участник всегда «активен»). Приватный дедуп по нормализованному (`trim().toLowerCase()`) непустому email: аккаунтная (`userId`) ⊕ ручная (`userId=null`) карточка на один email схлопываются в одну строку — база = носитель аккаунта, должность/отдел/человеческое имя дополняются из ручной, порядок первого появления сохранён.
- **Ф2 — БД: partial unique** — `backend/scripts/postgres-init.sql`. `CREATE UNIQUE INDEX persons_tenant_email_active_uniq ON "persons" ("tenantId", lower("email")) WHERE "deletedAt" IS NULL AND "email" <> ''`. Schema-уровневый `@@unique([tenantId, email, deletedAt])` бесполезен (`NULL ≠ NULL` в PG пропускает дубли с `deletedAt IS NULL`). **Self-skip:** если на момент прогона есть активные дубли — `RAISE NOTICE` + пропуск (postgres-init в `apply-prod-deploy --with-schema` идёт раньше backfill, поэтому индекс ОБЯЗАН не падать на дублях; встанет на следующем прогоне после Ф3). Образец — `Vendor_tenantId_inn_unique_idx`, `Entity_strong_email_uniq`.
- **Ф3 — backfill слияния дублей** — новый `backend/scripts/backfill-merge-duplicate-persons.ts` (+spec), через `createPrismaClient()` из `_lib/prisma` (без AppModule). Группировка по `(tenantId, lower(email))`; каноническая = единственная с `userId` либо старейшая по `createdAt`; `≥2` аккаунтов на email — НЕ сливать (warn, ручной разбор). Дубли soft-delete (`deletedAt=now` — FK не рвутся, уходят из ростера и из partial index), обогащение канонической ТОЛЬКО в пустые поля, слабое имя-логин → человеческое (Р4). Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase:'backfill'`, `args:['--apply']`, `skipBootstrap:true`).
- **Ф4 — дедуп при создании Person** — `backend/src/modules/persons/services/persons.service.ts`, `create`. До вставки при заданном email ищем активную `Person` по `(tenantId, email)`: ручное создание + нашлась → 409 `person_email_taken` (Р3); задан `linkUserId` + нашлась безличная (`userId=null`) → линкуем её, не плодим; иначе как раньше.
- **Ф5 — `finish` устойчив из `scheduled`** — `backend/src/modules/meetings/host-controls.service.ts` (+ `meetings.controller`, фронт). Из `scheduled` — best-effort `deleteRoom` + `scheduled → failed('ended_before_start')`, ответ 200 (не 409); терминальные — идемпотентный no-op; `active` — как раньше. FSM `scheduled → failed` уже разрешён, таблицу не расширял. Фронт показывает нейтральный тост «Встреча завершена (запись не велась)» (Р1).
- **Ф6 — idle-cron reconcile брошенных `scheduled`** — `backend/src/modules/meetings/cron/idle-meeting.cron.ts`. Второй проход подбирает `scheduled` старше `max(idle.timeoutMinutes, 30)` мин, сверяет с `livekit.listParticipants`: пусто/нет room → `failed('never_activated')`; есть живые участники (вебхук потерян, встреча идёт) → `scheduled → active` + при `recordByDefault` попытка стартовать запись (recovery) (Р2).

**Решения владельца (приняты, §1 ТЗ):** Р1 (finish из scheduled → failed/200 + нейтральный тост), Р2 (reconcile через 30 мин), Р3 (409 `person_email_taken` либо линковка безличной по `linkUserId`), Р4 (каноническая получает человеческое имя из ручной карточки).

**Ключевые инженерные развилки (отклонения от буквы ТЗ):**
- **(а) флаг backfill — `--apply`, не ТЗ-шный `--dry-run`.** В репозитории все backfill-скрипты дефолтят в dry-run и пишут только по `--apply` (зеркало `backfill-reclassify-instructions.ts`). Принял конвенцию репо, чтобы STEPS-регистрация (`args:['--apply']`) была единообразной.
- **(б) дедуп email — `$queryRaw lower()`, не Prisma `mode:'insensitive'`.** Prisma `insensitive` транслируется в `ILIKE`, а `ILIKE` трактует `_` (частый в email) как одиночный wildcard → ложные совпадения. Сравнение через `lower("email") = lower($1)` — точное.
- **(в) порог reconcile — `Math.max(idle.timeoutMinutes, 30)`.** Общий idle-timeout по умолчанию 15 мин — мало для `scheduled` (можно закрыть заранее созданную встречу). 30 мин (Р2) как пол.
- **(г) backfill-скрипты — валидация через spec+runtime, не tsc.** `tsconfig` backend не покрывает `scripts/` → новый backfill не проходит через `tsc` проекта; корректность доказана его `.spec.ts` + раннер-прогоном.

## Что вышло

6 коммитов (ветка `feature/meeting-cabinet-fixes-2026-06-10`). Все спеки зелёные:
- `orgs.service.spec.ts` — 6/6 (4 существующих + 2 новых: дедуп аккаунт⊕ручная с разным регистром email → 1 строка/accepted/человеческое имя; участник с Membership без invitation → accepted).
- `backfill-merge-duplicate-persons.spec.ts` — 10/10.
- `persons.service` (create-дедуп) — 3/3 (ручной дубль → 409; link к безличному → линковка; чистое создание).
- `host-controls.service` (finish) — 12/12 (каждый исходный статус: scheduled/active/терминальные).
- `idle-meeting.cron` — 5/5 (пустая room / room с участниками).

`backend` typecheck 0 + build 0; `frontend` typecheck 0 + build 0.

**Prod-операции (diff к выкату):** Шаг 5 (`apply-postgres-init` — partial unique self-skip), Шаг 8 (`backfill-merge-duplicate-persons.ts` сначала dry-run → `--apply`), rebuild backend+frontend. Полная инструкция — `docs/operations/prod-deploy-log.md` блок «🩹 2026-06-10». Инфра-блокер вебхуков — действие владельца (ТЗ §4), без него каждая новая встреча будет зависать.

## Чему научился

- **Prisma `mode:'insensitive'` = `ILIKE`, а не «toLower равенство».** `ILIKE` интерпретирует `_`/`%` как wildcard — в полях вроде email это даёт ложные матчи. Для регистронезависимого *равенства* нужен `$queryRaw lower(col)=lower($1)`, не `insensitive`.
- **`scripts/` вне tsc-покрытия backend.** Новый скрипт `tsc` проекта не валидирует — единственная защита от опечаток типов в нём это собственный `.spec` + runtime-прогон. Закладывать spec сразу.
- **`build` ≠ Nest-bootstrap для DI.** Зелёный `bun run build` компилирует, но не поднимает DI-граф — проблемы провайдеров/`@Optional()`/`forwardRef` (как `RecordingsService` в idle-cron) ловятся только запуском/спеком с тестовым модулем, не сборкой.
- **NULL в обычном unique индексе PG = дыра.** `@@unique([..., deletedAt])` для soft-delete не защищает от дублей среди живых строк (`NULL ≠ NULL`). Инвариант «один активный на ключ» делается только partial unique `WHERE deletedAt IS NULL` (вне schema.prisma, в `postgres-init.sql`).
- **Self-skip partial index** — рабочий паттерн, когда индекс ставится до того, как backfill устранил существующие нарушения: считать группы-дубли, при `>0` `RAISE NOTICE` + пропуск, индекс встаёт на следующем прогоне после backfill. Так schema-фаза не падает из-за порядка относительно backfill-фазы.
