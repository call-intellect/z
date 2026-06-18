---
title: Помощник × календарь — дубли, даты/таймзоны, контрагент-vs-место, онлайн-пометка (8 фаз)
date: 2026-06-18
tags: [conversational, concierge, events, calendar, timezone, bullmq, prisma, рефлексия]
---

# Помощник × календарь: реализация мастер-ТЗ (Ф1–Ф8)

## Что было поставлено
Реализовать `plans/tz/2026-06-18-assistant-calendar-master.md` — 8 фаз, чинящих 4 бага помощника Коры в мессенджерах (по прод-логам инцидента 2026-06-17) + продуктовая модель «время/доступность — свойство человека, онлайн — пометка»:
1. дубли ответов (5 на одно сообщение); 2. «завтра» не распознаётся; 3. «сегодня» = вчера+завтра; 4. офлайн-встреча → `failed` видеокомната. Плюс: контрагент vs место, рабочий профиль человека.

Ветка `feature/assistant-calendar-fixes` (от текущего HEAD — **не от main**: main отстаёт на 1457 коммитов, это не trunk).

## Как решал (оркестрация суб-агентами, пофазно)
Группа «острое» (без БД): **Ф1** дедуп `update_id`/`mid` (Redis SET NX EX 3600) + ранний ACK за kill-switch `ASSISTANT_INBOUND_ASYNC_ENABLED` через новую BullMQ-очередь `assistant.inbound` (воркер in-process, attempts:1, jobId-дедуп) — клон `ConversationalSendWorker`. **Ф2** «Сейчас: дата (день), время по TZ» первой строкой контекста помощника (USER-блок, SYSTEM не трогаем — prompt-cache). **Ф7** описания `list_meetings`/`list_my_events`.

Группа «БД-поля» (одна миграция `20260618120000_…`): `Person.workStartHour/workEndHour/workingDays`, `Event.online`, `Event.counterparty`. **Ф6** видеокомната по `online===true` (не `kind==='meeting'`) + `attachLivekitRoom` (DRY) + `makeEventOnline` (идемпотентный) + эндпоинт `POST /events/:id/make-online`. **Ф5** `counterparty` + правило в описании `create_event`. **Ф3** окно дня по локальным суткам (`startOfLocalDayUtc` вынесен в `local-date.ts`) + `find_free_slot` из рабочих часов Person. **Ф4** `GET/PATCH /me/work-profile` + seed AdminSetting дефолтов + инструмент `set_my_work_profile` + автоспрос таймзоны. **Ф8** фронт: `WorkProfileSection` в настройках, тумблер «Онлайн»/поле «Контрагент»/кнопка «Сделать онлайн».

Коммиты `25e316d6..00a9858a` (9). Каждая фаза: картография → промпт кодеру → независимая приёмка (греп маркеров + re-Read + свой typecheck/lint/build/тесты) → коммит.

## Что вышло (верификация)
Все фазы зелёные сам-прогоном: typecheck 0, build 0, тесты по модулям (Ф1 35, Ф2 13, Ф6+Ф5 68, Ф3 61, Ф4 178, Ф8 фронт 4 + build 215 страниц). Lint — 0 errors в своих файлах. Прод-прогон (реальные ретраи Telegram, LLM-выбор инструментов) — по природе только в проде, отмечено в smoke `prod-deploy-log`.

## Чему научился (уроки)
1. **`User.timezone` НЕ существует — ТЗ и анализ ошиблись.** Анализ сослался на «User.timezone:2481», но строка 2481 — это `Org.timezone` (модель `User` = 1077–1219, без `timezone`). Таймзона человека уже резолвится `Person.timezone → Org.timezone → Moscow` (`find-free-slot.resolveOrganizerTimezone`). **Решение:** рабочий профиль кладём на `Person`, не User. **Ловушка Prisma:** `findUnique({select:{timezone}})` на несуществующем поле **проходит typecheck** (Prisma-select лишний ключ не ругается статически), но в рантайме бросает `PrismaClientValidationError` — а мок-тесты этого не ловят. Я внёс этот баг в Ф2 (доверившись ТЗ) и поймал только на картографии Ф4. **Вывод:** «поле X на модели Y» из ТЗ/анализа — верифицировать грепом схемы/`UserOmit` в generated client, не доверять номеру строки.
2. **Суб-агенты прерываются/умирают — фактчек обязателен.** Первый кодер Ф6+Ф5 прервался на середине: `const→let` не применился, `attachLivekitRoom` вызван, но не определён, старый блок создания комнаты удалён → **сборка сломана, отчёта нет**. Первый кодер Ф8 умер на 0 tool_uses (terminal API error). `SendMessage` в этой среде недоступен → перезапуск нового агента с явным «что уже сделано / что СЛОМАНО». **Вывод:** после каждого агента — греп маркеров (`grep -c "private async attachLivekitRoom"`) + прогон **build** (не только тесты — тесты были бы зелёные на сломанной сборке, т.к. не компилируют весь граф); не верить отчёту.
3. **Миграция без живой БД (Prisma 7).** Docker Desktop не запущен → `migrate dev` нельзя. `prisma migrate diff --from-schema=<старая> --to-schema=<новая> --script` генерит точный SQL без БД (флаг именно `--from/to-schema`, не `--from-schema-datamodel` — тот удалён в P7; подтверждено Context7). Папку миграции создал вручную с этим SQL, `prisma generate` (без БД) обновил client. Прод применит `migrate deploy` сам.
4. **Ранний ACK снимает сериализацию per-webhook** — два быстрых сообщения одного юзера теперь могут обработаться параллельно (concurrency 4); память диалога per-binding best-effort. Приемлемо для багфикса (лучше дублей), зафиксировано как trade-off.
