---
title: Утренняя сводка задач — реализация ТЗ (оркестрация суб-агентами)
date: 2026-06-29
distilled: false
---

# Утренняя сводка задач (morning-tasks-digest)

## Что было поставлено
ТЗ [`plans/tz/2026-06-29-morning-tasks-digest.md`](../../plans/tz/2026-06-29-morning-tasks-digest.md): каждое утро по МСК каждый активный сотрудник получает одно уведомление со всеми своими открытыми задачами (группы Просрочено/Срок сегодня/В работе/Запланировано), пустой день → «всё чисто». Каналы и час — крутилки в админке. Без новых таблиц/миграций.

## Как решал (оркестрация)
6 фаз, ветка `feature/morning-tasks-digest`. Картография — `Explore`-агент (vexp free-cap не покрыл backend, как и помечено в памяти). После Ф0 запустил **4 кодера параллельно** (Ф1 сервис, Ф3 адаптеры, Ф4 фронт, Ф5 сид+UI) — все правят непересекающиеся файлы; Ф2 (cron) — соло после Ф1.

- **Ф0** — контракты (сам, точные копипасты из ТЗ): payload-схема `tasks.daily_open` в [event-payload.registry.ts](../../backend/src/modules/conversational/types/event-payload.registry.ts), строка политики в [conversational.service.ts](../../backend/src/modules/conversational/conversational.service.ts), 5 валидаторов в [admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts). Коммит `bb3ef20d`.
- **Ф1** — [morning-tasks-digest.service.ts](../../backend/src/modules/tracker/services/morning-tasks-digest.service.ts): чистая `buildTasksDailyOpenPayload` (МСК-границы, классификация top-down, сортировка, лимит+overflow, пустой случай) + Prisma-методы + `groupOpenIssuesByUser`. 5/5 юнит-тестов. Коммит `6c8fcfef`.
- **Ф2** — [morning-tasks-digest.cron.ts](../../backend/src/modules/tracker/workers/morning-tasks-digest.cron.ts): `@Cron('0 * * * *', Europe/Moscow)` + kill-switch + МСК-гейт (Intl, не getUTCHours) + дедуп по `Notification` + отправка + метрика `z_tracker_morning_digest_total`. 6/6 спека. Коммит `d65dfd23`.
- **Ф3/Ф4/Ф5** — рендер в 3 адаптерах, фронт (label + `DailyOpenTasksView`), сид+UI-группа+STEPS. Коммиты `2fb6b98d`/`2a9f0da6`/`40191e7e`.
- **Ф6** — feature-flags, prod-deploy-log (блок 2026-06-29), second-brain (tracker/workers-queues/не-сделано), рефлексия.

## Что вышло (верификация — прогонял сам, не по отчётам агентов)
- Backend: `bun run typecheck` exit 0 (0 ошибок), `bun run build` exit 0 (DI/декораторы), оба спека зелёные (5/5 + 6/6), eslint 0 errors.
- Frontend: `typecheck` 0, `lint` 0 errors.
- Грепы acceptance: `getUTCHours` отсутствует в кроне, `Europe/Moscow` есть, провайдер крона в module, 5 ключей в сиде+реестре, регистрация в STEPS.

## Чему научился / грабли
- **vitest зелёный ≠ tsc зелёный.** Спек Ф1 проходил в vitest, но полный `bun run typecheck` дал 8 ошибок `noUncheckedIndexedAccess` (`items[0].x`, destructuring `split('-').map(Number)`). Урок: приёмка фазы = полный typecheck, не только прогон спека. Чинится `?.[0]?.` и `Number(parts[i])` вместо destructuring.
- **`bun run build` ловит OOM node-кучи.** Первый build упал `Abort trap: 6` (код 134) — это OOM tsc-emit, не ошибка типов. Перезапуск с `NODE_OPTIONS=--max-old-space-size=8192` → exit 0. (Согласуется с памятью «8GB tsc heap».)
- **Параллельные кодеры по непересекающимся файлам — дёшево и быстро.** 4 кодера за одну волну, заранее проверил что файловые множества не пересекаются (tracker.module.ts трогали только Ф1 и Ф2, и Ф2 шёл после Ф1 — без гонки).
- **Фича на 80% на готовых рельсах** (почтальон + адаптеры + AdminSetting) — новых таблиц/миграций ноль, идемпотентность через дедуп по существующей `Notification`.

## Хвосты (в [[../04_не-сделано/README|реестре не-сделано]])
Руководительский разрез по команде; BullMQ-очередь при >2000 сотрудников/тенант; пер-юзерная подписка в кабинете — все vNext по решениям владельца.
