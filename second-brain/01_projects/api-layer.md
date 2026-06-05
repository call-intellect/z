---
title: API Layer (реестр endpoints)
status: living
covers: реестр всех REST endpoints backend по модулям
---

# API Layer — реестр endpoints

Сжатый реестр всех REST endpoints backend. Полные DTO/Swagger — в `backend/src/modules/*/dto/` и `/api/docs`. Глобальный префикс — `/api/v1`. Авторизация по cookie `z_session` (CookieAuthGuard) + `TenantGuard` (берёт `X-Org-Id` / `:orgId`).

Этот файл создан 2026-05-25 как часть финального handoff Wave 1-3. Не претендует на полноту — пополняется по факту добавления новых endpoint'ов.

## Smart Tables — MVP-старт (2026-05-31, Фазы 0+1)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/v1/tables` | Создать таблицу (multi-tenant). Body `{ name, description?, icon?, parentDocumentId?, entitySync? }`. Лимит `TABLE_MAX_TABLES_PER_ORG=1000`. |
| GET | `/api/v1/tables` | Список таблиц (`?archived=active\|archived\|all&limit=50&offset=0`). |
| GET | `/api/v1/tables/:id` | Одна таблица. |
| PATCH | `/api/v1/tables/:id` | Обновить (name/description/icon/...). |
| POST | `/api/v1/tables/:id/archive` | Soft-archive (`archivedAt=now()`). Идемпотентно. |
| POST | `/api/v1/tables/:id/unarchive` | Снять архив. |
| DELETE | `/api/v1/tables/:id` | Hard-delete (только если архив). Каскад на properties/rows/views/automations. |
| GET | `/api/v1/tables/:tableId/properties` | Список колонок (по `order`). |
| POST | `/api/v1/tables/:tableId/properties` | Создать колонку. Body `{ name, type, config?, isPrimary?, order? }`. Лимит `TABLE_MAX_PROPS_PER_TABLE=200`. |
| PATCH | `/api/v1/tables/:tableId/properties/:propertyId` | Обновить колонку. |
| POST | `/api/v1/tables/:tableId/properties/:propertyId/reorder` | Изменить `order` (фракционный). |
| DELETE | `/api/v1/tables/:tableId/properties/:propertyId` | Удалить колонку (hard). |
| GET | `/api/v1/tables/:tableId/rows` | Список строк (`?archived=...&limit=100&offset=0`). |
| POST | `/api/v1/tables/:tableId/rows` | Создать строку. Лимит `TABLE_MAX_ROWS_PER_TABLE=100_000`. Каждое значение в `cells` ≤ `TABLE_MAX_CELL_SIZE_BYTES=1_048_576`. |
| GET | `/api/v1/tables/:tableId/rows/:rowId` | Одна строка. |
| PATCH | `/api/v1/tables/:tableId/rows/:rowId` | Обновить ячейки / entityId / pageContent. |
| POST | `/api/v1/tables/:tableId/rows/:rowId/archive` | Soft-archive строки. |
| POST | `/api/v1/tables/:tableId/rows/:rowId/unarchive` | Снять архив строки. |
| DELETE | `/api/v1/tables/:tableId/rows/:rowId` | Hard-delete (только если архив). |

19 эндпоинтов. Все под `CookieAuthGuard + TenantGuard`. RBAC ресурс `table` в `policy.csv` (owner/admin/manager r/w/d, manager — self-scope на write/delete). См. [[smart-tables]].

