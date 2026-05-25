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

## UI/API Modernization 2026-05-25 (фазы A-G ТЗ `ui-api-modernization`)

### Новые design-preview страницы

| Путь | Назначение |
|---|---|
| `(design-preview)/light-theme` | Галерея компонентов в светлой теме (sage `#7CA890`): swatches, типографика, кнопки, Chip × 6 вариантов, StatCard default+dark+sparkline, Sparkline bar+line, EmptyState, ConfirmDialog, sonner toast. |
| `(design-preview)/dark-theme` | То же в тёмной теме (warm-mint `#6FEAC8`). |

Тема задаётся через `data-theme="light|dark"` + `style={{colorScheme:'...'}}` на оборачивающем `<div>`. Внутри — единый `DesignPreviewGallery.tsx`.

### Новые shared-компоненты (`frontend/src/ui/components/shared/`)

| Компонент | Назначение |
|---|---|
| `StatCard.tsx` | Бордерлесс-карточка KPI: label/value/delta/sparkline. `variant: 'default'\|'dark'` — dark как визуальный якорь в KPI strip даже в светлой теме. |
| `Sparkline.tsx` | Pure-SVG bar/line, без recharts. Props: `data: number[]`, `variant: 'bar'\|'line'`, `color?`, `width?`, `height?`. |
| `Chip.tsx` | Семантический pill: `variant: success\|warning\|danger\|info\|lavender\|sand`, `size: 'sm'\|'md'`. Использует `bg-chip-*-bg` / `text-chip-*-fg`. |
| `QueryGate.tsx` | Универсальная обёртка `loading \| error \| empty \| content` поверх SWR. Принимает `skeleton?`, `empty?`, `errorView?`. |
| `ConfirmDialog.tsx` | Замена нативного `confirm()`. Controlled через `open`/`onOpenChange`, `destructive?`, Russian-defaults. |
| `useConfirmDialog.tsx` | Hook promise-based: `const { ask, dialog } = useConfirmDialog(); if (!(await ask({...}))) return; /* render */ {dialog}`. |
| `EmptyState.tsx` (fix) | Hardcoded `bg-white/slate-*` → токены `bg-bg-subtle / border-border-subtle / text-fg-*`. |

### Новые hooks (`frontend/src/hooks/`)

| Hook | Назначение |
|---|---|
| `useSwrWithToast.ts` | Обёртка над `useSWR`: на error автоматически вызывает `sonner.toast.error(message)`. Тот же интерфейс что у `useSWR`. |
| `useMediaQuery.ts` | `useMediaQuery(query)` + helper `useIsMobile()` (`max-width: 768px`). Vanilla `matchMedia`, SSR-safe (mount-guard). |

### Дизайн-токены `frontend/src/ui/tokens.css`

Полностью переписан на OKLCH. Light = sage `oklch(0.62 0.07 155)`, dark = warm-mint `oklch(0.84 0.13 168)`. Семантика pastel-чипов 6 семейств. Тёплый off-white фон `oklch(0.985 0.005 85)` вместо `#FFFFFF`. Film-grain noise overlay через `body::before` SVG-фильтр (отключается `@media (prefers-reduced-motion)`). Новая шкала radii (xs=6 → 2xl=28). Двойная мягкая тень `--shadow-card-{soft,raised}` + `--shadow-accent-focus`.

### Tailwind config (`frontend/tailwind.config.ts`)

Добавлены utility-классы: `bg-bg-surface`, `bg-bg-subtle`, `bg-accent-active`, `text-fg-disabled`, `bg-chip-*-{bg,fg}` (6 вариантов), `shadow-card-{soft,raised}`, `shadow-accent-focus`. Legacy `glow`/`glow-mint`/`soft`/`elevated` оставлены как alias на новые токены (для не-сломанного обратно совместимого кода). Inline plugin `.scrollbar-none` (без npm-зависимостей).

### Sidebar (`frontend/src/ui/components/app-shell/Sidebar.tsx`)

