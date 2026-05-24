---
title: Frontend Pages (реестр страниц)
status: living
covers: реестр всех страниц Next.js App Router
---

# Frontend Pages — реестр страниц

Сжатый реестр страниц Next.js App Router (`frontend/app/`). Route-группы: `(public)` / `(authenticated)` / `(admin)` / `(design-preview)`. Все страницы под `(authenticated)` требуют сессии (cookie `z_session`).

Файл создан 2026-05-25 как часть финального handoff Wave 1-3 (Wave 1 закрытие). Пополняется по факту.

## Финальный handoff Wave 1-3 — новые страницы

### T1 Recognition (Gamification frontend)

| Путь | Что показывает |
|---|---|
| `/me/contributions` | Мои вклады: 5 типов (helpProvided, ideasShipped, thanksReceived/Given, currentCheckinStreak). MyContributionsWidget + my badges + outgoing thanks (последние 30 дней). |
| `/persons/[id]/contributions` | Вклад коллеги. PersonContributionsWidget — read-only, фильтр по `visibility` (member видит только public, manager видит team). |

Виджеты (для встраивания в дашборды):
- `src/ui/recognition/MyContributionsWidget.tsx`
- `src/ui/recognition/PersonContributionsWidget.tsx`
- `src/ui/recognition/TeamSpotlightWidget.tsx` — топ-5 за неделю (используется в `feed/spotlights/page.tsx`).

### T2 Helpfulness frontend (Specialist 3.8)

| Путь | Что показывает |
|---|---|
| `/me/social-contribution` | Мой социальный профиль: 5 публичных traits (help_provided, proactive_hint, mentoring, emotional_support, constructive_feedback). Privacy: private traits (question_unanswered, question_acknowledged_no_action) — НЕ показываются субъекту, только admin. |
| `/persons/[id]/social-contribution` | Социальный профиль коллеги. Те же фильтры что и для своего, плюс role-based visibility. |
| `/admin/helpfulness-overview` | Manager+admin: team-map (агрегат по сотрудникам) + unanswered questions widget (только admin видит private traits). |

Виджеты:
- `src/ui/helpfulness/TopHelpfulWidget.tsx`
- `src/ui/helpfulness/SpotlightsTodayWidget.tsx`
- `src/ui/helpfulness/HelpRequestsWidget.tsx`

### T5 Email-to-task (UI обновлено)

`app/(authenticated)/projects/[slug]/settings/page.tsx` — добавлена секция «Email-в-задачу»:
- Переключатель «Принимать задачи по email».
- При включении — генерится `emailInboxAlias` + показывается полный адрес `<alias>@<MAIL_INBOX_DOMAIN>`.
- Копи-кнопка.
- Кнопка «Сгенерировать новый адрес» (старый перестаёт работать).
- Превью последних 10 писем (с status badge: routed/duplicate/rejected/failed).

### T1+T2 — `feed/spotlights/page.tsx` обновлено

Добавлены 4 виджета сверху списка spotlights:
- `<TeamSpotlightWidget>` (T1 — Recognition top-5).
- `<TopHelpfulWidget>` (T2 — топ helpfulness).
- `<SpotlightsTodayWidget>` (T2 — сегодня).
- `<HelpRequestsWidget>` (T2 — открытые запросы помощи).

## Tracker (Phase 2 + Wave 2 polish + handoff)

| Путь | Назначение |
|---|---|
| `/projects` | Список проектов (фильтры, поиск) |
| `/projects/[slug]` | Master-detail проекта (Board / Backlog / Cycles / Settings) |
| `/projects/[slug]/settings` | Настройки проекта (members, states, **email-inbox T5**) |
| `/issues` | Список задач (фильтр по assignee, state, label, cycle) |
| `/issues/[id]` | Карточка задачи: Description / **IssueComments (T8 переписан)** / Activity / Versions / **IssueChat (T6b scope='issue')** |
| `/me/inbox` | Мои входящие задачи (cursor pagination + badge counter T6a) |
| `/me/mentions` | **T8 — Лента моих @mention'ов** |
| `/me/check-ins` | Мои чек-ины |
| `/me/contributions` | **T1 — Мои вклады (Recognition)** |
| `/me/social-contribution` | **T2 — Мой социальный профиль (Helpfulness)** |
| `/me/clone` | Мой клон (γ-1, обязательная для DoD) |
| `/me/knowledge-profile` | Мой профиль знаний (β-2) |
| `/persons/[id]/contributions` | **T1 — Вклад коллеги** |
| `/persons/[id]/social-contribution` | **T2 — Соц. профиль коллеги** |
| `/persons/[id]/skill-profile` | Skill-профиль (γ-1, manager UI) |
| `/persons/[id]/knowledge-profile` | Профиль знаний коллеги (β-2) |
| `/feed/spotlights` | Spotlights + **T1/T2 виджеты** |
| `/feed` | Activity Feed (Wave 2) |
| `/intake` | Triage очередь (AI suggestions) |

## Admin

| Путь | Назначение |
|---|---|
| `/admin` | Дашборд админки (Org-Admin) |
| `/admin/helpfulness-overview` | **T2 — Team-map + unanswered** |
| `/admin/ai-models` | Управление LLM-моделями (Org-overrides) |
| `/admin/llm/catalog` | Каталог моделей (super_admin) |
| `/admin/llm/routes` | Маршруты taskType → provider |
| `/admin/prompts` | Prompt Registry (Phase A) |
| `/admin/users` | Пользователи Org |
| `/admin/audit` | Audit Log |

## Top-level

- `/` (public) — landing.
- `/login`, `/register`, `/forgot`, `/reset` — auth.
- `/onboarding` — wizard (Phase 0c, owner-only).
- `/chat-v2` — AI-чат компании (master-detail + deep-link `?conversationId=`).
- `/dashboard` — Director Dashboard.
- `/decisions`, `/insights`, `/ideas`, `/regulations` — реестры специалистов.
- `/curation` — кураторская очередь.

## История

- **2026-05-25:** создан в рамках handoff Wave 1-3. Документированы T1, T2, T5 (settings секция), feed/spotlights обновления.

[[../index|← index]]
