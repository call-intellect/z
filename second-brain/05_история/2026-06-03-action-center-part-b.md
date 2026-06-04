---
type: reflection
date: 2026-06-03
distilled: false
---

# 2026-06-03 — Action Center Часть B: центр подтверждений

## Постановка

Реализовать **Часть B «Action Center»** ТЗ `plans/tz/2026-06-02-action-center-pending-confirmations.md` (ветка `feature/action-center-trust-ladder`, worktree `C:\work\z-action-center`). Цель — единая поверхность «что ждёт моего подтверждения» поверх четырёх источников (curation / conflict / intake / probe): живой бейдж, страница `/actions`, глобальный колокольчик, блок на дашбордах, Telegram-напоминания и one-tap подтверждение. Роль — оркестрация по фазам B0-B5 (кодеры + самопроверка) + документирование в second-brain (эта сессия).

## Что сделал

Оркестрация по шести фазам (6 коммитов):

- **B0** — новый модуль `backend/src/modules/pending-actions/`: `PendingActionsService` (агрегатор) + 4 read-провайдера (curation/conflict/intake/probe, читают Prisma напрямую, tenant + роль-scoped). Модель `PendingActionSnooze` (generic «отложить»). REST `GET /api/v1/pending-actions/count` (`{total, bySource}`), `GET /api/v1/pending-actions` (urgent-first), `POST /api/v1/pending-actions/snooze`. owner/admin видят все pending по curation/conflict/intake; probe — только свои.
- **B1 (frontend)** — пункт сайдбара «Подтверждения» с живым бейджем (`usePendingActionsCount`, SWR 60с); глобальный колокольчик `PendingActionsBell` (desktop top-bar в `AppShell` + мобильный `Header`, Popover со списком); страница `/actions` (фильтр по источнику, deep-link, snooze 1д/3д/7д). Слои `pending-actions.api` / `domain/pending-action` + хуки `usePendingActionsCount` / `usePendingActions`.
- **B2** — блок `requiresAction` в `DirectorDashboardDto` (персонально по `userId`, из `PendingActionsService`, best-effort); `RequiresActionTile` на главном дашборде + `RequiresActionBanner` на «Панели операций»; deep-link `/actions`; `danger` при `conflict>0` / янтарный иначе / скрыт при 0.
- **B3** — `PendingActionsReminderCron` (`@Cron('0 * * * *')`, слоты 9/12/15/18/21 локального времени, батч одним сообщением, ТОЛЬКО при `total>0`, уважает quietHours/disabledUntil, Redis-dedup per слот, Telegram через `ConversationalService`, детерминированный шаблон без LLM); eventType `actions.reminder` (registry + `EVENT_TYPE_CHANNEL_POLICY`); строка «Ждёт подтверждения: N» в ежедневном дайджесте (per-recipient, best-effort). Метрика `pending_reminder_sent_total`.
- **B4** — `POST /api/v1/pending-actions/confirm`: one-tap подтверждение light curation (delegate в `CurationService.decide` approve, RBAC внутри); кнопка «Подтвердить» на `canQuickConfirm` в `/actions` и колокольчике.
- **B5** — `CurationItemLifecycleCron` (`@Cron('0 2 * * *')`, per-Org): pending `CurationItem` с `expiresAt < now` → `status='expired'` (оживили мёртвый `expiresAt`), метрика `curation_item_expired_total` + age-гистограмма, best-effort уведомление owner/admin; провайдер курации помечает urgent за `LEAD_DAYS=3` до истечения.

Документирование (эта сессия, worktree `C:\work\z-action-center`, только .md):
- `second-brain/02_architecture/module-map.md` — раздел §pending-actions (модуль + 2 крона, зависимости curation/conversational).
- `second-brain/02_architecture/data-model.md` — модель `PendingActionSnooze`.
- `second-brain/01_projects/api-layer.md` — раздел Pending Actions (`/count`, `/`, `/snooze`, `/confirm`).
- `second-brain/01_projects/frontend-pages.md` — `/actions`, колокольчик, пункт сайдбара, блок `requiresAction`, хуки.
- `second-brain/01_projects/workers-queues.md` — кроны `pending-actions-reminder` и `curation-item-lifecycle`.
- `docs/operations/prod-deploy-log.md` — запись «🔔 Action Center Часть B» (Шаги 4/11/12).

