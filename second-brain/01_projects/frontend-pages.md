---
title: Frontend Pages (реестр страниц)
status: living
covers: реестр всех страниц Next.js App Router
---

# Frontend Pages — реестр страниц

Сжатый реестр страниц Next.js App Router (`frontend/app/`). Route-группы: `(public)` / `(authenticated)` / `(admin)` / `(design-preview)`. Все страницы под `(authenticated)` требуют сессии (cookie `z_session`). С 2026-05-31 Z-Admin (`/admin/*`) физически перенесён из `(authenticated)/admin/` в свою standalone route-группу `app/(admin)/admin/*` с собственным root-layout и `AdminAuthGuard` (без AppShell/EntitlementProvider) — см. `plans/archive/2026-05-31-z-admin-standalone-route-group.md`. Org-admin с 2026-06-02 вынесен в собственную route-группу `(authenticated)/company-admin/*` (свой layout + `CompanyAdminSidebar`, ТЗ `plans/archive/2026-06-02-org-admin-cleanup-no-costs-nav-split.md`). Старый `/settings/admin/*` оставлен только как redirect-заглушки на `/company-admin`.

Файл создан 2026-05-25 как часть финального handoff Wave 1-3 (Wave 1 закрытие). Пополняется по факту.

## Публичная главная (лендинг) + демо + вики (2026-06-17)

| Путь | Что |
|---|---|
| `/` (`app/HomeClient.tsx`) | Боевая главная — редизайн по светлому образцу «боль→решение» (hero-оверлей → Договорённости → Знания → Цели → Платформа). Самодостаточные scoped-стили под классом `.kora-landing` (приложение тёмное по умолчанию — лендинг рисует свою светлую тему, не завязан на токены приложения). Шапка: Войти `/login`, Получить ранний доступ `/signup`, Связаться (Telegram), nav-ссылки Демо `/demo/index.html` и Инструкция `/wiki/index.html`. Футер: оферта `/terms`, политика `/privacy`. 2 плашки-перехода на демо (после «Знания» и «Цели»). Редирект авторизованного → `/dashboard`, reveal-анимации (IntersectionObserver). Картинки — WebP в `public/landing/` (q90, `next/image` с **`unoptimized`** — иначе Next пережимает в q75 и текст на слайдах мылится). |
| `/demo/index.html` | **Статика** в `public/demo/` (НЕ React-роут) — демо-кабинет на моках, собран от HTML-прототипа `plans/analysis/2026-06-13-cabinet-redesign-prototypes/`. Экраны: Сегодня (+ виджет «Лента Коры»), **Аналитика** (доведение решений / клиенты под риском / знания под риском / перегруз / блокеры / загрузка), Неделя, Итоги месяца, Встречи, Задачи, Память, Команда, Я (+ «Лента Коры»), Настройки. Переключатель ролей owner/coo/member, тёмная/светлая тема. Без авторизации/API. |
| `/wiki/index.html` | **Статика** в `public/wiki/` — вики-инструкция (копия `docs/wiki/`, PNG→WebP). Источник правды остаётся `docs/wiki/`. |

На `/demo` и `/wiki` сверху — постоянная **КОРА-шапка** (логотип + ← На главную + кросс-ссылка Демо↔Инструкция + Связаться + Войти + Получить ранний доступ), снизу — **КОРА-подвал** (бренд + На главную/Демо/Инструкция/Связаться/оферта/политика); тёмное «стекло», sticky; стили в `design-system.css`/`styles.css` (классы `kora-sitebar`/`kora-sitefoot`/`ksb-*`/`ksf-*`); липкие сайдбары сдвинуты под шапку. ТЗ: [plans/tz/2026-06-17-landing-redesign-demo-and-wiki.md](../../plans/tz/2026-06-17-landing-redesign-demo-and-wiki.md).

## Группировка в Sidebar (ТЗ 2026-05-27 navigation-restructure)

Меню `frontend/src/ui/components/app-shell/Sidebar.tsx` разделено на 6 смысловых слоёв (раньше было 3 плоских группы Компания/Оперативка/Настройки):

1. **Каждый день** — `/dashboard`, `/meetings`, `/dump`, `/cards`, `/projects`, `/chat`, **`/structure` («Команда»)**, плюс `/intake` (для owner/admin) с живым бейджом. *(2026-06-04: «Команда» поднята сюда верхним пунктом; раньше `/structure` жил в «Справочнике».)*
2. **Моё пространство** — `/me`, `/me/contributions`, `/me/social-contribution`, `/me/promises`, `/feedback`.
3. **Память компании** — `/ideas`, `/regulations`, `/decisions`, `/insights`, `/entities`, `/themes`. Items фильтруются `useMemoryAccess()`.
4. **Управление** *(только owner/admin/coo)* — `/dashboard/operations`, `/dashboard/operations/daily`, `/dashboard/operations/weekly`, `/goals`.
5. **Справочник** *(collapsible, default свёрнут, storageKey `sidebar.reference.open`)* — `/company`, `/departments`, `/domains`, `/maturity`, `/documents`, `/roles`, `/clones`, `/vendors`, `/events`, `/experiments`, `/brand-voice`. Внутри — вложенная подгруппа «Будет в следующей фазе» с γ-пунктами (`/processes`, `/policies`, `/metrics`). *(2026-06-04: `/structure` отсюда убран — стал «Команда» в группе «Каждый день».)*
6. **Настройки** — `/settings/templates`, `/settings/integrations`, `/settings` + подгруппа «Админка» (`/company-admin` для owner/admin, `/admin` для super_admin). С 2026-06-02 «Админка компании» — отдельная поверхность `/company-admin/*` (Доступ к памяти / Источники / Встречи); «Экономика» (расходы LLM) и тех. «Ядро знаний» убраны из клиента — владелец Org себестоимость не видит.

CTA «Создать встречу» (Plus + ссылка на `/meetings/create`) и `OrgSwitcher` живут в шапке Sidebar над списком групп.

Источник ТЗ: [plans/archive/2026-05-27-navigation-restructure.md](../../plans/archive/2026-05-27-navigation-restructure.md).

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
| `/projects` | **Рабочий стол «Задачи»** (`TasksWorkspaceClient`, ТЗ 2026-06-18 tasks-unified-workspace): проект = фильтр, не отдельный экран. Виды Доска (`OrgBoard` «Все проекты» с DnD по 5 категориям / `Board` одного проекта) · Список · Спринты (`useSprints`→`/sprints/[id]`) · Входящие (`IntakeBoard`, только руководителю) · Архив. Селектор проекта, фильтр команды (руководителю), фильтр спринта, поиск, «+ Новая задача», «Открыть проект →». URL-стейт `?view/?project/?assignee/?cycle/?q`. *(Старый `ProjectsListClient` удалён.)* |
| `/projects/[slug]` | Master-detail проекта (Board / Backlog / Cycles / Settings) |
| `/projects/[slug]/settings` | Настройки проекта (members, states, **email-inbox T5**) |
| `/issues` | Список задач (фильтр по assignee, state, label, cycle) |
| `/issues/[id]` | Карточка задачи: Description / **IssueComments (T8 переписан)** / Activity / Versions / **IssueChat (T6b scope='issue')** |
| `/me/pulse` | **pulse-full Волна 3** — личная Pulse-карточка сотрудника. Резолвит свой `personId` через `GET /me/profile` и переиспользует `PersonPulseClient` (backend RBAC разрешает self-view). Пункт меню «Мой пульс» в «Моё пространство». |
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
| ~~`/feed`~~ | **УДАЛЕНА (2026-06-18)** — «Лента Коры» вынесена в виджет `CoraFeedWidget` (variant full/compact) на `/dashboard` и `/me`. Сиблинги `/feed/insights`, `/feed/probe-questions`, `/feed/spotlights` живы. ТЗ [`cora-feed-into-dashboards`](../../plans/tz/2026-06-17-cora-feed-into-dashboards.md), коммиты `9aa3945e`+`10dbbe35`. См. [[frontend-contexts-hooks]] §«Виджет „Лента Коры“». |
| `/intake` | Triage очередь (AI suggestions) |

## Sprints (2026-05-27 / 2026-05-28, см. [[sprints]])

| Путь | Что |
|---|---|
| `/sprints` | **Master-detail список Org** (2026-05-28): слева — карточки спринтов с tabs (`Активные/Завершённые/Предстоящие/Все`), scope-chips (Компания/Отдел/Клиент/Поставщик/Сотрудник/Проект), поиск debounced 300ms, сортировка (startDate/progress/hints), пагинация. Справа — `SprintPreviewCard` (scope-badge, прогресс, счётчики, топ-3 SprintHint, топ-3 задач без срока, кнопка «Открыть спринт»). Mobile — список + `Sheet` для detail. URL-state синхронизируется. Live через `/ws/tracker` (`cycle.*`, `sprint_hint.*`) — счётчики обновляются без F5. Кнопка «+ Создать» открывает расширенный `SprintCreateWizard`. |
| `/sprints/[id]` | Дашборд спринта: прогресс / 3 секции задач / помощник предлагает / связанные встречи / кнопки «Создать видеовстречу» (запускает `sprint_review`) и «Завершить спринт». SWR refresh 30s. |
| `/sprints/[id]/review` | Финальный AI-отчёт (3 состояния: pending / ready / failed). На pending — auto-poll 10s, на failed — кнопка regenerate. |