**Дополнение Фазы 3 — сохраняемые срезы (2026-05-31):**

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/tables/:tableId/views` | Список views (visibility-фильтр: personal только свои + все shared/public). |
| POST | `/api/v1/tables/:tableId/views` | Создать view. Body `{ name, type, config, visibility }`. `ownerId=currentUser`. |
| GET | `/api/v1/tables/:tableId/views/:viewId` | Один view. |
| PATCH | `/api/v1/tables/:tableId/views/:viewId` | Обновить. Только owner или admin. |
| DELETE | `/api/v1/tables/:tableId/views/:viewId` | Удалить. Только owner или admin. |

Итого Smart Tables: **24 эндпоинта** (19 базовый CRUD + 5 views).

## Партнёрский кабинет — обновление (2026-05-31)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/v1/referrals/me` | Создать профиль. Body `{ contractAccepted: true, inn?, legalForm?, payoutDetails? }`. ИНН/реквизиты опц. |
| GET | `/api/v1/referrals/me/clients` | **Маскированный** список клиентов (`clientCode`, `status`, `monthlyEarningsKopecks`, без `org.name/id`) |
| GET | `/api/v1/referrals/me/stats` | Расширенный (`clicks30d`, `signups30d`, `firstPayments30d`, 2 конверсии) |
| GET | `/api/v1/referrals/me/income-chart` | 12 месяцев `{month, incomeRub, activeClients}` |
| GET | `/api/v1/referrals/me/funnel?period=30d\|90d\|all` | Воронка `{clicks, signups, firstPayments, activeNow, conversions}` |
| POST | `/api/v1/referrals/me/promo-event` | Трекинг impression/click/dismissed промо-баннера. Throttle 30/min/IP |

`GET /api/v1/admin/referrals/:id` (super_admin) теперь использует `listClientsForAdmin` — НЕ маскированный, со всеми `org.name/id` для аудита.

## Z-Admin / Тариф — упразднение CRUD (2026-05-31)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/admin/orgs/plans/current` | Снимок единого `tier_standard` из AdminSetting + TIER_CONFIG + counts. `editableSettings` метаданные для UI |

CRUD `POST/PATCH/DELETE/list/getUsage` упразднены. Модель `Plan` в schema.prisma — `// LEGACY` (физическое удаление через 2 недели prod-наблюдений). Цена редактируется через `POST /api/v1/admin/settings/billing.*` (severity=`high`, `reason` обязателен).

## Auth — единый логин (2026-05-29)
| Метод | Путь | Назначение |
|---|---|---|
| POST | `/auth/login` | **единый логин** юзеров и супер-админов: try standalone (argon2) → admin (bcrypt). Ответ `{ user, role, isSuperAdmin, mustChangePassword }`, cookie `z_session`. См. [[auth-and-accounts]] Поток 4 |
| POST | `/accounts/login` | standalone-логин (deprecated, за единым) |
| POST | `/auth/admin-login` | admin-логин (deprecated, за единым) |

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

### Sprints (2026-05-27 / 2026-05-28, см. [[sprints]])

| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/api/v1/sprints` | Master-detail список Org с фильтрами `status` (active/completed/upcoming/all), `scopeKind` (org/customer/vendor/person/department/project), `q`, сортировками (startDate/progress/hints), пагинацией. 2026-05-28. |
| POST | `/api/v1/sprints/quick-create` | Атомарное создание Project + Cycle + Board + IssueStates (одна transaction). Поддерживает 6 scope. Auto-генерация slug/identifier с collision retry. Idempotency-Key. 2026-05-28. |
| GET  | `/api/v1/cycles/:id/dashboard` | Агрегированные данные дашборда спринта. Redis-кэш 5 мин. |
| POST | `/api/v1/cycles/:id/start-meeting` | Запуск встречи (default `type='sprint_review'`). Создаёт `Meeting.linkedCycleId`. |
| GET  | `/api/v1/cycles/:id/hints` | Список активных подсказок помощника. |
| POST | `/api/v1/sprint-hints/:id/dismiss` | Закрыть подсказку (`status='dismissed'`). |
| POST | `/api/v1/sprint-hints/:id/resolve` | Пометить выполненной (`status='resolved'`). |
| GET  | `/api/v1/cycles/:id/review` | Финальный отчёт спринта (`ready` / `pending` / `failed`). Живёт в `KnowledgeCoreApiModule`. |
| POST | `/api/v1/cycles/:id/review/regenerate` | Перезапустить генерацию финального отчёта. |

### Vendors (расширено 2026-05-28)

| Метод | Путь | Назначение |
|---|---|---|
| GET  | `/api/v1/vendors` | Список с фильтрами. |
| GET  | `/api/v1/vendors/:id` | Детальный. |
| POST | `/api/v1/vendors` | Создать (для inline-create из мастера спринтов). RBAC `vendor:write`. 2026-05-28. |
| PATCH | `/api/v1/vendors/:id` | Обновить. RBAC `vendor:write`. 2026-05-28. |
| DELETE | `/api/v1/vendors/:id` | Soft-delete. RBAC `vendor:delete`. 2026-05-28. |

## Goals OKR v2 — Граф целей (2026-06-02)

ТЗ — [`plans/tz/2026-06-02-goals-okr-v2.md`](../../plans/tz/2026-06-02-goals-okr-v2.md). Полная заметка — [[goals-and-strategic-alignment]] §«Goals OKR v2». Все под `CookieAuthGuard + TenantGuard`. (Базовый CRUD целей `GET/POST/PATCH/DELETE /goals` и темы — описаны выше в Phase 9.)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| POST | `/api/v1/goals/:id/key-results` | Создать Key Result. Body `{ name, unit?, startValue, targetValue, currentValue?, sourceKind?, sourceConfig? }` | owner (RBAC `goal_key_result:write`) |
| PATCH | `/api/v1/goals/:id/key-results/:krId` | Обновить KR. Ручной `currentValue` → пишет `GoalKeyResultCheckpoint(recordedBy='manual')` + помечает поле в `manualOverride` (M0). | owner |
| DELETE | `/api/v1/goals/:id/key-results/:krId` | Удалить KR (каскад checkpoints). | owner |
| POST | `/api/v1/goals/:id/supersede` | Заменить цель новой версией: создаёт новый Goal с `supersededById`, старой `validUntil=now` (история сохраняется). | owner |
| PATCH | `/api/v1/goals/:id` (расширен) | Помимо базовых полей принимает `parentGoalId` (reparent c `assertNoCycle`/`assertParentExists`), `progressStatus`, `promotionState` (например `suggested→active` — «Принять цель»). | owner |
| POST | `/api/v1/ideas/:id/goal` | Привязать гипотезу к цели (`Idea.goalId`). Валидация goal+tenant, audit. «Двигает цель». | owner/admin |
| PATCH | `/api/v1/cycles/:id` (расширен) | Принимает `primaryGoalId` — «этот спринт продвигает цель X» (валидация goal). | по RBAC спринтов |

**Дашборд директора (`GET /api/v1/dashboard/director`)** — `DirectorDashboardDto` расширен опц. блоками:
- `goalsTree?` — дерево active-целей (parent→children) с per-KR `progressPercent` и `progressStatus`.
- `goalsPulse?` — счётчики недели по `progressStatus` (✅ выполнено / 🟢 в движении / 🟡 риск / 🔴 застряло / ⚪ выпало) + `newThisWeek`.

Наполняются `fetchGoalsTree` / `fetchGoalsPulse` в `DirectorDashboardService.getDirectorView`.

> RBAC: новый ресурс `goal_key_result` (owner r/w/d, admin/manager r). Доставка пульса — не REST, а `ConversationalService` eventType `goals.pulse` (см. [[workers-queues]] cron `goals-pulse`).

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
| GET  | `/api/v1/me/ai-chat/quota` | Единая per-user дневная квота AI-общения (Concierge + клоны вместе) — `{ dailyUsed, dailyLimit, role }`. См. ТЗ [`2026-05-31-ai-chat-quota-unified-per-user`](../../plans/tz/2026-05-31-ai-chat-quota-unified-per-user.md). | — |
| POST | `/api/v1/voice/transcribe` | REST ASR (Vox/GigaAM, fallback) | — |
| WS | `/ws/voice` | Streaming-стенд для голоса (events: voice.start/chunk/end/cancel → voice.transcribed/error) | **T4** |

⚠ **Voice — только вход** (микрофон → ASR). Concierge отвечает **только текстом**, TTS не интегрируется в flow (см. `feedback_concierge_text_only_output.md`).

## Knowledge-core

См. [`knowledge-core.md`](../02_architecture/knowledge-core.md) — `/api/v1/knowledge/blocks`, `/entities`, `/themes`, `/graph/*`, `/search`.

## Curation (Слой 4)

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/api/v1/curation/override-stats` | Доля override (`(reject + approve_with_edits) / decided`) per `resourceType` — read-model `CurationService.getOverrideStats`. Часть A «Лестница доверия». | `owner` `admin` |

Полная карта курации (триаж, лестница доверия, AI-судья, autotune+kill-switch) — [[curation]]. Provisional-audit-статистика (`getProvisionalAuditStats`) пока только сервисный метод, отдельного эндпоинта нет.

## Pending Actions (Action Center, Часть B, 2026-06-03)

Единый агрегатор «что ждёт подтверждения» (curation / conflict / intake / probe). Модуль `backend/src/modules/pending-actions/`. Все под `CookieAuthGuard + TenantGuard`. owner/admin видят pending по curation/conflict/intake; probe — только свои. См. [[../02_architecture/module-map]] §pending-actions.

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/api/v1/pending-actions/count` | `{ total, bySource }` — для живого бейджа сайдбара и колокольчика. | self (role-scoped) |
| GET | `/api/v1/pending-actions` | Urgent-first список pending-элементов (`source`, `actionUrl`, `urgent`, `canQuickConfirm`). | self (role-scoped) |
| POST | `/api/v1/pending-actions/snooze` | Отложить элемент (1д/3д/7д) — создаёт `PendingActionSnooze`. | self |
| POST | `/api/v1/pending-actions/confirm` | One-tap подтверждение light curation → delegate в `CurationService.decide` (approve), RBAC внутри. | self (RBAC curation) |

Блок `requiresAction` отдаётся также в `GET /api/v1/dashboard/director` (`DirectorDashboardDto`, персонально по `userId`, best-effort). Источник: `plans/tz/2026-06-02-action-center-pending-confirmations.md` (Часть B).

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

> **`ensurePersonForUser` — у владельца Org теперь есть своя `Person` (МТЗ №1 Фаза 9, 2026-06-04, коммит `7cffb1e3`).** Раньше у владельца не было карточки `Person`, и `/me/promises` (и весь self-сценарий с обещаниями) падал. Теперь:
> - `PersonsService.ensurePersonForUser` — `findFirst` по `userId` → линковка осиротевшей `Person` из `membership.personId` → создание новой с `User.email`/`name`, `relationship='employee'` (устойчиво к гонке `P2002`).
> - `OrgsService.createForOwner` создаёт `Person` владельца + `Membership.personId` при создании Org.
> - `GET /me/promises` теперь **graceful**: при отсутствии `Person` отдаёт `{items:[]}` (а не 500); `POST /me/promises/:blockId/mark` остаётся `403` (нельзя закрывать чужое обещание).
> - Backfill для существующих владельцев — `backend/scripts/backfill-owner-person.ts` (зарегистрирован в `apply-prod-deploy.ts` STEPS).

## Clones (Skill & Persona, γ-1 + v2)

| Метод | Путь | Назначение | Доступ | Фаза |
|---|---|---|---|---|
| POST | `/api/v1/clones/persons/:personId/ask` | One-shot вопрос клону сотрудника (rate-limit 20/сутки, mode=`clone_style`, антифальшивка ≥2 reasoning-блока с cosine≥0.70) | owner/admin/self/direct manager | γ-1 |
| POST | `/api/v1/clones/roles/:roleId/ask` | One-shot вопрос агрегатному клону роли (top traits всех employee'ев роли) | owner/admin/manager | γ-1 |
| GET | `/api/v1/clones/persons/:personId/skill-profile` | Read профиля + traits | manager/admin/self | γ-1 |
| GET | `/api/v1/clones/roles/:roleId/skill-profile` | Агрегатный профиль роли + список людей | manager/admin | γ-1 |
| POST | `/api/v1/clones/skill-traits/:traitId/mark-misleading` | Manager/admin помечает trait как неверный (postфактум-контроль) | owner/admin/direct manager | γ-1 |
| **POST** | `/api/v1/clones/persons/:personId/conversations` | **Многотуровый диалог с клоном сотрудника v2** — dialog-layer (multi-query expansion + temporal filter), режимы `factual` / `judgmental`. taskType `dialog-multi-query-clone` (DeepSeek V4 Pro). Доступ через `CloneAccessGrant`. Флаг `CLONE_V2_ENABLED`. | owner/admin/granted (через CloneAccessGrant) | **Фаза 7 §9 (2026-05-26)** |
| **POST** | `/api/v1/clones/roles/:roleId/conversations` | **Многотуровый диалог с клоном роли v2** — те же dialog-layer / режимы. Агрегатный клон роли. | owner/admin/granted | **Фаза 7 §9 (2026-05-26)** |
| **GET** | `/api/v1/clones/conversations?cloneType&cloneRefId&cursor&limit` | Мои диалоги с конкретным клоном (cursor-pagination, маппинг на `ChatV2Conversation(scope='card')` — отдельной модели `CloneConversation` нет). | granted через CloneAccessGrant | **2026-05-26** |
| **GET** | `/api/v1/me/clone-access` | Что мне выдано (для frontend-хука `useMyCloneAccess`). Грейсфул на 404 — пустой массив. | authenticated | **2026-05-26** |

⚠ **Ролевые клоны (решение 2026-05-25).** ExecutablePersona строится по должности, а не по сотруднику. UI-страницы — только `/clones`, `/clones/[roleId]`, `/clones/[roleId]/chat/[conversationId]` и `/admin/clones`. Старые `/me/clone` и `/persons/[id]/skill-profile` удалены. См. [[skill-and-clone]].

### Clones admin (2026-05-26 — Фаза 7 §9 рост)

Все endpoints под `OrgAdminGuard` + `AdminAuditInterceptor` (severity `high` — `reason` обязателен в payload для grant / revoke / extend). Префикс `/api/v1/admin/clones`. См. [[admin]] §«/admin/clones».

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/clones/access-grants?cloneType=&search=&onlyActive=&page=&pageSize=` | Список грантов с фильтрами + server-side pagination + batch-enrichment (`cloneLabel` / `userName` / `userEmail` / `grantedBy`) без N+1. |
| POST | `/admin/clones/access-grants` | Выдать грант (идемпотентно: re-grant поверх revoked удаляет старую запись в транзакции). Body: `{ cloneType, cloneRefId, grantedToUserId, expiresAt?, reason }`. Эмитит `clone.access_granted` через `ConversationalService` (in-app + Telegram, warn-log при ошибке — grant не откатывается). |
| DELETE | `/admin/clones/access-grants/:id` | Soft-revoke (`revokedAt` + `revokedBy`). Запись остаётся как audit. Body: `{ reason }`. |
| PATCH | `/admin/clones/access-grants/:id` | Продлить / изменить `expiresAt` (включая «бессрочно» = null). Body: `{ expiresAt: ISO \| null, reason }`. |
| GET | `/admin/clones/:cloneType/:cloneRefId/access-grants` | Per-clone view — кому уже выдан этот клон (для модалки CreateGrantDialog). |

**ТЗ:** [plans/tz/2026-05-26-clone-access-grant-admin-api.md](../../plans/tz/2026-05-26-clone-access-grant-admin-api.md).

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

### Demo-кабинеты (2026-05-29, `super_admin`)
`AdminDemoController` (`@ApiExcludeController` — не в Swagger). Переиспользует `OnboardingService`.
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/admin/demo/orgs` | список Org (+ `demoSeededAt`, владелец) |
| POST | `/admin/demo/orgs/:orgId/seed` | залить демо «ТехноСтрим» (от имени owner'а Org) |
| POST | `/admin/demo/orgs/:orgId/reset` | сбросить демо |

### Onboarding — авто-сидинг демо (ТЗ 2026-05-31)
`OnboardingController` (`CookieAuthGuard + TenantGuard`, owner/admin). Авто-заливка демо при регистрации — см. [[onboarding-wizard]] и [[workers-queues]] (очереди `onboarding.demo-seed`/`demo-cleanup`).
| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/v1/orgs/:orgId/demo-seed-status` | статус авто-заливки демо (`pending`/`in_progress`/`completed`/`failed`) для loading-экрана `/onboarding/welcome/complete` |
| POST | `/api/v1/orgs/:orgId/demo-workspace/ensure` | **fallback**: если Org в DEMO, но синтетики нет (старые Org / неудавшийся seed) — ставит свежий seed-job. Идемпотентно (`{status, enqueued}`). Дёргается `SubscriptionContext` один раз при DEMO. |

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

## Команда + персональные доступы сотрудников (2026-06-04)

ТЗ — [`plans/tz/2026-06-03-team-section-and-employee-access.md`](../../plans/tz/2026-06-03-team-section-and-employee-access.md). Модуль `orgs`. Все под `CookieAuthGuard + TenantGuard`. Capabilities-эндпоинты — только owner/admin Org. Подробнее — [[frontend-pages]] §«Команда», модель — [[../02_architecture/data-model]] §EmployeeCapabilityOverride.

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| GET | `/api/v1/orgs/:id/team-roster` | Объединённый ростер: все `Person` ⊕ участники (`Membership`) без карточки. Поля `personId/userId/fullName/email/roleId/roleName/departmentId/departmentName/invitationStatus/systemRole/telegramLinked/hasPersonCard/invitationId`. Self-contained (`OrgsService.listTeamRoster`). | member+ |
| GET | `/api/v1/orgs/:id/members/:userId/capabilities` | Список персональных override доступа участника. | owner/admin |
| PUT | `/api/v1/orgs/:id/members/:userId/capabilities/:capability` | Установить override `{ effect: 'allow'\|'deny', expiresAt? }`. Капабилити: `memory:regulations`/`memory:entities`/`feature:graph`/`panel:operations`. Upsert (`@@unique[tenantId,grantedToUserId,capability]`). | owner/admin |
| DELETE | `/api/v1/orgs/:id/members/:userId/capabilities/:capability` | Снять override (вернуть дефолт роли/тарифа). | owner/admin |
| GET | `/api/v1/orgs/:id/effective-access` | Эффективный доступ участников = дефолт роли/тарифа ± дельта override. | owner/admin |

`POST /api/v1/persons` (модуль `persons`) расширен полем `linkUserId` — привязка создаваемой карточки сотрудника к существующему участнику. Приглашение участника (`InviteMemberSchema`) расширено `personId` — резолв `Person`, дедуп pending по `personId`, сохранение `personId` в `OrgInvitation`.

## Meetings — приглашение сотрудников + задачи встречи (МТЗ №1, 2026-06-05)

ТЗ — [`plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md`](../../plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md) (Фазы 2–5). Модуль `meetings`. Подробнее — [[../02_architecture/module-map]] §«Identity встречи».

- **POST создания встречи** (`CreateMeetingForUserSchema`) расширен полем `invitees[]` (Ф2): массив `{ userId? | personId? | email?, sendVia: ('email'|'telegram')[] }`, max 50. Приглашённые pre-seed'ятся в транзакции как `Participant(role:'guest', isRegisteredUser, invitationStatus:'invited', inviteToken=nanoid)`; после транзакции — best-effort рассылка `deliverMeetingInvites` (joinUrl `${publicFrontendUrl}/m/<id>?inv=<token>`).
- **`GET /api/v1/meetings/:id/tasks`** (Ф5.2) — теперь **gate-coupled** на `AdminSetting knowledge.meetingTasksToTrackerOnly` (code-fallback FALSE): при дефолте читает `Task` и отдаёт **прежний контракт байт-в-байт**; при `ON` — задачи из tracker-`Issue` по `linkedMeetingIds`, нормализованные в ту же форму. Единый источник — `MeetingActionItemsService`. Внешний контракт при дефолте не изменился.

**Новый conversational `eventType 'meeting.invite'`** (Ф3) — политика каналов `telegram → email → in_app` (`EVENT_TYPE_CHANNEL_POLICY`), payload-схема в `event-payload.registry.ts`; обрабатывается в `telegram-bot.adapter` / `max-bot.adapter`. Для **внешних** адресатов (email без аккаунта) приглашение идёт через `mail.sendMeetingInvite`, не через conversational (см. [[../02_architecture/code-pitfalls]] §«два движка email»).

## ChatBox-интеграция (2026-06-05)

ТЗ — [`plans/tz/2026-06-05-chatbox-integration.md`](../../plans/tz/2026-06-05-chatbox-integration.md). Модуль `chatbox`. Все (кроме webhook) под `CookieAuthGuard + TenantGuard`, RBAC-ресурс `chatbox`. Профильная заметка — [[chatbox-integration]], фронт — [[frontend-pages]] §«Чаты».

| Метод | Путь | Назначение | RBAC act |
|---|---|---|---|
| GET | `/api/v1/chatbox/integration` | текущая интеграция org (без plain-токена) | read |
| POST | `/api/v1/chatbox/integration/workspaces` | по введённому токену вернуть список воркспейсов ChatBox | manage |
| PUT | `/api/v1/chatbox/integration` | создать/обновить `{token?, workspaceId, syncMode}` | manage |
| DELETE | `/api/v1/chatbox/integration` | отключить (снять webhook, status→disconnected) | delete |
| POST | `/api/v1/chatbox/integration/sync` | ручной синк `{scope:'all'\|'customers'\|'managers'\|'chats'}` → BullMQ job | manage |
| GET | `/api/v1/chatbox/integration/sync/status` | статус последних синков | read |
| GET | `/api/v1/chatbox/chats` | список чатов (фильтры `status`/`channelType`/`customerExternalId`, пагинация) | read |
| GET | `/api/v1/chatbox/chats/:id` | чат + клиент(unified) + менеджер + сессии | read |
| GET | `/api/v1/chatbox/chats/:id/messages` | сообщения чата | read |
| POST | `/api/v1/chatbox/chats/:id/messages` | отправить ответ от менеджера `{text}` → ChatBox API | write |
| GET | `/api/v1/chatbox/members` | менеджеры + текущая связка с Person | read |
| PUT | `/api/v1/chatbox/members/:id/link` | ручной маппинг `{personId\|null}` | manage |
| POST | `/api/v1/webhooks/chatbox/:tenantId/:secret` | **inbound webhook ChatBox** (`@ApiExcludeController`, без cookie-auth, `timingSafeEqual`, всегда 200) | — |

**Privacy-инвариант:** super_admin **не** получает bypass на чтение текста переписки (`ChatboxMessage.text`). Коды ошибок machine-readable: `chatbox_token_invalid`, `chatbox_workspace_not_found`, `chatbox_not_configured`, `chatbox_chat_not_found`, `chatbox_send_failed`, `chatbox_member_not_found`, `person_not_found`. Swagger-тег `chatbox`.

## История изменений

- **2026-05-25:** создан как часть финального handoff Wave 1-3. Документированы T1/T2/T4/T5/T6a/T8.
- **2026-05-25 (β-8.1/β-8.2):** добавлены `team-temperature`, `weekly-digest`, `open-commitments`, `/me/promises`, `personal-relations/commitments` endpoints; зафиксирована fail-safe privacy для поля `sentiment`.
- **2026-05-25 (β-8.3):** добавлены `daily-digest` (GET/POST + `/latest`) endpoints — ежедневный отчёт COO в окне 1 день МСК. См. [`plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md`](../../plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md).
- **2026-05-25 (admin-redesign Фазы 0-9):** добавлен раздел «Admin (Z-Admin) — новые эндпоинты Фаз 0-9» с полным списком префиксов `/api/v1/admin/{settings,crons,audit,incidents,analytics,ai,orgs/{plans,entitlements,:id/*},content/*,integrations/*,media/*,platform/*,llm-routes}`.
- **2026-05-25 (feedback):** добавлен раздел «Feedback — канал обратной связи + AI-кластеризация» с пользовательскими и админскими эндпоинтами `/api/v1/feedback/*` и `/api/v1/admin/feedback/*`. Полная заметка фичи — [[feedback]].
- **2026-05-26 (clones v2, Фаза 7 §9):** добавлены `POST /clones/persons/:id/conversations` и `POST /clones/roles/:id/conversations` — многотуровый диалог с клоном, dialog-layer, режимы factual / judgmental, taskType `dialog-multi-query-clone` на DeepSeek V4 Pro. Доступ через модель `CloneAccessGrant`, флаг `CLONE_V2_ENABLED`. См. [[skill-and-clone]] §«Доработки 2026-05-26».
- **2026-05-26 (clones admin CRUD + user list):** добавлены 5 admin endpoints `/api/v1/admin/clones/access-grants` (list / create / revoke / extend / per-clone-view) + 2 user endpoints `/api/v1/clones/conversations` (мои диалоги с клоном) и `/api/v1/me/clone-access` (что мне выдано). `AdminAuditInterceptor.classifyAction` расширен 3 ветками (grant/revoke/extend, severity high). `RbacService.canAccess*Clone` исправлен: теперь фильтрует активность грантов (`revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`). См. [plans/tz/2026-05-26-clone-access-grant-admin-api.md](../../plans/tz/2026-05-26-clone-access-grant-admin-api.md).
- **2026-06-02 (Goals OKR v2):** добавлен раздел «Goals OKR v2 — Граф целей» — KR-эндпоинты `POST/PATCH/DELETE /goals/:id/key-results[/:krId]`, `POST /goals/:id/supersede`, расширенный `PATCH /goals/:id` (parentGoalId/progressStatus/promotionState), `POST /ideas/:id/goal`, расширенный `PATCH /cycles/:id` (primaryGoalId), дашборд `goalsTree`/`goalsPulse`. Новый RBAC-ресурс `goal_key_result`. См. [plans/tz/2026-06-02-goals-okr-v2.md](../../plans/tz/2026-06-02-goals-okr-v2.md).
- **2026-06-04 (Команда + доступы):** добавлен раздел «Команда + персональные доступы сотрудников» — `GET /orgs/:id/team-roster`, capabilities CRUD `GET/PUT/DELETE /orgs/:id/members/:userId/capabilities[/:capability]`, `GET /orgs/:id/effective-access`; `POST /persons` расширен `linkUserId`, приглашение — `personId`. Новая модель `EmployeeCapabilityOverride`. См. [plans/tz/2026-06-03-team-section-and-employee-access.md](../../plans/tz/2026-06-03-team-section-and-employee-access.md).
- **2026-06-05 (МТЗ №1 meeting-identity):** добавлен раздел «Meetings — приглашение сотрудников + задачи встречи» — POST создания встречи принимает `invitees[]`; `GET /meetings/:id/tasks` стал gate-coupled на `knowledge.meetingTasksToTrackerOnly` (контракт при дефолте сохранён); новый conversational `eventType 'meeting.invite'`. См. [plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md](../../plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md).
- **2026-06-05 (ChatBox-интеграция):** добавлен раздел «ChatBox-интеграция» — `/chatbox/integration(+workspaces,sync,sync/status)`, `/chatbox/chats(+/:id,/messages,POST send)`, `/chatbox/members(+/:id/link)`, inbound webhook `/webhooks/chatbox/:tenantId/:secret`. Новый RBAC-ресурс `chatbox`, privacy-инвариант (super_admin без bypass на текст переписки). См. [plans/tz/2026-06-05-chatbox-integration.md](../../plans/tz/2026-06-05-chatbox-integration.md).

[[../index|← index]]
