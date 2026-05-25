---
title: API Layer (реестр endpoints)
status: living
covers: реестр всех REST endpoints backend по модулям
---

# API Layer — реестр endpoints

Сжатый реестр всех REST endpoints backend. Полные DTO/Swagger — в `backend/src/modules/*/dto/` и `/api/docs`. Глобальный префикс — `/api/v1`. Авторизация по cookie `z_session` (CookieAuthGuard) + `TenantGuard` (берёт `X-Org-Id` / `:orgId`).

Этот файл создан 2026-05-25 как часть финального handoff Wave 1-3. Не претендует на полноту — пополняется по факту добавления новых endpoint'ов.

## Tracker

См. полный список в [`tracker.md`](tracker.md) §«REST API endpoints».

### Финальный handoff Wave 1-3 — новые endpoint'ы

| Метод | Путь | Назначение | T |
|---|---|---|---|
| GET | `/api/v1/me/inbox/count` | `{ total, unread }` для badge в TrackerBottomNav | T6a |
| GET | `/api/v1/me/mentions` | Лента моих @mention'ов (cursor pagination, фильтр `issueId`) | T8 |
| GET | `/api/v1/projects/:id/email-inbox` | Текущее состояние email-inbox (alias, enabled, последние 10 писем) | T5 |
| POST | `/api/v1/projects/:id/email-inbox/enable` | Включить + сгенерировать alias | T5 |
| POST | `/api/v1/projects/:id/email-inbox/disable` | Отключить | T5 |
| POST | `/api/v1/projects/:id/email-inbox/regenerate-alias` | Перевыпустить alias (старый перестаёт принимать) | T5 |

## Recognition + Gamification

| Метод | Путь | Назначение | T |
|---|---|---|---|
| GET | `/api/v1/me/contributions` | Мои вклады (BadgeStreak/HelpProvided/IdeasShipped/ThanksGiven) | Wave 2 |
| GET | `/api/v1/persons/:id/contributions` | Вклад коллеги (filter-by-visibility) | Wave 2 |
| GET | `/api/v1/me/recognitions` | Полученные мной Recognition | Wave 2 |
| GET | `/api/v1/badges` | Каталог badges (5 базовых) | Wave 2 |
| GET | `/api/v1/me/badges` | Мои полученные badges + progress | Wave 2 |
| POST | `/api/v1/issues/comments/:id/thanks` | Idempotent toggle thanks от user'а | Wave 2 |
| GET | `/api/v1/orgs/:orgId/recognition/team-spotlight` | Top-5 лидеров за неделю (TeamSpotlightService) | **T1** |
| POST | `/api/v1/me/recognition-optout` | Отписка от Recognition (Redis TTL 365 дней) | **T1** |

## Helpfulness (Specialist 3.8)

| Метод | Путь | Назначение | T |
|---|---|---|---|
| GET | `/api/v1/me/social-contribution` | Мой социальный профиль (5 публичных traits) | Wave 2 (UI — T2) |
| GET | `/api/v1/persons/:id/social-contribution` | Профиль коллеги (privacy filter) | Wave 2 (UI — T2) |
| GET | `/api/v1/feed/spotlights` | HelpfulnessSpotlight список | Wave 2 |
| POST | `/api/v1/spotlights/:id/approve` | Manager approve | Wave 2 |
| POST | `/api/v1/spotlights/:id/hide` | Manager hide | Wave 2 |
| POST | `/api/v1/spotlights/:id/republish` | Manager republish после hide | Wave 2 |
| POST | `/api/v1/helpfulness-traits/:id/mark-as-misleading` | Subject sa-curation | Wave 2 |
| GET | `/api/v1/admin/helpfulness/team-map` | Team-карта (manager+admin) | Wave 2 (UI — T2) |
| GET | `/api/v1/admin/helpfulness/unanswered` | Незакрытые вопросы (admin only — private traits) | Wave 2 |

