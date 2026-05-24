---
type: tz
status: done
feature: Таск-трекер Z/Кора — Фаза 5 — Импорт из Битрикс24 / Trello / Я.Трекер + миграционный wizard
date: 2026-05-23
phase: 5 / 6
parent: plans/tz/2026-05-23-tracker-phase-1-models-api.md
---

# Фаза 5 трекера: Импорт и миграция

## TL;DR

Wizard `/integrations/import-tracker` — главный администратор вводит токен/файл, видит preview, импорт за 1 клик. 3 главных источника: **Битрикс24** (~50% переходов в РФ), **Trello** (JSON export), **Я.Трекер** (REST API). Сохраняем структуру: проекты, доски, задачи, комментарии, файлы, исполнители (по email-mapping). Срок: 3 человеко-недели.

## Зависимости

- **Фаза 1 трекера** — модели готовы.
- **Existing accounts** — для mapping исполнителей по email.

## UX

### Точка входа

`/integrations/import-tracker` (новая страница). 3 карточки:
- 🟦 Битрикс24
- 🟩 Trello
- 🟧 Яндекс Трекер

При выборе — wizard 4 шага:

1. **Подключение** (токен / файл / OAuth)
2. **Выбор данных** (какие проекты импортировать)
3. **Preview** (что будет создано: N проектов, M задач, K комментариев)
4. **Маппинг пользователей** (по email — где найден, где нет, что делать)
5. **Импорт** (прогресс-бар, лог)

### Маппинг пользователей

Для каждого пользователя из источника:
- Поиск в нашей Org по email
- Если найден → mapping автоматический
- Если не найден → выбор: «Пригласить по email», «Игнорировать (assignee = raw)»

## Битрикс24 → Кора

### Подключение

- Через **REST API Битрикс24** с авторизацией по входящему вебхуку.
- Пользователь вводит URL `https://your-portal.bitrix24.ru/rest/N/TOKEN/`.

### Что мапим

| Битрикс24 | Наше |
|---|---|
| `tasks.task` | `Issue` |
| Группа (рабочая группа) | `Project` |
| Этап / стадия | `IssueState` |
| Ответственный (`responsibleId`) | `IssueAssignee.userId` (через email mapping) |
| Создатель (`createdBy`) | `Issue.createdById` |
| Срок (`deadline`) | `Issue.dueDate` |
| Описание (`description`) | `Issue.description` (HTML → text + rich JSON конверсия) |
| Комментарии (`task.commentitem`) | `IssueComment` |
| Чек-листы (`task.checklistitem`) | Сохраняем как метки в description или подзадачи |
| Файлы | `IssueAttachment` (скачиваем + загружаем в наш S3) |
| Подзадачи | `Issue.parentId` |
| Зависимости | `IssueRelation` (типы: blocked_by / blocks) |
| Приоритет (важный / обычный) | `Issue.priority` (high / medium) |

### Что НЕ импортируем (в первом релизе)

- Бизнес-процессы (workflows) — слишком сложно
- Сделки CRM — отдельный продукт
- Кастомные поля — отдельной таблицей в `Issue.metadata Json`

### Скрипт `backend/scripts/import-bitrix24.ts`

- Принимает: tenant ID + webhook URL + список выбранных групп.
- Постранично выкачивает задачи через `tasks.task.list` (по 50).
- Для каждой задачи — выкачивает комментарии, файлы, подзадачи, зависимости.
- Пишет в `IssueWebhookLog` (для аудита) — нет, в новую модель `ImportLog`:

```
model ImportLog {
  id          String   @id @default(cuid())
  tenantId    String
  source      String              // bitrix24 | trello | yandex_tracker
  startedAt   DateTime @default(now())
  completedAt DateTime?
  totalProjects Int
  totalIssues   Int
  totalComments Int
  errors      Json?               // массив ошибок
  status      String              // running | completed | failed
  initiatedByUserId String
  
  @@index([tenantId])
}
```

### Прогресс на frontend

WebSocket `import.progress` — каждые 5 секунд:
```json
{ "importId": "...", "processed": 234, "total": 1000, "phase": "issues" }
```

## Trello → Кора

### Подключение

- **Опция А:** JSON-export файл (Trello отдаёт через настройки доски).
- **Опция Б:** через Trello API + OAuth (если у клиента доступ).

### Что мапим

| Trello | Наше |
|---|---|
| Board | Project |
| List | IssueState |
| Card | Issue |
| Card description | Issue.description (Markdown → rich JSON) |
| Card members | IssueAssignee |
| Card due date | Issue.dueDate |
| Card labels | IssueLabel + Label |
| Card checklists | Подзадачи или markdown в description |
| Card comments | IssueComment |
| Card attachments | IssueAttachment |

### Скрипт `backend/scripts/import-trello.ts`

