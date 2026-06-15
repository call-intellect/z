---
title: Перенос задачи в другой проект (вручную сменить проект у Issue)
type: tz
status: ready-to-implement
date: 2026-06-15
owner: Сергей (sergrv80@gmail.com)
discovered_during: plans/tz/2026-06-15-cabinet-qa-bugfixes.md (Ф3 — дефолт-проект «Входящие»)
relates_to:
  - backend/src/modules/tracker/services/issues.service.ts
  - backend/src/modules/tracker/dto/issues/update-issue.dto.ts
  - backend/src/modules/tracker/controllers/issues.controller.ts
  - frontend/app/(authenticated)/tasks
---

# ТЗ. Перенос задачи в другой проект

## Контекст (требование владельца, 2026-06-15)

В Ф3 QA-багфиксов задачи без проекта теперь автоматически попадают в общую
папку «Входящие» (вместо ошибки `target_project_required`). Владелец явно
поставил условие: **«потом задачи можно вручную поменять и прикрепить проект
какой-то другой»** — то есть перенести Issue из «Входящих» (или любого проекта)
в нужный проект.

**Проблема:** такой возможности сейчас НЕТ — ни в backend, ни во фронте.
- `UpdateIssueSchema` (`update-issue.dto.ts`) не содержит `projectId`; PATCH
  задачи не умеет менять проект.
- Нет эндпоинта «move to project». `boardId` меняется только в пределах того же
  проекта (`BoardsService.assertBoardInProject`).
- Во фронте (`tasks/*`, `src/api/tracker/*`) нет селектора проекта у задачи.

## Почему перенос нетривиален (инварианты)

`Issue` (`schema.prisma` model Issue):
- `identifier String` — «PROJ-123», **уникален per tenant**;
- `sequenceId Int` — порядковый **per project** (`@@unique([projectId, sequenceId])`);
- `stateId` — принадлежит статусам исходного проекта (`IssueState` per project);
- `boardId` — доска исходного проекта (`@@unique([projectId, ...])`);
- `cycleId` — цикл исходного проекта.

Простая смена `projectId` сломает: уникальность identifier/sequence в целевом
проекте, ссылки на чужой state/board/cycle. Поэтому перенос = атомарная
ре-аллокация:
1. новый `sequenceId` = max(sequenceId в целевом проекте)+1 (как в
   `IssuesService.create`, защита `@@unique([projectId, sequenceId])`);
2. новый `identifier` = `${targetProject.identifier}-${newSeq}`;
3. `stateId` → дефолтный статус целевого проекта (или маппинг по category);
4. `boardId` → дефолтная доска целевого проекта (reuse `resolveBoardIdForCreate`);
5. `cycleId` → null (цикл исходного проекта неприменим);
6. запись `IssueActivity` (verb `moved_to_project`), WS-событие, метрика.

Открытые подвопросы: что делать с подзадачами (`parentId`) при переносе родителя
(переносить поддерево или запретить перенос задач с детьми) — решить в Фазе 1.

## Объём работ

### Фаза 1 — backend: move-to-project [ ]
- `IssuesService.moveToProject(issueId, targetProjectId, tenantId, userId)` —
  атомарная ре-аллокация (1–6 выше) в `$transaction`. Валидации: целевой проект
  того же tenant, не архивный; задача существует; запрет переноса в тот же
  проект (no-op/400). Подзадачи: v1 — запретить перенос задачи, у которой есть
  `parentId` или дети (понятная 400), либо переносить поддерево — выбрать в Ф1.
- Эндпоинт: `POST /api/v1/issues/:id/move` body `{ targetProjectId }` (явный
  verb предпочтительнее, чем перегружать PATCH). RBAC как у PATCH issue.
- Тесты: успешный перенос (новый identifier/sequence/state/board, cycle=null,
  activity); негатив (тот же проект, чужой tenant, архивный проект); подзадачи.

### Фаза 2 — frontend: селектор проекта у задачи [ ]
- В карточке/детале задачи — «Проект: <name> · Перенести» → диалог выбора
  проекта (переиспользовать паттерн пикера проектов из `/intake`).
- `issuesApi.move(orgId, issueId, targetProjectId)`; оптимистичное обновление +
  тост реальной ошибки (`humanizeApiError`).
- Доступно в т.ч. для задач в «Входящие» — закрывает кейс владельца.

## Acceptance
- Задачу из «Входящие» можно перенести в выбранный проект; у неё меняется
  префикс/идентификатор на целевой, она появляется в целевом проекте и пропадает
  из исходного; статус/доска валидны для целевого проекта.
- Перенос в тот же проект — корректная ошибка/no-op.
- typecheck/lint/build + тесты (backend Ф1, frontend Ф2) зелёные.

## Прод / Ship-On
- Без миграций (поля Issue уже есть). Эндпоинт + UI включаются сразу (Ship-On),
  без флагов.

## Итог
Не реализовано (ТЗ написано по требованию владельца в ходе Ф3). Дефолт-проект
«Входящие» (Ф3) уже устраняет ошибку; этот ТЗ даёт обещанную возможность увести
задачу из общей папки в нужный проект. Реализация — по явному «делаем перенос
задач между проектами».
