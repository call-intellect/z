---
title: Проактивный слой и очередь действий (proactive · pending-actions)
type: project
status: production (частично)
date: 2026-07-05
source: замер кода 2026-07-05
related:
  - "[[probe-agent]]"
  - "[[probe-observers-catalog]]"
  - "[[director-dashboard]]"
  - "[[../02_architecture/chief-of-staff-capability-map]]"
  - "[[../03_processes/notification-dispatch]]"
---

# Проактивный слой и очередь действий

> Две production-подсистемы «Кора сама пишет / собирает то, что требует внимания». Дополняют движок вопросов-уточнений [[probe-agent]] (probe — отдельный модуль). Вместе с operations-дайджестами ([[director-dashboard]]) образуют проактивную половину слоя Chief of Staff. Карта покрытия — [[../02_architecture/chief-of-staff-capability-map]].

## 1. `proactive` — нуджи по графу знаний

Модуль `backend/src/modules/proactive/`. `ProactiveWatcherCron` (`0 */6 * * *`, kill-switch `PROACTIVE_WATCHER_ENABLED`) гоняет 7 правил-наблюдателей по графу и шлёт **мягкий нудж** через `ConversationalService` (in-app/Telegram).

- `proactive-watcher.service.ts` — правила (гигиена графа; из способностей Chief of Staff покрыт частично C3 через `rulePlanItemOverdue`).
- `proactive-message-craft.service.ts` — LLM формулирует нудж в тоне спокойного операционного директора (коротко, всегда причина + следующий шаг, без «СРОЧНО!!!»); детерминированный fallback. Это ядро характера C11 (мягкая половина).
- `proactive-dedup.service.ts` — анти-спам: cap **1 нудж на пользователя в локальный день** (ключ `tenant:user:dateLocal`), **не обходится severity** — прямой ограничитель для «жёсткой эскалации» (C11 gap).
- Модель `ProactiveNotification` (`schema.prisma:8096`).

**Мёртвый груз:** `ProactiveWatcherService.tenantTop()` — приватный метод, нигде не вызывается.

## 2. `pending-actions` — «что требует вашего действия»

Модуль `backend/src/modules/pending-actions/`. Агрегатор из **7 источников** (curation / conflict / intake / probe / task_closure / task_review / progress_draft) с `count`/`list`/`snooze`/`confirm`. `PendingActionsReminderCron` (`0 * * * *`, окно рабочих часов по TZ, dedup 4ч) шлёт часовое Telegram-напоминание.

- `pending-actions.service.ts`, `pending-actions-reminder.cron.ts`.
- Модель `PendingActionSnooze` (`schema.prisma:4026`).
- Это одна из 5 панелей C12 («внимание сегодня»), пока существует как отдельная поверхность, не собрана в единый экран.

## 3. Проактивность — что важно знать

Система реально пушит (не только отвечает), но **жёстко задушена анти-спамом**: proactive ≤ 1 касание/день, probe rate-limit 5/час + 20/день, pending-reminder только в рабочие часы. Severity high это **не обходит** — «операционный директор» физически не может пробить важное наверх. Это ключ к пробелам C3/C5/C11 (см. [[../02_architecture/chief-of-staff-capability-map]]).

## 4. Смежное

- Движок вопросов probe (дедуп, rate-limit, formulation, response-handler) — [[probe-agent]] + каталог наблюдателей [[probe-observers-catalog]].
- Свод блокеров (`BlockerSynthesisService`, 22:00 МСК) и `listOpenForPerson` (построен, 0 потребителей) — модуль `operations`.
- Доставка через каналы — [[../03_processes/notification-dispatch]] (in-app/email/telegram/max/push + `NotificationBudgetLedger`).
