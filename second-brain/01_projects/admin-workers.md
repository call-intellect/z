---
type: project
status: done
phase: 8
---

# BullMQ-инспектор (`/admin/platform/workers`)

> UI и API для инспекции / управления BullMQ-очередями Z без `redis-cli` и без редеплоя. Часть редизайна админки (Фаза 8). См. [admin-z-global.md](admin-z-global.md).
>
> Реализовано: `backend/src/modules/admin/platform/workers/workers-admin.controller.ts` + `workers-admin.service.ts`.

## Зачем

Z крутит десятки BullMQ-очередей (`core.raw-events`, `core.block-distill`, `core.specialist-routing`, `core.skill-profile-rebuild`, `core.knowledge-clone-rebuild`, `core.tracker.webhooks`, `mail.outbound`, и т. д.). Когда очередь зависает или job падает — оператору нужно:

- Видеть статус каждой очереди (active / waiting / failed / delayed / completed).
- Просматривать failed jobs с stacktrace.
- Повторять (retry) одно или все failed.
- Ставить очередь на паузу / возобновлять.
- Чистить DLQ.

Раньше это делали через `redis-cli + bullmq cli` руками. После Фазы 8 — через UI.

## Контроллер

[backend/src/modules/admin/platform/workers/workers-admin.controller.ts](backend/src/modules/admin/platform/workers/workers-admin.controller.ts):

```
GET    /api/v1/admin/workers/queues                   — список очередей + счётчики
GET    /api/v1/admin/workers/queues/:name             — detail: active / waiting / failed / delayed
POST   /api/v1/admin/workers/queues/:name/retry-failed — Job.retry() для всех failed
POST   /api/v1/admin/workers/queues/:name/pause       — Queue.pause()
POST   /api/v1/admin/workers/queues/:name/resume      — Queue.resume()
```

Под капотом — `@bullmq/api` (`Queue.getJobCounts()`, `Queue.getFailed()`, `Job.retry()`, `Queue.pause()/resume()`).

Severity для всех destructive-операций (`retry-failed` массовый, `pause` критичной очереди) — `high`, `reason` обязателен.

## DLQ (Dead-Letter Queue)

После maxAttempts (3-5 в зависимости от очереди) failed job попадает в DLQ-видимое подмножество BullMQ (`getFailed()`). UI разделяет:

- **Failed (recoverable)** — можно retry, jobs младше 24ч.
- **DLQ (старше 24ч)** — отдельная вкладка, требует ручного разбора. Кнопка «Удалить из DLQ» (destructive, reason обязателен).

## UI

[frontend/app/(admin)/admin/platform/workers/](frontend/app/(admin)/admin/platform/workers/):

- Сводная таблица: имя очереди / counts (active/waiting/failed/delayed) / `paused?` / последний failed-error.
- Карточка очереди — `AdminSection` + `AdminTabs`:
  - **Активные** — таблица `JobId / data preview / progress / startedAt`.
  - **Ожидают** — упрощённая таблица.
  - **Упали** — `JobId / failedAt / attemptsMade / failedReason / data`, чекбоксы + «Retry выбранные» / «Retry все».
  - **Отложенные** — `JobId / delayUntil`.
  - **DLQ** — отдельный список.
  - **Управление** — `AdminDangerZone` с кнопками «Пауза», «Возобновить», «Очистить DLQ».

## Связь с `/admin/incidents`

Фаза 1 — `/admin/incidents` — собирает алерты из:

- BullMQ failed > threshold (правило в `AlertRule`).
- DLQ size > threshold.
- Worker lag > threshold (BullMQ metrics).
- Webhook delivery failures > threshold.

При триггере правила инцидент попадает в `/admin/incidents` и (Фаза 9 — отложено) шлёт Web-Push админу.

## Реестр очередей

См. [workers-queues.md](workers-queues.md) — там полный living-registry. Ключевые:

| Очередь | Назначение |
|---|---|
| `core.raw-events` | Вход knowledge-core (Source → IdeaBlock pipeline) |
| `core.block-ingest` | Извлечение IdeaBlock + Entity из RawEvent |
| `core.block-distill` | Distill + дедупликация |
| `core.block-linker` | KNN + LLM-арбитр на связи блоков |
| `core.specialist-routing` | Router → специалисты 3-1…3-9 |
| `core.skill-profile-rebuild` | SBA γ-1 |
| `core.knowledge-clone-rebuild` | SBA β-2 |
| `core.probe-events` | Probe-агент (SBA β-5) |
| `core.tracker.webhooks` | Outbound webhooks из трекера (HMAC + retry) |
| `mail.outbound` | Транзакционные письма (`email-fetch` для inbound — отдельный cron, не очередь) |

## Риски

1. **Retry-storm.** Если retry-failed для тысячи jobs одним нажатием — может перегрузить воркеры. **Митигация:** ratelimit на уровне API (max 100 retry за запрос).
2. **Pause критичной очереди забыт включить.** Если оставить `core.raw-events` на паузе — knowledge-core встанет. **Митигация:** Visual-сигнал «PAUSED» на главном дашборде + cron `alert-paused-queues` каждые 15 минут шлёт алерт.

## Связанные

- [admin-z-global.md](admin-z-global.md) — каркас админки.
- [admin-crons.md](admin-crons.md) — соседний раздел (расписания vs очереди).
- [workers-queues.md](workers-queues.md) — реестр всех очередей и воркеров.
