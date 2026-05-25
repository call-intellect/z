---
title: ТЗ — журнал операций (Operations Log) в Z-Admin
date: 2026-05-25
type: reflection
tags: [admin, observability, logging, planning, tz]
distilled: false
---

# Сессия 2026-05-25 — ТЗ для admin-operations-log

## Что было поставлено

Пользователь попросил: «в админке нужна отдельная вкладка с логами — таблица, чтобы видеть, что упало / что прошло хорошо у всех агентов и кронов; писать в БД и зеркалить в админку, чтобы не лазить на сервер; проанализируй, узнай актуальные практики, напиши ТЗ».

Триггер — заходим в фазу, где будет много фоновых процессов (cron, BullMQ, AI-агенты), и нужен централизованный «пульс»-журнал без SSH.

## Как решал

1. **Разведка существующего.** Параллельно прогрел `Glob`/`Grep`/`Read`:
   - Логгер: `@nestjs/common.Logger` (stdout), `nestjs-pino` НЕ используется (предположение из CLAUDE.md оказалось неверным — есть упоминание `PinoLogger` в комментарии `main.ts:82`, но фактически логирует обычный Nest Logger).
   - `AllExceptionsFilter` (`backend/src/common/filters/all-exceptions.filter.ts:55`) — пишет в `Logger`, но НЕ в БД.
   - `AdminAuditService` (`backend/src/modules/admin/audit/admin-audit.service.ts`) + `SuperAdminAccessLog` — только действия super_admin.
   - `AdminIncidentsService` (`backend/src/modules/admin/incidents/admin-incidents.service.ts`) — live из Redis через `Queue.getFailed()`, **не персистится** в БД.
   - В Prisma уже 6 доменных таблиц-логов: `AiUsageLog`, `WebhookDelivery`, `MailInboundLog`, `AuditLog`, `ApiAccessLog`, `SuperAdminAccessLog`.
   - UI: `/admin/audit`, `/admin/incidents`, `/admin/platform/workers`, `/admin/platform/crons`, `/admin/health` уже есть.

2. **context7.** Спросил `/pinojs/pino` про custom transport с batching (получил пример `pino-abstract-transport` + `SonicBoom` + redact-patterns) и `/taskforcesh/bullmq` про `QueueEvents` (получил pattern глобального listener'а, который слушает completed/failed/stalled из любого процесса).

3. **Архитектурный выбор.** Решил **не делать pino-transport в Postgres** — это перегруженно для ~50k событий/день. Вместо этого — собственный `OperationLogService` с in-process буфером (≤1000) + batch flush (2с / 100 записей). Запись из БД не блокирует hot path; при фейле INSERT — `Logger.error` в stdout + дроп (без infinite retry → иначе залезем в loop при incident).

4. **Принцип «не дублировать».** Доменные таблицы (`AiUsageLog` и т.п.) оставляем как есть. UI `/admin/logs` агрегирует **7 источников** через адаптер `LogItem`. Новый `OperationLog` пишет только то, для чего нет специализированной таблицы (cron tick'и, BullMQ events, HTTP-ошибки 5xx + админ 401/403, internal warn/error).

5. **Sampling + retention + redaction** заложены сразу: иначе через месяц БД распухнет, а в payload протечёт `Authorization: Bearer ...`.

6. **Открытые вопросы.** 7 пунктов в конце ТЗ (sampling rate, retention, org-доступ, лимит экспорта, алерты, HTTP-success, WORKER_INSTANCE) — чтобы согласовать с пользователем ДО Фазы 1, а не после.

## Что вышло

- Создан [`plans/tz/2026-05-25-admin-operations-log.md`](../../plans/tz/2026-05-25-admin-operations-log.md), 545 строк, 7 фаз, оценка ~7.5 чел.-дней.
- Коммит `ac0b4e8 docs(tz): ТЗ — журнал операций (Operations Log) в Z-Admin` запушен в `dev`.
- В коммит попал ТОЛЬКО ТЗ-файл; 36 modified + 50+ untracked чужих файлов остались в рабочем дереве нетронутыми (явный `git add <path>`, без `-A`).

Реализация — ждёт ответа пользователя на 7 открытых вопросов.

## Чему научился

1. **Перед "добавим логирование" сначала ищи, что уже залогировано.** В Z уже 6 доменных лог-таблиц + interceptor + filter. Универсальный «всё в одну таблицу» выглядел бы как duplication. Правильное решение — **витрина-агрегатор** + новая таблица только для «всего остального». Эта мысль не появляется автоматически, если стартовать с «новой Prisma-модели и UI» без разведки.

2. **`AdminIncidentsService` уже читает failed BullMQ jobs из Redis live, но НЕ персистит их.** Это важный pitfall: при TTL очистке Redis такие jobs пропадают. Persistent зеркало в `OperationLog` — must-have.

3. **Pino-transport в Postgres = anti-pattern для приложения с собственным сервисом БД.** Прямая запись через `OperationLogService` (Prisma + batch) проще тестировать и легче катить, чем external transport. Pino остаётся stdout-only.

4. **Sampling success-логов важен с самого начала.** При 4 worker'ах × concurrency 2-4 × средне 1-3 job/с легко получить 50k+ completed-событий/сутки. 1/10 sampling — разумный дефолт.

5. **Open questions в конце ТЗ — экономят время.** Если бы я сразу зафиксировал sampling=10, retention=30/90/180, org-доступ только super_admin — пользователь мог бы потом сказать «а я хотел иначе» → переписывание. Лучше согласовать ДО Фазы 1.

## Что осталось

- Получить от пользователя ответы на 7 открытых вопросов в ТЗ.
- Стартовать Фазу 1 (Prisma-модель + базовый сервис).
- После реализации каждой фазы — обновлять `[ ]` → `[x]` в ТЗ.
