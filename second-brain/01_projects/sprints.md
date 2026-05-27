---
title: Спринты — управление циклами с AI-помощником
status: in_progress
created: 2026-05-27
related:
  - 01_projects/tracker.md
  - 01_projects/ai-analysis-by-type.md
  - 01_projects/ai-jobs.md
  - 02_architecture/data-model.md
---

# Спринты

«Спринт» — это бизнес-цикл работы команды с гибкой привязкой и AI-помощником,
который читает текущее состояние и подсказывает руководителю, что идёт не так.
В коде спринт = `Cycle` (модель трекера). В интерфейсе и копи-стрингах слово
«Цикл» заменено на «Спринт».

## Шесть продуктовых принципов

1. **AI не двигает задачи сам** — только показывает, читает, подсказывает.
2. **Никаких жёстких ритуалов** — обязательных встреч в определённое время нет.
3. **Длина спринта — настройка**, не методология. 1/2/3/4 недели.
4. **Гибкая привязка** — компания / клиент / поставщик / отдел / сотрудник / проект.
5. **Задачи добавляются вручную** или через подтверждение во входящих. Никаких
   автоматических созданий.
6. **Подсказки качества — сразу**, а не пост-фактум.

## Ключевые сущности

| Сущность | Где живёт | Назначение |
|---|---|---|
| `Cycle` | `backend/prisma/schema.prisma` (model Cycle) | Сам спринт. Имя в UI — «Спринт». |
| `Project` (расширен) | `backend/prisma/schema.prisma` | 4 опц. scope-поля: `customerCardId`, `vendorId`, `subjectPersonId`, `departmentId`. Инвариант ≤1 заполненного — валидация в `CreateProjectSchema.superRefine` + `ProjectsService.update`. |
| `Meeting.linkedCycleId` | `backend/prisma/schema.prisma` | Встреча, запущенная по спринту (обычно `type=sprint_review`). |
| `SprintHint` | `backend/prisma/schema.prisma` | Подсказка помощника. 10 видов (`SprintHintKind`), 3 severity, 3 статуса. `contentHash` для дедупликации воркером. |
| `MeetingType.sprint_review` | `backend/prisma/schema.prisma` (enum) | Встреча «Итоги спринта». Промпт — ретроспективного стиля (см. `prompts/index.ts`, `meeting-report-fast.prompt.ts`, `summary-v2.prompt.ts`). |

## API (REST)

| Метод и путь | Назначение |
|---|---|
| `GET /api/v1/sprints` | Master-detail список спринтов уровня Org с фильтрами (status / scopeKind / q), сортировками (startDate / progress / hints) и пагинацией. |
| `POST /api/v1/sprints/quick-create` | Атомарное создание Project + Cycle + Board + IssueStates в одной transaction. Принимает scope ∈ {org, customer, vendor, person, department, project} с auto-генерацией slug/identifier. Idempotency-Key. |
| `GET /api/v1/cycles/:id/dashboard` | Агрегированные данные дашборда спринта. Redis-кэш 5 мин. |
| `POST /api/v1/cycles/:id/start-meeting` | Запуск встречи (default `type='sprint_review'`). Создаёт `Meeting` с `linkedCycleId`. |
| `GET /api/v1/cycles/:id/hints` | Список активных подсказок. |
| `POST /api/v1/sprint-hints/:id/dismiss` | Закрыть подсказку (`status='dismissed'`). |
| `POST /api/v1/sprint-hints/:id/resolve` | Пометить выполненной (`status='resolved'`). |
| `GET /api/v1/cycles/:id/review` | Прочитать финальный отчёт (`ready` / `pending` / `failed`). |
| `POST /api/v1/cycles/:id/review/regenerate` | Перезапустить генерацию финального отчёта. |
| `POST /api/v1/vendors` | Создать поставщика (для inline-create из мастера спринта). RBAC `vendor:write`. |
| `PATCH /api/v1/vendors/:id` | Обновить поставщика. RBAC `vendor:write`. |
| `DELETE /api/v1/vendors/:id` | Soft-delete поставщика. RBAC `vendor:delete`. |

Существующие cycle-endpoint'ы (`/api/v1/cycles/:id`, list, create, complete) —
без изменений. Полная карта см. в [api-layer.md](api-layer.md).

## AI-агент: Specialist 3-13 «Помощник по спринтам»

- **Worker**: `backend/src/modules/knowledge-core/workers/sprint-helper.worker.ts` —
  consumer очереди `core.specialist-routing` с jobName=`3-13-sprint-helper`,
  concurrency=1.
- **Service**: `sprint-helper.service.ts` — собирает контекст и вызывает LLM.
- **Cron**: `sprint-helper.cron.ts` — каждые 4 часа enqueue по всем активным
  циклам (`completedAt IS NULL AND endDate >= now`), cap 50.
- **LLM-таск**: `sprint-helper-suggest`. Промпт: `prompts/sprint-helper-suggest.prompt.ts`.
  Цепочка провайдеров (см. seed `seed-llm-task-routes-sprints.ts`):
  - primary — `deepseek/deepseek-v4-pro` (JSON Schema strict, дешёвая capable);
  - secondary — `openai-via-proxy/gpt-5.4-mini`;
  - tertiary — `ollama/qwen3.5:9b`.
- **Дедупликация**: SHA-1 hash(title+body), `contentHash` в `SprintHint`. Один
  и тот же совет дважды не появится.
- **Лимиты в промпте**: до 10 подсказок за вызов, MIN_CONFIDENCE=0.5,
  пропускает задачи моложе 24 часов и подсказки за последние 7 дней.

