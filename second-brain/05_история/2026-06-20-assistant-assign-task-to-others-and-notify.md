---
date: 2026-06-20
feature: assistant-assign-task-to-others-and-notify
distilled: false
---

# Помощник ставит задачу на другого + уведомление исполнителю + человекочитаемый текст подтверждения

## Что было поставлено
Реализовать ТЗ `plans/tz/2026-06-20-assistant-assign-task-to-others-and-notify.md` (5 фаз, ready-to-implement) силами оркестрации суб-агентов. Из вопроса Насти: помощник не умел ставить задачу на другого человека, исполнителю никто не слал уведомление, а текст подтверждения помощника сыпал сырые англ. ключи (`title: …, dueDate: …`).

## Как решал (оркестрация фаза-за-фазой, суб-агенты пишут код, приёмку делаю сам)
- **Ф1** (`f3f36dc3`): новый util `backend/src/common/utils/format-ru-date.ts` (date-only → «20 июня», datetime → «20 июня, 14:30», неразбираемое — как есть), переписан `buildConfirmPreview` (concierge.service.ts) на `${ruName}: метка — значение` через `CONFIRM_TOOL_RU_NAMES` + `PARAM_RU_LABELS`.
- **Ф2** (`642d52cf`): `POST /api/v1/me/tasks/assign` (MeTasksController/Service), новый `AssigneeResolverService` (имя→user по `tenantId`+активный `Membership`, матч exact→startsWith→contains, дедуп по userId), коды 404 `assignee_not_found` / 409 `assignee_ambiguous`. После `issues.create` — догруз полного Prisma-`Issue` через `prisma.issue.findUnique` и явный `emitIssueAssigneeChanged(added)`.
- **Ф3** (`a1d616b4`): tool `assign_task` в service-map (POST /me/tasks/assign, required title+assigneeName, без readOnly/undoableVia → требует подтверждения), `'assign_task'` в `CHANNEL_TOOL_WHITELIST_SELF`, строка в SYSTEM-промпте concierge-respond (cache-friendly).
- **Ф4** (`939d7165`): `IssueAssignmentNotifierService` (listener `@OnEvent(TrackerEmitterService.EVENT_NAME)` → фильтр `issue.assignee_changed(added)` → `issue.assigned`), eventType `issue.assigned` (Zod-схема в event-payload.registry + рендер Telegram(HTML)/MAX(plain) + channel-policy), kill-switch `ASSIGNMENT_NOTIFICATIONS_ENABLED` (default ON) в env.schema + `get tracker()`.
- **Ф5**: second-brain (api-layer, concierge-agent, module-map, conversational-channels), prod-deploy-log (Шаг 1 ENV, Шаг 12 smoke), feature-flags.md (строка флага), рефлексия.

## Что вышло (верификация)
typecheck/lint/build зелёные; vitest по затронутым spec зелёный (formatRuDate, concierge preview, assignee-resolver, me-tasks service+controller, notifier, telegram-adapter render). `bun run build` дважды подтвердил DI/декораторы/@OnEvent. Негативы покрыты тестами: self-skip (assignee==actor → 0), флаг OFF → 0, action removed → 0, чужой тип → 0, cross-tenant Person не матчится, membership-gate.

## Чему научился (грабли и открытия)
1. **Цикл модулей решается размещением listener'а на «нижней» стороне.** `ConversationalModule` УЖЕ импортит `TrackerModule`, значит notifier на tracker→conversational дал бы цикл; правильно — listener в ConversationalModule, слушает событие по строковому `EVENT_NAME` (статический ES-import без DI-зависимости). ТЗ это предсказал как план Б — он оказался единственно верным.
2. **`EVENT_TYPE_CHANNEL_POLICY` молча роняет новый eventType в `DEFAULT_POLICY=['in_app']`** — без явной строки `issue.assigned` уведомление НЕ дошло бы в бот (только кабинет). Любой новый push-eventType = строка в этой карте, иначе R10 не выполняется. ТЗ это не выделило — нашёл при картографии sendNotification.
3. **`issues.create` возвращает `IssueResponseDto` (dueDate-строка), а эмиттер требует Prisma-`Issue` (dueDate-Date).** Нельзя передать ответ create в `emitIssueAssigneeChanged` — нужен догруз полного Issue. ТЗ-псевдокод `emit({issue})` был неточен по типу.
4. **basicIssue кладёт dueDate как полный ISO** → `formatRuDate` показал бы «00:00». Решение: в notifier `dueDate.slice(0,10)` → date-only → чистое «20 июня».
5. **Параллельные сессии в общем рабочем каталоге = контаминация.** `feature-flags.md`, `CLAUDE.md`, `02_architecture/code-pitfalls.md`, `04_не-сделано/README.md` правились другими сессиями (config-аудит ENV→AdminSetting, decision-materialization). Урок: перед каждым `git add` — `git diff` файла; контаминированную строку стейджить выборочно (`git apply --cached -R` чужого hunk'а, рабочее дерево не трогать); где hunk'и неразделимы (04_не-сделано) — не трогать файл вовсе и зафиксировать в отчёте. Подтверждает правило о git worktree на сессию.

## Открыто / хвост
- Строка про этот пробел в `second-brain/04_не-сделано/README.md` НЕ перенесена в архив (файл мид-флайт у 2 параллельных сессий) — архивировать вручную после их слияния.
- Богатый выбор проекта/отдела при назначении, согласование-отклонение исполнителем, обогащение `issue.created` исполнителями — осознанно vNext (см. «Вне scope» ТЗ).
