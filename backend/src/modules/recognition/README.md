# Recognition — Gamification (Wave 2)

ТЗ: [plans/tz/2026-05-23-gamification-and-motivation.md](../../../../plans/tz/2026-05-23-gamification-and-motivation.md).

## Состав

- `services/recognition.service.ts` — основной фасад: enqueue + read API.
- `services/comments-thanks.service.ts` — toggle `IssueComment.thanksUserIds`.
- `services/badge-conditions.service.ts` — чистые функции-проверщики условий.
- `workers/recognition-formulate.worker.ts` — consumer `core.recognition-formulate`.
- `cron/contribution-snapshot.cron.ts` — `@Cron('0 4 * * *')` daily.
- `cron/badge-awarder.cron.ts` — `@Cron('0 5 * * *')` daily, после snapshot.
- `cron/streak-detector.cron.ts` — `@Cron('0 23 * * *')` daily.
- `cron/recognition-weekly-digest.cron.ts` — `@Cron('0 9 * * 1')` понедельник.
- `controllers/contributions.controller.ts` — `/me/contributions`, `/persons/:id/contributions`, `/me/recognitions`.
- `controllers/badges.controller.ts` — `/badges`, `/me/badges`.
- `controllers/comments-thanks.controller.ts` — `POST/GET /issues/comments/:id/thanks`.
- `controllers/recognition-admin.controller.ts` — stubs: `forward-as-self`, `notifications/recognition` opt-out.
- `prompts/recognition-formulate.prompt.ts` — LLM-промпт + JSON schema + fallback.
- `seed/badge-seed.ts` — функция `seedBaseBadges()` (5 базовых).

## Этическая защита (ТЗ §8)

- Recognition от AI = `fromUserId = null`. Message формирует LLM — **не от имени руководителя**.
- `POST /recognitions/:id/forward-as-self` — заглушка под Sprint 4 (сейчас 501).
- Опт-аут: stub `POST /me/settings/notifications/recognition` (TODO sprint-4 подключить к notification-preferences).
- Никаких leaderboard / очков-валюты / «топ-3». В UI бейджи показываются только владельцу (не сравниваются).
- Self-thanks: добавляется в `thanksUserIds`, но Recognition не enqueue'ится — `thanksReceived` не растёт.

## Запуск

```bash
# Один раз (или после обновления каталога) — seed бейджей.
cd backend && bun run scripts/seed-badges.ts

# Маршруты LLM для recognition-formulate.
cd backend && bun run scripts/seed-llm-task-routes-recognition.ts
```

## Зависимости

- `ActivityFeedService` (Agent 14/15 параллельно) — пока **не реализован**.
  В `RecognitionFormulateWorker.process()` стоит TODO: при `visibility ∈ {team, public_org}`
  публиковать в ActivityFeed. Сейчас Recognition остаётся в БД, в ленту не уходит.
- `HelpfulnessSpotlight` (Agent 16 параллельно) — пока **не реализован**. ТЗ предусматривает
  enqueue Recognition `type='thanks_helpfulness'` после создания спотлайта. Триггер
  ожидается со стороны Agent 16: `await this.recognition.enqueueFormulate({ type: 'thanks_helpfulness', contextEntityType: 'helpfulness_spotlight', contextEntityId: spotlightId, ... })`.
- `DailyCheckIn` — модель есть. Если переход на корректную локальную TZ требует
  более точного расчёта, см. TODO в `StreakDetectorCron.hadCheckinOn()`.

## TODO

- `forward-as-self` — Sprint 4.
- `low_team_engagement` probe-trigger — требует понятия Team/Department в `RecognitionWeeklyDigestCron`.
- `unrecognized_high_contributor` — сейчас просто эмитит Recognition; полноценный probe — позже через `ProbeService.suggest(...)`.
- ActivityFeed integration — после готовности Agent 14/15.
- Metrics Prometheus (`recognition_sent_total`, `thanks_total`, `badges_awarded_total`,
  `checkin_streak_distribution`, `contribution_snapshot_updates_total`,
  `recognition_agent_messages_sent_total`) — отложено, добавить через
  `BusinessMetricsService` (см. backend/src/common/metrics/business-metrics.service.ts).

## RBAC

Новые ResourceType, которые нужно добавить в `backend/src/modules/rbac/policies/policy.csv`
и в `RbacService.ResourceType` union (см. `rbac.service.ts`):

- `recognition` — read свои (toUserId = user), write только система / AI.
- `badge` — read все (member Org), write admin.
- `user_badge` — read свои (+ admin/owner для подчинённых), write только cron.
- `contribution_snapshot` — read свои (+ admin/owner для подчинённых), write только cron.

На MVP RBAC реализован через прямые проверки внутри контроллеров (`org/manage` для
`/persons/:id/contributions`) — без расширения policy.csv. Расширение — отдельным
коммитом владельца кода RBAC.
