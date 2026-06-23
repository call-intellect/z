---
date: 2026-06-23
type: рефлексия
feature: meeting-tasks-assignee-probe-closure
branch: feature/2026-06-23-meeting-tasks-assignee-probe-closure
distilled: false
---

# Рефлексия — задачная петля «разговор→трекер→доуточнение→отклонение/доработка→закрытие» (Ф1–Ф9)

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md` (9 фаз, граф зависимостей Ф1→Ф2→(Ф3‖Ф4)→Ф5→Ф6→Ф7→Ф8→Ф9). Канон владельца: задача из любого разговорного канала попадает в трекер с 4 сущностями (название/описание/исполнитель/срок); при нехватке исполнителя/срока Кора задаёт уточняющий вопрос **автору реплики** в кабинет И Telegram (с опцией «удалить»); ответ применяется; закрытие требует конкретики; постановщик узнаёт о закрытии; карточка живёт. Тот же механизм уточнений работает и для решений. Доказанная боль (встреча `01KVQDR2`): «задача мне изучить сервис» приехала без исполнителя — корень в промпте, не в модели.

## Как решал (оркестрация суб-агентами)

Оркестрация фаз силами суб-агентов в **изолированном worktree** `C:\work\z-assignee-probe` с отдельной БД `z_assignee_probe` (чтобы не задеть параллельные сессии в общем `c:\work\z`). По фазам:

- **Ф1** — миграция `20260623083858_evidence_author_person` (`IdeaBlockEvidence.authorPersonId`/`authorLabel`); `block-ingest` пишет автора реплики через `resolveEvidenceAuthor`; specialist-3-15 показывает автора каждой цитаты агенту; `SegmentBuilder.Segment.authorExternalLabel` для внешнего автора чат-бокса («Клиент»).
- **Ф2** — `dismissProbe` гасит все `NotificationDelivery` (взаимное закрытие при отклонении); дедуп probe учитывает адресата за kill-switch `probe.recipientAwareDedupEnabled`. REALITY: двухканальная доставка и закрытие при ОТВЕТЕ уже были (PR #55).
- **Ф3** — правило само-назначения «мне/я» в промпте `tasks-unified` (BASE/STRUCTURED SYSTEM); enrich имён спикеров meeting-extract (`livekitIdentity→Person.fullName`).
- **Ф4** — meeting-extract резолвит исполнителя единым Org-wide `AssigneeResolverService`; author-fallback за `tracker.selfAssignAuthorFallbackEnabled`.
- **Ф5** — probe `task.assignee_unresolved` со встречи адресуется АВТОРУ реплики; новые reason `task.poorly_specified`/`task.false_positive`; опция «удалить»; крутилка `tracker.taskDismissUndoWindowHours` (24). Мягкое удаление **переиспользует существующее** (`IssuesService.softDelete` / intake reject) — БЕЗ миграции.
- **Ф6** — общий `ProbeResponseHandler`: отрицательная ветка для task-reason → мягкое удаление; `task.poorly_specified/false_positive` → дозапись в описание; новый `maybeApplyDecisionProbeAnswer` (решения + «не решение»→`Decision.deletedAt`).
- **Ф7** — gate конкретики `task-closure-verify` в `MeTasksService.completeTask`; при браке — probe `task.completion_detail_missing` вместо тихого кандидата; `tracker.completionDetailGateEnabled`; DTO `candidateId` nullable + `needsDetail`/`clarificationQuestion`.
- **Ф8** — `confirmTaskClosure` шлёт постановщику (`createdById`) eventType `task.closed_for_review` (in_app+telegram+max + рендереры), кроме само-закрытия (Р-7); `tracker.closureNotifyCreatorEnabled`. Движение карточки в «Готово» уже работало.
- **Ф9** — `TaskCompletionHandler` дописывает `IssueActivity(verb='conversation_note', actorType='ai_agent', metadata.sourceBlockId)` при матче блока с открытой задачей и verdict «не выполнено»; описание не перезатирается; идемпотентность по `(issueId, sourceBlockId)`; `tracker.livingCardEnabled`.

REALITY-CHECK подтвердил: половина Ф1/Ф2 уже была сделана merge `unified-task-extraction` (PR #55) — надстраивали, не дублировали.

## Что вышло (верификация)

- typecheck (вкл. `.spec`) / build / lint — зелёные.
- unit + integration против **мигрированной** БД `z_assignee_probe` — зелёные.
- 3 предсуществующих провала, доказанно НЕ наши: `probe-provenance-synthetic` deep-link; telegram/max webhook async-дедуп. integration против `z_main` падает, пока не применена миграция `20260623083858` — ожидаемо (миграция аддитивная, на проде доедет `migrate deploy`).

## Чему научился

1. **Общий стек stash между worktree утягивает чужие файлы.** Изоляция через отдельный worktree+БД спасает от коллизий с параллельными сессиями в `c:\work\z`, но `git stash` поверх общего объектного хранилища всё равно может подхватить чужое — проверять область явным перечислением путей.
2. **`vitest -u` перетирает CRLF во всех `.snap`.** Обновление снапшотов на Windows глобально меняет окончания строк в snapshot-файлах — после `-u` смотреть `git diff` снапшотов и не коммитить массовый CRLF-шум, который не относится к задаче.
3. **Интеграционные фикстуры бьют в `z_main` и требуют миграции.** integration-прогон против основной БД падает до применения новой миграции — это не регрессия, а порядок «migrate → test»; держать тестовую БД мигрированной.
4. **Меняя конструктор сервиса — новые `@Optional()` инжекты в КОНЕЦ.** Иначе ломаются ручные spec-моки, собирающие сервис позиционно; добавление в хвост сохраняет совместимость существующих тестов.

## Что осталось

- Прод-выкат: `docker compose up -d --build backend` (миграция авто через `migrate deploy`, 6 крутилок доедут агрегатором `apply-prod-deploy.ts --mode update`). Diff команд — в `docs/operations/prod-deploy-log.md` (блок 2026-06-23 «Задачная петля…»).
- vNext-хвосты ТЗ: тонкие decision-сценарии (устаревание/конкурирующие версии/`outcome_unknown`), полный отказ от legacy-модели `Task`, UI-редизайн карточки задачи — отдельными ТЗ при появлении.

## Прод-команды

См. `docs/operations/prod-deploy-log.md` — блок «📄 2026-06-23 — Задачная петля…» (полная актуальная инструкция там). Кратко: 1 аддитивная миграция авто, 6 новых AdminSetting через штатный сид-прогон, `docker compose up -d --build backend`.
