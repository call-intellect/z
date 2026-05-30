# Каталог бизнес-процессов Z

> **Что это:** реестр сквозных процессов платформы. Каждая строка — отдельный документ в этой папке с описанием в двух регистрах (бытовой + технический) и пошаговой таблицей со статусами.
>
> **Зачем:** быстро понять, что платформа реально делает; найти, где сломалось; видеть расхождения между задумкой и реализацией.
>
> **Формат карточки:** см. [[_template]]. ТЗ каталога: [`plans/analysis/2026-05-29-business-processes-catalog.md`](../../plans/analysis/2026-05-29-business-processes-catalog.md).
>
> **Сводный отчёт расхождений «задумано vs реализовано»:** [`plans/analysis/2026-05-29-processes-gaps-summary.md`](../../plans/analysis/2026-05-29-processes-gaps-summary.md).
>
> **Условные обозначения статуса:**
> - ✅ implemented — реализован полностью, работает в проде/dev.
> - ⚠️ partial — частично реализован, есть TODO / отключённые ветки / неполная маршрутизация.
> - ❌ designed_only — только в ТЗ, кода нет.
> - 🗑 deprecated — был, отменён или заменён.

## Группа А. Встречи и медиа

| Процесс | Триггер | Источник | Статус | Аудит |
|---|---|---|---|---|
| [[meeting-create-and-invite]] | действие | хост жмёт «Новая встреча» | ✅ implemented | 2026-05-30 |
| [[meeting-in-progress]] | webhook | LiveKit-сессия активна, события room/track | ⚠️ partial | 2026-05-29 |
| [[meeting-end-and-recording]] | webhook | LiveKit `room_finished` / `egress_ended` | ✅ implemented | 2026-05-29 |
| [[meeting-post-processing]] ⭐ | webhook | LiveKit `egress_ended` → ai-pipeline | ⚠️ partial | 2026-05-29 |
| [[recording-retention]] | cron | TTL по тарифу (по умолчанию 30д) | ✅ implemented | 2026-05-29 |

## Группа Б. Conversational-каналы (входящие)

| Процесс | Триггер | Источник | Статус | Аудит |
|---|---|---|---|---|
| [[telegram-inbox-ingestion]] ⭐ | webhook | `POST /webhooks/telegram-bot` | ✅ implemented | 2026-05-30 |
| [[inapp-free-note-ingestion]] | действие | `POST /me/notifications/free-note` | ✅ implemented | 2026-05-29 |
| [[email-to-task]] | cron/IMAP | `MailInboundCron */2 * * * *` | ✅ implemented | 2026-05-29 |

## Группа В. Conversational-каналы (исходящие)

| Процесс | Триггер | Источник | Статус | Аудит |
|---|---|---|---|---|
| [[notification-dispatch]] | event | внутренний `ConversationalService.sendNotification` | ✅ implemented | 2026-05-29 |
| [[probe-question-flow]] | event | `ProbeService.suggest(...)` | ✅ implemented | 2026-05-29 |
| [[coo-daily-digest]] ⭐ | cron | `0 22 * * *` UTC | ✅ implemented | 2026-05-29 |

## Группа Г. Знания (knowledge-core)

| Процесс | Триггер | Источник | Статус | Аудит |
|---|---|---|---|---|
| [[raw-event-to-graph]] | event | `core.raw-events` | ✅ implemented | 2026-05-29 |
| [[theme-clustering]] | cron | `15 * * * *` | ✅ implemented | 2026-05-29 |
| [[card-rollup-v2]] | event | `core.card-rollup-v2` (debounce 60s) | ✅ implemented | 2026-05-29 |
| [[reframing-cycle]] | cron | `0 3 * * *` | ✅ implemented | 2026-05-29 |

## Группа Д. Специалисты Слоя 3

| Процесс | Триггер | Источник | Статус | Аудит |
|---|---|---|---|---|
| [[specialist-3-1-regulations]] | event | `core.specialist-routing` → `3-1-regulations` | ✅ implemented | 2026-05-29 |
| [[specialist-3-2-knowledge-clone]] | event/cron | `core.knowledge-clone-rebuild` + `0 */6 * * *` | ✅ implemented | 2026-05-29 |
| [[specialist-3-3-decisions]] | event | `core.specialist-routing` → `3-3-decisions` | ✅ implemented | 2026-05-29 |
| [[specialist-3-4-project-customer]] | event | `core.specialist-routing` → `3-4-project-customer` | ✅ implemented | 2026-05-29 |
| [[specialist-3-5-insights]] | event/cron | `core.specialist-routing` + `0 */6 * * *` | ✅ implemented | 2026-05-29 |
| [[specialist-3-6-ideas]] | event | `core.specialist-routing` → `3-6-ideas` | ⚠️ partial | 2026-05-29 |
| [[specialist-gamma-1-skill-clone]] | event/cron | debounce 60s + cron `0 6 * * SUN` | ⚠️ partial | 2026-05-29 |

## Группа Е. Трекер

| Процесс | Триггер | Источник | Статус | Аудит |
|---|---|---|---|---|
| [[issue-lifecycle]] | действие | пользователь создаёт/двигает задачу | ✅ implemented | 2026-05-29 |
| [[tracker-to-knowledge]] | event | `IssueActivity` → `RawEvent` через `tracker.adapter` | ✅ implemented | 2026-05-29 |

## Группа Ж. Биллинг и онбординг

| Процесс | Триггер | Источник | Статус | Аудит |
|---|---|---|---|---|
| [[signup-and-onboarding-wizard]] | действие | регистрация нового пользователя | ⚠️ partial | 2026-05-29 |
| [[billing-cycle-tochka]] | действие/cron | Tochka OpenBanking + `BillingCycleCron` | ⚠️ partial | 2026-05-30 |
| [[referral-program]] | event | `@OnEvent('billing.invoice.paid')` + cron 10-го числа МСК | ✅ implemented | 2026-05-30 |

---

## Сводка по статусам (Волна 2 завершена)

| Статус | Кол-во |
|---|---|
| ✅ implemented | 21 |
| ⚠️ partial | 6 |
| ❌ designed_only | 0 |
| 🗑 deprecated | 0 |
| **Всего процессов в реестре** | **27** |

⭐ — эталонные процессы Волны 1.

## Сводка по триггерам

| Триггер | Процессы |
|---|---|
| webhook | meeting-end-and-recording, meeting-in-progress, meeting-post-processing, telegram-inbox-ingestion |
| cron | coo-daily-digest, email-to-task, recording-retention, reframing-cycle, theme-clustering |
| event | card-rollup-v2, notification-dispatch, probe-question-flow, raw-event-to-graph, referral-program, specialist-3-1..3-6, specialist-gamma-1-skill-clone, tracker-to-knowledge |
| user_action | billing-cycle-tochka, inapp-free-note-ingestion, issue-lifecycle, meeting-create-and-invite, signup-and-onboarding-wizard |

---

## Где смотреть расхождения «задумано vs реализовано»

В каждой карточке **раздел 8** — расхождения только этого процесса.

Сводный отчёт по всем 27 процессам с группировкой по типу проблемы (критические gap'ы, реализовано иначе, реализовано без ТЗ, открытые вопросы) — [`plans/analysis/2026-05-29-processes-gaps-summary.md`](../../plans/analysis/2026-05-29-processes-gaps-summary.md).