`SprintCreateWizard` (2026-05-28, расширен): шаг 1 — radio из 6 scope-вариантов + универсальный `Combobox` (cmdk + Popover) с inline-create через `+ Создать «<query>»` для Vendor/Card/Department/Person. Для `person` — двухступенчатый picker Role → Person через Appointment. Шаг 2 — название/длительность/дата. Submit → `POST /api/v1/sprints/quick-create` атомарно создаёт Project + Cycle + Board + IssueStates.

Сайдбар: пункт «Спринты» в группе «Каждый день» рядом с «Проекты», иконка `Rocket`, `data-tour-target="welcome.sprints"` для будущего onboarding-tour.

## Smart Tables (2026-05-31, MVP)

**Источник:** smart-tables ТЗ Фазы 0+1+2+3. Коммиты `acfd5dc`, `ab735c8`.

| Путь | Что |
|---|---|
| `/tables` | **Индекс таблиц** Org (2026-05-31): grid карточек активных таблиц `{icon, name, description}`, кнопка «+ Новая таблица» (prompt → POST /api/v1/tables → router.push). Пустое состояние с CTA. Стейты loading/forbidden/error через `AdminStateViews`. `TablesListClient.tsx`. |
| `/tables/[id]` | Smart-table детали: `TableHeader` (имя/иконка) + `ViewSelector` (Saved Views Фаза 3) + `GridView` (cell-edit, row-add/archive/delete) + `RowDetail` Sheet с pageContent. `TableClient.tsx` + Zustand store `tableStore.ts`. Кнопка «← Все таблицы» ведёт на `/tables`. |

## Clones — маркетплейс (2026-05-26, Clones=Roles финальный UI)

**Источник:** [`plans/archive/2026-05-26-clones-marketplace-frontend.md`](../../plans/archive/2026-05-26-clones-marketplace-frontend.md). Коммит `578a777` (user) + `eab4d8f` (admin).

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

### Настройки-крутилки — 7 страниц (2026-06-21, ветка `feature/three-tz-tails-finalization`)

Редактируемые поверхности для 126 camelCase-крутилок из `AdminSetting` (super_admin). Общий каркас — `frontend/src/ui/components/admin/DomainSettings.tsx` (`DomainSettingsClient` / `SettingSpec` / `SettingsGroup`, reason-gate). 7 пунктов в admin-навигации. Детали и таблица ключей — [[admin]] §«UI крутилок».

| Путь | Назначение |
|---|---|
| `/admin/ai/concierge` | **Помощник** — 12 крутилок (пороги/лимиты/таймауты помощника). |
| `/admin/ai/orchestrator` | **Оркестратор и маршрутизатор** — 6 крутилок. |
| `/admin/ai/models` | **Модели LLM и часы** — 14 крутилок (выбор модели + часы дайджестов). |
| `/admin/probe` | **Probe и курация** — 30 крутилок. |
| `/admin/platform/worker-knobs` | **Рубильники воркеров** — 7 крутилок BullMQ-воркеров. |
| `/admin/platform/retention-logging` | **Хранение и логи** — 21 крутилка (retention + уровни логов). |
| `/admin/platform/quotas` | **Квоты пользователей** — 36 крутилок (лимиты тарифов/шаринга/AI-чата/Smart Tables). |

## Feedback (пользовательская часть, 2026-05-25)

| Путь | Назначение |
|---|---|
| `/feedback` | **Канал «Ваши предложения».** Форма submit (rate-limit 5/сутки UTC) + история своих сообщений + индикатор лимита. Глобальная фича — фидбэк адресован команде Z, а не Org'е. См. [[feedback]]. |

## Top-level

- `/` (public, prerender static) — лендинг **КОРА** (`app/HomeClient.tsx`). Бренд `КОРА` (кириллица, wordmark с mint-точкой), позиционирование «память компании». Структура (сверху вниз): **LeakSection** (давим болью первым — 8 «дыр», через которые утекает выручка, с pulse-glow на иконках-«огоньках», shimmer-trail между болью и решением, КОРА wordmark text-8xl с blur→focus motion и accent underline) → **SourcesBridge** (5 источников: видеовстречи, планёрки, отчёты, чаты, задачи) → **Hero** «второй мозг» (ответ на боль) → Встречи (1 карточка) → Задачи (2 карточки) → AI-директор (gradient-блок) → bridge «копируется во второй мозг» → Память (6 карточек) → финальный CTA. Inline-keyframes: `leak-pulse` (4.5s amber огонёк), `leak-pulse-accent` (mint точка у КОРА), `shimmer-line` (mint trail), `breathe-mesh` (mint-пятно за LeakSection). LeakRow — editorial-список с `divide-y border-y` hairline-разделителями (не карточки). Стилистика dark + mint, motion (fadeIn/slideUp/whileInView + cascade staggerChildren). Авторизованных редиректит на `/dashboard`. Заглушка показывается только при `user` (не при `isLoading`) — иначе при недоступном бэке висел «синий экран».
- `/leak-v1`, `/leak-v2` (design-preview, не коммерческие) — реф-страницы для итераций секции «Кора найдёт дыры». V1 «Манифест» — только типографика, V2 «Дырки и заплатки» — пары проблема→решение. Используются для калибровки, ссылки не публикуются.
- `/login`, `/register`, `/forgot`, `/reset` — auth.
- `/onboarding` — wizard (Phase 0c, owner-only). `welcome/step-1..6` → `welcome/complete` (loading-экран авто-заливки демо «ТехноСтрим», polling `demo-seed-status`, ТЗ 2026-05-31). Страница `/onboarding/demo-choice` **удалена** — демо заливается автоматически. См. [[onboarding-wizard]].
- `/chat-v2` — AI-чат компании (master-detail + deep-link `?conversationId=`). **Селектор «помощник / клон должности» у окна ввода (2026-06-15):** `AssistantTargetSelect` (Radix) — по умолчанию «Кора · помощник» (стрим chat-v2 как было); можно выбрать ролевого клона (по должности) — вопрос уходит через `clonesApi.askRole` (клон — НЕ режим chat-v2), ответ склеивается в видимую нить с именем клона, per-`roleId` `conversationId`. Список клонов — `useClones` + доступ `useMyCloneAccess` (пустой → селектор скрыт); `refused` → сообщение, `403` → «нет доступа» + запросить. Telegram/бэкенд не затронуты. ТЗ [`2026-06-15-cabinet-assistant-clone-selector`](../../plans/archive/2026-06-15-cabinet-assistant-clone-selector.md).
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

**С 2026-06-02 (зонтик main-screen-umbrella, Поток Б):** структура «sticky Hero + 4 pill-таба».

- **Sticky Hero** (top-0 z-20): 3 KPI (Настроение / Обещания / Висящие решения) с MiniSparkline + AI-сводка (центр) + TopRiskCard (Топ-1 риск из pulse.irreversibleDecisions). Header не sticky (избегаем конфликта с Hero).
- **Узкая sticky-полоса** под Hero: StructureSummaryWidget слева + Pill «💬 Спросите Кору» справа (dispatchEvent `assistant-sidebar:open-ask`).
- **`<IntroWizardWidget />`** между Hero и Tabs — 4 состояния по `Org.setupCompletedAt` + 6-шаговый прогресс + кнопка «Отложить на неделю» (localStorage `dashboard.onboardingDeferredUntil`).
- **`<DashboardTabs />`** — 4 pill-таба: Обзор / Команда / Знания / Цели и встречи. Persistence per-user (`useDashboardTab(user.id)`).
- **Контент таба** через функции `OverviewTab`/`TeamTab`/`KnowledgeTab`/`GoalsTab`:
  - Overview — Дайджест недели (3 DigestCard с темами/сигналами/решениями).
  - Team — TeamHealthGrid + BusFactor + ActivityFeed (probe_question) + `PeopleAtRiskWidget` (пока скрыт, ожидает backend `/dashboard/people-at-risk`).
  - Knowledge — RecurringTopics + Bottleneck + WhatLearned + SignalCounters + ActiveThemes + HotEntities + OpenQuestions + InsightsTop + KnowledgeVelocityKpi.
  - Goals — GoalVector + LowRoi + IrreversibleDecisionsAlert (полный список) + StrategicAlignment + QualityScore.
- **Матрица 6 состояний** (см. [docs/reference/dashboards-registry.md](../../docs/reference/dashboards-registry.md) §4.5-4.6):
  - Если `isOwnOrg && status==='DEMO' && (owner|admin) && data?.isEmpty` — `MainEmptyState` замещает Hero+Tabs целиком (правило 3) с CTA «Оплатить» + опц. «Вернуться в демо» + встроенным онбордингом (setupProgress).
  - Если `currentOrgRole==='demo_observer'` — TopRiskCard CTA становятся `<button onClick={showPaywallModal}>` с tooltip, открывая PaywallModal.