## Chat-v2

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/v1/chat-v2/messages` | Задать вопрос (scope: org/card/project/**issue**) |
| GET | `/api/v1/chat-v2/conversations` | Список диалогов |
| GET | `/api/v1/chat-v2/conversations/:id` | Диалог с сообщениями |
| POST | `/api/v1/chat-v2/conversations/:id/pin` | Закрепить/открепить |
| POST | `/api/v1/chat-v2/conversations/:id/archive` | Архивировать |

T6b: scope `'issue'` добавлен — `IssueChat` теперь работает на нём нативно.

## Concierge + Voice

| Метод | Путь | Назначение | T |
|---|---|---|---|
| POST | `/api/v1/concierge/ask` | Conversational интерфейс (NL → tool-use) | γ-2 |
| POST | `/api/v1/voice/transcribe` | REST ASR (Vox/GigaAM, fallback) | — |
| WS | `/ws/voice` | Streaming-стенд для голоса (events: voice.start/chunk/end/cancel → voice.transcribed/error) | **T4** |

⚠ **Voice — только вход** (микрофон → ASR). Concierge отвечает **только текстом**, TTS не интегрируется в flow (см. `feedback_concierge_text_only_output.md`).

## Knowledge-core

См. [`knowledge-core.md`](../02_architecture/knowledge-core.md) — `/api/v1/knowledge/blocks`, `/entities`, `/themes`, `/graph/*`, `/search`.

## Org / RBAC / Admin / LLM

См. [`orgs-and-rbac.md`](orgs-and-rbac.md), [`admin-z-global.md`](admin-z-global.md), [`admin-org-knowledge-core.md`](admin-org-knowledge-core.md), [`llm-router.md`](llm-router.md).

## Feedback — канал обратной связи + AI-кластеризация (2026-05-25)

Глобальная фича (не tenant-bound). Полная заметка — [[feedback]].

### Пользовательские endpoints

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| POST | `/api/v1/feedback` | Submit сообщения. Body `{ text }`. 400 на пустоту / длину > N. 429 на превышение лимита. | authenticated |
| GET | `/api/v1/feedback/my` | История своих сообщений с items / topics. | authenticated |
| GET | `/api/v1/feedback/my/limit` | `{ used, limit, resetAt }` — оставшийся лимит на сутки UTC. | authenticated |

Rate-limit `FeedbackRateLimitGuard`: Redis-ключ `feedback:ratelimit:{userId}:{YYYY-MM-DD-UTC}`, cap 5/сутки, TTL до конца UTC-суток.

### Admin endpoints (`super_admin` only)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/admin/feedback/topics` | Список блоков с фильтрами (статус, поиск) + counts items |
| GET | `/api/v1/admin/feedback/topics/:id` | Детали блока (description, counts, динамика) |
| GET | `/api/v1/admin/feedback/topics/:id/items` | Items блока (пагинация) |
| GET | `/api/v1/admin/feedback/topics/:id/items/:itemId/message` | Оригинал сообщения (для просмотра контекста) |
| PATCH | `/api/v1/admin/feedback/topics/:id` | Rename: `{ title?, description? }` |
| POST | `/api/v1/admin/feedback/topics/:sourceId/merge` | Merge `source → target`: `{ targetId }` (items переезжают, source становится `status='MERGED'`, `mergedIntoId=targetId`) |
| POST | `/api/v1/admin/feedback/topics/:id/archive` | Archive (status=ARCHIVED) — спрятать с дашборда |
| POST | `/api/v1/admin/feedback/topics/:id/unarchive` | Unarchive (status=ACTIVE) |
| POST | `/api/v1/admin/feedback/digest/run` | Ручной запуск ночного прогона (BullMQ-job в `core.feedback-digest`). Возвращает `{ jobId }`. |
| GET | `/api/v1/admin/feedback/messages/failed` | Сообщения с `failedRuns >= 3` (AI трижды не справился) |

Защита: `CookieAuthGuard` + `SuperAdminGuard`. Все мутации логируются `SuperAdminAccessLog`.

## Operations — COO Dashboard + DailyCheckIn + Promises

| Метод | Путь | Назначение | Доступ | Фаза |
|---|---|---|---|---|
| GET | `/api/v1/dashboard/operations/overview` | Pulse: blockers/missed goals/team friction/capacity | `coo` `owner` `admin` | β-8 |
| GET | `/api/v1/dashboard/operations/blockers` | Активные блокеры с владельцами | `coo` `owner` `admin` | β-8 |
| GET | `/api/v1/dashboard/operations/team-frictions` | EntityLink-конфликты в команде | `coo` `owner` `admin` | β-8 |
| GET | `/api/v1/dashboard/operations/capacity` | Аггрегат `Appointment.loadPercent` | `coo` `owner` `admin` | β-8 |
| **GET** | `/api/v1/dashboard/operations/team-temperature?days=7` | Агрегат `sentiment` чек-инов по людям/командам | `coo` `owner` `admin` | **β-8.1** |
| **GET** | `/api/v1/dashboard/operations/weekly-digest?weekStart=YYYY-MM-DD` | Сохранённый `WeeklyOperationsDigest` или 404 | `coo` `owner` `admin` | **β-8.1** |
| **POST** | `/api/v1/dashboard/operations/weekly-digest/generate?weekStart=…` | Принудительная перегенерация | `admin` `super_admin` | **β-8.1** |
| **GET** | `/api/v1/dashboard/operations/daily-digest?date=YYYY-MM-DD` | Сохранённый `DailyOperationsDigest` за дату в МСК или 404 | `coo` `owner` `admin` | **β-8.3** |
| **GET** | `/api/v1/dashboard/operations/daily-digest/latest` | Последний сгенерированный отчёт (для блока «Вчерашний отчёт» на `/dashboard/operations`) | `coo` `owner` `admin` | **β-8.3** |
| **POST** | `/api/v1/dashboard/operations/daily-digest/generate?date=YYYY-MM-DD` | Принудительная перегенерация (двухстадийная сборка) | `admin` `super_admin` | **β-8.3** |
| **GET** | `/api/v1/dashboard/operations/open-commitments?days=14` | Висящие обещания в команде с именами | `coo` `owner` `admin` | **β-8.2** |
| GET | `/api/v1/me/check-ins?date=&kind=` | Свои чек-ины (`sentiment*` поля **всегда скрыты**, даже если у юзера есть роль `coo`) | self | β-8 / β-8.1 |
| POST | `/api/v1/me/check-ins` | Manual upsert | self | β-8 |
| GET | `/api/v1/me/check-ins/history?days=30` | Окно истории | self | β-8 |
| **GET** | `/api/v1/me/promises?status=open\|asked\|all&limit=50` | Свои обещания (изоляция через JOIN `entities.entity.persons.some.id`) | self | **β-8.2** |
| **POST** | `/api/v1/me/promises/:blockId/mark` | Ручное закрытие (`fulfilled`/`missed`/`cancelled` + note) | self | **β-8.2** |
| GET | `/api/v1/personal-relations?personId=&relationType=` | EntityLink-связи человека | `admin` `coo` | β-8 |
| **GET** | `/api/v1/personal-relations/commitments?personId=` или `?entityId=` | Исходящие + входящие обещания человека. Принимает `Person.id` или `Entity.id` (тип `person`) — взаимоисключающе. | `admin` `coo` `owner` `super_admin` | **β-8.2** |

⚠ **Privacy `sentiment`:** в `/me/check-ins` маппер `stripSentimentForRole` всегда вызывается с `role=null` — fail-safe двойная защита (RBAC + DTO-фильтр) против утечки настроения сотруднику. Покрыто 9 тестами.

## WebSocket gateways

| Namespace | Назначение |
|---|---|
| `/ws/tracker` | Tracker events (issue/comment/cycle/intake/activity_feed) + **issue.chat.* (T8 — presence, typing, join/leave)** |
| `/ws/feed` | ActivityFeed live (tenant/team/user rooms) |
| `/ws/voice` | **T4 — Streaming ASR (Concierge voice input)** |

## Admin (Z-Admin) — новые эндпоинты Фаз 0-9 редизайна (2026-05-25)

Все эндпоинты — под `SuperAdminGuard` + `SuperAdminAuditInterceptor`, префикс `/api/v1/admin`. Severity `high`/`destructive` требует поля `reason` в payload. Подробнее — [admin-z-global.md](admin-z-global.md), [admin-settings.md](admin-settings.md), [admin-crons.md](admin-crons.md), [admin-workers.md](admin-workers.md), [admin-content.md](admin-content.md).

### Settings (Фаза 0)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/settings` | список, фильтры `?category=&section=` |
| GET | `/admin/settings/:key` | значение + метаданные |
| POST | `/admin/settings/:key` | `{ value, reason? }` (reason обязателен для high/destructive) |
| GET | `/admin/settings/:key/history` | последние 50 правок |

### Crons (Фаза 8)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/crons` | список всех + статус |
| PATCH | `/admin/crons/:name` | `{ expression?, enabled? }` |
| POST | `/admin/crons/:name/run` | ручной запуск (пишет `CronRunHistory.triggeredBy`) |

### Workers / BullMQ (Фаза 8)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/workers/queues` | список + counts |
| GET | `/admin/workers/queues/:name` | active / waiting / failed / delayed |
| POST | `/admin/workers/queues/:name/retry-failed` | Job.retry() для failed |
| POST | `/admin/workers/queues/:name/pause` | Queue.pause() |
| POST | `/admin/workers/queues/:name/resume` | Queue.resume() |

### Audit + Incidents (Фаза 1)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/audit` | журнал super_admin, `?adminId=&entity=&from=&to=` |
| GET | `/admin/incidents` | DLQ + failed jobs + алерты |
| GET | `/admin/incidents/rules` | список правил алертов |
| POST | `/admin/incidents/rules` | CRUD правил |
| GET | `/admin/search` | Cmd+K fuzzy `?type=org|user|meeting&q=` |

### Analytics (Фаза 2, read-only)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/analytics/orgs` | usage по Org + пользователям |
| GET | `/admin/analytics/functions` | LLM-функции (заменил legacy `/admin/ai-usage`) |
| GET | `/admin/analytics/economics` | юнит-экономика |
| GET | `/admin/analytics/meetings` | встречи |
| GET | `/admin/analytics/knowledge` | Knowledge-Core |
| GET | `/admin/analytics/concierge` | Concierge / AI-чат |

### AI и модели (Фаза 3)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/ai-models` | список taskType (legacy URL роутится сюда же из `/admin/ai/routing`) |
| GET | `/admin/ai-models/:taskType` | детали + цепочка |
| GET | `/admin/ai-models/:taskType/metrics` | `?period=24h\|7d\|30d` (legacy ось периода; UI шлёт через mapper из `day/week/month`) |
| GET | `/admin/ai-models/:taskType/history` | audit переключений |
| POST | `/admin/ai-models/:taskType/switch-primary` | switch + опц. A/B |
| GET | `/admin/llm-routes` | роуты LLM по `dataClass` + `taskType` |
| GET | `/admin/ai-prompts` (он же `/admin/prompts`) | реестр шаблонов промптов |
| GET | `/admin/ai-prompts/:id` | + версии |

### Orgs / Plans / Entitlements (Фаза 4)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/orgs/plans` | список планов продукта |
| POST | `/admin/orgs/plans` | CRUD |
| PATCH | `/admin/orgs/plans/:id` | CRUD |
| GET | `/admin/orgs/entitlements` | глобальный обзор overrides по Org |
| PATCH | `/admin/orgs/:id/entitlements` | редактирование per-Org overrides |

### Content (Фаза 5)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/content/meeting-types` | список + CRUD |
| POST | `/admin/content/meeting-types` | … |
| PATCH | `/admin/content/meeting-types/:id` | … |
| GET | `/admin/content/email-templates` | список (БД + bootstrap-sync из `mail.templates.ts`) |
| POST | `/admin/content/email-templates` | … |
| POST | `/admin/content/email-templates/:key/test-send` | `{ to }` тестовая отправка |
| GET | `/admin/content/system-messages` | баннеры / maintenance / алерты |
| POST | `/admin/content/system-messages` | … |
| GET | `/admin/content/global-channels` | каталог in_app/email/telegram/max |
| POST | `/admin/content/global-channels` | … |
| GET | `/admin/content/copy-strings` | UI-строки |
| PATCH | `/admin/content/copy-strings/:key` | … |

### Integrations (Фаза 6)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/integrations/bots` | Conversational боты |
| GET | `/admin/integrations/webhooks` | подписки на вебхуки |
| GET | `/admin/integrations/livekit` | LiveKit-инспектор |

### Media (Фаза 7)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/media/retention` | `RetentionPolicy` по типам |
| PATCH | `/admin/media/retention/:type` | `{ days }` |
| GET | `/admin/media/storage` | S3 buckets stats |
| POST | `/admin/media/storage/switch` | `{ provider }` (Yandex/Selectel/MinIO/…) |

### Platform (Фаза 8)
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/platform/feature-flags` | глобальный default + org overrides + rollout% |
| PATCH | `/admin/platform/feature-flags/:key` | … |
| GET | `/admin/platform/feature-flags/:key/resolve` | `?tenantId=…` для отладки |
| GET | `/admin/platform/limits` | `MAX_*` |
| PATCH | `/admin/platform/limits/:key` | … |
| GET | `/admin/platform/security` | Argon / JWT TTL / IP-salt / rotation |
| PATCH | `/admin/platform/security` | … |
| GET | `/admin/platform/maintenance` | бэкапы / re-index |
| POST | `/admin/platform/maintenance/backup-now` | … |
| POST | `/admin/platform/maintenance/reindex-now` | … |

## История изменений

- **2026-05-25:** создан как часть финального handoff Wave 1-3. Документированы T1/T2/T4/T5/T6a/T8.
- **2026-05-25 (β-8.1/β-8.2):** добавлены `team-temperature`, `weekly-digest`, `open-commitments`, `/me/promises`, `personal-relations/commitments` endpoints; зафиксирована fail-safe privacy для поля `sentiment`.
- **2026-05-25 (β-8.3):** добавлены `daily-digest` (GET/POST + `/latest`) endpoints — ежедневный отчёт COO в окне 1 день МСК. См. [`plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md`](../../plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md).
- **2026-05-25 (admin-redesign Фазы 0-9):** добавлен раздел «Admin (Z-Admin) — новые эндпоинты Фаз 0-9» с полным списком префиксов `/api/v1/admin/{settings,crons,audit,incidents,analytics,ai,orgs/{plans,entitlements,:id/*},content/*,integrations/*,media/*,platform/*,llm-routes}`.
- **2026-05-25 (feedback):** добавлен раздел «Feedback — канал обратной связи + AI-кластеризация» с пользовательскими и админскими эндпоинтами `/api/v1/feedback/*` и `/api/v1/admin/feedback/*`. Полная заметка фичи — [[feedback]].

[[../index|← index]]
