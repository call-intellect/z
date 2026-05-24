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

## WebSocket gateways

| Namespace | Назначение |
|---|---|
| `/ws/tracker` | Tracker events (issue/comment/cycle/intake/activity_feed) + **issue.chat.* (T8 — presence, typing, join/leave)** |
| `/ws/feed` | ActivityFeed live (tenant/team/user rooms) |
| `/ws/voice` | **T4 — Streaming ASR (Concierge voice input)** |

## История изменений

- **2026-05-25:** создан как часть финального handoff Wave 1-3. Документированы T1/T2/T4/T5/T6a/T8.

[[../index|← index]]
