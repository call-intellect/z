---
title: Frontend Pages (реестр страниц)
status: living
covers: реестр всех страниц Next.js App Router
---

# Frontend Pages — реестр страниц

Сжатый реестр страниц Next.js App Router (`frontend/app/`). Route-группы: `(public)` / `(authenticated)` / `(admin)` / `(design-preview)`. Все страницы под `(authenticated)` требуют сессии (cookie `z_session`).

Файл создан 2026-05-25 как часть финального handoff Wave 1-3 (Wave 1 закрытие). Пополняется по факту.

## Группировка в Sidebar (ТЗ 2026-05-27 navigation-restructure)

Меню `frontend/src/ui/components/app-shell/Sidebar.tsx` разделено на 6 смысловых слоёв (раньше было 3 плоских группы Компания/Оперативка/Настройки):

1. **Каждый день** — `/dashboard`, `/meetings`, `/dump`, `/cards`, `/projects`, `/chat`, плюс `/intake` (для owner/admin) с живым бейджом.
2. **Моё пространство** — `/me`, `/me/contributions`, `/me/social-contribution`, `/me/promises`, `/feedback`.
3. **Память компании** — `/ideas`, `/regulations`, `/decisions`, `/insights`, `/entities`, `/themes`. Items фильтруются `useMemoryAccess()`.
4. **Управление** *(только owner/admin/coo)* — `/dashboard/operations`, `/dashboard/operations/daily`, `/dashboard/operations/weekly`, `/goals`.
5. **Справочник** *(collapsible, default свёрнут, storageKey `sidebar.reference.open`)* — `/structure`, `/company`, `/departments`, `/domains`, `/maturity`, `/documents`, `/roles`, `/clones`, `/vendors`, `/events`, `/experiments`, `/brand-voice`. Внутри — вложенная подгруппа «Будет в следующей фазе» с γ-пунктами (`/processes`, `/policies`, `/metrics`).
6. **Настройки** — `/settings/templates`, `/settings/integrations`, `/settings` + подгруппа «Админка» (`/settings/admin`, `/admin`) для owner/admin/super_admin.

CTA «Создать встречу» (Plus + ссылка на `/meetings/create`) и `OrgSwitcher` живут в шапке Sidebar над списком групп.

Источник ТЗ: [plans/tz/2026-05-27-navigation-restructure.md](../../plans/tz/2026-05-27-navigation-restructure.md).

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
| `/me/knowledge-profile` | Мой профиль знаний (β-2) |
| `/persons/[id]/contributions` | **T1 — Вклад коллеги** |
| `/persons/[id]/social-contribution` | **T2 — Соц. профиль коллеги** |
| `/persons/[id]/knowledge-profile` | Профиль знаний коллеги (β-2) |
| `/feed/spotlights` | Spotlights + **T1/T2 виджеты** |
| `/feed` | Activity Feed (Wave 2) |
| `/intake` | Triage очередь (AI suggestions) |

## Clones — маркетплейс (2026-05-26, Clones=Roles финальный UI)

**Источник:** [`plans/tz/2026-05-26-clones-marketplace-frontend.md`](../../plans/tz/2026-05-26-clones-marketplace-frontend.md). Коммит `578a777` (user) + `eab4d8f` (admin).

| Путь | Назначение |
|---|---|
| `/clones` | **Маркетплейс клонов** — список ролевых клонов компании с группировкой по department и поиском. `ClonesMarketplaceClient.tsx`. Карточки `CloneCard` показывают либо «Спросить» (если есть грант), либо «Запросить доступ». |
| `/clones/[roleId]` | Карточка клона роли + последние диалоги + кнопка «+ Новый диалог». `CloneDetailClient.tsx`. |
| `/clones/[roleId]/chat/[conversationId]` | Чат с клоном с боковой панелью диалогов (sticky desktop / drawer mobile, mobile-first 1→2→3→4 колонки, safe-area-inset в composer). `CloneChatClient.tsx`. |
| `/roles/[id]/clone` | Redirect на `/clones/[id]` — legacy совместимость после первой итерации Clones-Roles рефакторинга. |

**Удалено (legacy первой итерации Clones-Roles, не наша работа — рефакторинг 2026-05-25):** `/me/clone`, `/persons/[id]/skill-profile`. См. memory `project_clones_are_role_based.md`.