## AI-агент: финальный отчёт спринта

- **Service**: `sprint-review.service.ts`.
- **Хук завершения**: `CyclesService.complete` эмитит `cycle.review_requested` event,
  `SprintReviewService.onCycleReviewRequested` ловит и запускает генерацию.
- **REST**: `GET/POST /cycles/:id/review*` (см. выше).
- **LLM-таск**: `sprint-review-summary`. Промпт: `prompts/sprint-review-summary.prompt.ts`.
  Та же цепочка провайдеров.
- **Хранение**: через `CurationService.triage({resourceType:'cycle'})` →
  `CardVersion(resourceType='cycle', version=N)`. Отдельной таблицы под отчёт
  нет (решение 5 в ТЗ).
- **Graceful degrade**: если все 3 LLM-провайдера упали — в
  `Cycle.progressSnapshot.reviewStatus='failed'`, в UI кнопка «Сгенерировать
  ещё раз».

## Фронтенд

| Путь | Назначение |
|---|---|
| `/sprints` | Master-detail список Org: слева — карточки с фильтрами (status tabs / scope chips / поиск / сортировки) и пагинацией, справа — preview-карточка. URL-state. Live через `/ws/tracker`. На mobile detail открывается как `Sheet`. |
| `/sprints/[id]` | Дашборд спринта: прогресс, задачи (3 секции), подсказки, встречи. |
| `/sprints/[id]/review` | Финальный отчёт (`ready` / `pending` / `failed`). |

Компоненты:
- `SprintHintCard` — карточка подсказки.
- `SprintCreateWizard` — 2-шаговый Dialog. **Шаг 1 (scope)**: radio из 6 вариантов (Компания / Отдел / Клиент / Поставщик / Сотрудник / Проект) + универсальный Combobox с inline-create через `+ Создать «<query>»` для Vendor/Card/Department/Person (через cmdk Command + Popover). Для scope='person' двухступенчатый picker Role → Person через Appointment. **Шаг 2 (parameters)**: название / длительность 1-4 нед / дата старта. Submit → `POST /api/v1/sprints/quick-create` (один атомарный вызов).
- `SprintPreviewCard` — preview справа в master-detail: scope-badge, прогресс, счётчики, топ-3 SprintHint, топ-3 задач без срока, кнопка «Открыть спринт».

Сайдбар: пункт «Спринты» в группе «Каждый день», иконка `Rocket` (lucide).
`data-tour-target="welcome.sprints"` — для будущего
[onboarding-tour'а](../../plans/tz/2026-05-27-tracker-onboarding-tour.md).

## Метрики Prometheus

- `cycles_created_total{tenant, scope_kind}` — по виду scope (org/customer/vendor/person/department/project).
- `cycles_completed_total{tenant}`.
- `sprint_hints_total{tenant, kind, status}`.
- `sprint_hint_dismissed_total{tenant, kind}`.
- `sprint_dashboard_cache_hit_total / miss_total {tenant}`.
- `sprint_helper_runs_total{tenant, status}` — success/failed/skipped.
- `sprint_helper_duration_seconds{tenant}` — histogram.
- `sprint_review_generation_total{tenant, status}` — ready/failed/retried.
- `sprint_review_generation_duration_seconds{tenant}` — histogram.

## RBAC

- `cycle` — без изменений (read/write/delete как раньше).
- `sprint_hint` (новый): owner/admin r/w/d, manager open r/w, manager strict
  r/w self (по project membership проверяется в сервисе), coo r.
- См. [`policy.csv`](../../backend/src/modules/rbac/policies/policy.csv).

## Учёт паритета трекера

Зонтик `tracker-parity-with-competitors` уже замержен:
[tracker-boards](../../plans/tz/2026-05-27-tracker-boards.md),
[tracker-subtasks-ui](../../plans/tz/2026-05-27-tracker-subtasks-ui.md),
[tracker-checklists](../../plans/tz/2026-05-27-tracker-checklists.md),
[tracker-project-documents](../../plans/tz/2026-05-27-tracker-project-documents.md),
[tracker-project-overview](../../plans/tz/2026-05-27-tracker-project-overview.md).

Что учли в спринтах:
- Дашборд показывает бэйджи доска / чек-лист / подзадачи рядом с задачей.
- `SprintAnalystService.invalidateDashboardCache` эмитит
  `cycle.progress_updated` event — `OverviewCacheService`
  (tracker-project-overview) поймает и сбросит `project:overview:{projectId}`.
- В дашборде спринта только связанные встречи; связанные карточки CRM —
  на уровне проекта (`/projects/[slug]/overview`).
- `data-tour-target="welcome.sprints"` готов для tracker-onboarding-tour.

## Что ещё не сделано (MVP-долг)

- «Создать спринт на основе плана следующего» в `/review` — сейчас просто
  ссылка на `/sprints`.
- Inline-валидации задач (`§3.7` ТЗ) — отложено.
- Шаг тура `welcome.sprints` сам напишет автор `tracker-onboarding-tour`
  (target-атрибут уже выставлен).

## Источники

- [plans/tz/2026-05-27-sprints.md](../../plans/tz/2026-05-27-sprints.md) — базовое ТЗ.
- [plans/tz/2026-05-28-sprints-master-detail-and-wizard.md](../../plans/tz/2026-05-28-sprints-master-detail-and-wizard.md) — ТЗ master-detail + расширенного мастера.
- [plans/analysis/2026-05-27-sprints.md](../../plans/analysis/2026-05-27-sprints.md) — анализ.
