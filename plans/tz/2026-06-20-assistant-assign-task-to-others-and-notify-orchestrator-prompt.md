# Orchestrator-prompt — назначение задач на других + уведомление + текст подтверждения

Ты — `tz-orchestrator`. Реализуй ТЗ `plans/tz/2026-06-20-assistant-assign-task-to-others-and-notify.md` фаза за фазой силами суб-агентов, с независимой приёмкой. Не дублирую тело ТЗ — оно источник правды; здесь только как вести.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (vexp-first, Bun, без комментариев в коде, Ship-On).
2. `second-brain/index.md`, затем `01_projects/concierge-agent.md`, `01_projects/conversational-channels.md`, `01_projects/tracker.md`.
3. Само ТЗ целиком + анализ `plans/analysis/2026-06-20-assistant-task-assignment-and-notify-and-confirm-text.md`.
4. Код-якоря (перечитать перед правкой, номера строк могли сдвинуться — ищи по символу):
   - `concierge.service.ts` → `buildConfirmPreview`, `CONFIRM_TOOL_RU_NAMES`
   - `service-map-generator.service.ts` → объект tool `create_task`
   - `assistant-channel.bridge.ts` → `CHANNEL_TOOL_WHITELIST_SELF`, строки `Подтвердите действие`/`Готово:`
   - `tracker/services/me-tasks.service.ts` + `me-tasks.controller.ts`
   - `tracker/services/issues.service.ts` → `create`, `addAssignee`, `emitIssueAssigneeChanged`
   - `tracker/services/tracker-emitter.service.ts` → `TrackerEventPayload`, `EVENT_NAME`
   - `conversational/types/event-payload.registry.ts` → `IssueMentionPayloadSchema`, `registry`
   - `conversational/adapters/telegram-bot/telegram-bot.adapter.ts` → `renderText` switch, кейс `issue.mention`
   - `conversational/adapters/max-bot/max-bot.adapter.ts` → `renderText`
   - `conversational/conversational.service.ts` → `sendNotification` (in_app fallback)
   - `schema.prisma` → `model Person`, `model Membership`, `model User`

## Инструменты
- vexp `run_pipeline` первым на каждую фазу (grep/glob блокируются хуком при живом демоне). Fallback при мёртвом демоне — Explore+Grep/Read.
- Context7 НЕ требуется (внешних либ-новинок нет; всё на текущем стеке NestJS/Zod/Prisma).

## Граф фаз (строго последовательно силами суб-агентов)
- **Ф1** (preview) — независима, делай первой. Видимый эффект сразу.
- **Ф2** (backend assign) — раньше Ф3 и Ф4.
- **Ф3** (tool assign_task) и **Ф4** (notify) — независимы между собой, обе после Ф2.
- **Ф5** (verify+docs+second-brain+рефлексия) — последней.
Коммить пофазно (`feat(...)`/`fix(...)`), зелёная приёмка → следующая волна в том же ответе; push — только с подтверждением владельца.

## Факт-чек (НЕ верь отчёту суб-агента — урок «агенты лгут про [x]»)
После каждой фазы сам:
- греп маркеров из Acceptance фазы (например `me/tasks/assign`, `'assign_task'`, `'issue.assigned'`, `PARAM_RU_LABELS`, `assignment` ENV);
- re-Read изменённых участков;
- `bun run typecheck && bun run lint && bun run build` + `bunx vitest run` по затронутым spec;
- проверь негативы (self==actor → 0 пушей; флаг OFF → 0; cross-tenant Person не матчится).
Фаза «закрыта» только когда все её Acceptance машинно подтверждены тобой, не агентом.

## Failure-modes (на что смотреть особо)
- **Цикл модулей** tracker→conversational при регистрации notifier: если Nest ругнётся на циклическую зависимость — перенеси `IssueAssignmentNotifierService` в `ConversationalModule` (инъекция только cfg + типов payload), слушая тот же `TrackerEmitterService.EVENT_NAME`.
- **Двойной эмит** для новой задачи (issue.created + явный assignee_changed) — это ОЖИДАЕМО и безвредно (Б3); не «чинить» подавлением.
- **preview**: убедись, что bridge не строит свой preview мимо `buildConfirmPreview` (он берёт `confirmRequired.preview` из события — значит правка в concierge.service наследуется и в «Готово»).
- **MAX-адаптер**: повторяй его собственную конвенцию экранирования (там не HTML), а не копируй Telegram-HTML дословно.
- **prod**: миграций нет; не вызывай `prisma migrate`; не пиши `new PrismaClient()`; ENV только через `TypedConfigService`/`env.schema.ts`.

## Завершение
По триггеру «после push» — обнови second-brain по таблице производных заметок, prod-deploy-log (Шаг 1 ENV, Шаг 12 smoke), feature-flags.md, закрой строку в реестре «не сделано», запиши рефлексию, дай владельцу краткий prod-diff.