**Компоненты (`frontend/src/ui/clones/`):**
- `CloneAvatar.tsx` — SVG-иконка с инициалом роли, 12-цветная палитра Tailwind-600, детерминированный хеш по `departmentId` (без фото человека). 9 unit-кейсов покрывают детерминированность цвета, фолбэк инициала и accessibility.
- `CloneCard.tsx`, `CloneChatSidebar.tsx`, `CloneSearchInput.tsx`, `DepartmentSection.tsx`, `EmptyCloneList.tsx`.

**API + hooks:**
- `src/api/clones.api.ts` расширен (`createRoleConversation`, `listMyCloneConversations`, `requestAccess`).
- `src/api/me-clone-access.api.ts` — грейсфул на 404 (пустой массив).
- `src/api/admin-clones.api.ts` — 5 методов admin CRUD.
- `src/domain/clone.ts` расширен, новый `src/domain/admin-clone-access-grant.ts` (типы + мапперы + русские лейблы).
- Хуки `src/hooks/useClones.ts`: `useClones` / `useCloneByRoleId` / `useCloneConversations` / `useMyCloneAccess` / `useInvalidateClones` (SWR).
- `src/hooks/useUnseenCloneGrants.ts` — in-app точка («тебе только что выдали клона»).

Только русский язык в UI. Mobile-first.

## Admin

| Путь | Назначение |
|---|---|
| `/admin` | Дашборд админки (Org-Admin) |
| `/admin/clones` | **Доступы к клонам (2026-05-26)** — управление гранатами `CloneAccessGrant` (`owner`/`admin` Org): таблица с фильтрами + модалы `CreateGrantDialog` / `RevokeGrantDialog` / `ExtendGrantDialog`. Пункт «Доступы к клонам» в группе «AI и модели» (иконка `ShieldCheck`). См. [[admin]]. |
| `/admin/helpfulness-overview` | **T2 — Team-map + unanswered** |
| `/admin/ai-models` | Управление LLM-моделями (Org-overrides) |
| `/admin/llm/catalog` | Каталог моделей (super_admin) |
| `/admin/llm/routes` | Маршруты taskType → provider |
| `/admin/prompts` | Prompt Registry (Phase A) |
| `/admin/users` | Пользователи Org |
| `/admin/audit` | Audit Log |
| `/admin/feedback` | **Канал обратной связи + AI-кластеризация (2026-05-25)** — дашборд блоков `FeedbackTopic` с процентами по items, действия rename/merge/archive, ручной запуск ночного прогона. Только super_admin. |
| `/admin/feedback/[topicId]` | Детальная карточка блока + items + диалоги действий (Phase 8). |

## Feedback (пользовательская часть, 2026-05-25)

| Путь | Назначение |
|---|---|
| `/feedback` | **Канал «Ваши предложения».** Форма submit (rate-limit 5/сутки UTC) + история своих сообщений + индикатор лимита. Глобальная фича — фидбэк адресован команде Z, а не Org'е. См. [[feedback]]. |

## Top-level