- **`<TabEmptyState />`** в Overview/Knowledge/Goals — единый empty-state когда все виджеты пусты И ничего не loading.
- **AssistantSidebar** (`frontend/src/ui/components/dashboard/AssistantSidebar.tsx`) — 4 pill-таба (urgent/feed/probes/ask). AskSection использует существующий `OrgChatPanel` (POST `/chat-v2/messages` с `@PublicDemo()` для demo_observer).

Историческая нота: до 2026-06-02 главная имела 5 `<StatCard>` сверху + Sticky header + плоские секции виджетов. Sticky header убран, чтобы не конфликтовать с Hero. Все 12 эталонных виджетов из `dashboards-registry.md` переехали в табы без потерь.

### Toast — sonner единственный

- `frontend/app/layout.tsx`: `<ToastProvider>` удалён, sonner `<Toaster />` смонтирован один раз.
- `frontend/src/contexts/toast-context.tsx`: остался как deprecated shim (proxy на sonner) — для обратной совместимости любых забытых импортов.
- 67 файлов мигрировано через одноразовый codemod (`frontend/scripts/migrate-toast.mjs` — не закоммичен, throwaway).

### Mobile master-detail

`/meetings` — list+detail на desktop, push в `/meetings/[id]/result` на mobile (через `useIsMobile`). `/cards`, `/themes`, `/goals` уже на grid+Link, mobile стакается из коробки.

Admin-таблицы (`/admin/llm-prices`, `/admin/usage/users`, `/admin/usage/functions`) — `hidden md:block` для `<table>` + `md:hidden` card-list. `/settings/sources`, `/settings/webhooks` — `flex-col md:flex-row`.

Pill-фильтры (`MeetingsJournalReal.FilterChips`, `TasksClient` status pills) — горизонтальный `overflow-x-auto scrollbar-none snap-x` на mobile, `flex-wrap` на desktop.

## SBA β-8.1 + β-8.2 — добивка панели COO + Хранитель обещаний (2026-05-25)

**Источник:** [`plans/archive/2026-05-24-sba-beta-8-1-coo-dobivka.md`](../../plans/archive/2026-05-24-sba-beta-8-1-coo-dobivka.md), [`plans/archive/2026-05-24-sba-beta-8-2-promise-keeper.md`](../../plans/archive/2026-05-24-sba-beta-8-2-promise-keeper.md).

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

## Action Center — Часть B (2026-06-03)