- Принимает JSON-export файл (загруженный через wizard).
- Парсит, валидирует, импортирует.

## Я.Трекер → Кора

### Подключение

- Через **REST API Яндекс 360 / Я.Трекер** с OAuth-токеном (Яндекс ID).

### Что мапим

| Я.Трекер | Наше |
|---|---|
| Очередь (Queue) | Project |
| Issue | Issue |
| Статус | IssueState |
| Исполнитель | IssueAssignee |
| Дедлайн | Issue.dueDate |
| Комментарии | IssueComment |
| Связи | IssueRelation |
| Файлы | IssueAttachment |
| Кастомные поля | Issue.metadata Json |

### Скрипт `backend/scripts/import-yandex-tracker.ts`

- Через `https://api.tracker.yandex.net/v2/`.
- Постранично через `_perPage=50`.

## REST API

```
POST   /api/v1/imports/bitrix24       # запуск
POST   /api/v1/imports/trello         # запуск (с файлом или OAuth)
POST   /api/v1/imports/yandex-tracker # запуск
GET    /api/v1/imports                 # список (status, progress)
GET    /api/v1/imports/:id             # детали + лог
POST   /api/v1/imports/:id/cancel      # отмена в процессе
```

## WebSocket events

```
import.progress       { importId, processed, total, phase }
import.completed      { importId, summary }
import.failed         { importId, error }
```

## Идемпотентность импорта

Каждая импортированная Issue получает `externalSource='bitrix24'|'trello'|'yandex_tracker'` + `externalId=<source_id>`. Если попытаться повторно импортировать тот же источник — skip существующих, импорт только новых.

## Worker `import-tracker.worker`

- BullMQ-воркер на отдельной очереди `core.imports`.
- Отдельный процесс (как `workers/main.ts`).
- Принимает job со всеми параметрами импорта.
- Постранично выкачивает + создаёт сущности.
- Эмитит WebSocket-события через `hulypulse`-аналог.

## Метрики Prometheus

```
import_started_total{tenant, source}
import_completed_total{tenant, source, success}
import_issues_processed_total{tenant, source}
import_errors_total{tenant, source}
import_duration_seconds{tenant, source} (histogram)
```

## DoD

- [x] Wizard `/integrations/import-tracker` работает
- [x] 3 импортных источника: Битрикс24 (через webhook URL), Trello (JSON или OAuth), Я.Трекер (OAuth)
- [x] Маппинг пользователей по email с UI для unmatched
- [x] WebSocket progress
- [x] Идемпотентность (повторный импорт не создаёт дубли)
- [x] ImportLog модель + UI для просмотра истории
- [x] Тесты: integration (mock-ответы API + проверка структуры данных) + manual e2e на тестовом портале Битрикс24 и Trello

## Срок

**3 человеко-недели.**

## Следующая фаза

Фаза 6 (β-8) — COO Operations Dashboard + DailyCheckIn (детальный sub-ТЗ уже есть: `2026-05-23-sba-beta-8-personal-relation-coo-checkin.md`).

---

_2026-05-23: импорт из главных источников РФ-рынка. GTM-нож._

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- ImportLog модель в `schema.prisma` + DTO в `backend/src/modules/tracker/dto/imports/`.
- Strategy pattern: `import-strategy.interface.ts` + 3 стратегии в `backend/src/modules/tracker/strategies/` — `trello-import.strategy.ts`, `bitrix24-import.strategy.ts` (REST по webhook URL, маппинг task.STATUS → IssueState, RESPONSIBLE_ID → IssueAssignee, DEADLINE → dueDate, файлы → S3), `yandex-tracker-import.strategy.ts` (OAuth Яндекс ID + REST `api.tracker.yandex.net/v2/` с retry/backoff).
- `ImportService` + `import-tracker.worker.ts` (BullMQ очередь) + `imports.controller.ts` (POST /imports/*, GET, cancel).
- WebSocket progress через `TrackerGateway` (`import.progress`/`import.completed`/`import.failed`).
- Идемпотентность через `@@unique[externalSource, externalId]` на Issue — повторный импорт skip-ает.
- Frontend wizard: `frontend/app/(authenticated)/integrations/import-tracker/` — `ImportTrackerClient.tsx`, `Bitrix24Wizard.tsx`, `YandexTrackerWizard.tsx`, Trello JSON загрузка + детальная страница `[importId]/ImportDetailClient.tsx` с `useImportDetail` (SWR polling 2s + WS overlay).
- RBAC: 4 строки `import_tracker` в `policies/policy.csv`.
- Метрики Prometheus + 9+ тестов (`trello-import.strategy.spec.ts`, `bitrix24-import.strategy.spec.ts`).

**Коммиты:** 4b009cd, c8d6ecc, 7c036b0 (Agent F + I + J).
