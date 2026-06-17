---
title: Канал обратной связи и AI-кластеризация
status: implemented
date: 2026-05-25
---

# Канал обратной связи «Ваши предложения»

## Что это

Пользователь пишет фидбэк через `/feedback` (5 сообщений в сутки на user, окно UTC). Ночной AI-агент (01:00 UTC) кластеризует сообщения в смысловые блоки (FeedbackTopic). Super-admin Z видит дашборд блоков с процентами в `/admin/feedback` + детальную карточку каждого блока с действиями (rename / merge / archive / unarchive).

Фича глобальная (не tenant-bound): фидбэк адресован команде Z, а не Org'е пользователя.

## Бэк

- **Модуль:** `backend/src/modules/feedback/`
- **Эндпоинты пользовательские:**
  - `POST /api/v1/feedback` — submit (rate-limit 5/сутки)
  - `GET /api/v1/feedback/my` — история своих сообщений
  - `GET /api/v1/feedback/my/limit` — оставшийся лимит на сегодня
- **Эндпоинты админские (super_admin only):**
  - `GET /api/v1/admin/feedback/topics` — список + фильтры
  - `GET /api/v1/admin/feedback/topics/:id` — детали
  - `GET /api/v1/admin/feedback/topics/:id/items` — items блока
  - `GET /api/v1/admin/feedback/topics/:id/items/:itemId/message` — оригинал сообщения
  - `PATCH /api/v1/admin/feedback/topics/:id` — переименование (rename)
  - `POST /api/v1/admin/feedback/topics/:sourceId/merge` — merge в другой topic
  - `POST /api/v1/admin/feedback/topics/:id/archive`, `.../unarchive`
  - `POST /api/v1/admin/feedback/digest/run` — ручной запуск ночного прогона
  - `GET /api/v1/admin/feedback/messages/failed` — сообщения с `failedRuns >= 3`
- **Воркер:** `workers/feedback-digest.{queue,worker,cron}.ts`
  - Очередь `core.feedback-digest` (BullMQ, in-process)
  - Cron `0 1 * * *` UTC (`feedback-digest.cron.ts`)
  - Worker зовёт `FeedbackDigestService.runDigest()`
- **Промпт:** `prompts/feedback-cluster.prompt.ts`
  - Registry-key `feedback.cluster`, code-fallback
  - Primary `deepseek-v4-pro` (см. [`ai-jobs.md`](ai-jobs.md))
- **LlmTaskRoute seed:** `backend/scripts/seed-llm-task-routes-feedback-cluster.ts`
- **Модели Prisma:** `FeedbackMessage`, `FeedbackTopic`, `FeedbackItem`, enum `FeedbackTopicStatus` (ACTIVE | ARCHIVED | MERGED). См. [[../02_architecture/data-model|data-model]].
- **Rate-limit:** Redis-ключ `feedback:ratelimit:{userId}:{YYYY-MM-DD-UTC}` (TTL — до конца суток UTC). Guard `FeedbackRateLimitGuard`.
- **Redis-lock для digest:** `feedback:digest:lock` (SET NX EX 1800). Только один прогон digest'а на весь кластер одновременно.

## Фронт

- **Пользователь:** `frontend/app/(authenticated)/feedback/`
  - `page.tsx` + `components/` — форма submit + история своих сообщений + индикатор лимита.
- **Админ:** `frontend/app/(authenticated)/admin/feedback/`
  - `page.tsx` + `FeedbackDashboardClient.tsx` — дашборд блоков с процентами
  - `[topicId]/` — детальная карточка блока + items + действия
  - `components/` — UI-компоненты (диалоги действий rename / merge / archive, Phase 8)
- **API клиенты:** `frontend/src/api/feedback.api.ts`, `frontend/src/api/admin-feedback.api.ts`
- **DomainModel:** `frontend/src/domain/feedback.ts`, `frontend/src/domain/admin-feedback.ts`

## Метрики Prometheus

Регистрируются в `backend/src/common/metrics/business-metrics.service.ts`:

| Метрика | Тип | Labels | Назначение |
|---|---|---|---|
| `feedback_digest_runs_total` | Counter | `result` = `success` \| `skipped` \| `lock_held` \| `agent_failed` \| `txn_failed` \| `anomaly` | Каждый прогон `runDigest()` |
| `feedback_digest_messages_processed_total` | Counter | — | Инкремент на размер батча после успешной транзакции |
| `feedback_digest_new_topics_total` | Counter | — | Сколько новых `FeedbackTopic` создано |
| `feedback_digest_failed_runs_total` | Counter | — | Сколько сообщений достигли `failedRuns >= 3` (хронически невалидные) |

Cardinality-safe (без `tenant` — фича глобальная).

Structured-логи `feedback-digest`: `batchSize`, `topicsCount`, `newTopicsCreated`, `itemsCreated`, `discardedCount`, `lockKey`, `model`, `attempt`, `result`.

## Решения

- `dataClass = 'internal'` для LLM-вызова (отдельный `internal-feedback` отложен — потребует миграцию enum `DataClass`).
- Worker **в процессе** (паттерн Z) — отдельного `workers/main.ts` ветвления для feedback нет.
- Статусы блока: `ACTIVE | ARCHIVED | MERGED`. Split (разделение блока на два) — фаза 2.
- В MVP без статусов «учтено / в работе» у блоков для конечного пользователя.
- Sanity-check: если LLM возвращает `newTopics > 0.5 × totalItems` — батч помечается failed и трогка пропускается.
- Retry на уровне сервиса: 2 попытки (вторая с retry-hint). На каждой попытке `LlmRouter` сам перебирает primary → secondary → tertiary провайдеров.
- `failedRuns >= 3` — сообщение выпадает из выборки и попадает в `/admin/feedback/messages/failed`.

## Ссылки

- ТЗ: [`plans/archive/2026-05-25-user-feedback-with-ai-clustering.md`](../../plans/archive/2026-05-25-user-feedback-with-ai-clustering.md)
- AI-jobs: [[ai-jobs|ai-jobs]] (taskType `feedback.cluster`)
- Workers / queues: [[workers-queues|workers-queues]] (очередь `core.feedback-digest`)
- API: [[api-layer|api-layer]] (раздел Feedback)
- Frontend pages: [[frontend-pages|frontend-pages]] (`/feedback`, `/admin/feedback`)
- Admin: [[admin|admin]] (раздел «Обратная связь»)

[[../index|← index]]