**Источник:** [`plans/tz/2026-06-02-action-center-pending-confirmations.md`](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (Часть B). Ветка `feature/action-center-trust-ladder`. Backend — [[../02_architecture/module-map]] §pending-actions, эндпоинты — [[api-layer]] §Pending Actions.

| Путь | Что показывает |
|---|---|
| `/actions` | **Центр подтверждений** — единый список «что ждёт подтверждения» (curation / conflict / intake / probe). Фильтр по источнику, deep-link, snooze (1д/3д/7д), кнопка «Подтвердить» на элементах с `canQuickConfirm` (one-tap light curation). |

**Глобальный колокольчик `PendingActionsBell`** — на desktop в top-bar `AppShell` + в мобильном `Header`; Popover со списком pending, кнопка «Подтвердить» на `canQuickConfirm`. Живой бейдж через `usePendingActionsCount` (SWR refresh 60с).

**Сайдбар:** пункт «Подтверждения» с живым бейджем (`usePendingActionsCount`).

**Дашборды (блок `requiresAction`):**
- `RequiresActionTile` — на главном Director Dashboard.
- `RequiresActionBanner` — на «Панели операций» (`/dashboard/operations`).
- Оба: deep-link на `/actions`; `danger` при `conflict > 0`, янтарный иначе, скрыт при 0.

**Слои api/domain/hooks:** `src/api/pending-actions.api.ts`, `src/domain/pending-action.ts`, хуки `usePendingActionsCount` / `usePendingActions`. actionUrl curation → `/curation/${id}`, conflict → `/curation/conflicts/${id}` (deep-link на detail-страницы, см. ниже).

## Action Center — лестница доверия (C1-C3, 2026-06-03)

**Источник:** [`plans/tz/2026-06-02-action-center-pending-confirmations.md`](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (фазы C1-C3 trust-ladder). Worktree `feature/action-center-trust-ladder`, коммиты `c8799f8` (C1), `4d72ead` (C2), `ce4052d` (C3). Backend и слои `curation.api.ts` / `domain/curation.ts` были готовы заранее — C3 закрыл фронт detail-страниц.

| Путь | Роль-доступ | Назначение |
|---|---|---|
| `/curation/[id]` | `owner` / `admin` + кандидат-куратор (+ `super_admin`) | **Детальная карточка курации** — `CurationDetailClient`: панель решения куратора с 8 типами `decisionType`; поле `reasoning` обязательно при deep-review и структурных решениях. Deep-link из провайдера `requiresAction` (curation). |
| `/curation/conflicts` | строго `owner` / `admin` | **Список конфликтов** курации (рассинхрон/эволюция карточек знаний). |
| `/curation/conflicts/[id]` | строго `owner` / `admin` | **Резолюция конфликта** — варианты `accept_new` / `keep_old` / `merge` / `evolving` + действие `dismiss`. Deep-link из провайдера `requiresAction` (conflict). |

**Метка доверия `TrustBadge`** (`frontend/src/ui/components/shared/TrustBadge.tsx`, C1) — статус проверки карточки знаний по `trustTier` (из `CardVersion.currentVersion`): `provisional` → `warning` «Не проверено человеком», `auto` → `sand` «Авто», `human` → ничего не рендерит. Поле `trustTier` пробрасывается в read-DTO регуляций / решений (вкл. supersede-chain) / процессов / политик и в provenance документа. Показывается на `/regulations`, `/decisions` (список + деталь) и во вкладке «Извлечённые сущности» документа.

## Goals OKR v2 — Граф целей (2026-06-02)

**Источник:** [`plans/archive/2026-06-02-goals-okr-v2.md`](../../plans/archive/2026-06-02-goals-okr-v2.md) Фазы 1/4/5. Полная заметка — [[goals-and-strategic-alignment]] §«Goals OKR v2». Слои `ApiDto → Domain → Ui`: `frontend/src/api/goals.api.ts`, `frontend/src/domain/goal.ts`.

| Путь / компонент | Что показывает |
|---|---|
| `/goals` (`GoalsClient.tsx`) | **Переключатель «Список / Дерево / Карта»** (`ViewMode = list\|tree\|map`, вкладка «Карта» добавлена 2026-06-20). В режиме «Дерево» — `GoalsTreeView` (рекурсивное дерево «главная → подцели», чип `progressStatus` парными токенами, per-KR прогресс-бар). Маркер «Предложено Корой» для `promotionState='suggested'` + кнопка «Принять цель». |
| `/goals/[id]` (`GoalDetailClient.tsx`) | Секция «Ключевые результаты» (CRUD KR, ручной ввод `currentValue`, прогресс-бар на парных токенах, `krProgressBarColor`); диалог «Сделать подцелью…» (reparent, перевод 400-ошибки цикла в понятный текст); диалог «Заменить цель» (supersede → `router.push` на новую). |
| Карточка идеи (`/ideas...`) | Секция **«Двигает цель»** — привязка гипотезы к цели через общий `GoalPickerDialog` (`POST /ideas/:id/goal`). Гейт owner/admin. |
| Дашборд спринта | Блок **«Продвигает цель»** — выбор `primaryGoalId` через `GoalPickerDialog`. |
| Дашборд CEO (`DirectorDashboardClient.tsx`) | Виджет **«Пульс целей»** (`GoalsPulseWidget` — 5 счётчиков по `progressStatus` парными токенами) + дерево целей (`GoalsTreeView`) рядом со `StrategicAlignmentWidget`. Данные из `DirectorDashboardDto.goalsPulse?` / `goalsTree?`. |

**Мапперы (`domain/goal.ts`):** `goalKeyResultFromApi`, `krProgressBarColor`, `progressStatusChipClasses`, `progressStatusTone` (ChartTone не имеет info/sand → `achieved→accent`, `dropped→neutral`), `buildTree`. Цвета — только парные токены `bg-{color}` + `text-{color}-fg` (memory `feedback_paired_color_tokens`).

### Вкладка «Карта» + слой идей (2026-06-20)

**Источник:** ТЗ [`plans/tz/2026-06-20-goals-map-and-ideas-tz.md`](../../plans/tz/2026-06-20-goals-map-and-ideas-tz.md). Полная заметка — [[goals-and-strategic-alignment]] §«Карта целей + слой идей».

- **`GoalsMapView.tsx`** (`frontend/src/ui/components/goals/`) — радиальная strategy-map на `react-force-graph-2d` (`dagMode='radialout'`, динамический импорт; fallback-заглушка «нужен `bun install`»): центр — главная цель (`Goal.isPrimary`), подцели кольцами по `horizon`, orphan отлетает на край. Цвета — парные токены `--chip-*-fg`.
- **`domain/goal-map.ts`** — `computeGoalAlignment` (`aligned`/`top_level`/`orphan`, защита от циклов) + `buildGoalGraph`.
- **Слой идей** — переключатель «Показать идеи» (по умолчанию ВЫКЛ): узлы-идеи другим цветом, рёбра по `Idea.goalId`, зона «идеи без цели». Действие **«Принять идею → цель»** (`POST /ideas/:id/promote-to-goal`) из панели идеи на карте.
- **AI-подсказка** на orphan-узле «Куда относится?» → `POST /goals/:id/suggest-parent` (read-only, имя предложенной цели + причина) → подтверждение через `PATCH /goals/:id {parentGoalId}`.
- **Сайдбар:** пункт `/goals` «Цели» добавлен в `nav-config.ts` (`WORK_SECTION`).

## Команда + карточка сотрудника (2026-06-04)

**Источник:** [`plans/tz/2026-06-03-team-section-and-employee-access.md`](../../plans/tz/2026-06-03-team-section-and-employee-access.md). Модуль `structure` (страницы) + `settings` (приглашения). Раздел `/structure` переименован в **«Команда»** и поднят в верхний уровень меню (`Sidebar`, группа «Каждый день»); дубль убран из «Справочника». Диалоги вынесены в `frontend/src/ui/components/team/`.

| Путь | Что показывает |
|---|---|
| `/structure` («Команда») | Объединённый ростер (`GET /orgs/:id/team-roster`). Вкладки: **Сотрудники** (открывается первой), **Отделы**, **Должности**. На строке `PersonsTab` — меню действий: сменить системную роль, удалить из компании, сброс Telegram, пригласить / перевыпустить / отозвать приглашение (перенесено из Настроек). Привязка карточки к участнику без неё — через `POST /persons` с `linkUserId`. |
| `/structure/persons/[id]` | Карточка сотрудника. Вкладка **«Профиль»** + вкладка **«Доступы»**: смена системной роли, доступ к клонам должностей (через `adminClonesApi`), персональные override доступа (`memory:regulations`/`memory:entities`/`feature:graph`/`panel:operations`) поверх дефолта роли/тарифа. Диалоги — `src/ui/components/team/PersonDialogs.tsx`. |

`/settings/organization` очищена до вкладки **«Информация»** — управление участниками/приглашениями ушло в «Команду». Диалоги `InviteEmployeeDialog`/`InviteCreatedDialog` перенесены в `frontend/src/ui/components/team/`. Мастер «Знакомства» снова переоткрываем (убран редирект «есть отделы → /dashboard»).

## Детальные страницы на async `params` (Next 16, 2026-06-06)

В Next 16 `params` в server-компоненте страницы — **Promise**, его нужно
`await`. 26 детальных `page.tsx` читали `params` синхронно (`{ params }: { params: { id } }`),
из-за чего `id` оказывался `undefined` → переходы вида `/tables/undefined`,
«Сотрудник не найден», «не найдено» на карточках. Все 26 переведены на
эталон `cards/[id]`: сигнатура `params: Promise<{…}>` + `const { id } = await params`.

Затронутые группы детальных маршрутов: **tables** (`/tables/[id]`),
**documents** (`/documents/[id]`), **issues** (`/issues/[id]`),
**sprints** (`/sprints/[id]`, `/sprints/[id]/review`), **roles** (`/roles/[id]`),
**persons** (`/persons/[id]` и подстраницы), **clones**
(`/clones/[roleId]`, `/clones/[roleId]/chat/[conversationId]`) и
**admin-detail** (карточки в `(admin)/admin/*`).

Источник: [plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md](../../plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md) Ф1 (коммит `521f7553`). ТЗ оценивало 22 страницы, по факту после merge `dev` их оказалось 26 — чинился весь класс с acceptance-грепом.

## Видеовстречи — фиксы живой комнаты + редизайн просмотра/журнала (2026-06-18)

**Источник:** [`plans/tz/2026-06-17-meeting-room-three-bugs-fix.md`](../../plans/tz/2026-06-17-meeting-room-three-bugs-fix.md) (Ф1–Ф3) + [`plans/tz/2026-06-17-meeting-review-and-journal-redesign.md`](../../plans/tz/2026-06-17-meeting-review-and-journal-redesign.md) (Ф1–Ф5). Ветка `feature/meeting-fixes-and-result-redesign`. Полностью frontend-only (бэк / БД / ENV не затронуты — выкат = только rebuild фронта).

**Живая комната (`meeting-room/`, 3 фикса):**
- **Чат доставляет сообщения live:** убран форс уникального `topic` в `useChat().send()` (`ChatPanel.tsx`) — теперь дефолтный `lk.chat` совпадает с приёмником text-stream; дедуп по `attributes.clientMessageId` сохранён. Раньше каждое сообщение слалось на `chat-<id>`, который никто не слушал → другие участники его не видели.
- **Камера в сетке не обрезает кадр:** класс `kora-video-grid` + правило `object-fit: contain` в `globals.css` распространены на `GridLayout` (≥2 уч.), не только на solo. Допустимы тёмные поля (приоритет «не резать лицо»).
- **Демонстрация экрана читаема:** на `<TrackToggle source=ScreenShare>` (`ControlsBar.tsx`) добавлены `captureOptions={{ contentHint: 'detail' }}` + `publishOptions.screenShareEncoding = ScreenSharePresets.h1080fps30` (~5 Мбит/с). Simulcast не отключаем.

**Просмотр встречи (`/meetings/[id]/result`, `meeting-result-v2/`) — единое окно без модалок:**
- **Плеер** — компактный sticky (`max-w-[80vh]` ⇒ высота ≤45vh, `sticky top-4`) + кнопка «Свернуть/Развернуть видео» (`playerCollapsed`). Скелетон приведён к новому одноколоночному дефолту.
- **Отчёты** — master-detail inline вместо модалки: список-рейл слева (карточка-кнопка выбора, active-подсветка), выбранный отчёт справа во всю ширину (`ReportInlinePanel`, скролл на уровне страницы). Удалён `ReportDetailDialog` / `max-h-[60vh]`. `Modal` остался только в `AddReportDialog` (форма выбора шаблона).
- **AI-чат** — правая колонка сворачиваемая, по умолчанию свёрнута: корневой грид условный (`chatOpen` → `lg:grid-cols-1` vs `…_400px`), свёрнутый вид = плавающая кнопка «Открыть AI-чат». Состояние поднято в `MeetingResultPageReal` (один источник правды); `MeetingChatPanel` стал управляемым (`open`/`onOpenChange`), внутренний collapse + localStorage убраны.
- **Глубокие ссылки:** `?tab=<overview|reports|chapters|transcript|chat|tasks>` и `?report=<id>` синхронизированы с URL (`useSearchParams` + `router.replace(scroll:false)`); `router.replace` только в обработчиках событий — без цикла ре-рендера.

**Журнал (`/meetings`):** статус каждой строки — словом-чипом через централизованный `meetingStatusView` (парные токены `chipClass`); кнопка «⋮» (в т.ч. «Удалить») видна на десктопе без наведения (был `md:opacity-0`).

## Трекер + Встречи — финальная сессия (2026-06-06)

**Источник:** [`plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md`](../../plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md) (фазы A1-A7, B1-B5). Ветка `sergdev`. Фронт-only по большинству пунктов; B5 — новый бэк-эндпоинт.

**Журнал встреч (`/meetings`):** у идущей/запланированной встречи (joinable — `isJoinableStatus`) появились действия «Войти» / «Скопировать ссылку» / «Пригласить» (и в панели деталей, и в строке списка). У `active`-встречи — бейдж «Идёт».

**Страница встречи (`/m/:id`):**
- Хостовое **«Выйти»** (disconnect, встреча остаётся `active`) разведено с **«Завершить»** (завершает встречу).
- После выхода хоста — блок «Вы вышли из встречи» + кнопка **«Вернуться в встречу»** (rejoin).
- Лобби хоста — кнопка **«Скопировать ссылку»**.
- В комнате — надёжная **«Ссылка»** (через `copyToClipboard`, при отказе clipboard — fallback-модалка с ссылкой) + **«Пригласить»** (переиспользуемый `InviteDialog`).

**Меню (`Sidebar`):** новая группа **«Задачи»** (Проекты · Спринты · Входящие · Архив спринтов). Дамп + Таблицы перенесены в группу **«Память компании»**, `/me/inbox` переименован в **«Мои задачи»**. Порядок групп: Каждый день → Задачи → … .

**Подвкладки проекта (`/projects/[slug]`):** primary-вкладки (Обзор · Доска · Список · Календарь · Спринты · Настройки) + выпадающее **«Ещё ▾»** (Документы · Приложения · Загруженность · Входящие · Гант).

**«Архив гипотез» → «Архив спринтов» (`/sprints/archive`):** убрана гипотезная лексика (UI «Цикл/Циклы» → «Спринт/Спринты»). `computeDurationDays` — без лишнего `+1`.

**Входящие (`/intake`):** при «Принять», если проект не резолвится, открывается **пикер проекта** (фронт-выбор + тост ошибки). Ссылка дампа на странице — `/intake` → `/ideas`.

**Шаблон продаж (бэк):** русификация ролей в `TeamTemplate.definition` — SDR → «Специалист по квалификации», BANT/CHAMP → «методике квалификации» (patch `patch-team-templates-ru.ts`); бэк-промпт «Кора».

## Батч 5 — дашборды + загрузка/импорт документов + загрузка встречи (2026-06-09)

**Источник:** ТЗ-2 (состав) ⊕ ТЗ-3 (modern-визуал), ТЗ-4, ТЗ-5. Ветка `feature/2026-06-08-daily-value-dashboards-uploads`. API/модули — [[api-layer]] §«Батч 5», [[../02_architecture/module-map]] §«Батч 5».

**Новые страницы:**
- `/dashboard/portfolio` — здоровье портфеля целей (PortfolioHealthService + MoSCoW), гейт `operations.portfolio_health.enabled`.
- `/dashboard/value-recap` — экран месячной витрины пользы (поверх ValueRecap S1.5) + экспорт слайдов/печать.
- `/meetings/upload` — мастер ручной загрузки встречи (видео/аудио → диаризация).
- `/meetings/[id]/speakers` — экран подписи говорящих (сотрудник/внешний/исключить/слить); `STATUS_VIEW` для статуса `awaiting_speakers`.

**Изменённые экраны:**
- `/dashboard` (главная директора): первый экран сжат до ≤7 величин (ValueStrip + чат/настроение/обещания/висящие решения + вердикт компаса + AI-сводка + Top-1 риск), гейт `dashboard.main_rework.enabled`; новые виджеты `ValueStripWidget`/`WhatWeLearnedWidget`/`GoalVectorVerdictWidget`/`IdeasTopWidget`/`ChatUsageWidget`.
- `/dashboard/operations` (COO): += `TeamCapacityWidget`/`ChronicBlockersWidget`, гейт `operations.dashboard_rework.enabled`.
- `/me` (5→9 виджетов): `MemoryHelpedMeWidget`/`MyWeeklyPlanFactWidget`/`MyIdeasFateWidget`/`RecognitionInboxWidget`; кнопки 👍/👎 на ответах чата (chat-v2 feedback); гейт `me.daily_value_widgets.enabled`.
- `/documents`: мультизагрузка + форма привязки + `ImportDocumentsDialog` (ZIP/Notion/Confluence) + `SuggestionBanner` (accept/edit AI-подсказки) + ссылка на документ-источник в citations чата.
- Визуал: `/goals`,`/actions`,`/maturity` на modern; modern-фон админки (`AdminShell MODERN_PAGE_BG`); perf-fallback `prefers-reduced-transparency` в tokens.css.
- ⚠ Светлая тема дашбордов (ТЗ-3) — задизайнит владелец отдельно (в «не сделано»).

## Служба поддержки — виджет + кабинет клиента + деск (2026-06-09)

**Источник:** ТЗ [`plans/archive/2026-06-09-support-desk-clone-and-closed-contour-tz.md`](../../plans/archive/2026-06-09-support-desk-clone-and-closed-contour-tz.md) (Ф1–Ф4). API/модель — [[api-layer]] §«Служба поддержки», профильная заметка — [[support-desk]].

**Клиентский виджет (отдельный bounded context, R-INV-4 — без tool'ов Concierge и без графа компании):**
- `frontend/src/ui/support/SupportWidget.tsx` + `SupportForm.tsx` + `SupportWidgetMount.tsx` — плавающая кнопка + форма создания обращения (тема + сообщение), монтируется глобально.

**Новые страницы:**
- `/support/my-tickets` — список обращений клиента + детальный экран (лента только `access='external'`) + оценка CSAT.
- `/support/desk` — рабочий деск сотрудника поддержки: очередь (`unassigned/mine/all/closed/spam`) + детальный тикет с ответом клиенту / внутренней заметкой / назначением / сменой статуса (доступ по членству в группе-контуре).

**Меню:** пункты сайдбара «Поддержка» (клиентский «Мои обращения» + деск для сотрудников поддержки).

## Доводка редизайна дашбордов — полный стеклянный язык + дата-виз (2026-06-10)

**Источник:** ТЗ [`plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md`](../../plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md) (Ф0–Ф7). Ветка `feature/query-understanding-and-support-desk`. Контрактные поля бэка — [[api-layer]] §«Дата-виз поля редизайна дашбордов».

Закрыт класс «новый градиентный фон со старыми плоскими `shadcn`-карточками»: 5 экранов доведены до **современного стеклянного языка** (библиотека `frontend/src/ui/components/dashboard/modern/*`, эталоны `/dashboard/portfolio`, `/dashboard/value-recap`, `/goals`, `/maturity`, `/actions`). Тема — только тёмная (светлая = отдельная Ф владельца, см. `04_не-сделано`). Новых флагов нет (Ship-On); OFF-ветки kill-switch (`reworkEnabled`/`mainReworkEnabled`) **не тронуты** — мигрировалась только ON-раскладка.

| Экран | Было | Стало (modern/*) |
|---|---|---|
| `/dashboard/operations` (`OperationsDashboardClient` + `MaturityWidget`/`CauseCategoryMapWidget`/`InsightsTopWidget`) | новый фон, но 4×`KpiHero` + ~10 плоских `bg-bg-card`-секций | `ModernPageShell`; 4 `KpiHero`→`StatCard`; hero-`AreaTrend` «Операционная нагрузка» по `weeklyInflow`; `DonutCard` температуры; `RadarCard` зрелости; `GlassCard`/`ModernTable` |
| `/me` (`MeClient` + `MyPositionCard`/`MyTelegramCard`) | без нового фона, верх — `shadcn Card` | `ModernPageShell` + `GlassCard`-карточки; якоря `#me-card-position`/`#me-card-telegram` сохранены |
| `/dashboard` (`DirectorDashboardClient`, ON-ветка) | KPI `KpiHero`, AI-сводка/виджеты табов — `shadcn Card` | 3 `KpiHero`→`StatCard` (реальный sparkline уже был на бэке); AI-сводка→`GlassCard` glow; виджеты табов→`GlassCard` |
| `/dashboard/operations/daily` (`DailyDigestClient`) | фон + 1 glass-секция | все секции glass + 2 hero-`AreaTrend` (настроение/нагрузка) из `digest.trend`; заглушка при `<2` точках |
| `/dashboard/operations/weekly` (`WeeklyDigestClient`) | фон + 1 glass-секция | все секции glass + hero-`AreaTrend`+`BarTrend` из `digest.trend` |

**Фундамент библиотеки (Ф0):** `StatCard` — пропсы `spark`/`delta`/`up` стали опциональными + добавлен `href`; новый компонент `ModernPageShell({title, subtitle?, headerRight?, maxWidth?, children})` (фон `MODERN_PAGE_BG` + контейнер + glass-header); хелпер `kpiTone(value, threshold)` в `tokens.ts`. Файлы — `frontend/src/ui/components/dashboard/modern/{StatCard.tsx,tokens.ts,ModernPageShell.tsx,index.ts,StatCard.spec.tsx}`. `KpiHero` **не удалён** — остаётся у внешних потребителей (`/teams`, `/persons/pulse`, `KnowledgeVelocityKpi`).

**Уборка (Ф7):** удалён мёртвый `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` (0 импортёров — роутинг идёт через `DashboardRouter` → `DirectorDashboardClient`/редирект на `/me`).

## Мобильная Кора — презентационный слой `src/ui/mobile/*` (2026-06-11)

**Источник:** ТЗ [`plans/tz/2026-06-11-mobile-cora-exec-manager.md`](../../plans/tz/2026-06-11-mobile-cora-exec-manager.md) (Ф0–Ф7). Ветки `feature/finishable-now-2026-06-11` (Ф0+Ф1) → `feature/remaining-handoff` (Ф2–Ф7, коммиты `7aa1e3ed..daf72cbe`). Мобильный — **отдельный презентационный слой поверх существующих роутов**: `MobileShell`-gate (через `useIsMobile`) на странице рендерит мобильное дерево, **десктоп не меняется** (та же `page.tsx` отдаёт десктопный клиент при `!mobile`). Дубли страниц не плодятся — мобайл переиспользует те же API/эндпоинты.

**Гейт `MobileShell` врезан в роуты** (десктопный клиент не тронут):

| Роут | Мобильный экран | Десктоп (без изменений) |
|---|---|---|
| `/dashboard` | `MobileOverviewClient` (exec «Обзор» — читает `/dashboard/director` + `/dashboard/operations/overview`) | `DirectorDashboardClient` |
| `/dashboard/operations` | `MobileTeamClient` (exec «Команда») | `OperationsDashboardClient` |
| `/dashboard/operations/weekly` | `MobileDealsClient` (exec «Дела») | `WeeklyDigestClient` |
| `/goals` | `MobileGoalsClient` (exec «Цели») | `GoalsClient` |
| `/chat` | `MobileAskClient` («Спросить» — переиспользует `OrgChatPanel` + аддитивные опц. пропсы `suggestedPrompts`/`voiceInput`, дефолт-off → десктоп не тронут; промпт-кнопки по роли, голос-ВВОД, ответ только текст с citation) | `ChatV2` (`/chat` рендерит ChatV2) |
| `/decisions` | `MobileMemoryClient` («Память» — `decisionsApi.list` + поиск) | реестр решений |
| `/decisions/[id]` | `MobileMemoryClient` (без предвыбора) | `DecisionsListClient` с предвыбранным решением — deep-link, чинит 404 (2026-06-12) |
| `/me/daily-brief` | **переиспользование** готового `MyDailyBriefClient` (таб «Моё» — дубль не плодили) | тот же `MyDailyBriefClient` |
| `/me/check-ins` | таб «Чек-ин» + `VoiceInputButton` (голосовой ввод) | `/me/check-ins` |

**Голосовой ввод `src/ui/components/voice/VoiceInputButton.tsx`** — запись `MediaRecorder` + `pickSupportedMimeType` → `voiceApi.transcribe` (серверный ASR Vox, iOS-совместимо; клон паттерна `ProbeAnswerInput`, **не** Web Speech API — тот не работает на iOS Safari). Вшит в `/me/check-ins`.

**Утренний exec-push (Ф7):** кнопка `EnableMorningRemindersButton` на exec «Обзоре» (`MobileOverviewClient`) — оформляет push-подписку (если задан `NEXT_PUBLIC_VAPID_PUBLIC_KEY`). Доставку шлёт новый бэк-крон `ExecMorningPushCron` (см. [[workers-queues]]).

**Примитивы `src/ui/mobile/shared/*`:** `ZoneTile`, `StatusDot`, `GlanceGauge`, `DrillList` (зональные плитки/индикаторы/мини-датчик/drill-вниз), `MobileAskClient`, `MobileMemoryClient`. Exec-экраны — `src/ui/mobile/exec/{MobileOverviewClient,MobileTeamClient,MobileDealsClient,MobileGoalsClient}.tsx`; manager — `src/ui/mobile/manager/MobileMemoryClient.tsx`.

**ChatBox-виджет (блок A, 2026-06-11):** `ChatboxMemorySummaryCard` на `/chats/integrations/chatbox` — сводка «Чаты в памяти» (counts диалоги/сессии/проанализировано/в работе/ошибки + блоки/задачи из переписки), читает `GET /api/v1/chatbox/integration/memory-summary` (см. [[api-layer]] §ChatBox).

## История

- **2026-05-25:** создан в рамках handoff Wave 1-3. Документированы T1, T2, T5 (settings секция), feed/spotlights обновления.
- **2026-05-25 (UI/API modernization):** добавлена секция про design-preview / 7 новых shared-компонентов / 2 hooks / OKLCH-токены / sonner-миграцию / mobile-адаптацию.
- **2026-05-25 (β-8.1/β-8.2):** добавлены страницы `/dashboard/operations/weekly` и `/me/promises`, виджеты `TeamTemperatureWidget` и «Открытые обещания», роль `coo` во фронтенд-типах.
- **2026-05-25 (β-8.3):** добавлена страница `/dashboard/operations/daily` + новые виджеты `CauseCategoryMapWidget` и `MaturityWidget` на `/dashboard/operations` + блок «Вчерашний отчёт» + кликабельные бэйджи `cause_category` в `InsightsTopWidget` (deep-link `/insights?cause_category=…`). Файл `frontend/src/lib/cause-category-presentation.ts` — 8 русских лейблов + Tailwind палитра.
- **2026-05-25 (feedback):** добавлены страницы `/feedback` (пользователь), `/admin/feedback` (super_admin дашборд блоков), `/admin/feedback/[topicId]` (детали блока). Полная заметка фичи — [[feedback]].
- **2026-05-26 (clones marketplace + admin):** добавлены маршруты `/clones`, `/clones/[roleId]`, `/clones/[roleId]/chat/[conversationId]` (маркетплейс ролевых клонов + чат с боковой панелью диалогов), `/roles/[id]/clone` теперь redirect на `/clones/[id]`, новая admin-страница `/admin/clones` (управление `CloneAccessGrant`). Удалены `/me/clone` и `/persons/[id]/skill-profile` (legacy первой итерации Clones-Roles). См. [plans/archive/2026-05-26-clones-marketplace-frontend.md](../../plans/archive/2026-05-26-clones-marketplace-frontend.md).
- **2026-06-02 (main-screen-umbrella — зонтик A+Б+В, 24 коммита):** главная страница перестроена в «sticky Hero + 4 pill-таба + AssistantSidebar.Спросить + MainEmptyState». Поток А: shared эталонная демо-Org «Демо: ТехноСтрим» (`isReferenceDemo=true`), роль `demo_observer`, `DemoObserverGuard` (APP_GUARD), `RbacService.canMutate`, ENV `ZDEMO_ORG_ID`, listener detach при оплате, удалён авто-сидинг копий. Поток Б: `DashboardTabs` + `useDashboardTab` (per-user localStorage), Hero refactor (3 KPI + AI-сводка + `TopRiskCard`), 4 функции-таба `OverviewTab/TeamTab/KnowledgeTab/GoalsTab`, `IntroWizardWidget` 4-state, `TabEmptyState`, `PeopleAtRiskWidget`, mobile + sticky header fix. Поток В: подключение `MainEmptyState` (правило 3 матрицы), TopRiskCard CTA disabled+Paywall для `demo_observer`, setupProgress встроен в EmptyState, `@PublicDemo()` на `/concierge/messages` + `/chat-v2/messages` (LLM-чат разрешён в эталоне). Источник: [plans/archive/2026-06-01-main-screen-umbrella.md](../../plans/archive/2026-06-01-main-screen-umbrella.md). Профильные заметки [[demo-workspace]] + раздел в [[onboarding-wizard]].
- **2026-06-02 (Goals OKR v2):** на `/goals` добавлен переключатель «Список / Дерево» + `GoalsTreeView`; на `/goals/[id]` — секция «Ключевые результаты» (CRUD + ручной прогресс), диалоги reparent/supersede, маркер «Предложено Корой». В карточке идеи — «Двигает цель», в дашборде спринта — «Продвигает цель» (общий `GoalPickerDialog`). На дашборде CEO — `GoalsPulseWidget` + дерево целей. Слои `goals.api.ts`/`domain/goal.ts`. См. [plans/archive/2026-06-02-goals-okr-v2.md](../../plans/archive/2026-06-02-goals-okr-v2.md).
- **2026-06-03 (Action Center Часть B):** новая страница `/actions` (центр подтверждений), глобальный колокольчик `PendingActionsBell` (top-bar + мобильный Header), пункт сайдбара «Подтверждения» с живым бейджем, блок `requiresAction` (`RequiresActionTile` на главной + `RequiresActionBanner` на «Панели операций»). Слои `pending-actions.api` / `domain/pending-action` + хуки `usePendingActionsCount` / `usePendingActions`. Источник: [plans/tz/2026-06-02-action-center-pending-confirmations.md](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (Часть B).
- **2026-06-03 (Action Center trust-ladder C1-C3):** новые страницы курации `/curation/[id]` (детальная карточка + панель решения куратора, 8 `decisionType`), `/curation/conflicts` (список конфликтов) и `/curation/conflicts/[id]` (резолюция accept_new/keep_old/merge/evolving + dismiss); роль-доступ — карточка `owner`/`admin`+кандидат-куратор, конфликты строго `owner`/`admin`. Новый shared-компонент `TrustBadge` (метка доверия по `trustTier`) на `/regulations`, `/decisions` и вкладке сущностей документа. actionUrl провайдеров `requiresAction` переведены на deep-link detail-страниц. Worktree `feature/action-center-trust-ladder`, коммиты `c8799f8`/`4d72ead`/`ce4052d`. Источник: [plans/tz/2026-06-02-action-center-pending-confirmations.md](../../plans/tz/2026-06-02-action-center-pending-confirmations.md) (фазы C1-C3).
- **2026-06-04 (Команда + персональные доступы):** `/structure` переименован в «Команда» и поднят в группу «Каждый день» (дубль убран из «Справочника»); вкладка «Сотрудники» открывается первой. Новая карточка сотрудника `/structure/persons/[id]` (вкладки «Профиль» / «Доступы» — системная роль + доступ к клонам + персональные override доступа). Управление участниками/приглашениями перенесено из `/settings/organization` (очищена до «Информации») в «Команду». Диалоги вынесены в `frontend/src/ui/components/team/` (`InviteEmployeeDialog`/`InviteCreatedDialog`/`PersonDialogs`). Мастер «Знакомства» снова переоткрываем. См. [plans/tz/2026-06-03-team-section-and-employee-access.md](../../plans/tz/2026-06-03-team-section-and-employee-access.md).
- **2026-06-01 (dashboards-wow-polish — 11 фаз):** общая полировка всех 5 семейств дашбордов (CEO / Operations / Person / Sprint / Tables). Закрыты 3 dead routes — `/tables` и `/sprints/archive` в Sidebar (`DAILY_GROUP`), системный `PersonSubpagesNav` (pill-табы 7 пунктов) для карточки сотрудника. Новая библиотека мини-визуализаций `frontend/src/ui/components/dashboard/charts/` (MiniSparkline / MiniBarRow / MiniStackedBar / MiniDonut / MiniHeatCell / CountUp + preview-страница `/charts`). 12 виджетов CEO-дашборда переведены с «MVP-стиля» в режим с живой визуализацией; DirectorDashboard получил «cinema mode» (hero-strip с градиентом, sticky-header с backdrop-blur, AI-сводка с inner-glow, mosaic-layout, motion-safe enter-stagger). Operations Daily/Weekly/Overview объединены навигационным `OperationsTabs`. Person Pulse — Hero с MiniDonut Pulse score. Sprint Daily получил Hero-strip; Archive переоформлен в карточный grid с MiniDonut процента. Smart-tables — карточки таблиц, цветные ячейки status/select через `themeOverride` Glide (без custom canvas-рендера), TYPE_HINTS для ColumnTypeSelector. CountUp интегрирован в общий `KpiHero` (backward-compatible через опц. `format`). Все 12 виджетов реестра `docs/reference/dashboards-registry.md` помечены ✅. См. [plans/archive/2026-06-01-dashboards-wow-polish.md](../../plans/archive/2026-06-01-dashboards-wow-polish.md).

- **2026-06-05 (ChatBox-интеграция):** новая группа сайдбара **«Чаты»** (route `/chats`, гейт `gateFeature:'feature.chatbox'`, подгруппа «Интеграции» → пункт «Чат бокс»). Страницы: `/chats` (`ChatsListClient` — список чатов с бейджами типа мессенджера MAX/WhatsApp/Telegram/виджет/«Другое», единая карточка клиента по `customerExternalId`, менеджер, последнее сообщение), `/chats/[id]` (`ChatDetailClient` — лента сообщений + сегментация на сессии + поле ответа менеджера), `/chats/integrations/chatbox` (`ChatboxIntegrationClient` — ввод токена → выбор воркспейса → режим синка + кнопки ручного синка), `/chats/integrations/chatbox/managers` (`ChatboxManagersClient` — маппинг менеджеров на сотрудников). Слои `src/api/chatbox.api.ts` → `src/domain/chatbox.ts` (ApiDto→DomainModel, маппинг `channelType`→иконка/лейбл), SWR. `domain/entitlement.ts` пополнен флагом `feature.chatbox`. Источник: [plans/tz/2026-06-05-chatbox-integration.md](../../plans/tz/2026-06-05-chatbox-integration.md). Профильная заметка — [[chatbox-integration]].

- **2026-06-12 (срочный фикс прод-404 на решениях):** добавлен сегмент App Router `/decisions/[id]` ([frontend/app/(authenticated)/decisions/[id]/page.tsx](../../frontend/app/(authenticated)/decisions/[id]/page.tsx)) — deep-link на решение: тот же десктопный master-detail с **предвыбранным** решением (правая колонка грузит деталь сразу), мобайл — та же лента «Память». `DecisionsListClient` принял опц. проп `initialSelectedId` (backward-compat: `/decisions` без него не изменился). Чинит 404 от префетча ссылок на `/dashboard` (виджет «Необратимые решения»), в недельной сводке и `/insights`. Источник: [plans/tz/2026-06-12-urgent-dashboard-500-and-decisions-404-fix.md](../../plans/tz/2026-06-12-urgent-dashboard-500-and-decisions-404-fix.md) (Фаза 2).
- **2026-06-05 (онбординг собственника: должность + Telegram-каналы):** на странице «Я» (`/me`) добавлены три блока — карточка «Должность» (`MyPositionCard`: Popover+Command, выбор существующей `Role` или создание новой → `PATCH /persons/:id {roleId}`, шапка обновляется через `mutate(['me-profile'])`), карточка «Telegram» (`MyTelegramCard`: статус привязки + CTA на `/me/channels`), баннер-подсказка «заполните профиль» (виден пока нет должности и/или Telegram не `linked`, якоря `#me-card-position`/`#me-card-telegram`). В меню «Моё пространство» добавлен пункт **«Каналы»**→`/me/channels` (единый канон привязки Telegram). Со страницы `/settings/integrations` убран дубль `TelegramLinkSection` (файл удалён) — там остался только `DestinationsClient` (направления доставки); пункт «Интеграции» и страница сохранены. Фронт-only, бэкенд не тронут. Все нужные API уже были (`meProfileApi`/`rolesDomainApi`/`personsDomainApi`/`listMyChannels`). Источник: [plans/tz/2026-06-05-onboarding-owner-position-and-channels-entry.md](../../plans/tz/2026-06-05-onboarding-owner-position-and-channels-entry.md).
- **2026-06-06 (детальные страницы → async `params` + UI-честность):** 26 детальных `page.tsx` (tables/documents/issues/sprints/roles/persons/clones/admin-detail) переведены на async `params` (Next 16) — чинит класс-баг «/tables/undefined» и «не найдено» (см. раздел «Детальные страницы на async `params`» выше). В 66 `metadata.title` суффикс `— Z` → `— Кора`. Объединены два наложенных плавающих помощника: у Консьержа (`ConciergeFloatingButton`) убран собственный FAB — он открывается только по событию `concierge:open`; единственная плавающая кнопка кабинета — «Помощник компании» (`AssistantSidebar`), на неё перенесена цель тура `welcome.concierge`. Деанглицизмы в `i18n/ru.ts` и заголовок чата «AI-чат» → «Помощник компании» (`/chat`, `/chat-v2`, командная палитра). `/dump` после сохранения показывает «куда попало» + ссылки; «Вопрос Коры» в `/actions` ведёт на `/me/notifications?id=<id>` (`NotificationsClient` раскрывает конкретный вопрос). Источник: [plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md](../../plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md) (коммиты `521f7553`/`edbb9554`/`d9730afb`/`dae2bb44`/`b9312735`). См. также [[frontend-contexts-hooks]] §«Единый плавающий помощник».
- **2026-06-05 (telegram-channel-reachability-fix):** `/me/channels` и карточка «Telegram» на «Я» получили честное состояние **«Не настроен»** (`channel_not_configured`) — когда глобальный Telegram-бот без токена; вместо кнопки в тупик показывается «бот не настроен администратором» (+ссылка в `/admin/content/global-channels` для owner/admin). Канал «В личном кабинете» теперь «Работает автоматически» (без «Привязан: id»); «потолок чувствительности» свёрнут в `<details>`. Deep-link строится из `botUsername` канала. Бэкенд: `listMyChannels`+`resolveBindings` теперь видят глобальные бот-каналы. Источник: [plans/tz/2026-06-05-telegram-channel-reachability-and-channels-ux-fix.md](../../plans/tz/2026-06-05-telegram-channel-reachability-and-channels-ux-fix.md).
- **2026-06-06 (Трекер + Встречи, A1-A7 + B1-B5):** новая группа меню **«Задачи»** (Проекты·Спринты·Входящие·Архив спринтов), Дамп+Таблицы → «Память компании», `/me/inbox` → «Мои задачи»; подвкладки проекта primary + «Ещё ▾»; «Архив гипотез» → «Архив спринтов» (без гипотезной лексики); пикер проекта при «Принять» во Входящих. Журнал встреч (`/meetings`) — «Войти»/«Скопировать ссылку»/«Пригласить» + бейдж «Идёт» у joinable. Страница встречи (`/m/:id`) — хостовое «Выйти» (rejoin) отдельно от «Завершить», блок «Вы вышли из встречи», «Скопировать ссылку» в лобби, надёжная «Ссылка» (fallback-модалка) + «Пригласить» в комнате (`InviteDialog`). Подробнее — раздел «Трекер + Встречи — финальная сессия» выше; контексты/хелперы — [[frontend-contexts-hooks]] §«Хелперы и хуки сессии». Источник: [plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md](../../plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md).
- **2026-06-06 (стабильность фронта + UX отчёта, ТЗ-1 + ТЗ-2 + ТЗ-5):** прод-сборка переведена на **webpack** (`next build --webpack`, уход от Turbopack — корень `ChunkLoadError`), `deploymentId` из build-arg `DEPLOYMENT_VERSION` (защита от version skew — рассинхрона версий). Русские `app/global-error.tsx` + `app/error.tsx` с **тихим авто-перезагрузом** при `ChunkLoadError` (anti-loop по 10-секундному окну, `src/lib/chunk-reload.ts`). **Vidstack-плеер заменён на нативный `<video>`** во всех 3 местах (`MeetingPlayer` / `ShareMeeting` / `ShareClip`), хук `src/hooks/use-video-player.ts`, зависимость `@vidstack/react` удалена. На странице результата встречи (`/result`) — честный баннер **«Отчёт готовится»** с SWR-поллингом (вместо пустоты, пока `reportFastStatus` не `ready`). **Действия отчёта** `ReportActions` (Скопировать / Скачать .md / Печать) в диалоге отчёта и в «Обзоре» под видео; сериализатор `structuredReportToMarkdown`. Источник: ТЗ-1/ТЗ-2/ТЗ-5 ветки `feature/prod-stability-2026-06-06`. Грабли (Turbopack→ChunkLoadError, удаление dep требует `bun install`) — [[../02_architecture/code-pitfalls]].

- **2026-06-10 (доводка редизайна дашбордов до полного стеклянного языка + дата-виз, Ф0–Ф7):** 5 экранов (`/dashboard/operations`, `/me`, `/dashboard`, `/dashboard/operations/daily`, `/dashboard/operations/weekly`) доведены до современного языка `modern/*` — устранён класс «новый фон + старые плоские `shadcn`-карточки». `KpiHero`→`StatCard`, `shadcn Card`→`GlassCard`/`ModernTable`, hero-графики `AreaTrend`/`BarTrend`/`DonutCard`/`RadarCard` по реальным трендовым рядам (`weeklyInflow`, `digest.trend` — см. [[api-layer]]). Фундамент библиотеки (Ф0): `StatCard` с опциональными `spark/delta/up` + `href`, новый `ModernPageShell`, хелпер `kpiTone`. Удалён мёртвый `DashboardClient.tsx` (Ф7); `KpiHero` сохранён для `/teams`/`/persons/pulse`/`KnowledgeVelocityKpi`. Тема только тёмная, OFF-ветки kill-switch не тронуты, новых флагов нет. Подробнее — раздел «Доводка редизайна дашбордов» выше. Источник: [plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md](../../plans/tz/2026-06-09-dashboards-redesign-completion-full-dataviz.md).

- **2026-06-15 (селектор «помощник / клон должности» на `/chat`):** у окна ввода AI-чата (`ChatV2Client`) добавлен `AssistantTargetSelect` (Radix) — по умолчанию «Кора · помощник» (стрим chat-v2 не меняется); выбор ролевого клона ветвит `onSubmit` на `clonesApi.askRole` (клон — НЕ режим chat-v2), ответ склеивается в нить с именем клона, спиннер, `refused`/`403`-обработка, per-`roleId` `conversationId`. Доступ — `useMyCloneAccess` (пустой список → селектор скрыт). Domain `cloneAnswerToChatV2Message` (citations + refused). Кабинет-онли (mobile `OrgChatPanel` — vNext); Telegram/бэкенд не затронуты (`askRole` уже есть, RBAC/квота на нём). Источник: [plans/archive/2026-06-15-cabinet-assistant-clone-selector.md](../../plans/archive/2026-06-15-cabinet-assistant-clone-selector.md).

- **2026-06-18 (сквозные хлебные крошки + мобильная «назад» + «Лента Коры» в дашборды):** (D) сквозная навигация-крошки — контекст `BreadcrumbProvider`/хук `useRegisterBreadcrumb` + `useBreadcrumbTrail`/`buildBreadcrumbTrail` + `Breadcrumbs`/`breadcrumb-config` (`frontend/src/ui/components/breadcrumbs/`), врезаны в AppShell/Header/AuthenticatedShell, имена зарегистрированы на ~16 страницах-деталях; на мобильном — кнопка «назад». Подробнее — [[frontend-contexts-hooks]] §«Сквозные хлебные крошки». (C) «Лента Коры» вынесена в виджет `CoraFeedWidget` (variant full/compact, `frontend/src/ui/components/feed/`) на `/dashboard` и `/me`; страница `/feed` удалена (сиблинги `/feed/insights`/`/feed/probe-questions`/`/feed/spotlights` живы). Ф5 (визуальная qa-приёмка обеих фич) — НЕ выполнена (см. `04_не-сделано`). Коммиты `8ef49108`+`eb0f7dee` (D), `9aa3945e`+`10dbbe35` (C). Источники: [plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md](../../plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md), [plans/tz/2026-06-17-cora-feed-into-dashboards.md](../../plans/tz/2026-06-17-cora-feed-into-dashboards.md).

- **2026-06-18 (помощник × календарь, Ф8 — рабочий профиль + онлайн-встреча):** в «Настройки → Профиль» добавлена секция **«Рабочее время»** (`WorkProfileSection`) — таймзона (IANA), рабочие часы и рабочие дни недели; пишет на свой `Person` через `GET/PATCH /api/v1/me/work-profile` (см. [[api-layer]] §Concierge). Форма события `EventForm` (`frontend/src/ui/calendar/`) получила **тумблер «Онлайн-встреча»** (биндится на `Event.online`, при включении создаётся видеокомната LiveKit), поле **«Клиент/контрагент»** (`Event.counterparty`, отдельно от «места»/`location`) и кнопку **«Сделать онлайн»** (`POST /api/v1/events/:id/make-online`). Маппер `domain/calendar.ts` теперь `isOnline = api.online` (раньше выводился из `kind==='meeting'`). Источник: [plans/tz/2026-06-18-assistant-calendar-master.md](../../plans/tz/2026-06-18-assistant-calendar-master.md). Профильная заметка — [[calendar]].

- **2026-06-20 (яркий FAB-помощник + единый колокольчик уведомлений + пикер собеседника):** разведены две поверхности — внизу справа **один яркий FAB** (`ConciergeFloatingButton`) открывает чат-помощника в 1 клик (фокус сразу в поле ввода); наверху **колокольчик** (`PendingActionsBell`) — единственный кликабельный центр уведомлений, сводит три группы (pending + proactive + срочный feed) под одним счётчиком (каждое уведомление кликабельно через `actionUrl`, человекочитаемый заголовок, без сырых `latin_snake`). `AssistantSidebar` **удалён**; пузырь Поддержки разведён в нижний левый угол. В панели чата — слим-вкладки **«Помощник компании | Клоны ролей»** (`ConciergeClonesTab`: `clonesApi.askRole`, citations, refused); ≤4 клонов по confidence + ссылка «Все клоны». Мобайл: FAB поднят над таб-баром, колокольчик доступен в мобильной шапке. Чистые мапперы `frontend/src/domain/assistant-signals.ts` (`PROACTIVE_RULE_LABEL`/`PROACTIVE_RULE_ROUTE`/`FEED_TYPE_ROUTE`), хук `useAssistantSignals` (см. [[frontend-contexts-hooks]]). Фронт-only (бэкенд не тронут). Отменяет «единый плавающий помощник = `AssistantSidebar`» из 2026-06-06 (см. [[frontend-contexts-hooks]]). Источник: [plans/tz/2026-06-20-assistant-fab-notifications-and-clone-picker.md](../../plans/tz/2026-06-20-assistant-fab-notifications-and-clone-picker.md) (Ф1–Ф4).

- **2026-06-20 (провенанс «Откуда это» на поверхностях — снипеты/подсветка/плеер):** сниппет цитаты-источника (`ProvenancePreviewSnippet`) рисуется прямо на карточках списков решений/регламентов/задач из денорм-`previewQuote` (без on-demand резолва). На странице документа — **подсветка/прокрутка к цитате** по deep-link `/documents/<id>?q=<цитата>` (B4, вариант «б»; page-aware `?page=N` остаётся vNext). В дровере «Откуда это» (`ProvenanceDrawer`) — **плеер голосового** сообщения (Telegram/MAX) через presigned `GET /api/v1/provenance/voice-note/:rawEventId/audio`. Chatbox-источник ведёт на конкретное сообщение `/chats/<chatId>?m=<msg>`. Источник: [plans/tz/2026-06-20-provenance-probe-followups.md](../../plans/tz/2026-06-20-provenance-probe-followups.md) (A1 / B1 / B3 / B4).

## «Что Кора выучила» — самообучение probe (2026-06-23, автономизация Блок D)

| Путь | Что показывает | Доступ |
|---|---|---|
| `/company-admin/subject-memory` | **«Что Кора выучила»** — правила самообучения probe (SubjectMemory): термины/дизамбигуации/предпочтения, выученные из ответов на уточняющие вопросы; фильтры по статусу (`shadow`/`canary`/`active`/…) и виду правила (`kind`), счётчики `countsByStatus`. Читает `GET /api/v1/subject-memory` ([[api-layer]] §История 2026-06-23). | owner/admin/coo |

Файлы: `frontend/app/(authenticated)/company-admin/subject-memory/` + `frontend/src/api/subject-memory.api.ts` (ApiDto) + `frontend/src/domain/subject-memory.ts` (маппер) + пункт в `CompanyAdminSidebar.tsx`. ТЗ [`2026-06-23-remove-manual-confirmations-master-tz`](../../plans/tz/2026-06-23-remove-manual-confirmations-master-tz.md) Блок D. Карта фичи — [[probe-agent]] §«Наблюдаемость самообучения SubjectMemory».

[[../index|← index]]