- Убран `shadow-glow-mint` с логотипа.
- В light — `bg-bg-surface` (светлее контента) вместо `bg-bg-elevated`.
- Active nav-item: 6px dot-маркер слева (absolute span) + `dark:shadow-accent-focus`.

### Dashboard CEO (`frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx`)

- KPI strip из 5 `<StatCard>` сверху (`grid-cols-1 md:grid-cols-3 xl:grid-cols-5`).
- «Активные темы» — `variant="dark"` (визуальный якорь).
- Sticky header: `sticky top-0 backdrop-blur-glass bg-bg-base/72` с responsive `-mx-4 md:-mx-6`.
- Error banner: `bg-chip-danger-bg text-chip-danger-fg shadow-card-soft` (вместо hardcoded red-50/red-700).

### Toast — sonner единственный

- `frontend/app/layout.tsx`: `<ToastProvider>` удалён, sonner `<Toaster />` смонтирован один раз.
- `frontend/src/contexts/toast-context.tsx`: остался как deprecated shim (proxy на sonner) — для обратной совместимости любых забытых импортов.
- 67 файлов мигрировано через одноразовый codemod (`frontend/scripts/migrate-toast.mjs` — не закоммичен, throwaway).

### Mobile master-detail

`/meetings` — list+detail на desktop, push в `/meetings/[id]/result` на mobile (через `useIsMobile`). `/cards`, `/themes`, `/goals` уже на grid+Link, mobile стакается из коробки.

Admin-таблицы (`/admin/llm-prices`, `/admin/usage/users`, `/admin/usage/functions`) — `hidden md:block` для `<table>` + `md:hidden` card-list. `/settings/sources`, `/settings/webhooks` — `flex-col md:flex-row`.

Pill-фильтры (`MeetingsJournalReal.FilterChips`, `TasksClient` status pills) — горизонтальный `overflow-x-auto scrollbar-none snap-x` на mobile, `flex-wrap` на desktop.

## SBA β-8.1 + β-8.2 — добивка панели COO + Хранитель обещаний (2026-05-25)

**Источник:** [`plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md`](../../plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md), [`plans/tz/2026-05-24-sba-beta-8-2-promise-keeper.md`](../../plans/tz/2026-05-24-sba-beta-8-2-promise-keeper.md).

| Путь | Что показывает | Фаза |
|---|---|---|
| `/dashboard/operations` (расширена) | Существующая панель + новый виджет `TeamTemperatureWidget` (зелёный/жёлтый/красный по 7 дням) + виджет «Открытые обещания» | β-8.1 + β-8.2 |
| `/dashboard/operations/weekly?weekStart=YYYY-MM-DD` | `WeeklyDigestClient` — рендер `WeeklyOperationsDigest` с навигацией по неделям. Доступ — `coo`/`owner`/`admin`. | β-8.1 |
| `/me/promises` | `MyPromisesClient` — таблица обещаний сотрудника + фильтр (open/asked/all) + действия (Сделано / Не сделано / Отменить) | β-8.2 |

**Навигация (`Sidebar.tsx`):**
- Группа «Операции»: «Панель операций» (как было) + «Недельная сводка» (новое).
- Группа «Я»: «Мои обещания» (новое, иконка `CheckCircle2`).

**Frontend-роль:** `CurrentOrgRole` расширена значением `'coo'` (`frontend/src/api/types/accounts.ts` + `frontend/src/domain/account.ts`).

## История

- **2026-05-25:** создан в рамках handoff Wave 1-3. Документированы T1, T2, T5 (settings секция), feed/spotlights обновления.
- **2026-05-25 (UI/API modernization):** добавлена секция про design-preview / 7 новых shared-компонентов / 2 hooks / OKLCH-токены / sonner-миграцию / mobile-адаптацию.
- **2026-05-25 (β-8.1/β-8.2):** добавлены страницы `/dashboard/operations/weekly` и `/me/promises`, виджеты `TeamTemperatureWidget` и «Открытые обещания», роль `coo` во фронтенд-типах.

[[../index|← index]]
