---
date: 2026-07-06
type: reflection
title: Задачи встречи — привязка к встрече + назначенец гостя (вариант А)
distilled: false
---

# Задачи встречи: привязка к встрече + назначенец гостя

## Что было поставлено
Баг из прод-приёмки: после разбора отчёта встречи (а) задачи не появлялись в карточке встречи (вкладка «Задачи встречи» пустая), (б) задача, адресованная **гостю** (клиенту без аккаунта), авто-назначалась на постороннего сотрудника Org через skill-routing. Нужно: привязать задачи к встрече и не назначать чужих людей на задачи гостя.

## Как решал (файлы, коммиты)
- **Диагностика** — по прод-логам + SSH-сверка (read-only, `docs/operations/prod-ssh-access.md`): код захода B на проде задеплоен (combo = владелец задач встреч, `MeetingExtractActionsService` снесён), но дефект сохранялся именно на `channel=meeting_report`. Корень: `TaskDraftMaterializerService` был канало-агностичным и НЕ резолвил `meetingId` из `sourceId=report_<id>`, а `meeting_report` не трактовался как meeting (шёл skill-routing + owner-fallback). Анализ → `plans/analysis/2026-07-06-meeting-tasks-not-linked.md`, архитектура (вариант А для гостя) → `plans/architecture/2026-07-06-meeting-tasks-linkage-fix.md`, ТЗ → `plans/tz/2026-07-06-meeting-tasks-linkage-fix.md`.
- **Ф1** (`c5878f21`) — materializer резолвит голый `meetingId` из `report_<id>` → `IntakeIssue.meetingId` (→ `Issue.linkedMeetingIds` при промоуте); `meeting_report`=meeting → always-promote без skill-routing/owner-fallback. `task-draft-materializer.service.ts` + spec.
- **Ф2** (`e2a7c71b`) — назначенец гостя вариант А: имя из поля `assignee` комбо-промпта, не сопоставленное сотруднику, пишется в новую колонку `IntakeIssue.ownerHintRaw` + `Issue.ownerHintRaw` (миграция `20260706120000_add_owner_hint_raw`, аддитивная nullable ×2). Исполнитель НЕ резолвится.
- **Ф3** (`ac94a2b3`) — снос фантомного пассивного taskType `meeting-extract-actions` из `llm-router.service.ts` (combo — единственный источник; skip-reason спайна 3-15 уточнён).
- **Ф4** (`4abc5aad`) — структурные логи `assignee_resolve`/`meeting_linkage`/`combo_task_linkage`/`promote_assignee` для диагностики привязки/резолва по прод-логам.
- **Ф2b** (`2aa5b50a`) — FE-пометка «по словам гостя» во вкладке «Задачи встречи» (`frontend/src/domain/tracker/issue.ts` + spec).

## Что вышло
- 5 коммитов на `work/2026-07-02`. `typecheck` / `lint` / `build` зелёные; затронутые тесты обновлены и проходят (материализатор, `intake-auto-triage.worker`, `tasks-unified`, `specialists-combined.prompt` snap, FE `issue.spec.ts`).
- Docs: `data-model.md` (§IntakeIssue/§Issue += `ownerHintRaw`), `tracker.md` (§«Задачи ВСТРЕЧИ»), `prod-deploy-log.md` Шаг 4 (миграция).
- Прод-эффект: задачи встречи попадают в карточку через `linkedMeetingIds`; задача гостя — без исполнителя + сырое имя + FE-метка.

## Чему научился
- **Диагностика по прод-логам через `channel`**: дефект жил только на `channel=meeting_report` — код-путь был общий (канало-агностичный materializer), но ветвление по каналу отсутствовало. Сверять «код задеплоен» ≠ «поведение верное» именно по конкретному каналу ingest.
- **Фантомный taskType**: `meeting-extract-actions` оставался пассивным в llm-router после сноса сервиса захода B — мёртвый маршрут вводил в заблуждение при чтении кода; такие «оставленные на совместимость» ключи стоит зачищать.
- **Владелец задач встречи = комбо** `SpecialistsCombinedService`, не спайн 3-15 и не снесённый `MeetingExtractActionsService`; задачи достаются тем же проходом, что граф.
- **Два разных «assignee»**: поле `assignee` в промпте combo (сырое имя от LLM) ≠ резолв исполнителя в `tasks-unified`/`AssigneeResolverService` — для гостя резолв надо ГЛУШИТЬ, а сырое имя сохранять (вариант А), иначе skill-routing цепляет постороннего сотрудника.