## Ключевые развилки

1. **Telegram zero-button (β-1) — НЕ реверсить.** Быстрое подтверждение (`confirm`) сделано в приложении (кнопка в `/actions` и колокольчике), а в Telegram-напоминании кнопок нет. Доказательство решения: анти-штамповка — в админке ~30 человек, inline-кнопка «Подтвердить» прямо в чате провоцировала бы массовое «согласие не вникая» (см. memory `feedback_no_human_in_loop_for_clone_learning`). Напоминание зовёт в приложение, где есть контекст.
2. **Маршрут `/curation/[id]` отсутствует → actionUrl на рабочую очередь `/curation`.** Провайдеры curation/conflict отдают `actionUrl='/curation'` (существующая master-detail очередь), а не на несуществующие detail-страницы. Доказательство: detail-роутов `/curation/[id]` и `/curation/conflicts` во фронте нет — ссылка на них дала бы 404. Detail-страницы вынесены в follow-up.

## Что вышло

6 коммитов, тесты зелёные (backend + frontend). `prisma db push` (модель `PendingActionSnooze`) отложен — изоляция через отдельный worktree/dev-Postgres, чтобы не задеть параллельную сессию в `C:\work\z`; push схемы — на момент выката через `migrate`-контейнер. Документация second-brain и prod-deploy-log обновлены по чек-листу производных заметок (новая модель БД → data-model + prod-deploy Шаг 4; новый модуль → module-map; новые кроны → workers-queues + Шаг 12; новые эндпоинты → api-layer + Шаг 12; новая страница/колокольчик → frontend-pages).

## Чему научился

1. **Агрегатор поверх существующих источников — read-провайдеры, не дублирование данных.** Action Center ничего своего не хранит (кроме `PendingActionSnooze` — «отложить»); 4 провайдера читают существующие таблицы curation/conflict/intake/probe напрямую. Урок: для «единой ленты из N источников» не плодить денормализованную таблицу-зеркало — провайдер-паттерн с общим нормализованным DTO дешевле и не рассинхронизируется.
2. **actionUrl привязывать только к существующим роутам.** Соблазн сослаться на «идеальную» detail-страницу ломается о реальный роутинг (404). Перед тем как зашить deep-link — проверить, что страница есть; иначе вести на рабочую очередь и вынести detail в follow-up.
3. **«Оживление мёртвого поля».** `CurationItem.expiresAt` существовал, но никто не переводил истёкшие в `expired` — поле было декоративным. `CurationItemLifecycleCron` его наконец задействовал. Урок: при работе с очередью проверять, что terminal-состояния реально проставляются кем-то, иначе фильтры по статусу врут.

## Что осталось (follow-up)

- Detail-страницы `/curation/[id]` и `/curation/conflicts` (сейчас actionUrl ведёт на рабочую очередь `/curation`).
- Вынос `LEAD_DAYS` и окон напоминаний (9/12/15/18/21) из констант кода в `AdminSetting` (параллельный поток; см. memory `feedback_admin_settings_not_env_or_code`).
- `prisma db push` модели `PendingActionSnooze` — на момент выката на прод.

## Прод-команды

Полная актуальная инструкция — `docs/operations/prod-deploy-log.md` → запись «🔔 2026-06-03 — Action Center Часть B». Кратко diff:
- Шаг 4: `docker compose exec backend bun run prisma:push` (новая модель `PendingActionSnooze`).
- Шаг 11: `docker compose up -d --build backend frontend`.
- Шаг 12: smoke `GET /api/v1/pending-actions/count`; grep `PendingActionsReminderCron`/`CurationItemLifecycleCron`; grep eventType `actions.reminder`; фронт — `/actions` + колокольчик + сайдбар.
- ENV/seed — не требуются.