- `/` (public, prerender static) — лендинг **КОРА** (`app/HomeClient.tsx`). Бренд `КОРА` (кириллица, wordmark с mint-точкой), позиционирование «память компании». Структура (сверху вниз): **LeakSection** (давим болью первым — 8 «дыр», через которые утекает выручка, с pulse-glow на иконках-«огоньках», shimmer-trail между болью и решением, КОРА wordmark text-8xl с blur→focus motion и accent underline) → **SourcesBridge** (5 источников: видеовстречи, планёрки, отчёты, чаты, задачи) → **Hero** «второй мозг» (ответ на боль) → Встречи (1 карточка) → Задачи (2 карточки) → AI-директор (gradient-блок) → bridge «копируется во второй мозг» → Память (6 карточек) → финальный CTA. Inline-keyframes: `leak-pulse` (4.5s amber огонёк), `leak-pulse-accent` (mint точка у КОРА), `shimmer-line` (mint trail), `breathe-mesh` (mint-пятно за LeakSection). LeakRow — editorial-список с `divide-y border-y` hairline-разделителями (не карточки). Стилистика dark + mint, motion (fadeIn/slideUp/whileInView + cascade staggerChildren). Авторизованных редиректит на `/dashboard`. Заглушка показывается только при `user` (не при `isLoading`) — иначе при недоступном бэке висел «синий экран».
- `/leak-v1`, `/leak-v2` (design-preview, не коммерческие) — реф-страницы для итераций секции «Кора найдёт дыры». V1 «Манифест» — только типографика, V2 «Дырки и заплатки» — пары проблема→решение. Используются для калибровки, ссылки не публикуются.
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
| `/dashboard/operations` (расширена) | Существующая панель + новый виджет `TeamTemperatureWidget` (зелёный/жёлтый/красный по 7 дням) + виджет «Открытые обещания» + (β-8.3) `CauseCategoryMapWidget` (8 горизонтальных столбиков по `Insight.causeCategory`) + `MaturityWidget` (SVG-кольцо score зрелости + weakest/top FunctionalDomain) + блок «Вчерашний отчёт» (превью `DailyOperationsDigest`). `OperationsDashboardClient` обновлён под новые поля overview (`insightsByCauseCategory`, `maturity`). | β-8.1 + β-8.2 + β-8.3 |
| `/dashboard/operations/weekly?weekStart=YYYY-MM-DD` | `WeeklyDigestClient` — рендер `WeeklyOperationsDigest` с навигацией по неделям. Доступ — `coo`/`owner`/`admin`. | β-8.1 |
| `/dashboard/operations/daily?date=YYYY-MM-DD` | **β-8.3** — `DailyDigestClient`: date-picker + markdown-рендер `DailyOperationsDigest` + секции метрик и провенанса. Доступ — `coo`/`owner`/`admin`. Пункт «Ежедневный отчёт» в группе «Операции» sidebar. | β-8.3 |
| `/me/promises` | `MyPromisesClient` — таблица обещаний сотрудника + фильтр (open/asked/all) + действия (Сделано / Не сделано / Отменить) | β-8.2 |
| `/persons/[id]` (расширена) | Секция «Обещания» в `PersonDetailClient.tsx` (через `PersonCommitmentsSection`): исходящие («что обещал») + входящие («что обещали ему»). Видна `owner`/`admin`/`coo`/`super_admin`. Запрос идёт по `entityId` (бэк сам резолвит `Person.id` через `Person.entityId`). | β-8.2 |

**Навигация (`Sidebar.tsx`):**
- Группа «Операции»: «Панель операций» (как было) + «Недельная сводка» (новое).
- Группа «Я»: «Мои обещания» (новое, иконка `CheckCircle2`).

**Frontend-роль:** `CurrentOrgRole` расширена значением `'coo'` (`frontend/src/api/types/accounts.ts` + `frontend/src/domain/account.ts`).

## История

- **2026-05-25:** создан в рамках handoff Wave 1-3. Документированы T1, T2, T5 (settings секция), feed/spotlights обновления.
- **2026-05-25 (UI/API modernization):** добавлена секция про design-preview / 7 новых shared-компонентов / 2 hooks / OKLCH-токены / sonner-миграцию / mobile-адаптацию.
- **2026-05-25 (β-8.1/β-8.2):** добавлены страницы `/dashboard/operations/weekly` и `/me/promises`, виджеты `TeamTemperatureWidget` и «Открытые обещания», роль `coo` во фронтенд-типах.
- **2026-05-25 (β-8.3):** добавлена страница `/dashboard/operations/daily` + новые виджеты `CauseCategoryMapWidget` и `MaturityWidget` на `/dashboard/operations` + блок «Вчерашний отчёт» + кликабельные бэйджи `cause_category` в `InsightsTopWidget` (deep-link `/insights?cause_category=…`). Файл `frontend/src/lib/cause-category-presentation.ts` — 8 русских лейблов + Tailwind палитра.
- **2026-05-25 (feedback):** добавлены страницы `/feedback` (пользователь), `/admin/feedback` (super_admin дашборд блоков), `/admin/feedback/[topicId]` (детали блока). Полная заметка фичи — [[feedback]].
- **2026-05-26 (clones marketplace + admin):** добавлены маршруты `/clones`, `/clones/[roleId]`, `/clones/[roleId]/chat/[conversationId]` (маркетплейс ролевых клонов + чат с боковой панелью диалогов), `/roles/[id]/clone` теперь redirect на `/clones/[id]`, новая admin-страница `/admin/clones` (управление `CloneAccessGrant`). Удалены `/me/clone` и `/persons/[id]/skill-profile` (legacy первой итерации Clones-Roles). См. [plans/tz/2026-05-26-clones-marketplace-frontend.md](../../plans/tz/2026-05-26-clones-marketplace-frontend.md).

[[../index|← index]]
