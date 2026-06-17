---
type: analysis
status: draft
feature: Глубокий UI/UX design audit — Z-Admin и Org-кабинет
date: 2026-05-22
related:
  - plans/analysis/2026-05-21-user-cabinet-design.md (вход — навигация ЛК Фазы 0)
  - plans/archive/2026-05-21-phase-0-roles-and-onboarding.md (зонтичный ТЗ Фазы 0)
  - second-brain/02_architecture/design-system.md (целевой UX)
  - second-brain/01_projects/frontend-pages.md (каталог экранов)
  - second-brain/13_glossary/ui-glossary.md (глоссарий UI)
  - second-brain/13_glossary/copy-strings.ru.md (копирайт UI)
  - second-brain/06_marketing/positioning.md (категория «память компании»)
  - second-brain/06_marketing/messaging.md (tone of voice)
---

# UI/UX Design Deep Audit — Z (Кора)

> **Это аналитический документ, не ТЗ.** Сюда стекаются варианты, альтернативы, tradeoffs. Решения по итогам будут приниматься в отдельных sub-TZ (`plans/tz/...`), которые сошлются на разделы этого аудита. Не выбираю «один правильный путь» — даю входные данные для выбора.

> **Источники фактуры:** три исследовательских стрима, проведённых 2026-05-22:
> - Стрим A — инвентаризация текущего фронта Z (65+ маршрутов, AppShell, design system).
> - Стрим B — UX-материалы из `delivery/` и второго мозга (принципы, позиционирование, копирайт, конфликты).
> - Стрим C — публичные материалы по эталонам data-heavy admin: Mixpanel, Amplitude, Cloudflare Dashboard.

---

## 0. Зачем этот документ

### 0.1. Цель

Дать целостный взгляд на состояние UI/UX Z **сегодня** и сформировать **банк вариантов** для будущих решений по двум кабинетам:

1. **Org-кабинет** — то, что видят клиенты Z (`owner` / `admin` / `member` внутри Org). Сегодня — это `/dashboard`, `/structure`, `/documents`, `/roles`, `/me`, `/meetings`, `/cards`, `/tasks`, `/chat`, `/dump`, `/settings/*`, `/settings/admin/*`.
2. **Z-Admin** — то, что видит собственник платформы Z (роль `super_admin`). Сегодня раздвоен: `(authenticated)/admin/*` и `(admin)/admin/*` — разбираем шов в разделе 5.1.

Цель **не в том**, чтобы выбрать единственный «правильный» дизайн. Цель — собрать **все обоснованные альтернативы** так, чтобы при написании ТЗ можно было быстро взять блок, выбрать вариант, и не пере-открывать развилку.

### 0.2. Контекст

- Фаза 0 («Должности, каркас компании, знакомство») в активной разработке. Большая часть UI Фазы 0 **уже реализована в коде** — обнаружено стримом A: `/structure`, `/documents`, `/roles`, `/me`, `/dump`, wizard `/onboarding/company/step-*`, OrgSwitcher, CommandPalette с поиском по новым сущностям, Sidebar в 3 группы, 4 coming-soon-страницы γ.
- Это **меняет фокус аудита** с «что добавить» на «как поднять качество того, что уже есть» — типографика, плотность, состояния, иерархия информации, согласованность.
- Дальше будут меняться: подход к админке (Z-Admin усиливается), формат отчётов (под 9 типов встреч), модели данных (каркас 5 уровней наполняется в γ).
- В дальней перспективе — ребренд Z → Кора (Q4 2026 / Q1 2027). Любые brand-выборы в дизайне (название в шапке, копирайт) должны допускать смену через токен/переменную, а не быть hard-coded в JSX.

### 0.3. Что внутри документа

- Раздел 1 — контекст и input (скоп, эталоны, ограничения).
- Раздел 2 — текущее состояние UI (компактная сводка по коду).
- Раздел 3 — эталоны Mixpanel/Amplitude/Cloudflare: 30 паттернов «брать / отвергать / спорно» + 5 универсальных.
- Раздел 4 — design language Z (цвет, типографика, density, иконки, motion, эмпти-стейты).
- Раздел 5 — архитектурные решения (двойной Z-Admin, переосмысление дашборда, унификация).
- Раздел 6 — per-screen анализ 12 ключевых экранов (Этап 4, в следующих итерациях документа).
- Раздел 7 — cross-cutting улучшения design system.
- Раздел 8 — action items с приоритетами.
- Раздел 9 — что отложили явно, с обоснованием.
- Раздел 10 — связи и обновления других документов.

### 0.4. Что НЕ делаем

- **Не выбираем шрифт окончательно** — фиксируем варианты с tradeoffs.
- **Не выбираем библиотеку иконок** — Lucide (текущая) против Heroicons / Phosphor разобраны как варианты.
- **Не пишем pixel-perfect mockups** — будут ASCII-wireframes для каждого экрана + контракт «что показывает / какие состояния / какие действия».
- **Не делаем технический рефакторинг** — указываем, что в коде надо менять, но не пишем сам код. Прототипы кода — опциональный Этап 6 по итогам аудита.
- **Не покрываем 100% экранов** — берём 12 ключевых из 65+, остальные получают cross-cutting рекомендации через design system.

### 0.5. Связь с другими документами

- **[second-brain/02_architecture/design-system.md](../../second-brain/02_architecture/design-system.md)** — целевой UX-док, фиксирует 8 сквозных принципов. **Это «северный полюс»**, аудит к нему приближает, но не обязательно реализует на 100%.
- **[second-brain/01_projects/frontend-pages.md](../../second-brain/01_projects/frontend-pages.md)** — целевой каталог из 18 экранов. Из них реализовано 6, в очереди 12 (γ+).
- **[second-brain/13_glossary/ui-glossary.md](../../second-brain/13_glossary/ui-glossary.md)** + **[second-brain/13_glossary/copy-strings.ru.md](../../second-brain/13_glossary/copy-strings.ru.md)** — глоссарий русских терминов UI и копирайт.
- **[plans/analysis/2026-05-21-user-cabinet-design.md](2026-05-21-user-cabinet-design.md)** — вход по навигации ЛК. Этот аудит идёт **поверх** аналитики ЛК.
- **[plans/archive/2026-05-21-phase-0-roles-and-onboarding.md](../tz/2026-05-21-phase-0-roles-and-onboarding.md)** — зонтичный ТЗ Фазы 0, чей sub-TZ 0c будет писаться на основе и аналитики ЛК, и этого аудита.
- **[second-brain/06_marketing/positioning.md](../../second-brain/06_marketing/positioning.md)** + **[messaging.md](../../second-brain/06_marketing/messaging.md)** — категория «память компании», tone of voice, ICP.

**При расхождениях** между этим аудитом и `second-brain/02_architecture/design-system.md` — приоритет у `delivery/06`, кроме случаев когда delivery/06 явно противоречит свежей аналитике ЛК (тогда приоритет у аналитики ЛК + изменения в delivery/06 фиксируются отдельным апдейтом).

---

## 1. Контекст и input

### 1.1. Скоп аудита — 12 ключевых экранов

Выбраны по критериям: (1) большая частота использования, (2) высокая концентрация данных, (3) роль «hero» для основной user-story данного кабинета.

**Z-Admin (6 экранов):**

| # | URL | Почему ключевой |
|---|---|---|
| Z-1 | `/admin` | Главный экран собственника платформы; пульсация всех Org |
| Z-2 | `/admin/orgs` | **Главная боль владельца** — видеть все 10+ Org, статусы, расход |
| Z-3 | `/admin/orgs/[id]/billing` | Деньги по конкретной Org — критично для бизнеса |
| Z-4 | `/admin/usage/functions` | Расход по LLM-функциям — определяет себестоимость |
| Z-5 | `/admin/experiments` | A/B-эксперименты на LLM-маршрутизации |
| Z-6 | `/admin/health` | Здоровье системы — для дежурного мониторинга |

**Org-кабинет (6 экранов):**

| # | URL | Почему ключевой |
|---|---|---|
| O-1 | `/dashboard` | Director Dashboard — пульс компании клиента (10 виджетов сейчас) |
| O-2 | `/me` | Личный кабинет member — default landing для member |
| O-3 | `/structure` | Структура компании (3 таба) — после wizard'а главный workflow |
| O-4 | `/roles/[id]` | Карта должности — главное продуктовое отличие Z (RoleProfile) |
| O-5 | `/documents` | Документы — мост между ingest и knowledge-core |
| O-6 | `/settings/admin/usage` | Расход LLM Org-а — на скриншоте, который ты прислал |

**Альтернативный список** (если по итогам сочтём что важнее — фиксирую как варианты, не отбрасываю):
- Org: `/meetings` (master-detail с фильтрами — самый сложный экран по структуре), `/chat` (диалоговый UI с цитатами), `/cards`, `/tasks`, `/themes/[id]` (граф знаний), `/onboarding/company/step-*` (5-шаговый wizard).
- Z-Admin: `(admin)/admin/meetings` (таблица всех встреч), `(admin)/admin/ai-models` (конфигурация моделей), `(admin)/admin/recordings/expiring` (operational), `/admin/llm-prices` (управление ценами).

**Cross-cutting (не отдельные экраны, но разбираем):**
- AppShell: Sidebar + Header + OrgSwitcher + CommandPalette.
- Settings раздел в целом (15+ под-страниц).
- Empty/Loading/Error state-паттерны.
- Tables-паттерн (используется в десятке экранов).
- Forms-паттерн (settings, admin, wizard).

### 1.2. Эталоны и почему именно они

Выбраны три эталона из категории «data-heavy admin». Альтернативы и почему не их:

| Эталон | Почему берём | Альтернативы и почему отказались |
|---|---|---|
| **Mixpanel** | Product analytics с свежим редизайном навигации 2024–2025 (A/B-тест: +12.4% core flow, +15.9% Create button); сильный visual-language reset (с 2000+ цветов → 10 UI-цветов) | **PostHog** — тоже product analytics + open source, но визуальный язык менее зрелый. Можно добавить как 4-й эталон если по ходу окажется полезно |
| **Amplitude** | Глубокий behavioral analytics; формализованная design-система (Gellix+IBM Plex, Amplitude Blue); явная typography + colors spec для dark mode; «GAS framework» для дашбордов | **Heap** — близко по сценариям, но дизайн менее формализован. **Snowflake** — слишком B2B-сложный, не наш масштаб |
| **Cloudflare Dashboard** | Operational admin для multi-property accounts (близко к нашему «10+ Org в Z-Admin»); опубликована deep-dive статья про dark mode и design tokens; реальная mobile-first ответственность (>20% трафика с мобильных) | **Vercel Dashboard** — красиво, но мало multi-tenant паттернов (один пользователь — один проект). **AWS Console** — overwhelming, антипример. **Auth0 Dashboard** — близко по multi-tenant логике, но визуально устаревший |

**За пределами data-heavy admin** — что НЕ берём как эталон и почему:
- **Linear** — отличный craft, но он про single-team productivity, не про multi-tenant admin. Можно взять отдельные паттерны (CommandPalette, keyboard shortcuts), но не общий язык.
- **Notion** — мягкий, человечный, но это PKM (personal knowledge management), не admin. У нас задача «видеть пульс 10 компаний», не «уютно работать с заметкой».
- **Stripe Dashboard** — образцовый, но это финтех (тонна compliance/security), мы не финтех. Стоит подсматривать таблицы и filtering.
- **Plausible** — минимализм, light-mode-first. Хорошо как референс «можно меньше», но мы dark-first.

### 1.3. Жёсткие ограничения Z (что не сможем «как у Mixpanel»)

Эти ограничения — **рамка, в которой ищем решения**. Они не обсуждаются в этом аудите как варианты — они фиксированы вышестоящими решениями.

| # | Ограничение | Откуда | UI-следствие |
|---|---|---|---|
| C-1 | **Mobile-first ≥360px** | `second-brain/02_architecture/design-system.md` принцип 4 | Все 12 экранов должны быть usable на мобиле; таблицы Mixpanel с 22 колонками — НЕ наш паттерн |
| C-2 | **WCAG AA** | `second-brain/02_architecture/design-system.md` принцип 5 | Контрасты ≥4.5:1 для текста, ≥3:1 для UI-элементов; клавиатурная навигация; aria-label |
| C-3 | **Русский UI без англицизмов** | `second-brain/02_architecture/design-system.md` принцип 2; `second-brain/13_glossary/ui-glossary.md`; feedback memory | Русский в среднем на 15–20% длиннее английского — таблицы должны «дышать»; никаких `Submit`, `Loading`, `AI Chat` |
| C-4 | **«Память, не контроль»** | `second-brain/02_architecture/design-system.md` раздел 8 | Запрещены лидерборды, push о просрочках, «у вас 3 неотвеченных», очки/значки. Это снимает с нас целый класс паттернов Mixpanel/Amplitude (engagement-нудж) |
| C-5 | **Dark-first с mint-акцентом** | `frontend/src/ui/tokens.css` | Mint #5eead4 на тёмном фоне #0a0e14 проверен — 13:1 контраст (AAA). Mint в light-mode #14b8a6 на белом — 2.5:1, **НЕ проходит AA** (см. раздел 4.1) |
| C-6 | **Streaming везде** | `second-brain/02_architecture/design-system.md` принцип 3 | Любой длительный ответ — частями; нужны skeleton/typing-indicator паттерны как first-class |
| C-7 | **Внутренняя кухня скрыта** | `second-brain/02_architecture/design-system.md` принцип 6 | Имена агентов, моделей, токенов — только в «Расширенный режим»; основной UI не показывает «вызван Claude Sonnet, 1.2K токенов» |
| C-8 | **Tone of voice: на «вы», без эмодзи, без восторженности** | `second-brain/02_architecture/design-system.md` принцип 7; `messaging.md` | «Готово» вместо «Успешно создано!»; никаких «Ура, вы молодец!»; конкретность вместо «возможно стоит обратить внимание» |
| C-9 | **One sans-serif шрифт** | Текущий код: Geist Sans + Geist Mono | Несколько шрифтов = ад поддержки; держим один основной + один моноширинный |
| C-10 | **Категория «память компании»** | `second-brain/06_marketing/positioning.md` | UI читается как «memory layer для AI», не «приложение для встреч». Влияет на иерархию информации на главных экранах |

### 1.4. Расширения скопа, которые могут понадобиться

Эти вещи **за рамками 12 экранов**, но обнаружились по ходу. Перечисляю как варианты — не решаем сейчас, но фиксируем.

- **Email-шаблоны** ([backend/src/modules/mail/mail.templates.ts](../../backend/src/modules/mail/mail.templates.ts)) — есть `register-temp-password` и `password-reset`. Будут нужны: `member-invitation`, `meeting-invite`, `report-ready`, `weekly-digest`. Это UI-объект (visual design email), который тоже подчиняется brand-системе.
- **Onboarding flow** (5 шагов wizard'а — уже реализован). Это «экран-flow», не один экран. Можно делать как 13-й экран в скопе либо как cross-cutting в разделе 7.
- **Public meeting pages** `/m/[id]` для гостей — другой UI/UX контекст (не залогинен, гостевой опыт). Влияет на восприятие Z в целом.
- **Auth-страницы** `/login`, `/signup`, `/forgot-password`, `/reset-password` — есть AuthShell, отдельный UX от основного.
- **Landing/home** `/` — first-impression страница для неавторизованных. Полностью другой жанр UI (маркетинг, hero, CTA).

---

## 2. Текущее состояние UI Z (что есть в коде)

Полная инвентаризация — в выводах стрима A. Здесь — компактная сводка как контекст для остальных разделов.

### 2.1. Карта маршрутов (65+)

**Authenticated зона (`/(authenticated)/*`)** — 27 рабочих маршрутов:

```
Дашборды:      /dashboard, /me
Knowledge:     /cards, /cards/[id], /themes, /themes/[id], /goals, /goals/[id],
               /chat, /tasks, /dump
Структура:     /structure, /documents, /documents/[id], /roles, /roles/[id]
Встречи:       /meetings, /meetings/create, /meetings/[id]/result
Coming-soon:   /processes, /regulations, /policies, /metrics   (заглушки γ)
Persons:       /persons, /persons/[id]
Прочее:        /integrations, /invitations/[token]
```

**Settings зона (`/(authenticated)/settings/*`)** — 15 под-страниц:

```
/settings (профиль, табы: profile/security/billing)
/settings/organization, /settings/billing, /settings/tags
/settings/integrations, /settings/api, /settings/webhooks
/settings/sources, /settings/retention, /settings/exports
/settings/admin (4 секции: members, knowledge-core, sources, usage)
```

**Z-Admin зона раздвоена:**

```
/(authenticated)/admin/*  (super_admin внутри основного AppShell)
  /admin, /admin/orgs, /admin/orgs/[id]/billing,
  /admin/usage/users, /admin/usage/functions, /admin/usage/functions/[taskType],
  /admin/experiments, /admin/experiments/[taskType],
  /admin/health, /admin/llm-prices

/(admin)/admin/*  (super_admin отдельный layout, отдельный login)
  /(admin)/admin/login, /(admin)/admin/meetings, /(admin)/admin/meetings/[id],
  /(admin)/admin/ai-models, /(admin)/admin/ai-usage,
  /(admin)/admin/integration-keys, /(admin)/admin/recordings/expiring
```

**Это шов** — два пути для одной роли. Разбираем в разделе 5.1.

**Onboarding (`/(authenticated)/onboarding/*`):** `change-password`, `company/step-1` … `step-5`.

**Public / Share:** `/m/[id]`, `/share/[token]`, `/share/clip/[token]`.

**Auth:** `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`.

### 2.2. AppShell

**Sidebar** ([Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx)) — 248px fixed, dark.

Группировка в 3 секции (уже реализовано):

```
КОМПАНИЯ
  Главная (/dashboard)
  Структура (/structure)
  Документы (/documents)
  Карты должностей (/roles)
  Темы (/themes)             ← gated feature.theme
  Цели и стратегия (/goals)  ← gated feature.goals_strategy
  ▶ Будет в следующей фазе (collapsible)
    Процессы, Регламенты, Политики, Метрики

ОПЕРАТИВКА
  Встречи (/meetings)
  Дамп (/dump)
  Карточки (/cards)
  Задачи (/tasks)
  Помощник компании (/chat)  ← gated feature.chat_org
  Я (/me)

НАСТРОЙКИ
  Шаблоны (/settings/templates)
  Интеграции (/settings/integrations)
  Настройки (/settings)
  ▶ Админка (только owner/admin)
    Админка компании (/settings/admin)
    Z-Admin (/admin)
```

**Состояния пункта:**
1. Обычное — Link с иконкой Lucide.
2. `gateFeature` (тариф) — иконка `Lock`, клик → `/settings/billing`.
3. `comingSoon` (γ-фаза) — иконка `Clock4`, opacity-60, ведёт на preview.

**CTA Sidebar:** «Создать встречу» (`/meetings/create`) с иконкой `Plus`. Доминирует визуально.

**Header** ([Header.tsx](../../frontend/src/ui/components/app-shell/Header.tsx)) — MobileHeader, отрисовывается только на `<md`:
- Логотип Z (left).
- OrgSwitcher (mobile-вариант).
- Бургер → открывает Sidebar в `<Sheet>`.

На desktop Header **скрыт** — Sidebar и так всегда видна. Это **значимая развилка** (см. раздел 5).

**OrgSwitcher** ([OrgSwitcher.tsx](../../frontend/src/ui/components/app-shell/OrgSwitcher.tsx)) — 4 состояния:

| Состояние | Когда | Визуал |
|---|---|---|
| «Режим Z-Admin» | 0 memberships + super_admin | Текст, без dropdown |
| Single Org name | 1 membership | Truncated name + tooltip, без dropdown |
| Dropdown с выбором | 2+ memberships | DropdownMenu со списком + active mark |
| Скрыт | Внутри `/onboarding/company/*` | — |

Использует `ACTIVE_ORG_LS_KEY` для localStorage. Soft-reload через POST `/api/v1/auth/switch-org` + `mutate` SWR-кешей.

**CommandPalette** ([CommandPalette.tsx](../../frontend/src/ui/components/command-palette/CommandPalette.tsx)) — ⌘K/Ctrl+K.

Поиск по: `cards`, `meetings`, `tasks`, `roles`, `departments`, `persons`, `documents`, `themes`. Группировка по типу. Hardcoded список типов.

### 2.3. Design system (tokens, shadcn, шрифты)

**CSS-переменные** ([tokens.css](../../frontend/src/ui/tokens.css)):

```
Dark mode (data-theme="dark"):
  --bg-base:       #0a0e14   (самый тёмный)
  --bg-elevated:   #11161e   (карточки, Sidebar)
  --bg-card:       #161d26   (содержимое Card)
  --bg-overlay:    #1b232e   (hover, overlay)
  --border-subtle: rgba(255,255,255,0.06)
  --border:        rgba(255,255,255,0.10)
  --border-strong: rgba(255,255,255,0.18)
  --text-primary:   #e8eaed
  --text-secondary: #a0a6b0
  --text-tertiary:  #6b7280
  --accent:         #5eead4   (mint, brand)
  --accent-hover:   #7cf2dd
  --accent-muted:   rgba(94,234,212,0.12)
  --accent-fg:      #0a0e14   (текст на mint)
  --success: #4ade80
  --warning: #fbbf24
  --danger:  #f87171
  --info:    #60a5fa

Light mode (data-theme="light"):
  --bg-base:    #ffffff
  --bg-elevated: #f8fafb
  --accent:    #14b8a6   ⚠ КОНТРАСТ 2.5:1 НА БЕЛОМ — НЕ ПРОХОДИТ WCAG AA (см. 4.1)

Общие:
  Radius:    xs(4) sm(6) md(10) lg(16) xl(24) 2xl(32)
  Spacing:   1..16 (4 8 12 16 20 24 32 40 48 64) — почти 4px grid, но 20px ломает ритм
  Fonts:     Geist Sans (UI), Geist Mono (код)
  Sizes:     xs(12) sm(13) base(14) md(15) lg(17) xl(20) 2xl(24) 3xl(32) 4xl(48)
  Header h:  64px
  Sidebar w: 248px / collapsed 64px
```

**Анимации:** `shimmer` (1.5s, skeleton), `pulse-mint` (2.4s, attention), `fade-in` (240ms), `slide-up` (240ms).

**Shadcn-компоненты в [frontend/src/ui/shadcn/](../../frontend/src/ui/shadcn/) (23 шт):**

```
Button, Input, Textarea, Label, Dialog, DropdownMenu, Select, Tabs,
Tooltip, Avatar, Badge, Card, Separator, Sheet, Command, ScrollArea,
Popover, Switch, Checkbox, Progress, Skeleton, Toast (через контекст)
```

### 2.4. Дашборды (что показывают сейчас)

**Director Dashboard** ([DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx)) для owner/admin — **10 виджетов**:

1. IntroWizardWidget — виджет ознакомления.
2. AI-сводка за период (`narrativeSummary`).
3. StructureSummaryWidget.
4. WhatLearnedWidget (новые темы + сигналы, 2-col).
5. SignalCountersWidget (горизонтальные полосы).
6. ActiveThemesWidget (растущие темы).
7. HotEntitiesWidget (главные сущности).
8. OpenQuestionsWidget (открытые вопросы).
9. StrategicAlignmentWidget (резерв на Фаза 9).
10. OrgChatPanel (cross-meeting AI-чат).

Период: неделя/месяц. Кнопка «Обновить» с `Loader2` spin.

**Это перегруз** (см. раздел 5.2). Эталон Mixpanel/Amplitude — 4–6 виджетов на главном дашборде, остальное — drill-down.

**Admin Dashboard** ([AdminDashboardClient.tsx](../../frontend/app/(authenticated)/admin/AdminDashboardClient.tsx)) для super_admin — **4 KPI tiles**: Расход, Встречи, Юзеры, Функции. Фильтр период. Skeleton, EmptyState, ErrorState. Прозрачнее и компактнее, чем Director Dashboard.

### 2.5. 12 design-system гэпов (вход для аудита)

Обнаружены стримом A. Это **актуальные точки боли**:

| # | Гэп | Где |
|---|---|---|
| G-1 | Несогласованность EmptyState: один light (bg-white, border-slate), другой dark (fg-tertiary) | `shared/EmptyState.tsx` vs `EmptyHint` в DirectorDashboard |
| G-2 | Три разных стиля loading-индикаторов | `Loader2` в кнопках, `RefreshCcw` в Dashboard, AdminLoading с Skeleton |
| G-3 | Нет единого `LoadingButton` / `SkeletonWrapper` | submitting-флаги вручную в каждом компоненте |
| G-4 | Нет ErrorBoundary на уровне приложения | Нет `error.tsx` в `app/` — рендер-ошибка падает на пользователя |
| G-5 | Две версии Skeleton-компонента | shadcn/skeleton (новый) vs shared/Skeleton (старый), нужна миграция |
| G-6 | OrgSwitcher с 4 состояниями + localStorage fallback | Сложно поддерживать, легко сломать |
| G-7 | CommandPalette с hardcoded списком типов | Новая сущность → правка `CommandPalette.tsx` |
| G-8 | Coming-soon страницы есть, но preview-компонент не унифицирован | Каждая γ-страница может рендериться по-разному |
| G-9 | AdminPagePermissionGate только клиент-сайд | HTML может скачаться в devtools — потенциальный leak |
| G-10 | `/meetings` master-detail без явного «выберите встречу слева» state | Пустое правое поле без подсказки |
| G-11 | Inconsistent loading в кнопках | `Loader2` в одних, без spinner в других, RefreshCcw в Dashboard |
| G-12 | Дизайн preview-страницы `(design-preview)/*` не в навигации | Существуют, но непонятно зачем |

Эти 12 пунктов войдут в action items (раздел 8) и cross-cutting улучшения (раздел 7).

### 2.6. Архитектурные швы

Два **шва**, на которые нужно отдельное решение в разделе 5.

**Шов 1:** `(authenticated)/admin/*` vs `(admin)/admin/*` — две Z-Admin зоны для одной роли. Разные layout, разный login (через `(admin)/admin/login`), разные шапки, разный UX. Разбираем в 5.1.

**Шов 2:** `/settings/admin/*` vs `/(authenticated)/admin/*` — Org-Admin и Z-Admin **физически рядом в Sidebar** («Админка Org» + «Z-Admin» в подгруппе «Админка»), но это **два разных кабинета**:
- Org-Admin (`/settings/admin/*`) — для owner/admin **внутри своей Org** (members, knowledge-core, sources, usage внутри Org).
- Z-Admin (`/admin/*`) — для super_admin **над всеми Org** (orgs list, cross-Org billing, experiments, health).

Разбираем в 5.6 — нужна более ясная визуальная и навигационная сепарация.

---

## 3. Эталоны: что взяли, что отвергли, что под вопросом

Синтез стрима C. Для каждого эталона — 3 списка: «брать», «отвергать», «под вопросом». В конце — кросс-эталонные универсалии.

### 3.1. Mixpanel

#### 3.1.1. Что брать (10 паттернов)

| # | Паттерн | Источник | Применение в Z |
|---|---|---|---|
| M-1 | **Консолидированная sidebar-навигация с категоризацией** (top-bar убрали) | [Mixpanel Navigation Experiment](https://mixpanel.com/blog/navigation-experiment-results/) | Уже сделано: Sidebar в 3 группы. Можно дополнительно ввести **визуальные secondary-категории** внутри групп (как Mixpanel ввёл «Reports / Experimentation») |
| M-2 | **Split View / Table Focus / Chart Focus** — 3 кнопки переключения площади графика и таблицы | [Mixpanel Reorient View](https://docs.mixpanel.com/changelogs/2022-07-08-reorient) | Применимо для `/admin/orgs` (toggle table-view ↔ card-view) и для `/dashboard` (виджеты ↔ табличный режим) |
| M-3 | **Query builder на правой панели**, не на левой; раньше конкурировал с навигацией | Mixpanel Changelog | Применимо для `/admin/orgs` — фильтры в sticky right-panel; для `/meetings` — фильтры справа, master-list по центру |
| M-4 | **CTA-кнопка с цветом + иконкой + caret** — A/B показал +15.91% CTR | Mixpanel Navigation Experiment | Применимо для CTA «Создать встречу» в Sidebar Z: mint accent + Plus icon + опционально caret для dropdown типов встреч |
| M-5 | **Сепарация фич, которые ищут отдельно** (объединение Experiments+Feature Flags дало −70% discoverability) | Mixpanel Navigation Experiment | Применимо для `/settings/admin/*` — НЕ объединять Members, Knowledge-Core, Sources, Usage в один пункт «Админка» с табами; держать раздельно в навигации |
| M-6 | **Минимальная палитра** (10 UI-цветов вместо 2000+) | [Mixpanel Design System](https://designsystems.surf/design-systems/mixpanel) | У Z пока чисто: tokens.css содержит ~15 семантических цветов. Главное — **не плодить** ad-hoc hex'ы в компонентах |
| M-7 | **2-цветная type-система** (primary + muted secondary), не больше 3 размеров на экране | DesignShots Mixpanel | Применимо везде. Сейчас в Z доступно 9 размеров (xs..4xl), используются часто 4 — это нормально, но нужен явный гайд «на одном экране ≤3 размера» |
| M-8 | **Session Replay views ↑45% просто от лучшей discoverability** | Mixpanel Blog | Лессон для Z: когда запустим новый раздел (например, «Помощник компании»), правильное место в Sidebar даст естественный трафик без рекламы |
| M-9 | **Boards** — пользователь собирает несколько reports в один view | [Mixpanel Boards](https://docs.mixpanel.com/docs/boards/overview) | Применимо в Фазе γ для Org-кабинета — кастомные дашборды. В Фазе 0 — нет |
| M-10 | **Persistent navigation + keyboard shortcut** (`` ` `` — сворачивание sidebar) | [Mixpanel Persistent Navigation](https://help.mixpanel.com/changelogs/2024-06-18-persistent-navigation) | Применимо: Sidebar Z можно сворачивать клавиатурой (например, `\` или `[`); сейчас collapse по hover/mouse — нужен keyboard equivalent |

#### 3.1.2. Что отвергнуть (3 паттерна)

| # | Паттерн | Почему НЕ для Z |
|---|---|---|
| M-X1 | **22-колонные dense таблицы без мобильной адаптации** | C-1 (mobile-first ≥360px) + C-3 (русский на 15-20% длиннее). Нужны: progressive disclosure, frozen first column, или альтернативный card-view на мобиле |
| M-X2 | **Single-account model** (нет multi-tenant org-switcher) | У Z 10+ Org в Z-Admin, у клиента-консультанта — 2+ Org. Mixpanel-подход не работает |
| M-X3 | **Query builder UI для non-technical users** | Z-клиенты — не data-аналитики. UI должен быть simple-first с опцией продвинутых фильтров, не наоборот. Mixpanel query builder требует обучения, у нас нет такой роскоши |

#### 3.1.3. Под вопросом (2 паттерна)

| # | Паттерн | Что обсудить |
|---|---|---|
| M-?1 | **Side panel для query builder vs modal** | На desktop ≥1024px panel хорош. На планшете 768–1024px — занимает много места. Решение: panel на ≥1024, modal на меньше. Зафиксировать как responsive-rule в дизайн-системе |
| M-?2 | **1.5% opt-out даже без negative feedback** | Mixpanel получили 0 жалоб после редизайна, но 1.5% пользователей снизили активность. Урок для Z: при редизайне Sidebar — нужна beta-фаза с opt-in (или сохранение классического вида как опция в первые 2 недели) |

### 3.2. Amplitude

#### 3.2.1. Что брать (9 паттернов)

| # | Паттерн | Источник | Применение в Z |
|---|---|---|---|
| A-1 | **Двух-уровневая типографика** (display + body) | [Amplitude Typography](https://brand.amplitude.com/visual-direction/typography) | У Z сейчас один шрифт Geist Sans для всего. Вариант: добавить display-шрифт для заголовков H1/H2 (например, Manrope или сохранить Geist для всего как минимализм). Tradeoff: больше шрифтов = больше веса JS-bundle, но визуальный отрыв заголовков |
| A-2 | **Specifically defined hex для dark backgrounds** (Amplitude Blue имеет другой код на чёрном) | Amplitude Typography | **Применимо критично**: см. 4.1 — light-mode mint #14b8a6 не проходит AA. Нужны отдельные mint-shades для light и dark, не один |
| A-3 | **Two-column settings layout**: левый sidebar категорий + правая широкая область с формами | [Amplitude Navigation Redesign](https://amplitude.com/blog/redesigning-navigation-and-ux) | Применимо для `/settings/*` Z — на скриншоте, который пользователь прислал, уже видно: левая колонка категорий + правая область. Этот паттерн закрепить как стандарт settings |
| A-4 | **GAS framework для дашбордов**: Governed, Actionable, Storytelling | [Amplitude Dashboard Templates](https://academy.amplitude.com/dashboard-templates) | Применимо для всех 4 дашбордов (Director, Admin, /me, /admin/orgs). Каждый виджет должен: (1) иметь чёткий owner/audience (Governed), (2) иметь action — «View details», «Take action» (Actionable), (3) иметь заголовок-объяснение, почему виджет важен (Storytelling) |
| A-5 | **Кросс-проектные charts на одном дашборде** | [Amplitude Dashboard Creation](https://amplitude.com/docs/analytics/dashboard-create) | Применимо для Z-Admin — сравнить spend двух Org бок-о-бок на одном виджете |
| A-6 | **«Updated 1 hour ago» подпись под метриками** | Amplitude Dashboard Features | Применимо везде. Сейчас в Z виджеты не показывают свежесть данных — пользователь не знает, кешированы они или real-time. Critical для billing/usage |
| A-7 | **3 действия с дашбордами по умолчанию**: Copy, Download (CSV), Export (PDF/PNG) | Amplitude Dashboard Menu | Применимо для `/admin/usage/functions` и `/admin/orgs/[id]/billing` — экспорт CSV. PDF/PNG для отчётности |
| A-8 | **Лучшая навигация → +200% usage feature** | [Amplitude Blog Redesigning](https://amplitude.com/blog/redesigning-navigation-and-ux) | Лессон такой же, как M-8 от Mixpanel: place matters больше polish |
| A-9 | **Two-color type system** (primary text + muted secondary) | Amplitude Brand | У Z сейчас 3 (`--text-primary`, `--text-secondary`, `--text-tertiary`) — это норма. Главное — не плодить ad-hoc gray values |

#### 3.2.2. Что отвергнуть (4 паттерна)

| # | Паттерн | Почему НЕ для Z |
|---|---|---|
| A-X1 | **Мощный query builder для аналитиков** | C-3, C-8 — наша аудитория не аналитики |
| A-X2 | **Отсутствие mobile-first в публичных examples** | C-1 mobile-first ≥360px |
| A-X3 | **Дизайн-система не публичная (с 2023)** | Нельзя скопировать токены напрямую — строим своё |
| A-X4 | **Жёсткая grid 2-2-2 (multiples of two)** | У Z 4px base — гибче и стандартнее |

#### 3.2.3. Под вопросом (2 паттерна)

| # | Паттерн | Что обсудить |
|---|---|---|
| A-?1 | **Раскрытие backend-архитектуры как selling point** (Amplitude хвалится Nova database) | C-7 — внутренняя кухня скрыта. Мы не должны хвастаться «у нас Apache AGE». Но в Z-Admin для super_admin — можно показывать (это его аудитория) |
| A-?2 | **Video-widgets в дашбордах** (Loom, Vimeo) | Для Org-кабинета может быть nice-to-have (записи встреч → виджет «последние записи»). Для Z-Admin — избыточно. Решить per-screen в разделе 6 |

### 3.3. Cloudflare Dashboard

#### 3.3.1. Что брать (11 паттернов)

| # | Паттерн | Источник | Применение в Z |
|---|---|---|---|
| CF-1 | **Account Switcher вверху sidebar с поиском + сортировкой по статусу** | [Cloudflare Zero Trust Navigation](https://blog.cloudflare.com/zero-trust-navigation/) | Применимо критично для Z-Admin: org-switcher с поиском и фильтрами (active/trial/inactive). Сейчас в Z OrgSwitcher без поиска |
| CF-2 | **App Dock метафора** (top-of-page application launcher) | [Cloudflare New Control Panel](https://blog.cloudflare.com/cloudflares-new-control-panel/) | **Под вопросом для Z**: на mobile-first 360px нет места для top-dock. Альтернатива — Sidebar с большими иконками для секций (как сейчас) |
| CF-3 | **Responsive вплоть до мобилей** (pinch-zoom-free на <600px; >20% трафика с мобильных) | [Cloudflare Dashboard Redesign](https://blog.cloudflare.com/redesigning-cloudflare/) | C-1: критично. Это бенчмарк, к которому стремимся. Mixpanel/Amplitude — НЕ бенчмарк для мобильности |
| CF-4 | **7 типов чартов**: Timeseries, Bar, Donut, Map, Stat, Percentage, Top N | [Cloudflare Dashboards](https://developers.cloudflare.com/analytics/dashboards/) | Для Z достаточно **5**: line (trends), bar (comparisons), stat-card (KPI), table (details), gauge (percentage). Map и Donut добавляем при clear demand |
| CF-5 | **Dashboard-level фильтры** (применяются ко всем чартам сразу) | [Cloudflare Custom Dashboards](https://developers.cloudflare.com/analytics/dashboards/) | Применимо для Director Dashboard и Admin Dashboard: один picker «Период» вверху → все виджеты обновляются |
| CF-6 | **Drill-down из chart в Log Search** через контекстное меню | [Cloudflare Log Explorer](https://developers.cloudflare.com/log-explorer/custom-dashboards/) | Применимо: из виджета «Top LLM функций» → drill-down в `/admin/usage/functions` с pre-filled фильтрами |
| CF-7 | **Off-black для dark backgrounds** (#1D1D1D, не #000000) — less harsh | [Cloudflare Dark Mode](https://blog.cloudflare.com/dark-mode/) | У Z `--bg-base: #0a0e14` — это уже off-black, хорошо. Но: shadcn-компоненты могут использовать `bg-background` без custom value — проверить |
| CF-8 | **10-hue × 10-luminosity цветовая шкала**: первые 5 ступеней контрастны с белым текстом, последние 5 — с чёрным | Cloudflare Dark Mode Deep Dive | **Это серьёзная архитектура цвета**, у Z такой системы нет. Tradeoff: построить с нуля = неделя работы. Альтернатива — оставить семантические токены (как сейчас) и расширять по необходимости |
| CF-9 | **Outline иконки в dark mode** (solid слишком интенсивны) | [Cloudflare Design System](https://developers.cloudflare.com/realtime/realtimekit/ui-kit/branding/design-system/) | Применимо. Lucide иконки в Z по умолчанию stroke-style — это уже outline. Главное — НЕ переходить на solid для не-active state |
| CF-10 | **Модульная архитектура layouts**: модуль может комбинировать controls + data table + form, но компоненты общие | Cloudflare Dashboard Redesign | Применимо для Z `/settings/admin/*` — каждая под-секция (Members, Knowledge-Core, Sources, Usage) использует один и тот же `<AdminSection>` shell |
| CF-11 | **4px base spacing scale** (4 8 12 16 20 24 32 40 48 56 64 72 80 88 96) | [RealtimeKit Design System](https://developers.cloudflare.com/realtime/realtimekit/ui-kit/branding/design-system/) | У Z **почти 4px**: 4 8 12 16 20 24 32 40 48 64 — отсутствуют 56, 72, 80, 88, 96. Расширить шкалу для согласованности больших отступов |

#### 3.3.2. Что отвергнуть (3 паттерна)

| # | Паттерн | Почему НЕ для Z |
|---|---|---|
| CF-X1 | **App Dock сверху** | C-1 mobile-first — занимает горизонтальный pixel-budget |
| CF-X2 | **Map и Percentage chart-типы** | Не наш scope (география не нужна; percentage redundant с stat-card) |
| CF-X3 | **Natural Language dashboard creation** (AI-generated dashboard) | Premature optimization для MVP — добавим в γ+ |

#### 3.3.3. Под вопросом (2 паттерна)

| # | Паттерн | Что обсудить |
|---|---|---|
| CF-?1 | **Mobile-first как первоклассный gate** | Cloudflare потратил месяцы на mobile parity. Z может пойти **поэтапно**: viewer-only mobile в Фазе 0, full editing на мобиле в Фазе γ. Решение нужно зафиксировать |
| CF-?2 | **Security Overview-стиль aggregated dashboard** (миллионы инсайтов → top actionable items) | Аналог в Z — «Org Health Overview» (10+ Org с алертами по spend/usage/errors). Полезно, но overkill для MVP — γ |

### 3.4. Кросс-эталонные универсалии (5 паттернов)

Что верно для **всех трёх** эталонов и любого data-heavy admin SaaS:

| # | Паттерн | Z-applicability |
|---|---|---|
| U-1 | **Двухуровневая навигация**: Sidebar (1) + Breadcrumbs/Tabs (2) | Sidebar (Компания/Оперативка/Настройки) ✓ + **breadcrumbs не реализованы в Z** → добавить в action items |
| U-2 | **Фильтры в одном из трёх мест**: top bar / sidebar / right panel | Z пока без single-place pattern — каждый экран изобретает. Зафиксировать standard: **top-right filter button → right-panel slide-out (desktop) / modal (mobile)** |
| U-3 | **Плотность строк таблиц**: 40px compact / 48px default / 56px relaxed; sticky headers; sortable | Сейчас в Z разные плотности. Зафиксировать **48px default**, с переключателем |
| U-4 | **Dark mode — first-class**, не afterthought | Z уже dark-first ✓. Но light-mode нужно дотюнить (см. 4.1) |
| U-5 | **Progressive disclosure**: дефолт простой, advanced — по запросу | Применимо везде. Например, на `/admin/orgs` дефолтная таблица — 5 колонок, expandable row для деталей; полная таблица — через filter «расширенный вид» |

### 3.5. Сводная таблица «уже принятых эталонами» технических решений

Если эти решения мы кодируем — у нас гарантированно «как у больших».

| Параметр | Значение | Источник consensus'а |
|---|---|---|
| Sidebar width (desktop) | 240–248px | Mixpanel 240, Amplitude 240, Cloudflare 248, Z **248** ✓ |
| Sidebar width (collapsed) | 56–64px | Industry standard, Z **64** ✓ |
| Mobile breakpoint | hamburger при <768px | Cloudflare 768, Mixpanel 1024, **выбор для Z: 768** (баланс с C-1) |
| Table row height default | 48px | Все три, Z пока разное |
| Table row height compact | 40px | Mixpanel 40, Cloudflare 40 |
| Table row height relaxed | 56px | Cloudflare 56, Amplitude 56 |
| Off-black bg | #0f0f0f – #1a1a1a | Cloudflare #1D1D1D, Vercel #0a0a0a, Z **#0a0e14** ✓ |
| Spacing base | 4px | Cloudflare ✓, Mixpanel ✓, Amplitude (но multiples of 2 — тоже совместимо), Z **4** ✓ |
| Spacing scale | 4 8 12 16 20 24 32 40 48 56 64 72 80 88 96 | Cloudflare, Z **частично** (нет 56, 72, 80, 88, 96) — расширить |
| Font weights | Regular + Medium + SemiBold (+Bold для display) | Все три, Z **Geist все веса доступны** ✓ |
| Font size on body | 13–14px | Mixpanel 13, Amplitude 14, Cloudflare 14, Z **14** ✓ |
| Header heights | 56–72px | Cloudflare 64, Z **64** ✓ |
| Border radius default | 4–8px | Mixpanel 4, Amplitude 4, Cloudflare 6, Z `sm 6 / md 10` ✓ |
| Animation duration | 150–300ms | Mixpanel 200ms, Z `240ms` ✓ |
| Icon stroke width (Lucide) | 1.5 или 2px | Lucide default 2, Cloudflare 1.5, Z default **2** ✓ |
| Chart types | 4–7 | Cloudflare 7, Amplitude 5–6, Mixpanel 5–6, **Z: 5** (line/bar/stat/table/gauge) |
| Primary CTA | colored + icon + opt. caret | Mixpanel A/B-проверено, Z **есть** (mint + Plus icon) ✓ |
| Multi-tenant switcher | top-of-sidebar dropdown с поиском | Cloudflare, Z **есть OrgSwitcher, поиска нет** — добавить |

**Где Z уже совпадает с consensus'ом:** 11 из 17. **Где надо корректировать:** spacing scale (расширить до 96), Mobile breakpoint (зафиксировать 768), OrgSwitcher с поиском, единая table row height policy, mobile-first как gate.

---

## 4. Design language Z

Здесь — синтез: что выбираем из 30 паттернов эталонов, как это ложится на токены Z, какие альтернативы рассматриваем для каждого решения.

### 4.1. Цвет: критический фикс light-mode mint

**Проблема (Priority 0 finding):**

Расчёт WCAG-контраста для текущих токенов:

| Цвет | Фон | Ratio | WCAG verdict |
|---|---|---|---|
| `--accent: #5eead4` (dark mode) | `--bg-base: #0a0e14` | **13.07 : 1** | ✅ AAA (≥7:1) — превосходно |
| `--accent: #14b8a6` (light mode) | `--bg-base: #ffffff` | **2.46 : 1** | ❌ Fails AA (<4.5:1 для текста, <3:1 для UI) |

Mint #14b8a6 в light mode **нельзя использовать**:
- как цвет текста (например, в ссылках или кнопках-link) — провалит AA;
- как обводку UI-элемента (focus ring, border button) — провалит AA для non-text contrast (3:1);
- как цвет иконки — провалит non-text contrast.

**Варианты фикса (для будущего ТЗ):**

| Вариант | Hex | Контраст на #fff | Минусы |
|---|---|---|---|
| **A — Teal-700** (Tailwind) | `#0f766e` | 6.07 : 1 ✅ AA | Заметно темнее, может казаться «не таким живым» |
| **B — Teal-800** (Tailwind) | `#115e59` | 8.36 : 1 ✅ AAA | Тёмный, более «академичный» вид |
| **C — Mint #14b8a6 + текст всегда поверх tinted background** | `#14b8a6` поверх `#f0fdfa` (mint-50) | 2.46 не используется как text | Усложняет компоненты — нельзя использовать mint просто как color |
| **D — Двухслойный токен**: `--accent` (mint vibrant) для backgrounds, `--accent-text` (darker mint) для текста | `--accent: #14b8a6`, `--accent-text: #0f766e` | Каждое использование — выбор слоя | Дополнительный токен в системе, дисциплина для разработчиков |
| **E — Заменить mint в light на ту же яркость, что dark** | `#5eead4` в light | 1.5 : 1 на #fff (хуже!) | Не решает проблему |

**Рекомендация для ТЗ (предварительно):** вариант **D** (двухслойный токен) — наиболее гибко, не требует менять brand-цвет. Альтернатива — **A** (теmnee mint) как fallback, если D воспримется как «над-инженерия».

#### 4.1.2. Палитра в целом — выбор и tradeoffs

| Слой | Цвет dark | Цвет light | Назначение | Альтернатива |
|---|---|---|---|---|
| **Brand mint** | `#5eead4` | `#0f766e` (D из 4.1) | accent, CTA, links, focus | Можно перейти на teal вместо mint целиком — но это рестарт brand-identity |
| **Background base** | `#0a0e14` | `#ffffff` | Самый дальний слой | Off-black `#0f0f0f` (более стандартный) |
| **Background elevated** | `#11161e` | `#f8fafb` | Sidebar, top nav | — |
| **Background card** | `#161d26` | `#ffffff` | Карточки, диалоги | — |
| **Background overlay** | `#1b232e` | `#f1f5f9` | Hover, dropdown | — |
| **Text primary** | `#e8eaed` | `#0f172a` | Основной текст | — |
| **Text secondary** | `#a0a6b0` | `#475569` | Подписи | — |
| **Text tertiary** | `#6b7280` | `#94a3b8` | Disabled, hints | — |
| **Border subtle** | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)` | Разделители | — |
| **Border** | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.10)` | Карточки | — |
| **Border strong** | `rgba(255,255,255,0.18)` | `rgba(0,0,0,0.16)` | Inputs | — |
| **Success** | `#4ade80` | `#16a34a` (darker для AA) | Confirmations | — |
| **Warning** | `#fbbf24` | `#d97706` (darker для AA) | Attention | — |
| **Danger** | `#f87171` | `#dc2626` (darker для AA) | Errors | — |
| **Info** | `#60a5fa` | `#2563eb` (darker для AA) | Hints, neutral status | — |

**Принцип** (взято у Cloudflare CF-8): для light-mode большинство акцентных и semantic-цветов берутся на 200 ступеней темнее, чем для dark. Это **гарантирует контраст с light bg** и **симметрию** между двумя темами.

#### 4.1.3. Data-viz палитра

Для 5 типов чартов (line / bar / stat / table / gauge) нужна **палитра серий**. Mixpanel снизили с 2105 цветов до 10 UI + rainbow для виза. Cloudflare использует системные цвета для базовых + palette для категорий.

**Вариант для Z (8-цветная palette серий — для бэровских и линейных графиков):**

```
Series 1: #5eead4 (mint, brand) — наша «нить»
Series 2: #60a5fa (info blue)
Series 3: #c084fc (violet) — нейтральный второстепенный
Series 4: #fbbf24 (warning amber) — для контраста
Series 5: #f472b6 (pink) — для категорий
Series 6: #34d399 (emerald) — для positive trends
Series 7: #94a3b8 (slate) — для baseline / "other"
Series 8: #fb923c (orange) — pop accent
```

Tradeoff: 8 цветов — потолок воспринимаемости человека. Для серий >8 — переходить на pattern fills или labels.

**Альтернатива:** взять одну из готовых color-blind-safe палитр (например, Carbon, Tableau 10) — проще, проверено. Минус: меньше «нашего» вайба.

#### 4.1.4. Status colors усиления

| Использование | Dark | Light | Tip |
|---|---|---|---|
| Success badge (tag) | bg: `rgba(74,222,128,0.15)`, text: `#4ade80`, border: `rgba(74,222,128,0.3)` | bg: `#dcfce7`, text: `#16a34a`, border: `#86efac` | Везде в Z status-индикаторы должны иметь bg+text+border для надёжной видимости |
| Warning | то же с warning hex | то же | — |
| Danger | то же с danger hex | то же | — |
| Info / Neutral | то же с info hex | то же | — |

### 4.2. Типографика

**Выбор шрифтов — текущий код:** Geist Sans + Geist Mono. Это **хороший выбор для data-heavy admin** (нейтральный, отличная Cyrillic-поддержка, оптимизирован для UI).

**Варианты для ТЗ (если решим менять):**

| Вариант | Body | Display (H1/H2) | Mono | Tradeoff |
|---|---|---|---|---|
| **A — текущий** | Geist Sans | Geist Sans (heavier weight) | Geist Mono | Один шрифт = меньше bundle, но менее выразительные заголовки |
| **B — Amplitude-style** | IBM Plex Sans | Manrope / Gellix | IBM Plex Mono | Чёткое разделение body/display, но 2 шрифта |
| **C — Vercel-style** | Inter | Inter (weight) | JetBrains Mono | Очень стандартно, скучно для бренда |
| **D — Modern serif для display** | Geist Sans | Inter (Tight) или Editorial-стиль (например, Söhne) | Geist Mono | Сильный визуальный отрыв заголовков, но 2 шрифта; Cyrillic в serif редко хорош |
| **E — System-only** | system-ui / -apple-system | system-ui (weight) | ui-monospace | Нулевой bundle, но утрачивается brand identity |

**Рекомендация (предварительно):** вариант **A** — оставить Geist Sans для всего, использовать вес и размер для иерархии. Это уже в коде, working, никаких изменений.

**Шкала размеров (текущая):**

```
xs   12px  — captions, hints
sm   13px  — secondary text
base 14px  — body, table rows
md   15px  — tabbed labels, inputs
lg   17px  — section labels
xl   20px  — H3, card titles
2xl  24px  — H2
3xl  32px  — H1
4xl  48px  — hero
```

**Правило (по M-7 Mixpanel):** на одном экране ≤3 размера. Например, H1/H2 + body + caption. Если нужно H3 — это сигнал, что страница делится на под-страницы или табы.

**Веса — gist:**

```
400 Regular   — body, table content
500 Medium    — emphasis, labels
600 SemiBold  — headings H1–H3, buttons
700 Bold      — only display/marketing
```

### 4.3. Spacing: 4px grid

**Текущая шкала Z** (в `tokens.css`):
```
4 8 12 16 20 24 32 40 48 64
```

**Cloudflare-style (расширение):**
```
4 8 12 16 20 24 32 40 48 56 64 72 80 88 96 128
```

**Рекомендация:** расширить шкалу. 56px, 72px, 80px нужны для card-padding и section-gap. 96–128 — для больших разделов на широких экранах.

**Правило применения:**
- Inline padding (внутри small components, badge, input): 4–12px.
- Card padding: 16–24px.
- Section gap (между виджетами): 24–32px.
- Page padding (от края viewport): 16px mobile / 24px tablet / 40px desktop.
- Hero spacing (большие группы): 48–96px.

### 4.4. Density и плотность таблиц

**Три режима (U-3):**

| Режим | Row height | Где default |
|---|---|---|
| Compact | 40px | Power-user views (`/admin/usage/functions` с сотнями строк) |
| Default | 48px | Большинство таблиц (`/admin/orgs`, `/meetings`) |
| Relaxed | 56px | Mobile, или таблицы с большим количеством мета (avatar + 2-line text) |

**Переключатель плотности** (опционально для V-1.0):

Кнопка в правом верхнем углу таблицы: иконки `Rows-3` / `Rows-2` / `Rows-1` (Lucide). Сохраняется в `localStorage` per-user.

**Альтернатива:** не делать переключатель, фиксировать одну плотность per-table. Меньше работы, меньше choice paralysis у пользователя. Tradeoff: power-users без compact будут раздражены.

### 4.5. Иконки

**Текущий выбор:** Lucide React — уже используется во всех новых компонентах.

**Варианты для ТЗ:**

| Библиотека | Иконок | Стиль | Bundle | Cyrillic-friendly | Tradeoff |
|---|---|---|---|---|---|
| **Lucide** (текущая) | 1500+ | Stroke 1.5/2px | Tree-shakeable | N/A | ✅ Современная, активная, стандарт |
| **Heroicons** | 292 | Outline + solid pairs | Tree-shakeable | N/A | Меньше иконок, но Tailwind-team-made — premium feel |
| **Phosphor** | 7000+ × 6 weights | Thin / Light / Regular / Bold / Fill / Duotone | Большой, но tree-shakeable | N/A | Очень богатая, но 6 вариантов — paralysis |
| **Tabler Icons** | 4500+ | Stroke 1.5/2px (как Lucide) | Tree-shakeable | N/A | Альтернатива Lucide, чуть менее polished |

**Рекомендация:** оставить **Lucide** — уже в коде, экосистема ок.

**Правило (CF-9):** в dark mode — иконки stroke (outline). Solid (fill) — только для **active** state индикаторов (например, selected tab → solid icon).

**Размеры:**
- 14px (inline в тексте).
- 16px (default в кнопках, навигации).
- 20px (заголовки секций).
- 24px (hero, empty state).

### 4.6. Motion (анимации)

**Текущая база Z** (tokens.css):
- `shimmer` (1.5s, skeleton) — хорошо.
- `pulse-mint` (2.4s, attention) — для виджетов «новое».
- `fade-in` (240ms) — для контента.
- `slide-up` (240ms) — для popover / sheet.

**Дополнения по эталонам:**

| Use case | Duration | Easing |
|---|---|---|
| Hover state | 150ms | `ease-out` |
| Button press | 100ms | `ease-in` |
| Modal open | 200ms | `cubic-bezier(0.16, 1, 0.3, 1)` (spring-like) |
| Sidebar collapse/expand | 250ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Toast in/out | 300ms in / 200ms out | `ease-out / ease-in` |
| Page transition (Next.js) | НЕТ | Никаких page-level animations — слишком навязчиво для admin |
| Loading skeleton shimmer | 1.5s (loop) | `linear` |
| Data refresh pulse | один раз 800ms | `ease-in-out` |

**Принципы:**
- **Никакой `prefers-reduced-motion`-blind анимации** — все длинные animations должны уважать `@media (prefers-reduced-motion: reduce)`.
- **Микровзаимодействия — да** (hover, focus). **Page-level — нет** (раздражает в admin).
- **Loading — обязательно** (skeleton, не spinner для блочного контента; spinner только для inline actions).

### 4.7. Empty / Loading / Error states

См. также гэпы G-1, G-2, G-3, G-5 (несогласованность). Это **наиболее болезненный** дефицит у Z.

**Empty state — единый компонент `<EmptyState>`:**

Контракт:
```
<EmptyState
  icon={IconComponent}        // Lucide иконка, 32–48px
  title="Заголовок"            // короткая фраза
  description="Описание"       // 1-2 строки
  action={<Button>...</Button>}// опциональное CTA
  tone="default | hint | accent" // визуальная подача
/>
```

Варианты применения:
- **default** — серый фон, серый текст: для «список пуст».
- **hint** — accent border, accent muted text: для «первый раз тут, попробуйте».
- **accent** — mint accent для «всё хорошо, ничего не требует действия».

**Loading state — три уровня:**

1. **Skeleton** (`<Skeleton>` + shimmer) — для блочного контента (карточки, ряды таблицы). Унифицировать на shadcn/skeleton, мигрировать `shared/Skeleton`.
2. **Inline spinner** (`<Loader2 className="animate-spin">`) — для action buttons («Сохраняется…»).
3. **Optimistic** — UI обновляется сразу, ошибки откатывают. Применимо для тоглов, лайков, статусов.

**Единый `<LoadingButton>`:**
```
<LoadingButton loading={submitting} loadingText="Сохраняем…">
  Сохранить
</LoadingButton>
```

**Error state — четыре уровня:**

1. **Inline error** (под input): `text-danger text-sm` с описанием.
2. **Form error banner** (вверху формы): красная карточка с иконкой `AlertTriangle`.
3. **Page-level error** (не загрузился весь экран): полная страница с illustration, кнопкой «Попробовать снова».
4. **App-level boundary** (`error.tsx` в app/): для catastrophic errors. **СЕЙЧАС ОТСУТСТВУЕТ** в Z (G-4).

**Тон сообщений (C-8):**
- ❌ «Ой! Что-то пошло не так 🙈»
- ✅ «Не удалось загрузить. Попробуйте обновить страницу.»
- ❌ «Успешно сохранено!»
- ✅ «Сохранено.» (или просто toast без текста — checkmark)

### 4.8. «Память, не контроль» — UI-следствия (C-4)

Этот принцип серьёзно ограничивает то, что можно сделать в дашбордах. Перечисляю **запрещённые** паттерны и **рекомендуемые альтернативы**:

| Запрещено | Почему | Рекомендуемая альтернатива |
|---|---|---|
| Лидерборд участников («лучший по встречам — Иван») | Конкуренция = stress в команде | Сухие counters без рейтинга: «провёл X встреч за месяц» |
| Push о просрочках («у вас 3 просроченных задачи») | Реактивный UI = stress | Видимая польза по запросу: пользователь сам открывает «Что я обещал?» |
| Очки/badges/achievements | Геймификация = манипуляция | Никаких индикаторов прогресса по «активности» |
| Алерт о низкой активности | Stress | Только operational alerts (ошибки парсинга, недоступность сервиса) |
| AI-инициатива «Напомнить вам?» | Контроль | Пользователь сам спрашивает у AI |
| Streak / consecutive days | Геймификация | — |
| «Поделитесь с командой» nudges | Манипуляция | Sharing — по явному действию |

**Тон копирайта в widgets:**
- ❌ «Вы провели 12 встреч! Отличная работа 🎉»
- ✅ «12 встреч за неделю»

### 4.9. Сводка: design language за 1 страницу

| Параметр | Значение |
|---|---|
| Тема по умолчанию | Dark |
| Brand color | Mint `#5eead4` (dark) / `#0f766e` (light) |
| Background | `#0a0e14` (dark) / `#ffffff` (light) |
| Шрифт | Geist Sans (UI), Geist Mono (код) |
| Размер body | 14px |
| Размеры на экране | ≤3 |
| Веса | Regular (400), Medium (500), SemiBold (600) |
| Spacing base | 4px |
| Spacing scale | 4 8 12 16 20 24 32 40 48 56 64 72 80 88 96 128 |
| Border radius | sm 6px / md 10px / lg 16px |
| Icons | Lucide, 16px default, stroke style |
| Animation default | 240ms `cubic-bezier(0.16, 1, 0.3, 1)` |
| Table row | 48px default / 40px compact / 56px relaxed |
| Mobile breakpoint | 768px (hamburger ниже) |
| Chart types | 5 (line, bar, stat-card, table, gauge) |
| Data-viz palette | 8 цветов |
| Status colors | bg + text + border (всегда трёхслойно) |
| CTA | colored + icon (+caret для dropdown) |
| Empty/Loading/Error | единые компоненты, унифицированный тон |
| Tone | «вы», без эмодзи, без восторженности, конкретно |

---

## 5. Архитектурные решения

Это **развилки уровня архитектуры UI**, не визуала. Каждая — варианты + tradeoffs. ТЗ выбирает.

### 5.1. Шов: две Z-Admin зоны — `/(authenticated)/admin/*` vs `/(admin)/admin/*`

**Симптом** (стрим A): super_admin имеет два места:

| Зона | Layout | Login | Что внутри |
|---|---|---|---|
| `/(authenticated)/admin/*` | основной AppShell (Sidebar+Header) | основной cookie session | dashboard, orgs, usage, experiments, health, llm-prices |
| `/(admin)/admin/*` | отдельный layout без AppShell | отдельный `/admin/login` | meetings, ai-models, ai-usage, integration-keys, recordings/expiring |

**Корень проблемы (гипотеза):** `(admin)/admin/*` — более ранний слой (когда Z был «приложением для встреч»), `/(authenticated)/admin/*` — новее (когда добавили orgs, billing, etc). Слои не были объединены.

**Варианты решения:**

| Вариант | Действие | Tradeoff |
|---|---|---|
| **A — Полное объединение** | Перенести всё из `(admin)/admin/*` в `(authenticated)/admin/*`, удалить старую зону, единый login через `/login` с проверкой `isSuperAdmin` | Чисто, но требует миграции backend admin guards. Удаление маршрутов = бить закладки. **Это правильный путь** для production. |
| **B — Кросс-линки** | Оставить как есть, но добавить ссылки между ними («Перейти в новый Z-Admin» / «Старая админка»). Постепенная миграция | Полу-меры, шов остаётся. Допустимо как переходный этап (1–2 месяца) |
| **C — Объединение под единым layout** | Перенести `(admin)/admin/*` под `(authenticated)/admin/*`, но сохранить URL как алиасы. Содержимое единый AppShell | Сохраняет закладки, но добавляет URL-redirect layer |
| **D — Сделать `/(admin)/*` зону каноничной** | Перенести всё ТУДА, отдельный login сохранить как security feature (отдельный 2FA, отдельная audit-зона) | Подход финтех/безопасности. Tradeoff: super_admin должен иметь 2 сессии, неудобно |

**Рекомендация (предварительно):** **C** для Фазы 0 (быстро, не ломаем), **A** для Фазы γ (правильно, чисто). Декомпозиция:
- Фаза 0: добавить redirect `(admin)/admin/* → /(authenticated)/admin/*` если новые маршруты появились + единая Sidebar-секция Z-Admin со всеми пунктами.
- Фаза γ: реальная миграция/удаление `(admin)/admin/*`.

### 5.2. Director Dashboard: 10 виджетов → 4–5 hero + drill-down

**Симптом:** [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx) показывает 10 виджетов на одном экране. На мобиле 360px это ленточная простыня высотой 5+ экранов прокрутки.

Эталоны Mixpanel/Amplitude: главный дашборд = **4–6 виджетов** + остальное в Boards / drill-down.

**Варианты реструктуризации:**

| Вариант | Действие | Tradeoff |
|---|---|---|
| **A — Hero KPI + Sections** | 4 hero-tile вверху (KPI), затем 3–4 collapsible-секции с группами виджетов («Знания», «Темы», «Сигналы», «Вопросы»). По умолчанию открыта только первая | Просто, привычно, mobile-friendly |
| **B — Tabs** | 3 таба: «Сейчас» (4 виджета — что важно прямо сейчас), «Знания» (что нового), «Сигналы» (что требует внимания) | Sharper context per tab, но 3 раунда click чтобы увидеть всё |
| **C — Customizable widgets** (как Mixpanel Boards) | Пользователь сам кладёт нужные виджеты на canvas, drag-drop reordering | Мощно, но overkill для MVP, нужно отдельное состояние сохранения |
| **D — Smart Default (AI-curated)** | LLM решает порядок виджетов по контексту (нечего важного на этой неделе → схлопывает виджет, всё новое → выводит наверх) | Слишком много магии, непредсказуемо для пользователя |
| **E — Two-column layout** | Hero KPI вверху, 2 колонки виджетов ниже (left: «новое», right: «требует внимания») | Хорошо для desktop, но на мобиле всё равно простыня |

**Рекомендация (предварительно):** **A** (Hero + Collapsible Sections) — баланс простоты, mobile-friendly, не overkill. Подробнее — в per-screen разделе 6.2.1.

### 5.3. Empty / Loading / Error унификация

См. также G-1, G-2, G-3, G-4, G-5.

**Симптом:** в коде живут 3 версии EmptyState (одна light, одна dark, EmptyHint), 3 стиля loading-индикаторов, 2 версии Skeleton.

**Решение (единственный путь, без вариантов):** ввести **dedicated `frontend/src/ui/states/`**:

```
EmptyState.tsx       — три tone (default/hint/accent)
LoadingState.tsx     — Skeleton, Inline Spinner, Optimistic helper
ErrorState.tsx       — Inline, FormBanner, PageError
LoadingButton.tsx    — wrapper над shadcn/Button
SkeletonWrapper.tsx  — HOC для секций с loading/empty/error fallback
```

Контракты — в разделе 4.7. Все 65+ страниц мигрируются на эти 5 компонентов. Это **Priority 0** работа.

### 5.4. OrgSwitcher: 4 состояния → 2

См. G-6.

**Симптом:** 4 разных состояния (см. 2.2 OrgSwitcher) — много branches, сложно.

**Варианты упрощения:**

| Вариант | Действие | Tradeoff |
|---|---|---|
| **A — Свести к 2** | Всегда показывать dropdown (даже на 1 Org), просто без выбора (disabled state с tooltip «У вас одна компания»). super_admin без membership — отдельный case в самом dropdown | Простота для дев, чуть избыточно для пользователя с одной Org |
| **B — Skip switcher если 1 Org, показывать просто имя как label** (текущее поведение) | Уменьшает шум, но требует branching в коде | Сложнее поддерживать |
| **C — Всегда показывать с поиском (как Cloudflare)** | Если 1 Org — всё равно показываем поиск с placeholder «Найти компанию» (для consultant'ов, кто скоро добавит вторую) | Power для будущего, шум для текущего |
| **D — В шапке всегда название Org (статика), переключение через CommandPalette ⌘K** | Минимализм | Hidden affordance — не очевидно |

**Рекомендация:** **A** + добавить **search input в dropdown** для 5+ Org (как CF-1). Это сводит к 2 состояниям: (1) dropdown с поиском, (2) скрыт во время wizard'а / `(admin)/admin/login`.

### 5.5. CommandPalette: hardcoded → dynamic type registry

См. G-7.

**Симптом:** в [CommandPalette.tsx](../../frontend/src/ui/components/command-palette/CommandPalette.tsx) типы сущностей перечислены через `const TYPES = ['card', 'meeting', ...]`. Каждая новая сущность — правка файла.

**Варианты:**

| Вариант | Действие | Tradeoff |
|---|---|---|
| **A — Type registry на frontend** | `entityTypes.ts` экспортирует объект `{ card: { label, icon, route(id) }, ... }`. CommandPalette итерирует ключи | Простая централизация, всё на frontend |
| **B — Backend driven** | `/api/v1/search/types` возвращает available types per role/tariff. CommandPalette строит UI на основе response | Backend-driven, но 1 лишний request |
| **C — Hybrid** | Frontend regsiter (как A) + backend проверяет доступ. CommandPalette сразу видит, что искать, backend фильтрует доступы | Гибко и быстро |

**Рекомендация:** **A** для V1, **C** при росте entities >15.

### 5.6. Org-Admin vs Z-Admin: визуальная сепарация

См. шов 2 в разделе 2.6.

**Симптом:** В Sidebar в подгруппе «Админка» два пункта стоят рядом: «Админка Org» (для admin/owner) и «Z-Admin» (для super_admin). Визуально это **разные кабинеты** (один — внутри Org, второй — над всеми), но граница не очевидна.

**Варианты:**

| Вариант | Действие | Tradeoff |
|---|---|---|
| **A — Разные секции в Sidebar** | «Админка компании» (часть «Настройки» группы) + отдельная **топ-секция «Z-Admin»** в самом верху или внизу Sidebar (видна только super_admin) | Очень явное разделение |
| **B — Цветовой код** | «Z-Admin» иконка с danger-цветом + красная плашка вверху на всех Z-Admin страницах: «Вы в кабинете оператора платформы Z» | Сигналь «осторожно, у вас сила» |
| **C — Полностью отдельный layout** для Z-Admin (другой brand mark в Header, другая шапка) | Cognitive split — нет путаницы | Большая работа, ломает консистентность |
| **D — Текущее: одна подгруппа «Админка»** | Просто, но непонятно для super_admin, что он переходит между кабинетами | Status quo, мин work |

**Рекомендация:** **A + B** — отдельная топ-секция в Sidebar (visual separation) + цветовой код danger (semantic separation). Это закрывает шов 2 без полного переписывания.

### 5.7. Mobile-first: viewer-only vs full editing

См. CF-?1.

**Развилка фазирования mobile-first:**

| Вариант | Фаза 0 mobile-готовность | Фаза γ mobile-готовность | Tradeoff |
|---|---|---|---|
| **A — Full mobile везде** | Все 12 экранов работают на 360px (viewer + editing + admin) | Расширение по мере добавления | Дорого в Фазе 0, но не накапливаем долг |
| **B — Viewer-first, editing-later** | Все экраны можно ОТКРЫТЬ на мобиле и СМОТРЕТЬ; editing работает только на ≥768px | Editing включается на мобиле | Дешевле в Фазе 0, накапливаем долг на γ |
| **C — Read-only mobile** | На мобиле — read-only, любое editing редиректит на «Откройте на десктопе» | Самое простое, минимум кода | Bad UX, пользователи в дороге не могут ничего сделать |
| **D — Adaptive UI per screen** | Каждый экран сам решает (например, `/structure` — full editing на mobile, `/admin/experiments` — read-only на мобиле) | Гибко, но непредсказуемо | Дополнительная сложность поддержки |

**Рекомендация:** **B** для Фазы 0 (баланс), **A** для Фазы γ (полная mobile-готовность к ребренду на Кору).

### 5.8. Информационная плотность Org-кабинета vs Z-Admin

**Несимметричный контекст:**

- **Org-кабинет** — для бизнес-пользователей, на работе, читают между делом. Должен быть **более воздушным**, фокус на главное.
- **Z-Admin** — для оператора платформы (тебя), сидящего часами, любящего density. Может быть **более плотным**, больше колонок в таблицах, больше виджетов.

**Решение:** **разные default density** для двух кабинетов:

| Параметр | Org-кабинет | Z-Admin |
|---|---|---|
| Default table row | 56px (relaxed) | 48px (default) |
| Виджетов на дашборде | 4–5 | 6–8 |
| Card padding | 24px | 16px |
| Inter-section gap | 32px | 24px |

Tradeoff: для разработки = 2 set of defaults. Альтернатива: single default + переключатель density per user.

### 5.9. Wizard `/onboarding/company/*` — пять шагов

См. wireframes в аналитике ЛК §8. Здесь — design-level варианты для wizard'а.

| Вариант | Layout | Tradeoff |
|---|---|---|
| **A — Linear stepper** (текущий, по аналитике ЛК) | 5 шагов под номерами, навигация «Назад/Далее» | Простой, ожидаемый |
| **B — Sidebar steps + main content** | Левая колонка — все 5 шагов (можно перепрыгивать на любой завершённый), правая — текущий шаг | Невлинейная свобода, но overkill для 5 шагов |
| **C — Single-page form (no stepper)** | Все 5 секций — на одной странице, скролл вниз | Полностью видно сразу, нет иллюзии «куда я попал»; но overwhelming для первого раза |
| **D — Conversational wizard** | AI-чат вида «Привет! Давайте начнём. Какие у вас отделы?» — пользователь вводит, AI парсит | Очень brand-aligned («память компании»), но риск багов, медленнее |

**Рекомендация:** **A** для Фазы 0 (уже реализовано), **D** как эксперимент для Фазы γ.

### 5.10. Светлая vs тёмная тема как default

**Текущий код:** dark — default, light — переключатель в UserCard menu.

**Варианты:**

| Вариант | Действие | Tradeoff |
|---|---|---|
| **A — Dark default forever** | Текущий | Brand-aligned («ночная память», mint светится) |
| **B — Light default для public/auth, dark для authenticated** | Публичный лендинг — light (стандарт для marketing), внутренний admin — dark | Сложно, но «как у Vercel» |
| **C — System preference default** | `prefers-color-scheme` решает; пользователь может переключить | Стандартно, уважительно к ОС |
| **D — Per-Org default** | Org owner выбирает тему для своих | Кастомизация enterprise-style |

**Рекомендация:** **C** (system preference) — стандартный современный паттерн. Внутри Org `owner` может зафиксировать default.

---

---

## 6. Per-screen redesign

Для каждого из 12 ключевых экранов — единая структура:

- **.1 Текущее состояние** — wireframe + список проблем (на основе чтения кода).
- **.2 Рекомендации** — wireframe + почему так, со ссылкой на паттерны из раздела 3.
- **.3 Состояния** — empty / loading / error / over-loaded (≥1000 строк / ≥100 виджетов).
- **.4 Мобильная адаптация** — что меняется на 360px / 768px / 1024px.
- **.5 Действия и иерархия** — primary CTA, secondary, hover, drill-down.
- **.6 Контракт API** — что должно прийти от backend, чего пока нет.
- **.7 Альтернативы** — если есть несколько обоснованных вариантов.

Wireframes — ASCII, унифицированный стиль (box-drawing characters). Не pixel-perfect — задают зоны и иерархию.

---

### 6.1. Z-Admin

#### 6.1.1. `/admin` — Глобальный дашборд

**Файл:** [AdminDashboardClient.tsx](../../frontend/app/(authenticated)/admin/AdminDashboardClient.tsx).

##### 6.1.1.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Глобальный дашборд                              [ За неделю      ▼  ] │
│  Расход LLM по всем Org за выбранный период.                            │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│  │ Расход   │ │ FAIL     │ │ Org /    │ │ DAU 7d   │                    │
│  │ за пер.  │ │ RATE     │ │ Юзеров   │ │          │                    │
│  │  $0.00   │ │  0.0%    │ │ 0 / 0    │ │  0       │                    │
│  │ 0 выз.   │ │ 0 fail   │ │ 7d:0     │ │ юзер.    │                    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Расход по провайдерам                                              │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ openai-proxy             1,234 вызовов            $123.45         │ │
│  │ anthropic-direct           567 вызовов             $67.89         │ │
│  │ gigam-self-hosted          234 вызовов              $0.00         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Топ функций по расходу                          [ Все функции → ] │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ Отчёт по встрече sales-call             456            $45.67     │ │
│  │ Извлечение блоков идей                  234            $23.45     │ │
│  │ ...                                                                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Топ организаций по расходу                       [ Все Org → ]    │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ ООО Альфа                               1,234        $123.00      │ │
│  │ ИП Бета                                   567         $56.78      │ │
│  │ ...                                                                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ⓘ Метрики кэшируются на 60 секунд.                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.1.1.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Нет графиков** — только списки и tiles. Тренды («растёт ли расход неделя к неделе?») не видны | High — главный KPI собственника платформы |
| P-2 | **Нет сравнения период vs предыдущий** (delta «+12% к прошлой неделе») | High — без этого KPI — это просто число |
| P-3 | **KPI tile «FAIL RATE»** меняет цвет на warning при >5%, но не drill-down — куда смотреть? Какие функции фейлят? | Medium |
| P-4 | **Период только 3 значения** (день/неделя/месяц) — нет «вчера», «прошлая неделя», «30 дней», «90 дней», «custom range» | Medium |
| P-5 | **Top hardcoded в 10** — нельзя расширить, нельзя свернуть в 5 | Low |
| P-6 | **«Орг / Юзеров»** в одной плитке слитно (0 / 0) — нечитабельно, лучше разнести | Low |
| P-7 | **AppShell как у Org-кабинета** — нет визуального сигнала «ты в кабинете оператора платформы, у тебя сила» | Medium (см. 5.6) |
| P-8 | **Кэш 60s** — но это только в footnote, а freshness каждого виджета не показана («updated 23s ago») | Low (A-6 паттерн Amplitude) |
| P-9 | **Нет операционных метрик:** активные Org, новые регистрации за период, churn, MRR (если будет монетизация) | High — это пульсация бизнеса, не только расход LLM |
| P-10 | **Нет alert-секции:** ничего не выделяется как «требует внимания super_admin» (заморозки, отказы, expired recordings) | Medium |
| P-11 | **На мобиле 360px:** 4 KPI tiles в 1 столбец = высокая простыня прокрутки | Medium |

##### 6.1.1.3. Рекомендации (предложенный wireframe)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡  Z-Admin                                                                │
│  Кабинет оператора платформы                                                │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Платформа в целом         [ Период: 7 дней ▼ ]   [ ↻ ] обновлено 12с назад│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ MRR         │ │ Активных Org│ │ Расход LLM  │ │ Доля ошибок │            │
│  │ ₽1,234,567  │ │     127     │ │  $234.56    │ │    0.8%     │            │
│  │ ↑ +12.4%    │ │ +3 за нед   │ │ ↓ −3.2%     │ │ ↓ −0.2 pp   │            │
│  │ к прошл нед │ │             │ │ к прошл нед │ │             │            │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ⚠ Требует внимания                                                     │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │ • 3 Org с fail rate >5% за последние 24ч       [Посмотреть]            │ │
│  │ • 1 Org заморожена 5 дней без response          [Связаться]            │ │
│  │ • 47 expired recordings ждут удаления           [Удалить]              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ Расход по дням                            [ Линия ▼ ] [ ⤓ CSV ] [⋮]   │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │                                                                          │ │
│  │       $50 ┤        ╭──╮                                                  │ │
│  │           │       ╱    ╲                                                 │ │
│  │       $40 ┤      ╱      ╲                                                │ │
│  │           │     ╱        ╰╮                                              │ │
│  │       $30 ┤    ╱           ╰─╮                                           │ │
│  │           │ ╱─╯              ╰─                                          │ │
│  │       $20 ┤╱                                                             │ │
│  │           ├─────┬─────┬─────┬─────┬─────┬─────┬─────                    │ │
│  │           Пн    Вт    Ср    Чт    Пт    Сб    Вс                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐    │
│  │ Топ-10 Org по расходу          │  │ Топ-10 функций по расходу      │    │
│  │ [Все Org →]                    │  │ [Все функции →]                │    │
│  ├────────────────────────────────┤  ├────────────────────────────────┤    │
│  │ ООО Альфа        $45.67  19% ████│ Отчёт sales-call $34.45  15% ████   │
│  │ ИП Бета          $23.12  10% ██ │  Извлечение      $12.34   5% ██     │
│  │ ...                              │  ...                                  │
│  └────────────────────────────────┘  └────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────┐  ┌────────────────────────────────┐    │
│  │ По провайдерам                 │  │ По тарифам                     │    │
│  ├────────────────────────────────┤  ├────────────────────────────────┤    │
│  │ openai-proxy   $123 ██████████ │  │ basic        12 Org ████       │    │
│  │ anthropic       $67 ██████     │  │ pro          89 Org ██████████ │    │
│  │ gigam-local      $0            │  │ enterprise   26 Org ████       │    │
│  └────────────────────────────────┘  └────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Хедер-секция Z-Admin** — мини-логотип-маркер с иконкой `Shield`, явный заголовок «Z-Admin / Кабинет оператора платформы». Реализует **5.6 вариант A+B**.
2. **4 hero-KPI** — добавил MRR + delta «vs предыдущий период» на каждом KPI. Это паттерн **A-6 Amplitude (freshness)** + **CF-5 (dashboard-level period)**.
3. **Секция «Требует внимания»** — agregated alerts (P-10). Каждый item с прямым CTA-действием. **GAS-Actionable** (A-4 Amplitude).
4. **График «Расход по дням»** — line chart 5 chart types (CF-4 после фильтрации). + Toggle типа графика + Export CSV (A-7 Amplitude).
5. **2-колонный grid** «Top Orgs / Top Functions» — A-3 Amplitude (two-column layout). На мобиле — стек 1 колонка.
6. **«По тарифам»** — новый виджет с распределением Org по tier. Помогает увидеть структуру revenue.
7. **Freshness** — «обновлено 12с назад» в шапке, а не в footnote. Применимо A-6.

##### 6.1.1.4. Состояния

| Состояние | Что показывает |
|---|---|
| **Loading** | Skeleton: 4 placeholder KPI + skeleton банера alerts + skeleton chart (с pulsing-mint оверлеем) + 2 skeleton lists |
| **Empty (нет данных)** | После периода без активности: «За эту неделю активности не зафиксировано» + CTA «Посмотреть прошлую неделю» |
| **Error (500)** | Inline `<ErrorState>` с retry. Можно ретраить per-widget (например, график упал — перезагрузить только график) — это паттерн «module-level error» (CF-10) |
| **Forbidden (403)** | `<AdminForbidden>` — «Этот кабинет доступен только super_admin. Если вы ошибочно здесь — сообщите команде Z» |
| **Over-loaded (10000+ Org)** | Top-listы остаются 10 строк, но KPI tiles считаются по агрегату; графики бакетируются по дням, не часам |

##### 6.1.1.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280px (desktop wide)** | 4 KPI в ряд / alerts полная / chart полный / 2-col Top Orgs + Top Functions / 2-col By Provider + By Tier |
| **1024–1279px** | 4 KPI в ряд / alerts полная / chart полный / 2-col / 2-col |
| **768–1023px (tablet)** | **2 KPI в ряд** / alerts полная / chart полный / 1-col |
| **480–767px** | **2 KPI в ряд** / alerts стек / chart полный / 1-col / 1-col |
| **360–479px (mobile)** | **1 KPI в ряд** / alerts стек, action button под item / chart полный с горизонтальным скроллом / 1-col / 1-col / sticky period picker |

##### 6.1.1.6. Действия и иерархия

- **Primary action:** ✗ нет — это viewer-page, не action-page.
- **Secondary:** Period picker (global filter, влияет на все виджеты). Refresh (manual reload, кроме автоматического 60s cache).
- **Per-widget:** [⋮ menu] → Edit dashboard (γ), Duplicate widget (γ), Export CSV (A-7).
- **Drill-down:** клик на KPI MRR → `/admin/orgs?filter=paying`; клик на «Расход LLM» → `/admin/usage/functions`; клик на bar Top Orgs → `/admin/orgs/[id]/billing`; клик на alerts item → конкретный экран action'а.

##### 6.1.1.7. Контракт API (что должно быть от backend)

| Endpoint | Что возвращает | Статус | Что добавить |
|---|---|---|---|
| `GET /api/v1/admin/dashboard?period=week` | `totals` + `byProvider` + `byTaskType` + `topOrgs` + `counts` | ✓ есть | Добавить: `previousPeriodTotals` (для delta), `mrr`, `mrrDelta`, `alerts[]`, `byTier`, `dailyBreakdown[]` для графика |
| `GET /api/v1/admin/alerts` | список текущих алертов с типом и target | ✗ нет | Новый endpoint: `{ type, severity, message, targetUrl, count }[]` |
| `GET /api/v1/admin/dashboard.csv` | CSV-экспорт | ✗ нет | Применимо A-7 |

##### 6.1.1.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Hero + Alerts + Chart + 2-col** (рекомендуемый) | Как описано | Баланс информативности и плотности |
| **B — Just lists** (текущее) | Без графика, только tiles + lists | Проще, меньше зависимостей от chart library; но не видны тренды |
| **C — Full charts** (Cloudflare-style) | Все виджеты — chart (provider → donut, tier → bar, daily → line). Нет lists | Очень визуально, но плохо для скан-режима «быстро посмотреть конкретные числа» |
| **D — Cards с mini-chart внутри** (Linear/Stripe-style) | Каждый KPI tile содержит мини-sparkline под значением | Очень элегантно, но требует chart-library с поддержкой mini-mode (recharts/visx подойдут) |

---

#### 6.1.2. `/admin/orgs` — Список всех Org **⭐ главный экран для собственника**

**Файл:** [OrgsClient.tsx](../../frontend/app/(authenticated)/admin/orgs/OrgsClient.tsx).

##### 6.1.2.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Организации                              [ За месяц ▼ ]  [☐] С заморож│
│  Все Org: тариф, владелец, экономика, действия.                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────┐                                     │
│  │ имя или slug Org           [🔍 Найти]│                                │
│  └─────────────────────────────────┘                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  ORG          ТАРИФ       OWNER         MEMBERS  ВСТРЕЧ  РАСХОД  ДЕЙСТ │
│  ─────────────────────────────────────────────────────────────────────  │
│  ООО Альфа    [Pro    ▼]  ivan@alfa.ru     12      234   $123.45  💰❄🗑│
│  ИП Бета      [Basic  ▼]  petr@beta.io      3       45    $12.34  💰❄🗑│
│  заморожена                                                              │
│  ООО Гамма    [Enter. ▼]  ceo@gamma.com    87      678   $234.56  💰❄🗑│
│  ...                                                                     │
│  (до 200 строк без пагинации)                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.1.2.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Нет sorting** на колонках. Хочется отсортировать по Members ↑↓, Расход ↑↓, по дате регистрации | **Critical** — главная боль на таблице |
| P-2 | **Нет pagination** — лимит 200 hardcoded. На 500+ Org будет лагать. На 50 Org — пустые ряды внизу | High |
| P-3 | **Нет filter по tier** — только period + includeDeleted + search по имени | High |
| P-4 | **Нет filter по статусу** (active/trial/frozen) | High |
| P-5 | **Нет колонки «Зарегистрирована»** — когда Org появилась? Не видно «новые регистрации за неделю» | High |
| P-6 | **Нет колонки «Last activity»** — давно ли заходили? Признак churn | High |
| P-7 | **Inline tier-dropdown** — опечатка одной кнопкой меняет тариф клиента, нет confirm | **Critical** для деньги |
| P-8 | **`window.confirm` для freeze/delete** — браузерный диалог, плохой UX, нельзя кастомизировать | Medium |
| P-9 | **Нет bulk actions** — нельзя выделить 5 Org и заморозить разом | Medium |
| P-10 | **Нет column visibility toggle** — обязаны видеть все 7 колонок | Low |
| P-11 | **Нет export to CSV** — нельзя выгрузить для bookkeeping/планёрки | High |
| P-12 | **Нет drill-down view** — кликнуть на Org и увидеть детали в правом sidebar или modal — нельзя, только переход на /billing | Medium |
| P-13 | **На мобиле 360px** — таблица с 7 колонками, scroll-x обязателен, плохо читаемая | High |
| P-14 | **Иконки действий без подписей** (Wallet/Snowflake/Trash) — только tooltip; не для новичка | Low |
| P-15 | **Заморозка через `Snowflake` — иконка не очевидна** | Low |
| P-16 | **Нет batch view «по тарифам»** (сейчас можно лишь через filter, но нет агрегата) | Medium |

##### 6.1.2.3. Рекомендации (предложенный wireframe)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡 Z-Admin → Организации                                                    │
│  127 организаций · 89 активных · 12 trial · 5 frozen · 21 churned           │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │ 🔍 Поиск (имя, slug, email)      │  │ [+ Создать вручную] [⤓ CSV] [⋮]│ │
│  └──────────────────────────────────┘  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Фильтры:                                                              │  │
│  │  Тариф: [Все ▼]  Статус: [Все ▼]  Расход: [Любой ▼]  Период: [Мес ▼]│  │
│  │  [×] Очистить                                          [Сохранить вид]│  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [☐] ORG                  ТАРИФ      OWNER        MEM  ВСТР  $РАСХ   ДЕЙСТ  │
│  ──────────────────────────────────────────────────────────────────────────  │
│  [☐] 🔵 ООО Альфа         Pro        ivan@alfa     12   234  $123.45  [⋮]   │
│      alfa · регистр. 2026-04-12 · last activity 2ч                          │
│  [☐] ⚪ ИП Бета           Basic       petr@beta     3    45   $12.34  [⋮]   │
│      beta · регистр. 2026-05-01 · last activity 1д                          │
│  [☐] 🔴 ❄ ООО Заморож.   Pro         ceo@frozen    1     0   $0.00   [⋮]   │
│      frozen-org · регистр. 2026-02-14 · frozen 5д · по причине X            │
│  [☐] 🟢 ООО Гамма         Enterprise  ceo@gamma    87   678  $234.56  [⋮]   │
│      gamma · регистр. 2026-01-08 · last activity 12мин                      │
│  ...                                                                          │
│                                                                              │
│  Показаны 1–25 из 127           [‹ Назад] [1] 2 3 4 5 [Вперёд ›]            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Sticky right-panel (открывается при клике на ряд, по умолчанию закрыт):**

```
                                          ┌────────────────────────────────┐
                                          │ ООО Альфа                  [×]│
                                          │ alfa · Pro · Активна          │
                                          ├────────────────────────────────┤
                                          │ Owner:    ivan@alfa.ru        │
                                          │ Members:  12                  │
                                          │ Регистр.: 2026-04-12 (40 дн)  │
                                          │ Last act.: 2ч назад           │
                                          │ MRR:      ₽12,000             │
                                          │ Расход за мес: $123.45        │
                                          │ Встреч за мес: 234            │
                                          │                                │
                                          │ [Открыть биллинг]              │
                                          │ [Заморозить]                   │
                                          │ [Связаться с owner]            │
                                          │ [Удалить]                      │
                                          ├────────────────────────────────┤
                                          │ ⓘ Последние события (audit log)│
                                          │ 2ч • tier change: Basic→Pro   │
                                          │ 5д • billing override added   │
                                          │ 12д • new member invited      │
                                          └────────────────────────────────┘
```

**Bulk actions (когда выбрано ≥1):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ▶ Выбрано: 3                  [Заморозить] [Изменить тариф] [Удалить] │
└─────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Breadcrumb-style heading:** «Z-Admin → Организации» (U-1, отсутствует в Z).
2. **Status badges в шапке:** «127 / 89 active / 12 trial / 5 frozen / 21 churned» — мгновенный overview без скана таблицы.
3. **Поиск-first** + Filters dropdown row.
4. **Sortable columns** с явными indicator стрелок (P-1).
5. **Pagination** с pages + jump (P-2).
6. **Tier — БЕЗ inline-dropdown.** Tier меняется только через кнопку «⋮» → confirm → переход на `/billing` (P-7).
7. **Per-row actions через `⋮ DropdownMenu`** — не три иконки россыпью; кастомизируемая, расширяемая.
8. **Status-цветовой круг слева от имени Org**: 🟢 active+healthy / 🔵 active normal / ⚪ trial / 🔴 frozen / ⚫ churned. Сразу читается.
9. **Sub-row метаданные**: slug + регистрация + last activity. Видно без drill-down.
10. **Sticky right-panel при клике** — детали Org + действия + audit log preview. Закрывается крестиком.
11. **Bulk actions** (P-9) — checkbox-колонка + sticky-bar при ≥1 selected.
12. **Export CSV** (P-11) в правом верхнем углу.
13. **«Сохранить вид»** — фильтры можно сохранить в named view (как Linear, Notion). Например: «Trial под риском» = trial + last activity >7d.

##### 6.1.2.4. Состояния

| Состояние | Что показывает |
|---|---|
| **Loading** | Skeleton header + skeleton 10 строк таблицы + skeleton фильтров |
| **Empty (нет ни одной Org)** | Hero-empty: «Пока нет ни одной организации в Z. Когда появится первая регистрация — увидите её здесь.» |
| **Empty (фильтр дал 0)** | «По вашему фильтру ничего не найдено. [Сбросить фильтры]» |
| **Error** | Inline-error со скрытой таблицей + retry |
| **Forbidden** | Полный page-forbidden |
| **Over-loaded (10000+ Org)** | Пагинация 50/100/200 per page; фильтры обязательны (без фильтров — только 100 свежих) |

##### 6.1.2.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280px** | Полная таблица + sticky right-panel при клике |
| **1024–1279** | Полная таблица; right-panel становится sheet (slide-in) |
| **768–1023** | Таблица **скрывает колонки MEMBERS и ВСТРЕЧ** (доступны в drill-down) |
| **480–767** | **Card-view вместо table:** каждая Org — карточка с avatar+name+status+row of metrics |
| **360–479** | Card-view с **collapsed metrics** — только name + tier + расход; остальное по тапу |

Альтернатива: вместо card-view — **horizontal scroll таблицы с frozen first column** (Cloudflare-style CF-3).

##### 6.1.2.6. Действия и иерархия

- **Primary CTA:** «+ Создать вручную» — для случаев, когда super_admin создаёт Org вручную (white-label, тестовая, демо).
- **Secondary:** Export CSV.
- **Per-row primary action:** клик на ряд → открывает sticky right-panel.
- **Per-row secondary:** «⋮ menu» → «Открыть биллинг», «Заморозить», «Изменить тариф (→ biling)», «Связаться с owner», «Удалить».
- **Bulk:** «Заморозить», «Изменить тариф», «Удалить» (с confirm modal, не window.confirm).

##### 6.1.2.7. Контракт API

| Endpoint | Что возвращает | Статус | Что добавить |
|---|---|---|---|
| `GET /api/v1/admin/orgs?period=month&search=...&includeDeleted=...&limit=200` | `items[]` + `total` | ✓ есть | Добавить: `status enum (active/trial/frozen/churned)`, `createdAt`, `lastActivityAt`, `mrrRub`, фильтры по tier/status/spendRange, sorting по любой колонке, `cursor` или `page` для pagination |
| `GET /api/v1/admin/orgs/stats` | Агрегат по status и tier | ✗ нет | Новый endpoint для status badges «127/89 active/12 trial...» |
| `GET /api/v1/admin/orgs/[id]/preview` | Сводка для right-panel | ✗ нет | Новый endpoint: owner, members, mrr, recent activity, audit-log preview |
| `GET /api/v1/admin/orgs.csv` | CSV | ✗ нет | Применимо для bookkeeping |
| `POST /api/v1/admin/orgs/bulk` | Bulk action на ids[] | ✗ нет | Новый endpoint для bulk freeze/tier-change/delete |
| `PATCH /api/v1/admin/orgs/[id]` | Update tier/freeze | ✓ есть | OK как есть |

##### 6.1.2.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Table + sticky right-panel** (рекомендуемый) | Как описано | Стандартно для admin, хорошо знакомо |
| **B — Card grid** | Каждая Org — большая card, 2-3 в ряд | Очень визуально (как Vercel projects), но плохо для скана 100+ Org |
| **C — Tree-view (по tier)** | Раскрывающиеся группы: Enterprise (26), Pro (89), Basic (12) | Helpful для navigation, но добавляет click для просмотра |
| **D — Map view + table** | Карта России с пинами Org (если известна геолокация) + переключатель на table | Cute, но overkill — у нас не геопродукт |

---

#### 6.1.3. `/admin/orgs/[id]/billing` — Управление тарифом одной Org

**Файл:** [BillingAdminClient.tsx](../../frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx).

##### 6.1.3.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← К списку Org                                          [super_admin ⓘ]│
│  Тариф организации                                                       │
│  tenantId: abc-123-xyz                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ Тариф                                                                │ │
│  │ [Профессиональный (pro)  ▼]    Текущее значение в БД: pro            │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ Переопределения фич                                                  │ │
│  │ По умолчанию из тарифа Pro. Override перебьёт тарифное.              │ │
│  │ ───────────────────────────────────────────────────────────────────  │ │
│  │ ФИЧА                  ПО ТАРИФУ      OVERRIDE                        │ │
│  │ Темы                  включено       [из тарифа (inherit) ▼]         │ │
│  │ AI-чат                включено       [включить (override) ▼]         │ │
│  │ ...                                                                    │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ Переопределения квот                                                 │ │
│  │ ...table...                                                           │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ Заметка                                                              │ │
│  │ [Textarea]                                                            │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ ⚠ Причина изменения *                                                │ │
│  │ [Textarea — мин 3 символа]                              0/500        │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  [💾 Применить]  [⟲ Отменить и перезагрузить]                           │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.1.3.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Нет breadcrumbs** (только «← К списку Org») — пользователь не видит «где он» | Medium (U-1) |
| P-2 | **Нет контекста Org** — какой owner, сколько members, текущий MRR, текущий расход. Чтобы принять решение по тарифу — надо собирать инфу с других страниц | **Critical** |
| P-3 | **Нет AuditLog** в UI (есть TODO в коде «lazy-load auditLogApi») | High |
| P-4 | **Нет preview изменений** — «при сохранении: tier Basic→Pro, AI-чат включён, квота meetings 50→200». Сейчас все диффы только в backend AuditLog | High |
| P-5 | **«Применить» сразу применяет** — нет dry-run / preview | High |
| P-6 | **Нет «применить с DD/MM»** — нельзя запланировать смену тарифа на будущую дату (для промо «бесплатно до Q1») | Medium |
| P-7 | **Все sections на одной странице** — много скролла. Не используется tab-pattern | Medium |
| P-8 | **`super_admin` badge** дублирует Header — избыточно | Low |
| P-9 | **«inherit» в Select** — англицизм в UI | Medium (C-3) |
| P-10 | **«override»** — англицизм в UI | Medium (C-3) |
| P-11 | **«failed safe»** Badge — англицизм + неясно для не-разработчика | Medium |
| P-12 | **tenantId как code-block** — для super_admin OK, для будущего «оператора саппорта» — overkill | Low |
| P-13 | **`reason`-textarea не валидирует в реальном времени** — required но не показывает «осталось N символов» приветливо | Low |
| P-14 | **Нет «Запросить email подтверждение»** — для апгрейда тарифа клиента можно отправить ему письмо «вам подтверждён апгрейд» | Medium |

##### 6.1.3.3. Рекомендации (предложенный wireframe)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡 Z-Admin → Организации → ООО Альфа → Тариф                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ ⓘ Контекст Org                                                          ││
│  │ ────────────────────────────────────────────────────────────────────────││
│  │ Org:      ООО Альфа (alfa) · Активна                                    ││
│  │ Owner:    ivan@alfa.ru                                                   ││
│  │ Members:  12 / лимит 25 (Pro)                                            ││
│  │ Регистр.: 2026-04-12 (40 дн)                                             ││
│  │ MRR:      ₽12,000     Расход за мес: $123.45                             ││
│  │ Last activity: 2ч назад                                                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─[ Тариф ] [ Переопределения фич (3) ] [ Квоты (2) ] [ Журнал изменений ]┐│
│  │                                                                          ││
│  │ ┌────────────────────────────────────────────────────────────────────┐ ││
│  │ │ Текущий тариф: Профессиональный (pro)                              │ ││
│  │ │                                                                     │ ││
│  │ │ Сменить на:                                                          │ ││
│  │ │ ○ Базовый (basic)        ₽3,000/мес · 10 встреч · 5 чел           │ ││
│  │ │ ● Профессиональный (pro) ₽12,000/мес · 100 встреч · 25 чел        │ ││
│  │ │ ○ Корпоративный (enterprise) ₽40,000/мес · ∞ · ∞                 │ ││
│  │ │                                                                     │ ││
│  │ │ Применить:                                                          │ ││
│  │ │ ● Сразу                                                             │ ││
│  │ │ ○ С даты [DD.MM.YYYY] (если promo)                                 │ ││
│  │ │                                                                     │ ││
│  │ │ Уведомить:                                                          │ ││
│  │ │ [☑] Отправить owner письмо «ваш тариф изменён»                     │ ││
│  │ └────────────────────────────────────────────────────────────────────┘ ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ ⚠ Что изменится при сохранении                                          ││
│  │ ────────────────────────────────────────────────────────────────────────││
│  │ • Тариф: Pro → Enterprise                                                ││
│  │ • Включится: AI-чат (был выключен в Pro по умолчанию)                   ││
│  │ • Лимит meetings: 100 → ∞                                                ││
│  │ • Лимит members: 25 → ∞                                                  ││
│  │ • Цена для клиента: ₽12,000/мес → ₽40,000/мес                            ││
│  │ • Уведомление: будет отправлено письмо owner'у ivan@alfa.ru             ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Причина изменения (обязательно)                                         ││
│  │ ────────────────────────────────────────────────────────────────────────││
│  │ [Текстовая область, мин 3 символа]                       12/500         ││
│  │ ⓘ Записывается в журнал изменений для compliance.                       ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  [💾 Сохранить изменения]  [Отмена]                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Breadcrumb** «Z-Admin → Организации → ООО Альфа → Тариф» (U-1).
2. **Контекст-блок Org** в самом верху — owner, members, MRR, last activity, расход. **Снимает P-2** — теперь решение по тарифу принимается с full context.
3. **Tabs** «Тариф / Переопределения фич / Квоты / Журнал изменений» — устраняет длинный скролл (P-7). Badge на табе с counter (3 override-а, 2 квоты — мгновенно видно «где правка»).
4. **Тариф как radio с описанием** — не Select. Видно цену и лимиты каждого тарифа, без необходимости открывать дропдаун (Mixpanel M-4 — CTA с явной информацией).
5. **«Применить сразу / с даты»** — закрывает P-6 (timed changes).
6. **«Уведомить owner»** — checkbox для email-уведомления (P-14).
7. **Секция «Что изменится при сохранении»** — preview-диф (P-4, P-5). **Это самая важная секция** — пользователь видит ВСЁ, что произойдёт, до клика «Сохранить».
8. **Reason — внизу**, не в середине. Структурно понятнее: контекст → действие → diff → reason → submit.
9. **«inherit» → «из тарифа»**, **«override» → «персональное значение для этой Org»** — русифицировано (P-9, P-10, C-3).
10. **«failed safe» Badge — убрана из UI**, отправлена в журнал изменений как технический детал.
11. **Журнал изменений во вкладке** — закрывает P-3 (lazy-load AuditLog).

##### 6.1.3.4. Состояния

| Состояние | Что показывает |
|---|---|
| **Loading** | Skeleton: контекст-блок (с avatar+lines), tabs, текущий tier carbu, action buttons disabled |
| **Empty (Org удалена / не найдена)** | Hero-empty: «Org не найдена. Возможно, удалена. [К списку Org]» |
| **Error при загрузке** | Inline `<ErrorState>` с retry |
| **Forbidden** | Полный page-forbidden |
| **Pending save** | Все inputs disabled, кнопка с spinner «Сохраняем…» |
| **Saved success** | Toast «Тариф обновлён» + текущие значения обновляются + reason очищается + перерасчёт «Что изменится» (теперь пусто) |
| **Save error** | Toast с ошибкой + form остаётся в текущем состоянии для повторного submit |

##### 6.1.3.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1024px** | Контекст-блок full-width + tabs + content full-width |
| **768–1023** | То же, tabs остаются горизонтальными |
| **480–767** | Контекст-блок full / tabs scroll-x / sections stack |
| **360–479** | Контекст-блок collapsed (только название + owner) с кнопкой «Развернуть» / tabs scroll-x / sections stack / sticky-bottom save button |

##### 6.1.3.6. Действия и иерархия

- **Primary CTA:** «💾 Сохранить изменения» (disabled пока нет diffs и нет reason).
- **Secondary:** «Отмена» (возврат к загруженному состоянию, без сохранения).
- **Per-tab actions:** tab «Журнал изменений» — only viewing, нет CTA.

##### 6.1.3.7. Контракт API

| Endpoint | Что возвращает | Статус | Что добавить |
|---|---|---|---|
| `GET /api/v1/admin/orgs/[id]/entitlement` | Текущий entitlement | ✓ есть | Добавить: `org` (name, slug, owner, members count, mrr, lastActivity), `tierDescriptions` (для radio) |
| `PATCH /api/v1/admin/orgs/[id]/entitlement` | Update | ✓ есть | Добавить: `applyAt: Date \| null`, `notifyOwner: boolean` |
| `GET /api/v1/admin/orgs/[id]/audit-log?type=ENTITLEMENT*&limit=20` | Журнал изменений | ✗ нет (TODO в коде) | Новый endpoint |
| `POST /api/v1/admin/orgs/[id]/entitlement/preview` | Dry-run preview | ✗ нет | Новый endpoint для секции «Что изменится» |

##### 6.1.3.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Tabs + контекст-блок + preview-diff** (рекомендуемый) | Как описано | Полный контроль + safety preview |
| **B — Wizard (3 шага)** | Шаг 1: Выбор tier. Шаг 2: Overrides. Шаг 3: Confirm с diff | Более safe (force чтение diff), но медленнее для опытного оператора |
| **C — Modal-edit, текущая страница read-only** | На странице — текущее состояние; модал «Изменить тариф» с теми же контролами | Хорошо для clean view, но modal-overload на сложных операциях |
| **D — Inline-edit на /admin/orgs (без отдельной страницы)** | Раскрывающаяся строка в таблице | Быстро для опытных, но плохо для compliance (нет preview, нет audit) |

---

---

#### 6.1.4. `/admin/usage/functions` — Функции LLM

**Файл:** [FunctionsClient.tsx](../../frontend/app/(authenticated)/admin/usage/functions/FunctionsClient.tsx).

##### 6.1.4.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Функции LLM                                           [ За неделю  ▼ ] │
│  Все taskType: текущая модель, fallback, экономика, fail rate.           │
├─────────────────────────────────────────────────────────────────────────┤
│  ФУНКЦИЯ                  ТЕКУЩАЯ МОДЕЛЬ   ВЫЗОВ  FAIL  AVG$  AVGmS  ВСЕГО│
│  ─────────────────────────────────────────────────────────────────────  │
│  Отчёт встречи sales-call openai-proxy/sonnet 456   1.2%  $0.10  1.2s $45.67 →│
│  Извлечение блоков идей  anthropic/haiku [A/B] 234   0.0%  $0.01  0.4s $23.45 →│
│  Тематический кластер     openai-proxy/4o-mini 122  7.8%  $0.02  2.1s $12.34 →│  (fail >5% — warning)
│  ...                                                                     │
│  (sort by totalCostUsd desc — hardcoded)                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.1.4.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Только period filter** — нет filter по provider, fail rate, cost range | High |
| P-2 | **Sort hardcoded** (by totalCostUsd desc) — нельзя по AVG latency, fail rate, calls | High |
| P-3 | **Нет графиков** — только табличное представление | Medium (P-1 из /admin тоже) |
| P-4 | **Нет сравнения период vs предыдущий** | Medium |
| P-5 | **Нет breakdown** по часам/дням внутри функции | Low |
| P-6 | **На мобиле** 7 колонок таблицы не помещаются | High |
| P-7 | **Badge `[A/B]`** мелкая, легко пропустить | Low |
| P-8 | **«Текущая модель»** показана как `font-mono` (openai-proxy/sonnet) — для super_admin OK, но для будущего «инженера саппорта» — нужны человеческие названия | Low |
| P-9 | **Нет агрегированных KPI** в шапке («Всего $234.56 / 12345 вызовов / 1.2% fail» — должно быть hero, перед таблицей) | High |
| P-10 | **Нет threshold-визуализации** — что fail >5% подсвечено цветом, но нет «alert badge» в шапке таблицы | Medium |

##### 6.1.4.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡 Z-Admin → Функции LLM                                                   │
│  Все taskType: модель, экономика, надёжность                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│  │ Вызовов    │ │ Расход     │ │ Avg latency│ │ Доля ошибок│                │
│  │  12,345    │ │  $234.56   │ │   1.4s     │ │   1.2%     │                │
│  │ ↑ +8%      │ │ ↓ −3%      │ │ ↓ −150ms   │ │ ↓ −0.3pp   │                │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ⚠ Функции с fail rate >5%   (3)                       [Показать все]  │ │
│  │ • report-sales-call             7.8% (244 fail из 3120)               │ │
│  │ • theme-cluster                12.4% (12 fail из 97)                  │ │
│  │ • entity-extraction             6.1% (45 fail из 737)                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 🔍 Поиск (имя функции, taskType)                                       │ │
│  │ Фильтры: Провайдер [Все ▼] · Fail rate [Все ▼] · Period [Нед ▼]      │ │
│  │ Сортировка: Расход ↓ / Вызовов / Fail / Latency       [⤓ CSV]         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ФУНКЦИЯ                       МОДЕЛЬ           ВЫЗОВ↕ FAIL↕ AVG$ AVGmS TOTAL↓│
│  ──────────────────────────────────────────────────────────────────────────  │
│  Отчёт по встрече (sales-call) [Sonnet 4]      3,120  1.2%  $0.10 1.2s $312.45│
│  └─ openai-proxy · Pro+ tier · 23ч активность                                │
│  Извлечение блоков идей [A/B] [Haiku 4 vs Sonnet] 1,234 0.5% $0.02 0.4s $23.45│
│  └─ anthropic-direct · A/B активен 5 дн                                      │
│  ...                                                                          │
│                                                                               │
│  Показаны 1–20 из 47          [‹] 1 2 3 [›]                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Breadcrumb + 4 KPI hero** — суммарная картина перед table (P-9).
2. **Алерт-секция fail >5%** в шапке (P-10).
3. **Фильтры:** provider / fail rate / period — закрывает P-1.
4. **Sortable columns** — закрывает P-2.
5. **Sub-row** с провайдером, tier, last activity (мета без drill-down).
6. **A/B badge — крупнее** с подписью «активен 5 дн» (P-7).
7. **Модель — человеческое имя** «Sonnet 4» вместо `openai-proxy/sonnet` (P-8). taskType остаётся в `font-mono` под названием для технической точности.
8. **CSV export** (A-7).

##### 6.1.4.4. Состояния

| Состояние | Что |
|---|---|
| **Loading** | Skeleton 4 KPI + skeleton alerts + skeleton фильтров + 10 skeleton рядов |
| **Empty (нет вызовов)** | «За эту неделю функции LLM не вызывались. Возможно, активность была раньше — попробуйте «за месяц»» |
| **Error** | Inline retry |
| **Forbidden** | page-forbidden |
| **Over-loaded (200+ taskTypes)** | Пагинация 20/50/100 + фильтры обязательны |

##### 6.1.4.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280** | Full table 7 колонок |
| **1024–1279** | Скрывается «Avg latency» (доступна в drill-down) |
| **768–1023** | Скрываются «Avg latency» + «Avg cost» |
| **480–767** | Card-view: каждая функция — карточка с модель + 3 metrics + sparkline |
| **360–479** | Card-view с collapse — только название + Total + статус (fail rate) |

##### 6.1.4.6. Действия и иерархия

- **Primary CTA:** нет (viewer).
- **Secondary:** «⤓ CSV», period picker, filters.
- **Per-row:** клик → drill-down `/admin/usage/functions/[taskType]`. Right-click context menu: «Открыть в новой вкладке», «Скопировать taskType», «Запустить A/B» (если ещё нет).
- **Drill-down:** на детальной странице — те же metrics + графики по часам + список конкретных вызовов с прокруткой.

##### 6.1.4.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/admin/usage/functions?period=week` | items[] | ✓ есть | `previousPeriodTotals`, sortable params, фильтры |
| `GET /api/v1/admin/usage/functions/[taskType]?period=week&groupBy=hour` | breakdown | ✓ частично (есть detail page) | `dailyBreakdown[]` или `hourlyBreakdown[]` |
| `GET /api/v1/admin/usage/functions.csv` | CSV | ✗ нет | A-7 |
| `GET /api/v1/admin/usage/functions/alerts` | список fail>5% | ✗ нет | Для алерт-секции |

##### 6.1.4.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Hero KPI + alerts + filterable table** (рекомендуемый) | Как описано | Полная картина |
| **B — Tree-view: провайдер → модель → функция** | Группировка не по taskType, а по provider/model | Хорошо для cost-attribution analysis, но менее естественно |
| **C — Графики на каждом ряду (sparkline колонка)** | Mini-line chart 7-day trend под каждой функцией | Очень информативно, нужна chart-library с поддержкой 50-pixel sparklines |
| **D — Card grid вместо table** | Каждая функция — карточка с большими metrics + chart | Хорошо для 5-15 функций, плохо для 100+ |

---

#### 6.1.5. `/admin/experiments` — A/B-эксперименты

**Файл:** [ExperimentsListClient.tsx](../../frontend/app/(authenticated)/admin/experiments/ExperimentsListClient.tsx).

##### 6.1.5.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  A/B-эксперименты                                                        │
│  Активные эксперименты по функциям LLM. Запуск нового — со страницы     │
│  конкретной функции.                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  🔬 Извлечение блоков идей                            [Открыть →]       │
│     entity-extraction                                                    │
│  🔬 Тематический кластер                              [Открыть →]       │
│     theme-clustering                                                     │
└─────────────────────────────────────────────────────────────────────────┘

или

┌─────────────────────────────────────────────────────────────────────────┐
│  Активные эксперименты                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  ⓘ Сейчас экспериментов нет.                                            │
│    Чтобы запустить — откройте функцию (Функции LLM → конкретная →      │
│    «Запустить A/B»).                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.1.5.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Только активные эксперименты** — нет paused, draft, archived; нет history | High |
| P-2 | **Запуск из ДРУГОГО места** (`/admin/usage/functions/[taskType]`) — split workflow | High |
| P-3 | **Нет результатов inline** — обязан кликнуть «Открыть», чтобы увидеть winner/loser/значимость | High |
| P-4 | **Нет sorting / filter** — даже на 10 экспериментах будет неудобно | Medium |
| P-5 | **Нет breakdown «варианты эксперимента»** — какие модели сравниваются, какой текущий лидер | High |
| P-6 | **Нет start/end date** — когда запущен, когда планируется завершение | High |
| P-7 | **Нет «traffic split %»** — какой процент трафика идёт на вариант B | Medium |
| P-8 | **Нет stop/pause control** в списке — only через детальную | Medium |
| P-9 | **Heading «A/B-эксперименты»** — рядом нет иконки `FlaskConical`, не сразу понятно что это | Low |

##### 6.1.5.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡 Z-Admin → 🔬 A/B-эксперименты                                            │
│  Сравнение моделей LLM на реальном трафике                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│  │ Активных   │ │ Архивных   │ │ Завершено  │ │ Средн.рост │                │
│  │     3      │ │     12     │ │ за 30 дн: 4│ │ кач. +6.2% │                │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘                │
│                                                                              │
│  [+ Запустить новый эксперимент]                                  [⤓ CSV]   │
│                                                                              │
│  Фильтры: Статус [Активные ▼]  Функция [Все ▼]  Запуск [Любая дата ▼]      │
│                                                                              │
│  ┌─[Активные (3)] [Архив (12)] [История]──────────────────────────────────┐ │
│  │                                                                          │ │
│  │ ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │ │ 🔬 Извлечение блоков идей · entity-extraction                    │  │ │
│  │ │ ▸ Запущен 5 дн назад · 50/50 split                              │  │ │
│  │ │                                                                    │  │ │
│  │ │   A: Sonnet 4    ████████░░░░░  47%   $0.012/вызов  fail 1.2%   │  │ │
│  │ │   B: Haiku 4     ███████████░░  53%   $0.003/вызов  fail 0.8% ★ │  │ │
│  │ │                                                                    │  │ │
│  │ │   Победитель: B (Haiku) — −75% cost, −0.4pp fail                 │  │ │
│  │ │   Значимость: 98.2% (≥95%, можно promoting B)                    │  │ │
│  │ │                                                                    │  │ │
│  │ │   [▶ Promote B как default]  [⏸ Pause]  [Подробнее →]          │  │ │
│  │ └──────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                          │ │
│  │ ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │ │ 🔬 Тематический кластер · theme-clustering                        │  │ │
│  │ │ ▸ Запущен 2 дн назад · 80/20 split (consultant mode)            │  │ │
│  │ │   A: 4o-mini     ████████████░  82%   $0.020/вызов  fail 0.5%   │  │ │
│  │ │   B: T-Pro 32B   ███░░░░░░░░░░  18%   $0.000/вызов  fail 2.1%   │  │ │
│  │ │   Значимость: 32% (ждём ещё 5 дн)                                │  │ │
│  │ │   [⏸ Pause]  [Подробнее →]                                      │  │ │
│  │ └──────────────────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Hero KPI** — overview всех экспериментов (P-1, P-5).
2. **Primary CTA «+ Запустить новый эксперимент»** — в самом списке (P-2). Это снимает split workflow; запуск отсюда либо drill-down → запуск со страницы функции с pre-filled context.
3. **Tabs «Активные / Архив / История»** — закрывает P-1.
4. **Filters** — закрывает P-4.
5. **Каждый эксперимент — карточка с inline-результатами:**
   - Split percentage визуально (bar).
   - Variant performance с inline metrics ($/вызов, fail rate).
   - Победитель помечен звёздочкой ★.
   - **Статистическая значимость** (98.2% / ≥95% → promotable).
   - Inline actions: **Promote**, **Pause** (P-8) + Drill-down.
6. **Запуск + duration** в каждом ряду (P-6).
7. **Traffic split %** видно прямо в bar (P-7).

##### 6.1.5.4. Состояния

| Состояние | Что |
|---|---|
| **Loading** | Skeleton: 4 KPI + tabs + 3 skeleton-карточек экспериментов |
| **Empty (нет активных)** | Hero-empty: «Сейчас нет активных экспериментов. [+ Запустить первый]» |
| **Empty (нет архивных)** | «Архив пуст. Завершите хотя бы один эксперимент» |
| **Error** | Inline retry |
| **Forbidden** | page-forbidden |
| **Pending action (promote/pause)** | Карточка disabled с spinner |

##### 6.1.5.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1024** | 4 KPI в ряд + полная карточка эксперимента |
| **768–1023** | 2 KPI в ряд + карточка |
| **480–767** | 1 KPI в ряд + карточка стек |
| **360–479** | Carousel KPI / карточка с collapse «варианты»; actions sticky-bottom |

##### 6.1.5.6. Действия и иерархия

- **Primary CTA:** «+ Запустить новый эксперимент» (вверху списка).
- **Per-card primary:** «Promote B как default» (если есть значимый winner).
- **Per-card secondary:** «Pause», «Подробнее».
- **Per-card destructive:** «Stop without promote» (в подробнее, не на карточке).

##### 6.1.5.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/admin/experiments?status=active` | items[] | ✓ есть (но только `experimentEnabled` boolean, не full) | Расширить: variants[], trafficSplit, startedAt, endedAt, winner, significance, metrics per variant |
| `POST /api/v1/admin/experiments` | Start | ✓ есть (через `/[taskType]`) | Можно сохранить там же |
| `PATCH /api/v1/admin/experiments/[id]` | Pause/promote/stop | ✗ нет | Новый endpoint |
| `GET /api/v1/admin/experiments/history` | Архив | ✗ нет | Новый endpoint |

##### 6.1.5.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — List with rich cards** (рекомендуемый) | Как описано | Inline инфо без drill-down |
| **B — Table view** | Колонки: Функция / Запуск / Split / Variant A / Variant B / Winner / Status / Actions | Compact, но плохо для card-rich data |
| **C — Kanban**: Запланированные / Активные / Завершённые / Архив | Drag-drop через статусы | Cool, но overkill для 5-10 экспериментов в год |
| **D — Single-page wizard** для запуска (как Linear/Optimizely) | Wizard «1. Функция → 2. Варианты → 3. Split → 4. Запуск» | Хорошо для нового пользователя |

---

#### 6.1.6. `/admin/health` — Здоровье системы

**Файл:** [HealthClient.tsx](../../frontend/app/(authenticated)/admin/health/HealthClient.tsx).

##### 6.1.6.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Здоровье системы                                       [Обновить]      │
│  Очереди (BullMQ), размер БД, доступность Redis. Полный мониторинг —    │
│  фаза 11.                                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐               │
│  │ Redis       │ │ S3          │ │ База данных          │               │
│  │ [OK]        │ │ [unknown]   │ │ 12.4 GB              │               │
│  │ ping ok     │ │ — фаза 11 — │ │ 1,234,567 idea_blocks│               │
│  │             │ │             │ │ 567 entities         │               │
│  │             │ │             │ │ 234,567 raw_events   │               │
│  │             │ │             │ │ 12,345 ai_usage_log  │               │
│  └─────────────┘ └─────────────┘ └──────────────────────┘               │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Очереди BullMQ                                                      │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ QUEUE                  WAIT  ACTIVE  DELAY  FAIL  COMPLETED        │ │
│  │ meeting-process          0     2      5     0     12,345           │ │
│  │ ai-task                  3     1      0     7     5,678            │ │ ← fail > 0
│  │ entity-resolve           0     0      0     0     2,345            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  ⓘ Сгенерировано: 22.05.2026, 14:32                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.1.6.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **S3 не реализован** («мониторинг — фаза 11») — пустая плитка с unknown badge | High — S3 критичен для записей |
| P-2 | **Нет графиков** — только snapshot. Не видно «час назад было хуже» | High |
| P-3 | **Нет history** — таймлайн событий («Redis был DOWN 12:23–12:34») | High |
| P-4 | **Нет per-queue алертов** — failed > 0 подсвечен, но нет threshold ([>5] = warning, [>20] = danger) | Medium |
| P-5 | **Нет worker info** — uptime, memory usage, CPU | Medium |
| P-6 | **Нет LLM provider availability** — самое критичное для super_admin (OpenAI down → всё лежит) | **Critical** |
| P-7 | **Нет API latency** | High |
| P-8 | **Нет error rate trend** | High |
| P-9 | **Нет manual control** — «retry failed jobs», «pause queue», «clear delayed» | Medium |
| P-10 | **Нет alerting/notification setup** — нельзя настроить «уведомить меня если failed > 50» | Low (Фаза 11) |
| P-11 | **Нет grouping по сервисам** — Infrastructure (Redis/S3/DB) vs Application (Queues/Workers) vs External (LLM providers) | Medium |
| P-12 | **Heading и подзаголовок** говорят «фаза 11» — пользователь видит «не готово», бренд страдает | Low |

##### 6.1.6.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🛡 Z-Admin → Здоровье системы                                              │
│  ✓ Всё работает · обновлено 8с назад · авто-обновление каждые 30с [⏸]      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ── Инфраструктура ────────────────────────────────────────────────────────  │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                   │
│  │ Postgres       │ │ Redis          │ │ S3 (Yandex)    │                   │
│  │ ✓ OK · 8ms     │ │ ✓ OK · 1ms     │ │ ✓ OK · 45ms    │                   │
│  │ 12.4 GB / 50GB │ │ 234 MB used    │ │ 456 GB / 1 TB  │                   │
│  │ ╭───────────╮  │ │                │ │                │                   │
│  │ │ 25% диска │  │ │                │ │                │                   │
│  │ ╰───────────╯  │ │                │ │                │                   │
│  └────────────────┘ └────────────────┘ └────────────────┘                   │
│                                                                              │
│  ── Внешние провайдеры (LLM, ASR) ─────────────────────────────────────────  │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐│
│  │ OpenAI proxy   │ │ Anthropic      │ │ Vox ASR        │ │ GigaAM         ││
│  │ ✓ OK · 234ms   │ │ ⚠ Slow · 4.5s  │ │ ✓ OK · 12ms    │ │ ✓ OK · 89ms    ││
│  │ 0.1% fail/24ч  │ │ 2.3% fail/24ч  │ │ 0.0% fail/24ч  │ │ 0.0% fail/24ч  ││
│  └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘│
│                                                                              │
│  ── Очереди и воркеры ─────────────────────────────────────────────────────  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ QUEUE                 WAIT  ACTIVE  DELAY  FAIL  DONE       ДЕЙСТВИЯ   │ │
│  │ ───────────────────────────────────────────────────────────────────── │ │
│  │ meeting-process        0     2       5     0     12,345    [⋮]         │ │
│  │ ai-task                3     1       0    7⚠     5,678    [Retry][⋮]  │ │
│  │ entity-resolve         0     0       0     0     2,345    [⋮]         │ │
│  │ knowledge-export      12     0       0     0     567      [Pause][⋮]  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ── Активность последний час ──────────────────────────────────────────────  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ API requests / min:                                                     │ │
│  │   200 ┤        ╭──╮                                                     │ │
│  │       │       ╱    ╲                                                    │ │
│  │   100 ┤    ╱──      ╲────╮                                              │ │
│  │       ├──╯               ╰─                                             │ │
│  │       └─────────────────────────                                        │ │
│  │       60м    45м    30м    15м    Сейчас                                │ │
│  │                                                                          │ │
│  │ Errors / min:  средн 0.5  макс 3  Latency p95: 234ms                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ── Журнал событий (последние 24ч) ─────────────────────────────────────────│
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 14:32  ✓ Все системы OK                                                 │ │
│  │ 12:23  ⚠ Anthropic slow >3s (12 минут)                                  │ │
│  │ 08:45  🛑 Redis DOWN (5 минут) — auto-recovered                         │ │
│  │ 02:10  ℹ Postgres VACUUM завершён, освобождено 2.3GB                    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Hero status «✓ Всё работает» / «⚠ Внимание» / «🛑 Critical»** в шапке + auto-refresh каждые 30с (можно паузить).
2. **Группировка по доменам** (P-11): Инфраструктура / Внешние провайдеры / Очереди / Активность / Журнал. Каждая группа — section.
3. **S3 реализован** (P-1) — placeholder заменён на реальный мониторинг (это API-задача).
4. **LLM providers section** (P-6) — **самое критичное**, был полностью отсутствует. OpenAI/Anthropic/Vox/GigaAM с latency и fail rate.
5. **Postgres disk gauge** — мини-визуализация % использования диска (CF-4 gauge type).
6. **Queue actions inline** (P-9) — Retry / Pause / dropdown menu с per-queue actions.
7. **График API requests / min** (P-7, P-8) — последний час + p95 latency.
8. **Журнал событий** (P-3) — таймлайн с auto-recovered / манул-fix маркерами.
9. **Threshold visualizations** (P-4): failed >5 = warning badge, >20 = danger; auto-detect.
10. **Manual auto-refresh control** в шапке.

##### 6.1.6.4. Состояния

| Состояние | Что |
|---|---|
| **Loading** | Skeleton всех секций (placeholder boxes) |
| **Empty (новая система, нет истории)** | «Журнал пуст — это первый день работы». Остальные секции работают |
| **Error (само health endpoint упал)** | Это **критический случай** — выводится полноэкранный alert «Не удалось получить состояние системы. Попробуйте через 30 секунд.» Не показываем серый «unknown» — пользователь должен понимать что мониторинг сломан |
| **Partial outage** (Redis OK, Postgres DOWN) | Hero — «🛑 Critical», секция Postgres подсвечена красным, остальные нормально |
| **Forbidden** | page-forbidden |
| **Auto-refresh paused** | Hero badge «обновление приостановлено» |

##### 6.1.6.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280** | Full layout с 4-колоночными провайдер-tiles |
| **1024–1279** | 3-колоночный provider grid |
| **768–1023** | 2-колоночный provider grid + queue table compact |
| **480–767** | 1-колоночный stack, queue table → card-view |
| **360–479** | Hero только текстом «✓ Всё работает», collapse-сечения, журнал в самом конце |

##### 6.1.6.6. Действия и иерархия

- **Primary CTA:** нет (viewer-page, manual refresh — secondary).
- **Secondary:** Pause auto-refresh, Manual refresh.
- **Per-queue actions:** Retry failed (если failed>0), Pause queue, Clear delayed, View jobs.
- **Per-provider:** Test connection (manual ping), View error log (drill-down к /admin/usage/functions для этого provider'а).

##### 6.1.6.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/admin/health` | Текущий снэпшот | ✓ есть (Redis + DB + queues) | Добавить: `s3`, `providers[]` (LLM/ASR с pingMs/failRate24h), `disk` (для DB), `apiMetrics` (rps/p95/errors последний час), `recentEvents[]` |
| `POST /api/v1/admin/queues/[name]/retry` | Retry failed | ✗ нет | Новый |
| `POST /api/v1/admin/queues/[name]/pause` / `resume` | Toggle pause | ✗ нет | Новый |
| `POST /api/v1/admin/queues/[name]/clear?status=delayed` | Clear | ✗ нет | Новый, с confirm |
| `POST /api/v1/admin/providers/[id]/test` | Manual ping | ✗ нет | Новый |
| `GET /api/v1/admin/events?period=24h` | Журнал событий | ✗ нет | Новый, для timeline |

##### 6.1.6.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Grouped sections + timeline** (рекомендуемый) | Как описано | Operational mindset «всё видно с одного экрана» |
| **B — Status page-style** (как statuspage.io) | Каждый компонент — одна строка с green/yellow/red + uptime% за 90 дней | Хорошо для public status, плохо для actionable monitoring |
| **C — Grafana embedded** | Iframe с Grafana панелью | Дёшево и мощно, но vendor lock-in + хуже UX чем native |
| **D — Single uptime indicator + drill-down** | Hero «99.97% uptime» + клик → детали | Минималистично, но плохо для troubleshooting |

---

---

### 6.2. Org-кабинет

#### 6.2.1. `/dashboard` — Director Dashboard (для owner/admin)

**Файл:** [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx).

##### 6.2.1.1. Текущее состояние

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Привет, Иван                              [ Неделя | Месяц ]  [↻ Обнов.] │
│  Срез знаний компании за неделю.                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ ✨ IntroWizardWidget                                                │ │
│  │ (если wizard не пройден — большая баннер «Пройти знакомство»)      │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ ✨ AI-сводка за неделю                                              │ │
│  │ За неделю команда обсудила 12 ключевых тем... [LLM-narrative]      │ │
│  │ AI-сводка, может содержать ошибки.                                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌──────────────────────────┐ ┌──────────────────────────┐               │
│  │ Структура компании       │ │ Что узнали за неделю     │ ← 2-col       │
│  │ (StructureSummary)       │ │ (WhatLearned)            │               │
│  │ ─────────────────────    │ │ ─────────────────────    │               │
│  │ 5 отделов · 12 должн.    │ │ Новые темы | Новые сигн.│               │
│  │ 47 сотрудников           │ │ ...        | ...        │               │
│  └──────────────────────────┘ └──────────────────────────┘               │
│                                                                            │
│  ┌──────────────────────────┐ ┌──────────────────────────┐               │
│  │ Сигналы клиентов  (12)   │ │ Активные темы  (8)       │               │
│  │ ─────────────────────    │ │ ─────────────────────    │               │
│  │ Запрос  ████████ 4       │ │ • Тема А 📈   12 блоков │               │
│  │ Жалоба  ████ 2           │ │ • Тема Б     8 блоков   │               │
│  │ ...                       │ │ ...                       │               │
│  └──────────────────────────┘ └──────────────────────────┘               │
│                                                                            │
│  ┌──────────────────────────┐ ┌──────────────────────────────────────┐  │
│  │ Главные сущности  (10)   │ │ Открытые вопросы  (4)                │  │
│  │ ─────────────────────    │ │ ─────────────────────                │  │
│  │ ООО Альфа [client] 12    │ │ ┌──────────────────────────────┐    │  │
│  │ Иванов И. [person] 8     │ │ │ Какие KPI для Q4?            │    │  │
│  │ ...                       │ │ │ Зафиксировано 5 авг          │    │  │
│  │                           │ │ └──────────────────────────────┘    │  │
│  └──────────────────────────┘ └──────────────────────────────────────┘  │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ ⚖ Согласованность стратегии                                         │ │
│  │ (StrategicAlignmentWidget — зарезервировано на Фазу 9)              │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 💬 Спросите про вашу компанию                                       │ │
│  │ AI ищет ответ в архиве встреч, отвечает с цитатами                 │ │
│  │ [OrgChatPanel — 400px height]                                       │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

##### 6.2.1.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **10 виджетов на одной странице** (IntroWizard + AI-сводка + 7 grid + StrategicAlignment + OrgChatPanel) — простыня прокрутки 5+ экранов на мобиле | **Critical** — это главная боль (см. 5.2) |
| P-2 | **Все виджеты одной важности** — нет hero-KPI, нет иерархии | High |
| P-3 | **Period switch только Неделя/Месяц** — нет «вчера», «сегодня», «квартал», «90 дней» | Medium |
| P-4 | **«Обновить» с RefreshCcw** — G-2 inconsistent loading indicator | Low |
| P-5 | **EmptyHint текстовый** «Пока недостаточно данных» — без иконки, без CTA | Medium (нарушает 4.7) |
| P-6 | **Emoji 📈 inline в коде** — нарушает C-8 («без эмодзи в основных ответах») | Medium |
| P-7 | **OrgChat встроен в дашборд** — занимает 400px, перегружает; для дискуссии лучше отдельный экран `/chat` | High |
| P-8 | **StrategicAlignment** — зарезервирован, пустая плитка | Medium |
| P-9 | **«Сегодня vs вчера»** не показано — только период целиком | High |
| P-10 | **Card-design плоский** — все 7 одинаковые, нет визуальной приоритизации | Medium |
| P-11 | **HotEntities без drill-down** — стрелка «vNext», просто title — пользователь видит «Иванов И. 8 упом.», но не может кликнуть | Medium |
| P-12 | **Sidebar group action «Подборка по типу сигнала — vNext»** — недореализовано, видно пользователю | Low |
| P-13 | **Нет «требует моего внимания»** секции (типа «Открытых вопросов», но более срочных) — нет inbox flow | Medium |
| P-14 | **AI-сводка** в большом блоке вверху — нельзя свернуть | Low |
| P-15 | **«Привет, Иван»** — единственное обращение, не персонализировано (не «Вот что важно для тебя сегодня») | Low |
| P-16 | **На мобиле 360px** — все cards в 1 столбец, прокрутка 8+ экранов | High |

##### 6.2.1.3. Рекомендации (Hero KPI + Collapsible Sections — вариант A из 5.2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Дашборд компании · ООО Альфа              [Период: 7 дней ▼] обновл 12с │
│  Срез памяти компании за неделю.                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ Встреч      │ │ Новых тем   │ │ Сигналов    │ │ Открыт. вопр│            │
│  │     34      │ │     5       │ │     47      │ │      8      │            │
│  │ ↑ +12% к нед│ │ ↑ +2 нед.   │ │ ↑ +15 к нед │ │ ↓ −3 закрыто│            │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ✨ Главное за неделю (AI-сводка)                            [Свернуть] │ │
│  │ ────────────────────────────────────────────────────────────────────── │ │
│  │ За неделю команда обсудила 12 ключевых тем. Ключевые риски:           │ │
│  │ задержка с релизом Q3, нехватка ресурсов в команде дизайна,          │ │
│  │ возможные изменения в стратегии монетизации. Основные клиенты:        │ │
│  │ ООО Альфа (3 встречи), Бета-Group (2), Гамма (1).                     │ │
│  │ ─────                                                                   │ │
│  │ AI-сводка, может содержать ошибки.   [Полная сводка →]                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ▼ Знания (5 новых тем, 47 сигналов)                              [Свернуть]│
│  ────────────────────────────────────────────────────────────────────────── │
│  ┌──────────────────────────┐ ┌──────────────────────────┐                  │
│  │ Новые темы               │ │ Активные темы            │                  │
│  │ • Запуск Q4 (12 блоков) ▲│ │ • Релиз 2026.5  (12 блок)│                  │
│  │ • Найм 5 разраб.   (8)  │ │ • Бюджет Q4     (8)      │                  │
│  │ • ...                    │ │ ...                       │                  │
│  └──────────────────────────┘ └──────────────────────────┘                  │
│                                                                              │
│  ▶ Сигналы клиентов (47)                                          [Развер.] │
│                                                                              │
│  ▶ Главные сущности (10)                                          [Развер.] │
│                                                                              │
│  ▼ Что требует внимания                                            [Свернуть]│
│  ────────────────────────────────────────────────────────────────────────── │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ❓ Открытые вопросы                                           (4)       │ │
│  │ • Какие KPI для Q4? — зафиксировано 5 авг                              │ │
│  │ • Готов ли бюджет на найм? — зафиксировано 3 авг                       │ │
│  │ • ...                                                                    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ⚖ Согласованность стратегии                              (раздел γ)    │ │
│  │ Появится после загрузки целей и стратегии.                              │ │
│  │ [Загрузить документ стратегии →]                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ─────                                                                       │
│  💬 Спросить у памяти компании →  ⬅ переход на /chat                       │
│  (не inline-чат, а ссылка)                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **4 hero-KPI** (P-2) с delta «vs прошлая неделя» — мгновенный pulse. Применим **GAS-Storytelling** из A-4.
2. **AI-сводка свёртываемая** (P-14) — экономия места.
3. **Виджеты сгруппированы в collapsible sections** (P-1): «Знания», «Сигналы клиентов», «Главные сущности», «Что требует внимания». По умолчанию: «Знания» + «Требует внимания» открыты, остальные свёрнуты с counter.
4. **«Что требует внимания»** новая секция (P-13) объединяет Open Questions + Strategic Alignment (когда будет наполнен) + другие future flags.
5. **Strategic Alignment с CTA** (P-8) вместо «зарезервировано» — «Появится после загрузки документа стратегии» + button.
6. **OrgChat — выведен в отдельный link** (P-7), не встроен. Освобождает 400px на дашборде.
7. **Period picker** расширен (P-3): «1 день / 7 дней / 30 дней / Custom».
8. **Drill-down везде** (P-11): hot entities → `/entities/[id]` (когда будет в γ), сигналы → drill-down с фильтром.
9. **Emoji → Lucide TrendingUp icon** (P-6).
10. **Freshness в шапке** (A-6) — «обновлено 12с назад» вместо footnote.

##### 6.2.1.4. Состояния

| Состояние | Что |
|---|---|
| **Loading (full)** | Skeleton 4 KPI + skeleton AI-сводки + skeleton sections |
| **Loading (partial)** | KPI tiles загружены, sections с individual skeletons |
| **Empty (новая компания, wizard не пройден)** | IntroWizardWidget доминирует во всю ширину; KPI скрыты; внизу «Пока данных нет — пройдите знакомство, чтобы увидеть пульс компании» |
| **Empty (wizard пройден, мало данных за неделю)** | KPI с нулями + текст «Пока недостаточно данных за неделю — попробуйте за месяц или вернитесь через несколько дней» + ссылка переключить period |
| **Empty (member without role)** | На /dashboard member не попадёт — редирект на /me. Если попал — баннер «Вашу должность ещё не назначили» |
| **Error** | Per-section retry (если AI-сводка упала — она показывает retry, KPI остаются) |
| **Over-loaded (сильно активная Org)** | KPI остаются 4. Sections содержат «топ-10» + ссылку «Все» |

##### 6.2.1.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280** | 4 KPI в ряд + AI-сводка + 2-col sections |
| **1024–1279** | 4 KPI в ряд + AI-сводка + 2-col sections |
| **768–1023** | 2 KPI в ряд + AI-сводка + 1-col sections |
| **480–767** | 2 KPI в ряд + AI-сводка свёрнута по умолчанию + sections все свёрнуты, открываются по тапу |
| **360–479** | 1 KPI в ряд + всё свёрнуто (KPI, AI-сводка, sections) — пользователь сам открывает что нужно. Sticky period picker внизу |

##### 6.2.1.6. Действия и иерархия

- **Primary CTA:** «✨ Создать встречу» (в Sidebar, не на дашборде).
- **Secondary:** Period picker, Refresh.
- **Per-KPI tile:** клик → переход на детальный экран (Встреч → `/meetings?period=...`, Тем → `/themes?period=...`, и т.п.).
- **Per-section:** [Свернуть/Развернуть], [Все темы →] kind of links.
- **AI-сводка:** [Свернуть], [Полная сводка →] (открывает modal с длинным текстом).
- **«Что требует внимания»:** для каждого item — action button («Закрыть вопрос», «Ответить на вопрос», «Загрузить документ»).

##### 6.2.1.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/dashboard/director?period=week` | data | ✓ есть | Добавить: `previousPeriodTotals` для delta, custom date range, `attentionItems[]` (объединить open questions + future flags) |
| `GET /api/v1/dashboard/director/summary?period=week` | AI-сводка | ✓ есть (`narrativeSummary` в data) | OK |
| `GET /api/v1/dashboard/director/summary/full?period=week` | Длинная сводка | ✗ нет | Для modal «Полная сводка →» |

##### 6.2.1.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Hero KPI + Collapsible Sections** (рекомендуемый) | Как описано | Mobile-friendly, прогрессивное раскрытие |
| **B — Tabs** | 3 таба: «Сейчас» / «Знания» / «Сигналы» | Sharper context per tab, но 3 click чтобы увидеть всё |
| **C — Customizable widgets** (Mixpanel Boards) | Drag-drop reorder, hide/show | Мощно, но overkill для MVP |
| **D — AI-curated** | LLM решает порядок виджетов | Слишком магия, непредсказуемо |
| **E — Two-column** | Hero KPI + left=новое, right=внимание | Хорошо для desktop, плохо для мобиля |

---

#### 6.2.2. `/me` — Личный кабинет (default landing для member)

**Файл:** [MeClient.tsx](../../frontend/app/(authenticated)/me/MeClient.tsx).

##### 6.2.2.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Иван Петров                                                             │
│  💳 Менеджер по продажам · 🧑‍🤝‍🧑 Отдел продаж                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Моя карта должности                                                 │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ ОБЯЗАННОСТИ              НАВЫКИ                                     │ │
│  │ • Вести переговоры        • Презентации                            │ │
│  │ • Готовить КП             • CRM (Bitrix24)                         │ │
│  │ ...                                                                  │ │
│  │                                                                      │ │
│  │ или (если пусто)                                                    │ │
│  │ «Карта формируется. Заполнится автоматически по мере встреч,        │ │
│  │ документов и дампов.»                                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 📄 Мои документы                                                    │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ • cv-petrov-2026.pdf                              [готово]          │ │
│  │ • presentation-q1.pdf                             [готово]          │ │
│  │ • договор-альфа.docx                              [обрабатывается]  │ │
│  │ ...                                                                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 📅 Мои встречи                                                      │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ • Встреча с Альфа               3 сент                              │ │
│  │ • Sales call Бета               2 сент                              │ │
│  │ ...                                                                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.2.2.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Нет аватара** в шапке — обезличенно | Medium |
| P-2 | **Нет «Все мои документы»** ссылки в Card — только 5 первых | High |
| P-3 | **Нет «Все мои встречи»** ссылки — то же | High |
| P-4 | **Empty карта** «формируется» — нет ETA, нет «нужно ещё X встреч/документов» | Medium |
| P-5 | **Нет CTA «Загрузить документ»** на Card | Medium |
| P-6 | **Нет greeting message** (на /dashboard есть «Привет, Иван», тут — нет) | Low |
| P-7 | **Нет «требует моего внимания»** для member — обещания (`signalType=promise`), вопросы ко мне | High (когда будет в γ) |
| P-8 | **Карта должности RoleProfile.summaryCache** — рендерится 1-в-1 (responsibilities/skills/decisions/...). Если LLM выдала 20 пунктов в responsibilities — будет огромная простыня | Medium |
| P-9 | **3 cards одинаковые** — нет иерархии «что важнее» | Low |
| P-10 | **«ОБЯЗАННОСТИ» UPPERCASE** — для русского текста очень тяжело читать (Cyrillic letterforms) | Medium (C-3) |
| P-11 | **Нет статуса заполненности RoleProfile** в виде progress (12/20 разделов) | Low |

##### 6.2.2.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌───────┐                                                                   │
│  │  ИП   │   Иван Петров                          ivan@alfa.ru               │
│  │  IP   │   Менеджер по продажам ›  Отдел продаж ›                         │
│  └───────┘   В компании с 14 апреля 2026 (40 дней)                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ⓘ Что важно для меня сегодня                                            │ │
│  │ ────────────────────────────────────────────────────────────────────── │ │
│  │ • Ответьте на вопрос «Когда КП для Альфа?» (от Иванова, 2д назад)     │ │
│  │ • 3 встречи на этой неделе                                              │ │
│  │ • Карта должности заполнилась на 40% — ждём ещё ~5 встреч              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 🪪 Моя карта должности                              Заполнена на 40%    │ │
│  │ ────────────────────────────────────────────────────────────────────── │ │
│  │                                                                          │ │
│  │ Обязанности (5)                Навыки (3)                              │ │
│  │ • Вести переговоры             • Презентации                            │ │
│  │ • Готовить КП                  • CRM (Bitrix24)                         │ │
│  │ • Закрывать сделки             • Анализ потребностей                    │ │
│  │ ...                                                                      │ │
│  │                                                                          │ │
│  │ Решения, которые принимаю      Стиль работы                             │ │
│  │ (не наполнено — ждём ещё встреч)  (не наполнено)                        │ │
│  │                                                                          │ │
│  │ [Полная карта →]                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌──────────────────────────────────┐ ┌──────────────────────────────────┐ │
│  │ 📄 Мои документы (24)            │ │ 📅 Мои встречи (47)              │ │
│  │ ────────────────────────────────│ │ ────────────────────────────────│ │
│  │ cv-petrov-2026.pdf       готово  │ │ Встреча с Альфа           3 сент │ │
│  │ presentation-q1.pdf      готово  │ │ Sales call Бета           2 сент │ │
│  │ договор-альфа.docx       обраб   │ │ Демо Гамма                1 сент │ │
│  │ ...                              │ │ ...                              │ │
│  │ [+ Загрузить] [Все →]            │ │ [+ Создать встречу] [Все →]      │ │
│  └──────────────────────────────────┘ └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Avatar** в шапке (P-1) — инициалы (или загруженное фото) + контактная информация (email) + длительность в Org.
2. **«Что важно для меня сегодня»** — новая hero-секция (P-7). Хотя обещания и вопросы — γ, можно начать с простых things: счётчик встреч, статус карты.
3. **«Заполнена на 40%»** badge на карте должности (P-11).
4. **Карта в 2-колоночной grid** — обязанности/навыки в одной строке, решения/стиль во второй. Менее простыня (P-8).
5. **Не наполненные разделы** прямо показаны как «ждём ещё встреч» — пользователь понимает прогресс.
6. **«Полная карта →»** link для drill-down (P-2 equivalent).
7. **Card actions** — «+ Загрузить» документ, «+ Создать встречу», «Все →» (P-2, P-3, P-5).
8. **2-col layout** для Documents + Meetings (P-9).
9. **UPPERCASE → нормальный case** (P-10): «Обязанности» вместо «ОБЯЗАННОСТИ».
10. **Counts в title cards** «Мои документы (24)» — пользователь видит сколько всего без прокрутки.

##### 6.2.2.4. Состояния

| Состояние | Что |
|---|---|
| **Loading** | Skeleton header + skeleton attention + skeleton role-profile + 2 skeleton lists |
| **Empty (только что приглашён, без должности)** | Hero baner «Вашу должность ещё не назначили. Попросите администратора»; cards «Мои документы» и «Мои встречи» — стандартные с empty states |
| **Empty (карта пустая)** | Карта показывается с заголовками разделов и «ждём ещё встреч / документов с вашей ролью»; прогресс 0% |
| **Empty (нет документов)** | «Документы пока не загружены. [+ Загрузить первый]» |
| **Empty (нет встреч)** | «Встреч пока нет. [+ Создать встречу]» |
| **Error (carta load)** | Inline retry в Card |
| **Forbidden** | «Этот раздел доступен только в рамках Org» |

##### 6.2.2.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280** | Full 2-col Documents + Meetings; role profile 2-col |
| **768–1279** | Documents + Meetings stack; role profile 2-col |
| **480–767** | Все stack; role profile 1-col |
| **360–479** | Все stack; avatar slightly меньше; attention секция collapsed |

##### 6.2.2.6. Действия и иерархия

- **Primary CTA:** действия из «Что важно для меня сегодня» (ответить на вопрос, ...).
- **Secondary:** «+ Загрузить документ», «+ Создать встречу».
- **Per-document:** клик → `/documents/[id]`.
- **Per-meeting:** клик → `/meetings/[id]/result`.
- **Role link:** клик на должность в шапке → `/roles/[id]`.
- **Department link:** клик на отдел в шапке → `/structure?tab=departments&id=...`.

##### 6.2.2.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/structure/me?orgId=...` | profile | ✓ есть (404 если не настроен) | Добавить: `completeness` (процент карты), `attentionItems[]` |
| `GET /api/v1/documents?uploaderId=me` | Мои документы | ✓ частично | Серверный фильтр `uploaderId=me` (см. комментарий в коде) |
| `GET /api/v1/meetings?participantId=me&limit=5` | Мои встречи | ✗ частично | Backend сейчас фильтрует по cookie; явный `participantId=me` — лучше |
| `GET /api/v1/role-profiles/me/preview` | Превью RoleProfile + completeness | ✗ нет | Для completeness % |

##### 6.2.2.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Attention + Profile + 2-col cards** (рекомендуемый) | Как описано | Баланс информативности и простоты |
| **B — Текущее минимальное** | Без attention секции, без 2-col | Минимально, но не даёт ценности с первого взгляда |
| **C — Tabs (Профиль / Документы / Встречи / Активность)** | Глубже, но требует больше навигации | Для рабочей странницы — overkill |
| **D — Activity feed дома** (как Twitter home) | Лента «что произошло со мной» — обновления карты, новые встречи, упоминания | Возможно интересно, но overkill для Фазы 0 |

---

#### 6.2.3. `/structure` — Структура компании (3 таба)

**Файл:** [StructureClient.tsx](../../frontend/app/(authenticated)/structure/StructureClient.tsx) + [DepartmentsTab.tsx](../../frontend/app/(authenticated)/structure/DepartmentsTab.tsx) + RolesTab + PersonsTab.

##### 6.2.3.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Структура                                                               │
│  Отделы, должности и сотрудники компании.                                │
│  ────────────────────────────────────────────────────────────────────── │
│  [ 🏢 Отделы  |  🪪 Должности  |  👥 Сотрудники ]                       │
│  ────────────────────────────────────────────────────────────────────── │
│  (содержимое выбранного таба)                                            │
│  - Отделы: список с CRUD                                                 │
│  - Должности: список с CRUD + фильтр по отделу                           │
│  - Сотрудники: список с CRUD + статус приглашения + действия            │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.2.3.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Heading без счётчиков** — «5 отделов · 12 должностей · 47 сотрудников» |  Medium |
| P-2 | **Tabs без counter badges** | Medium |
| P-3 | **Нет глобального поиска** по всем 3 таблицам сразу | High |
| P-4 | **canEdit меняет только наличие кнопок** — нет visual indicator «viewer-mode» | Low |
| P-5 | **Нет «Импорт из CSV»** для bulk-create (открытый вопрос #4 зонтичного ТЗ) | Medium |
| P-6 | **Нет export to CSV** для архива | Medium |
| P-7 | **Нет drill-down view** — выбранный отдел/должность/сотрудник открывает edit-modal, не sidebar-preview | Medium |
| P-8 | **Нет breadcrumb** «Компания → Структура → Отделы» | Low |
| P-9 | **На табе «Должности» нет фильтра по отделу в URL** — фильтр в state, не persist | Low |
| P-10 | **Нет drag-drop** для переназначения сотрудников между отделами | Low (Фаза γ) |
| P-11 | **Нет «древовидной» структуры отделов** (parent/child) — даже если в БД есть `parentDepartmentId`, UI плоский (это решение зонтичного ТЗ) | Medium для γ |
| P-12 | **Подзаголовок «Просмотр.»** для viewer-mode — единственный indicator (P-4) | Low |

##### 6.2.3.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Компания → Структура                                                       │
│  5 отделов · 12 должностей · 47 сотрудников          [Viewer mode 👁]      │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────┐    ┌──────────────────────────────┐  │
│  │ 🔍 Поиск по всей структуре       │    │ [+ Добавить] [⤓ CSV] [⋮]    │  │
│  └──────────────────────────────────┘    └──────────────────────────────┘  │
│                                                                              │
│  [🏢 Отделы (5)] [🪪 Должности (12)] [👥 Сотрудники (47/52)]               │
│  ────────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  Сотрудники (47 активных, 5 в приглашениях)                                 │
│  Фильтры: Отдел [Все ▼]  Должность [Все ▼]  Статус [Активные ▼]           │
│                                                                              │
│  ИМЯ                  EMAIL              ДОЛЖНОСТЬ            ОТДЕЛ      ⋮ │
│  ────────────────────────────────────────────────────────────────────────── │
│  ИП Иван Петров       ivan@alfa.ru       Менеджер по прод.   Продажи    ⋮ │
│  П.С. Петя Сидоров    petr@alfa.ru       Разработчик          Разработка ⋮ │
│  📩 anna@alfa.ru ⓘ приглашение отправл. 3д назад              —         ⋮ │
│  ...                                                                          │
│                                                                              │
│  Показаны 1–20 из 52        [‹ Назад] [1] 2 3 [›]                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Sticky right-panel при клике на сотрудника:**

```
                                          ┌────────────────────────────────┐
                                          │ Иван Петров               [×] │
                                          │ ────────────────────────────── │
                                          │ Email:     ivan@alfa.ru       │
                                          │ Должность: Менеджер по прод.  │
                                          │ Отдел:     Продажи            │
                                          │ В Org с:   14 апр 2026         │
                                          │                                │
                                          │ [Открыть профиль]              │
                                          │ [Переназначить должность]      │
                                          │ [Удалить из компании]          │
                                          │                                │
                                          │ ── История ──                  │
                                          │ 14 апр • Приглашён             │
                                          │ 14 апр • Принял приглашение    │
                                          │ 21 апр • Назначен «Менеджер»   │
                                          └────────────────────────────────┘
```

**Что изменилось:**

1. **Breadcrumb** «Компания → Структура» (U-1).
2. **Counters в шапке** (P-1, P-2): «5 отделов · 12 должностей · 47 сотрудников» — мгновенный pulse без клика на табы. Badge counter на каждом табе.
3. **Глобальный поиск** (P-3) — ищет по всем 3 типам, результаты группируются.
4. **CSV import/export** (P-5, P-6).
5. **Viewer-mode badge** (P-4, P-12) явно в шапке.
6. **Sticky right-panel** при клике на любую сущность — preview + actions (P-7).
7. **Sub-row статус приглашения** для сотрудников: «📩 anna@alfa.ru · приглашение отправлено 3д назад».
8. **Filters per-tab** в URL (P-9).
9. **Pagination** для таблиц с >20 элементов.
10. **Drag-drop** между отделами — выделено как γ-feature (P-10).

##### 6.2.3.4. Состояния

| Состояние | Что |
|---|---|
| **Loading (per-tab)** | Skeleton 5–10 строк per tab |
| **Empty (новая компания после wizard)** | Если только что прошёл wizard — отделы заполнены, должности заполнены, сотрудники = только owner. На табе «Сотрудники» — empty hint: «Только вы пока. [Пригласить первого]» |
| **Empty (фильтр)** | «По фильтру ничего не найдено. [Сбросить]» |
| **Error** | Inline retry per tab |
| **Forbidden (member на edit-action)** | Кнопка disabled с tooltip «Только администратор может изменять» |
| **Pending invitation** | Сотрудник в таблице с статусом «приглашение отправлено» |
| **Bulk action pending** | Sticky-bottom action bar с spinner |

##### 6.2.3.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1024** | Полная таблица + sticky right-panel |
| **768–1023** | Полная таблица, right-panel → Sheet (slide-in) |
| **480–767** | Таблица скрывает колонки EMAIL и ОТДЕЛ (доступны в drill-down) |
| **360–479** | **Card-view** вместо table: каждый сотрудник — карточка с avatar + name + role + email; sticky filters |

##### 6.2.3.6. Действия и иерархия

- **Primary CTA:** «+ Добавить» — контекстная по табу (Отдел / Должность / Сотрудника / Пригласить).
- **Secondary:** «⤓ CSV», «📤 Импорт CSV».
- **Per-row:** клик → sticky right-panel.
- **Per-row menu «⋮»:** «Изменить», «Переназначить», «Удалить» (с confirm modal, не window.confirm).
- **Bulk (когда выбрано ≥1):** «Переназначить отдел», «Заморозить», «Удалить» с confirm modal.

##### 6.2.3.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/structure/departments` | items[] | ✓ есть | Добавить counts (members, roles) per department |
| `GET /api/v1/structure/roles` | items[] | ✓ есть | Counts + filter by department |
| `GET /api/v1/structure/persons` | items[] | ✓ есть | Pagination + filter by department/role/status |
| `GET /api/v1/structure/search?q=...` | Глобальный поиск | ✗ нет | Новый — ищет по всем 3 типам |
| `POST /api/v1/structure/import/csv` | Bulk-create | ✗ нет | Открытый вопрос #4 зонтичного ТЗ |
| `GET /api/v1/structure/export.csv` | CSV-export | ✗ нет | Для архива/планёрки |
| `POST /api/v1/structure/persons/[id]/reassign` | Сменить должность | ✗ нет (есть только update) | Семантично понятный endpoint |

##### 6.2.3.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Tabs + table + sticky right-panel** (рекомендуемый) | Как описано | Стандартно, хорошо знакомо |
| **B — Org-chart tree** | Древовидная визуализация отдел → должность → сотрудник | Visually rich, но плохо для 100+ сотрудников |
| **C — Card grid per role** | На вкладке «Должности» — grid карточек по role с counts | Хорошо для visual scan, но плохо для CRUD |
| **D — Single-page без табов** | 3 секции на одной странице (Departments + Roles + Persons stacked) | Видно сразу, но overload на больших Org |
| **E — Kanban** | Сотрудники → колонки по отделам, drag-drop переназначение | Cool, но overkill для базового структурного управления |

---

---

#### 6.2.4. `/roles/[id]` — Карта должности (RoleProfile)

**Файл:** [RoleDetailClient.tsx](../../frontend/app/(authenticated)/roles/[id]/RoleDetailClient.tsx).

##### 6.2.4.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← К списку должностей                                                   │
│  Менеджер по продажам                                                    │
│  Отдел: Продажи                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 👥 Назначенные сотрудники  [3]                                      │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ Иван Петров          ivan@alfa.ru          [Снять с должности]    │ │
│  │ Анна Сидорова        anna@alfa.ru          [Снять]                │ │
│  │ ...                                                                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 📄 Должностная инструкция                          [Загрузить]      │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ Файл загружен и попадёт в карту после парсинга. (или 'не загружена')│ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Карта должности                  [↻ Пересобрать карту]              │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ (2-col grid: Обязанности | Навыки                                   │ │
│  │             Решения        | Грабли                                 │ │
│  │             Стиль работы)                                            │ │
│  │                                                                      │ │
│  │ ── Источники ──                                                     │ │
│  │ [встреча] Sales call Альфа                                           │ │
│  │ [документ] cv-petrov-2026.pdf                                        │ │
│  │ ...                                                                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.2.4.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **«← К списку должностей»** — это не breadcrumb, маленькая текстовая ссылка | Medium |
| P-2 | **Header без аватара/иконки** — обезличенно | Low |
| P-3 | **Нет «Создано/Обновлено»** — когда карта последний раз пересобиралась? | High (A-6 freshness) |
| P-4 | **Нет «Заполнена на X%»** indicator | Medium |
| P-5 | **«Снять с должности»** прямая кнопка без confirm modal — рискованно | Medium |
| P-6 | **Должностная инструкция** card без preview — даже после загрузки видно «попадёт в карту после парсинга», но не сам контент или ссылка | Medium |
| P-7 | **Источники** — простой list без счётчиков (сколько от встреч, сколько от документов, сколько от дампов) | Low |
| P-8 | **Источники limit 12** hardcoded — нельзя посмотреть все | Low |
| P-9 | **«Пересобрать карту»** только одна кнопка — нет «обновить из новых встреч» или «полная пересборка» | Low |
| P-10 | **Polling 10s для build status** — не показывается визуально (только в label кнопки) | Medium |
| P-11 | **Empty карта** «формируется» — нет ETA или «нужно ещё X встреч» | Medium |
| P-12 | **UPPERCASE в подзаголовках разделов** — Cyrillic читается плохо | Medium (C-3) |
| P-13 | **Нет drill-down из «Источники»** — нет ссылок на встречи/документы | High |
| P-14 | **Нет history карты** — какая была неделю назад? | Low (γ) |

##### 6.2.4.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Компания → Структура → Должности → Менеджер по продажам                   │
│                                                                              │
│  🪪 Менеджер по продажам                                                    │
│  Отдел: Продажи · 3 сотрудника                                              │
│  Карта обновлена 2ч назад · Заполнена на 64% · [↻ Пересобрать]             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─[Карта должности] [Сотрудники (3)] [Источники (24)] [История] ────────┐ │
│  │                                                                          ││
│  │  ┌──────────────────────────────────────────────────────────────────┐ ││
│  │  │ ⓘ Что вошло в эту карту                                          │ ││
│  │  │ 17 встреч · 5 документов · 2 дампа · последний материал 3д назад│ ││
│  │  └──────────────────────────────────────────────────────────────────┘ ││
│  │                                                                          ││
│  │  Обязанности (5)                                            ▼          ││
│  │  ─────────────────────                                                  ││
│  │  • Вести переговоры с клиентами B2B                                     ││
│  │  • Готовить коммерческие предложения                                    ││
│  │  • Закрывать сделки $50К+                                              ││
│  │  • Вести CRM (Bitrix24)                                                ││
│  │  • Прогноз выручки по quarter                                          ││
│  │                                                                          ││
│  │  Навыки (3)                                                 ▼          ││
│  │  ─────────────                                                          ││
│  │  • Презентации                                                          ││
│  │  • CRM (Bitrix24)                                                       ││
│  │  • Анализ потребностей                                                  ││
│  │                                                                          ││
│  │  Решения, которые принимает                                 ▶          ││
│  │  (не наполнено — ждём ещё ~5 встреч на тему «стратегия продаж»)        ││
│  │                                                                          ││
│  │  Типичные грабли (1)                                        ▶          ││
│  │  Стиль работы                                               ▶          ││
│  │                                                                          ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  Должностная инструкция                                                     │
│  ──────────────────────                                                     │
│  📄 jd-sales-manager-v2.pdf · загружена 14 апр · v2 (заменила v1)          │
│  Парсинг завершён · Используется в карте · [Открыть] [Заменить]            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Tab «Источники»:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─[Карта] [Сотрудники] [Источники (24)] [История]─────────────────────────┐│
│  │                                                                          ││
│  │  Источники, повлиявшие на карту                                          ││
│  │  ─────────────────────────────                                           ││
│  │  Фильтры: Тип [Все ▼]  Период [Всё время ▼]                           ││
│  │                                                                          ││
│  │  📅 Встречи (17)                                                         ││
│  │   Sales call Альфа               3 сент   ★★★ высокое влияние            ││
│  │   Демо Бета                      2 сент   ★★                            ││
│  │   ...                                                                    ││
│  │                                                                          ││
│  │  📄 Документы (5)                                                        ││
│  │   jd-sales-manager-v2.pdf        14 апр   ★★★                          ││
│  │   ...                                                                    ││
│  │                                                                          ││
│  │  📝 Дампы (2)                                                            ││
│  │   мысли о продажах Q3            5 авг                                  ││
│  │   ...                                                                    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Breadcrumb** (P-1): «Компания → Структура → Должности → Менеджер по продажам».
2. **Иконка** `IdCard` рядом с заголовком (P-2).
3. **Метаданные карты** в шапке: «Обновлена 2ч назад · Заполнена на 64%» (P-3, P-4).
4. **Tabs** «Карта / Сотрудники / Источники / История» — closeable simple, easy navigation (P-13).
5. **«Что вошло в эту карту»** информационный блок (P-7) — счётчик источников.
6. **Collapsible blocks** разделов карты (P-12, mobile-friendly).
7. **Empty raison** для не наполненных разделов: «не наполнено — ждём ещё ~5 встреч на тему «стратегия продаж»» (P-11).
8. **Должностная инструкция как card** с версией и actions «Открыть/Заменить» (P-6).
9. **«Снять с должности»** через confirm modal — не прямая кнопка (P-5).
10. **Источники** — tab с группировкой по типу + filter + influence-rating ★ (P-13, P-7, P-8).
11. **История** — tab с версионированием карты (P-14, γ feature, но видно как «появится в Фазе γ»).

##### 6.2.4.4. Состояния

| Состояние | Что |
|---|---|
| **Loading** | Skeleton header + skeleton tabs + skeleton content of active tab |
| **Empty (без сотрудников + без документов)** | Карта не наполнена; CTA «Назначьте первого сотрудника / Загрузите должностную инструкцию» |
| **Empty (карта пустая, но материалы есть)** | «Карта в процессе сборки. Ждём ещё ~5 материалов с этой ролью. [↻ Пересобрать сейчас]» |
| **Карта rebuilding** | На заголовке spinner + «Пересборка карты с 14:32» |
| **Error** | Inline retry per tab |
| **Forbidden (viewer)** | «↻ Пересобрать» — disabled tooltip «Только администратор может пересобирать» |
| **JD upload pending** | Dialog с progress + spinner |
| **JD parse failed** | В Documents tab — error state с retry |

##### 6.2.4.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1024** | Full layout с табами, сотрудники в правой панели |
| **768–1023** | Полные tabs, content в 1-col |
| **480–767** | Tabs scroll-x; blocks collapsible by default |
| **360–479** | Все blocks collapsed; tabs scroll-x; sticky-bottom «↻ Пересобрать» (для canEdit) |

##### 6.2.4.6. Действия и иерархия

- **Primary CTA:** «↻ Пересобрать карту» (в шапке, для canEdit).
- **Per-tab:**
  - Карта: Открыть полную карту в modal (для печати).
  - Сотрудники: «+ Назначить сотрудника», «Снять с должности» (с confirm).
  - Источники: фильтры, drill-down к встрече/документу/дампу.
  - История: snapshot для diff с текущей.
- **Per-источник:** клик → переход на источник.

##### 6.2.4.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/roles/[id]` | role | ✓ есть | + `lastBuildAt`, `completeness`, `materialsCounts` |
| `GET /api/v1/role-profiles/[roleId]` | profile + sources | ✓ есть | + `sources[]` с `influenceScore`, pagination |
| `POST /api/v1/role-profiles/[roleId]/rebuild` | enqueue | ✓ есть | OK |
| `GET /api/v1/role-profiles/[roleId]/build-status` | status | ✓ есть | OK |
| `GET /api/v1/role-profiles/[roleId]/history` | versions | ✗ нет | γ — для История tab |
| `GET /api/v1/persons?roleId=...` | assigned | ✓ есть | OK |
| `PATCH /api/v1/persons/[id]` | reassign/unassign | ✓ есть | OK |

##### 6.2.4.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Tabs с metadata в шапке** (рекомендуемый) | Как описано | Best of both worlds |
| **B — Single long page** (текущее) | Все sections stack | Простой, но overscrolling на больших картах |
| **C — Sidebar layout** | Левый sidebar с разделами карты, правая зона — выбранный раздел | Хорошо для глубокой работы с большой картой |
| **D — Side-by-side: Карта vs Sources** | Слева — карта, справа — источники с подсветкой какой источник влияет на какой пункт | Очень информативно, но сложно реализовать |

---

#### 6.2.5. `/documents` — Список документов

**Файл:** [DocumentsListClient.tsx](../../frontend/app/(authenticated)/documents/DocumentsListClient.tsx).

##### 6.2.5.1. Текущее состояние

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Документы                                       [+ Загрузить документ] │
│  Загруженные файлы и их статус парсинга.                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  ИМЯ              ТИП              КЕМ ЗАГРУЖЕН  К ДОЛЖНОСТИ   СТАТУС    ДАТА│
│  ────────────────────────────────────────────────────────────────────── │
│  jd-sales.pdf     должностная     Иван П.       Менеджер прод. готов    14.04│
│  политика-пд.docx политика        Анна С.       —              обрабат.  10.04│
│  стратегия.pdf    другое          Иван П.       —              ошибка    8.04│
│  ...                                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

- Polling каждые 2с пока есть `uploaded` / `parsing`.
- Upload dialog с drag-drop + Select должности.

##### 6.2.5.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Нет breadcrumb** | Low |
| P-2 | **Нет search/filter** — на 100+ документах нечитаемо | High |
| P-3 | **Нет sort** на колонках | High |
| P-4 | **Нет filter по типу** (должностная / политика / процесс / ...) | High |
| P-5 | **Нет filter по статусу** (только готовые / только ошибки) | Medium |
| P-6 | **Нет filter по должности** | Medium |
| P-7 | **Нет bulk actions** (удалить несколько, привязать к должности bulk) | Medium |
| P-8 | **Нет KPI hero** (всего N документов, M обрабатывается, K ошибок) | Medium |
| P-9 | **Polling 2s** — нет визуального индикатора «обновляется» | Low |
| P-10 | **Нет preview документа** в правом sidebar (для быстрого скан) | Medium |
| P-11 | **На мобиле 360px** — 6 колонок таблицы плохо помещаются | High |
| P-12 | **Нет «retry parsing»** для ошибочных | Medium |
| P-13 | **Нет «расширенной информации»** (размер файла, количество страниц/слов) | Low |
| P-14 | **Status badge без иконки** для failed (только color) — менее accessible | Low |
| P-15 | **Нет «удалить документ»** action в таблице | Medium |

##### 6.2.5.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Компания → Документы                                                       │
│  47 документов · 3 обрабатывается · 2 с ошибкой                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │ 🔍 Поиск по имени                 │  │ [+ Загрузить] [⤓ CSV] [⋮]      │ │
│  └──────────────────────────────────┘  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Тип [Все ▼]  Статус [Все ▼]  Должность [Все ▼]  Период [Всё ▼]    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  [☐] ИМЯ                  ТИП↕            КЕМ        ДОЛЖНОСТЬ  СТАТУС↕  ↕ │
│  ────────────────────────────────────────────────────────────────────────── │
│  [☐] 📄 jd-sales-v2.pdf  должностная инст. Иван П.  Менеджер   ✓ Готов 14.04│
│  [☐] 📄 политика-пд.docx политика          Анна С.  —         ⟳ Обраб. 10.04│
│  [☐] 📄 стратегия.pdf    другое            Иван П.  —         ⚠ Ошибка 8.04│
│      └─ [Попробовать снова] [Удалить]                                       │
│  ...                                                                          │
│                                                                              │
│  Показаны 1–25 из 47          [‹] 1 2 [›]                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Sticky right-panel при клике (preview документа):**

```
                                          ┌────────────────────────────────┐
                                          │ jd-sales-v2.pdf            [×]│
                                          │ ────────────────────────────── │
                                          │ Тип:      должностная инструк. │
                                          │ Размер:   1.2 MB · 4 страницы  │
                                          │ Слов:     2,340                │
                                          │ Должн.:   Менеджер по продажам │
                                          │ Кем:      Иван Петров          │
                                          │ Дата:     14 апр 2026, 14:23   │
                                          │ Статус:   ✓ Готов              │
                                          │                                │
                                          │ ── Превью текста ──            │
                                          │ Должностные обязанности        │
                                          │ менеджера по продажам:         │
                                          │ 1. Вести переговоры...         │
                                          │ [Показать всё]                 │
                                          │                                │
                                          │ [Открыть полностью]            │
                                          │ [Скачать оригинал]             │
                                          │ [Удалить]                      │
                                          └────────────────────────────────┘
```

**Что изменилось:**

1. **Breadcrumb + counters в шапке** (P-1, P-8): «47 документов · 3 обрабатывается · 2 с ошибкой».
2. **Search + filters bar** (P-2, P-4, P-5, P-6).
3. **Sortable columns** (P-3).
4. **Status icons** в badge для accessibility (P-14): ✓ Готов / ⟳ Обраб. / ⚠ Ошибка / ⏸ Загружен.
5. **Bulk actions** (P-7) с checkbox column.
6. **Inline error actions** для failed: «Попробовать снова», «Удалить» (P-12, P-15).
7. **Sticky right-panel preview** (P-10, P-13) — мета + preview контента + actions.
8. **Pagination** (P-2).
9. **CSV export** для архива.
10. **Polling visual indicator** в шапке: «обновлено 3с назад» (P-9).

##### 6.2.5.4. Состояния

| Состояние | Что |
|---|---|
| **Loading** | Skeleton 5 строк |
| **Empty (нет документов)** | Hero-empty: «Документов пока нет. Загрузите первый файл — система автоматически распарсит и подключит к карте знаний.» + CTA |
| **Empty (фильтр)** | «По фильтру ничего не найдено. [Сбросить]» |
| **Error** | Inline retry |
| **Forbidden** | page-forbidden |
| **Many processing (>10)** | KPI hero подсвечивает «10 обрабатывается»; polling работает в фоне |
| **Single document failed** | Inline action под рядом + красный bg |

##### 6.2.5.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280** | Full table + sticky right-panel |
| **1024–1279** | Full table, right-panel → Sheet |
| **768–1023** | Скрываются «Кем» и «Дата» |
| **480–767** | Card-view: иконка + name + status + meta |
| **360–479** | Card-view с collapse | sticky bottom «+ Загрузить» |

##### 6.2.5.6. Действия и иерархия

- **Primary CTA:** «+ Загрузить документ» (modal с drag-drop, как сейчас).
- **Secondary:** «⤓ CSV», filters.
- **Per-row:** клик → sticky right-panel preview.
- **Per-row menu «⋮»:** «Открыть полностью», «Скачать оригинал», «Привязать к должности», «Удалить».
- **Bulk:** «Привязать к должности», «Удалить» с confirm modal.

##### 6.2.5.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/documents` | items[] | ✓ есть | + filters (kind/status/roleId/period), sort, pagination |
| `POST /api/v1/documents/upload` | upload | ✓ есть | OK |
| `POST /api/v1/documents/[id]/retry-parse` | retry | ✗ нет | Для error state |
| `DELETE /api/v1/documents/[id]` | delete | ✓ есть | OK + confirmation |
| `GET /api/v1/documents/[id]/preview` | meta + content preview | ✗ нет | Для sticky right-panel |
| `GET /api/v1/documents.csv` | CSV | ✗ нет | Для bookkeeping |
| `POST /api/v1/documents/bulk` | bulk actions | ✗ нет | Для bulk |

##### 6.2.5.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Table + filters + sticky right-panel** (рекомендуемый) | Как описано | Стандартно, хорошо |
| **B — Card grid** | Каждый документ — карточка с превью текста | Очень visually, но плохо для 100+ |
| **C — Tree-view (по должности)** | Группировка по роли + общие | Хорошо для разбора по ролям, неудобно для общих |
| **D — Single column with inline-preview** | Каждый документ — expandable row с превью | Похоже на email-список, очень компактно |
| **E — Кiosk-mode upload** | Большая drop-zone, документы — secondary | Если фокус на «загрузить» — но мы скорее «просмотреть» |

---

#### 6.2.6. `/settings/admin/usage` — Экономика Org

**Файл:** [OrgUsageClient.tsx](../../frontend/app/(authenticated)/settings/admin/usage/OrgUsageClient.tsx).

##### 6.2.6.1. Текущее состояние

(Это **тот самый экран** на скриншоте, который пользователь прислал в начале разговора.)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Экономика организации                       [ За неделю ▼ ] [CSV]      │
│  Расход LLM в вашей Org за период.                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐             │
│  │ РАСХОД       │ │ FAIL RATE    │ │ ПЕРИОД               │             │
│  │  $0          │ │  0.0%        │ │ 14.05—21.05.2026     │             │
│  │ 0 вызовов    │ │ 0 ошибок     │ │ [org-scope]          │             │
│  └──────────────┘ └──────────────┘ └──────────────────────┘             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Расход по провайдерам                                               │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ (или «Пока нет данных.»)                                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Топ функций                                                          │ │
│  │ ─────────────────────────────────────────────────────────────────  │ │
│  │ (или «Пока нет данных.»)                                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

##### 6.2.6.2. Проблемы

| # | Проблема | Severity |
|---|---|---|
| P-1 | **Это «копия Z-Admin Dashboard, но для одной Org»** — выглядит одинаково с глобальной, путаница «где я» | High |
| P-2 | **Нет хлебных крошек / breadcrumb** в путь settings → admin → usage | Medium |
| P-3 | **Нет «к моему тарифу»** ссылки — owner Org должен видеть свой текущий тариф + лимиты | High |
| P-4 | **Нет «осталось N% бюджета»** indicator — если есть лимит на расход | High |
| P-5 | **Нет сравнения «vs прошлая неделя»** — только snapshot | High |
| P-6 | **Нет графика** — только tiles + lists | High |
| P-7 | **Нет breakdown по дням** | Medium |
| P-8 | **Period «org-scope» Badge** — англицизм, неясно что это | Medium (C-3) |
| P-9 | **Нет «Кто из команды тратит больше всего»** — breakdown by user | Medium |
| P-10 | **Нет alerts** (например, «расход за неделю удвоился — что-то не так?») | Medium |
| P-11 | **Empty state «Пока нет данных»** — не CTA для понимания «когда появится» | Medium |
| P-12 | **Период 3 опции** — нет custom range | Medium |
| P-13 | **Нет projection** — «при текущем темпе за месяц получится $X» | Medium |

##### 6.2.6.3. Рекомендации

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Настройки → Админка → Экономика                                            │
│  Расход AI в вашей компании                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ ⓘ Текущий тариф: Профессиональный (Pro)                                ││
│  │ Лимит расхода: $500 / мес     Использовано: $234 (47%) ████████░░░    ││
│  │ Прогноз на месяц: $400 (в пределах лимита)                              ││
│  │ [Изменить тариф] [Подробнее о тарифах]                                 ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                │
│  │ Расход     │ │ Вызовов    │ │ Avg cost   │ │ Доля ошибок│                │
│  │  $234.56   │ │  12,345    │ │  $0.019    │ │   0.8%     │                │
│  │ ↑ +12%     │ │ ↑ +8%      │ │ ↓ −5%      │ │ ↓ −0.2pp   │                │
│  │ к прошл нед│ │ к прошл нед│ │ к прошл нед│ │ к прошл нед│                │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ Расход по дням                       Период: [Месяц ▼]      [⤓ CSV]   │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │     $20 ┤        ╭──╮                                                    │ │
│  │         │       ╱    ╲                                                   │ │
│  │     $15 ┤     ╱        ╰╮                                                │ │
│  │         │   ╱             ╰─╮                                            │ │
│  │     $10 ┤ ╱                  ╰─                                          │ │
│  │         ├─────────────────────────                                       │ │
│  │         1     5     10    15    20    25    30                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────┐ ┌────────────────────────────────┐    │
│  │ Топ функций по расходу         │ │ Расход по сотрудникам          │    │
│  │ ────────────────────────────── │ │ ────────────────────────────── │    │
│  │ Отчёт sales-call  $123  53%   │ │ Иван Петров     $89  38%        │    │
│  │ Извлечение блок.   $45  19%   │ │ Анна Сидорова   $67  29%        │    │
│  │ Тематика           $34  15%   │ │ Петя Сидоров    $34  15%        │    │
│  │ ...                              │ │ ...                              │    │
│  └────────────────────────────────┘ └────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ Расход по провайдерам                                                  │ │
│  │ openai-proxy   $123 ██████████████                                      │ │
│  │ anthropic       $67 ███████                                             │ │
│  │ gigam-local      $0                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Что изменилось:**

1. **Breadcrumb** «Настройки → Админка → Экономика» (P-2).
2. **«Расход AI»** вместо «LLM» в заголовке — менее технично (P-8).
3. **Tariff context block** в шапке (P-3, P-4): текущий тариф + лимит + использовано + прогресс-бар + projection.
4. **4 KPI с delta vs прошлый период** (P-5).
5. **Line chart «Расход по дням»** (P-6, P-7).
6. **2-col bottom: «Топ функций» + «Расход по сотрудникам»** (P-9) — последнее новое, не было.
7. **Custom date range** (P-12) — добавлен picker.
8. **Empty state с CTA**: «Расход появится после первой AI-операции в Org — например, после первой встречи с автоматическим отчётом» (P-11).
9. **Projection в Tariff card** (P-13).
10. **Alert-section (если расход выше лимита):** «⚠ Превышение прогноза — расход $234 при лимите $500. При текущем темпе будет $620 за месяц.» (P-10).

##### 6.2.6.4. Состояния

| Состояние | Что |
|---|---|
| **Loading** | Skeleton tariff block + 4 KPI + skeleton chart + 2 skeleton lists |
| **Empty (новая Org, нет вызовов)** | Tariff block работает; KPI с нулями; график пустой с подписью «Расход появится после первой AI-операции» |
| **В пределах лимита** | Прогресс-бар green |
| **80–95% от лимита** | Прогресс-бар warning + банер «Близко к лимиту» |
| **>95% от лимита** | Прогресс-бар danger + банер «Скоро лимит закончится» + CTA «Увеличить лимит» |
| **Превышение** | Полная плашка danger в шапке + KPI подсвечен |
| **Forbidden (member)** | «Эта страница доступна только владельцу или администратору Org» |
| **Error** | Inline retry |

##### 6.2.6.5. Мобильная адаптация

| Breakpoint | Layout |
|---|---|
| **≥1280** | Full layout |
| **1024–1279** | 2-col, KPI 4 в ряд |
| **768–1023** | 2 KPI в ряд, остальное stack |
| **480–767** | 2 KPI, stack |
| **360–479** | 1 KPI, всё stack; chart horizontal scroll |

##### 6.2.6.6. Действия и иерархия

- **Primary CTA:** [Изменить тариф] (в tariff block).
- **Secondary:** Period picker, [⤓ CSV].
- **Per-widget:** Drill-down («Все функции» → нет для Org — нет аналога /admin/usage/functions, только Z-Admin).
- **Drill-down KPI:** клик «Расход» → детали по дням / клик «Вызовов» → детали по функциям.

##### 6.2.6.7. Контракт API

| Endpoint | Что | Статус | Добавить |
|---|---|---|---|
| `GET /api/v1/admin/usage?period=week` (org-scope) | dashboard | ✓ есть | + `previousPeriodTotals`, `dailyBreakdown`, `byUser`, `tariff{limit, used, projection}` |
| `GET /api/v1/admin/usage/export.csv?kind=calls` | CSV | ✓ есть | OK |
| `GET /api/v1/admin/usage/users` | breakdown by user | ✗ нет | Новый для секции «Расход по сотрудникам» |
| `GET /api/v1/admin/usage/projection` | прогноз | ✗ нет | Новый для tariff card |

##### 6.2.6.8. Альтернативы

| Вариант | Описание | Tradeoff |
|---|---|---|
| **A — Tariff + KPI + chart + 2-col** (рекомендуемый) | Как описано | Полная экономика |
| **B — Текущее** | KPI + lists, без chart | Простой |
| **C — Tariff-первый** | Только tariff + прогноз + CTA, без детального usage | Минимализм для owner, но не помогает understand структуру |
| **D — Drill-down only** | Дашборд с одним графиком, остальное через клик | Less screen real-estate, но больше click |

---

---

## 7. Cross-cutting улучшения design system

Что переиспользуется на 65+ страницах. Здесь — рекомендации, которые **затрагивают всё приложение** (не привязаны к конкретному экрану).

### 7.1. AppShell: Sidebar + Header + Breadcrumbs + Filter Panel

#### 7.1.1. Sidebar — статус

Текущий [Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx) уже хорошо реструктурирован (3 группы). Что добавить:

| Что | Рекомендация |
|---|---|
| **Visual separation Z-Admin** | См. 5.6 — отдельная топ-секция «Z-Admin» (только super_admin), с danger-цветовым акцентом и иконкой `Shield`. **Сейчас закопано в подгруппу «Админка»** |
| **Hotkey collapse** | Добавить `\` или `[` для collapse/expand Sidebar (M-10 паттерн Mixpanel) |
| **Section counters** | Возле «Компания» badge с counter «5 отделов · 47 чел.» (на mouseover) |
| **Tooltip для gated items** | При hover на gated-feature пункт — tooltip объясняет почему недоступно и какой тариф нужен (вместо клика на Lock иконку) |
| **Disabled-γ tooltip** | При hover на coming-soon пункт — tooltip «Появится в Фазе γ. Сейчас: N автоматически собрано» |

#### 7.1.2. Header

Текущее: Header реализован только для mobile (<md). Desktop — без Header.

**Развилка:** добавить ли Header для desktop?

| Вариант | За | Против |
|---|---|---|
| **A — Без Header на desktop** (текущее) | Больше места для контента | Нет breadcrumbs, нет global search bar, нет global actions, нет org-switcher в шапке (только в Sidebar) |
| **B — Slim Header на desktop** (48-56px) | Breadcrumbs + global search ⌘K hint + user menu + notifications | Меньше места под контент (24px ~3%) |
| **C — Floating top-bar** | Breadcrumbs sticky + рассыпание global actions | Современнее, но менее conventional |

**Рекомендация:** **B** (slim Header). Содержит:
- Breadcrumbs (path до текущего экрана).
- Hint про ⌘K (или text input «Поиск... ⌘K»).
- Notifications bell (на γ).
- User avatar dropdown (мини-копия UserCard из Sidebar — для быстрого доступа на mobile-like жесте).

#### 7.1.3. Breadcrumbs — новый компонент

Сейчас Z **не имеет breadcrumbs**. Это U-1 паттерн из эталонов (все три используют).

Контракт:
```
<Breadcrumbs
  items={[
    { label: 'Z-Admin', href: '/admin' },
    { label: 'Организации', href: '/admin/orgs' },
    { label: 'ООО Альфа', href: `/admin/orgs/${id}/billing` },
  ]}
  currentLabel="Тариф"  // активный, без href
/>
```

Расположение:
- В Header (desktop).
- В шапке content area (mobile, после Header'а).

Визуал: `text-fg-tertiary` с separator `›` (или `chevron-right` Lucide); current — `text-fg-primary font-medium`.

#### 7.1.4. Filter Panel — новый паттерн

Сейчас Z **не имеет унифицированного** filter pattern. Каждый экран собирает фильтры по-своему.

**Рекомендация (U-2 паттерн):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  {Heading}                                  [Поиск] [Filters ▼] [+ CTA] │
├─────────────────────────────────────────────────────────────────────────┤
│  {если есть active filters:}                                             │
│  Фильтры: Тариф = Pro × | Статус = Активные ×       [Сбросить всё]      │
└─────────────────────────────────────────────────────────────────────────┘
```

При клике [Filters ▼] открывается:
- **Desktop ≥1024:** sticky right-panel (350px wide, slide-in).
- **Tablet 768–1023:** Sheet (slide-up from bottom).
- **Mobile ≤767:** Modal-fullscreen.

Применимо для: `/admin/orgs`, `/admin/usage/functions`, `/meetings`, `/structure`, `/documents`.

### 7.2. Empty / Loading / Error — единые компоненты

См. также 4.7, 5.3 (включая 6 design-system гэпов: G-1..G-5).

**Решение (без вариантов):** ввести `frontend/src/ui/states/`:

```typescript
// EmptyState.tsx
<EmptyState
  icon={IconComponent}           // Lucide иконка 32-48px
  title="Заголовок"
  description="Описание"          // 1-2 строки
  action={<Button>...</Button>}  // опциональный CTA
  tone="default | hint | accent"
/>

// LoadingState.tsx — три уровня
<Skeleton className="..." />                // блочный контент
<InlineSpinner label="Сохраняем…" />        // inline для actions
<OptimisticUI mutate={mutate}>...</...>     // optimistic helper

// ErrorState.tsx — четыре уровня
<InlineError message="..." />               // под input
<FormBanner message="..." onRetry={...} />  // вверху формы
<PageError message="..." onRetry={...} />   // полная страница

// LoadingButton.tsx
<LoadingButton loading={submitting} loadingText="Сохраняем…">
  Сохранить
</LoadingButton>

// SkeletonWrapper.tsx — HOC
<SkeletonWrapper
  loading={swr.isLoading}
  error={swr.error}
  empty={swr.data?.items.length === 0}
  onRetry={swr.mutate}
  emptyState={<EmptyState title="Пусто" />}
>
  {/* реальный контент */}
</SkeletonWrapper>
```

**App-level ErrorBoundary** (G-4):
- `frontend/app/error.tsx` для catastrophic errors.
- `frontend/app/(authenticated)/error.tsx` для auth-route errors.
- `frontend/app/(authenticated)/admin/error.tsx` для admin-route errors.

### 7.3. Tables — единый паттерн

Сейчас в Z 8+ компонентов с таблицами, каждый со своим стилем (AdminMeetingsTable, OrgsTable, FunctionsTable, RolesTable, PersonsTable, DocumentsTable, ...).

**Решение:** единый `<DataTable>` компонент с пропсами:

```typescript
<DataTable
  columns={[
    { key: 'name', label: 'Имя', sortable: true, sticky: true },
    { key: 'email', label: 'Email', hideAt: 'mobile' },
    ...
  ]}
  data={items}
  density="default" | "compact" | "relaxed"
  sortBy={sort}
  onSortChange={setSort}
  selection={{ enabled: true, selected, onChange }}  // для bulk
  rowActions={(row) => <DropdownMenu>...</DropdownMenu>}
  onRowClick={(row) => openSidePanel(row)}  // sticky right-panel
  pagination={{ page, total, limit, onPageChange }}
  loading={isLoading}
  emptyState={<EmptyState ... />}
  // mobile:
  mobileFallback="card-view" | "horizontal-scroll-with-frozen-first"
/>
```

С density toggle в правом верхнем углу таблицы (3 кнопки `Rows-1/2/3` Lucide).

С единой системой sortable headers (стрелочки `chevron-up-down` / `chevron-up` / `chevron-down`).

С единой mobile-стратегией (card-view как default для `/admin/orgs`, horizontal-scroll для `/admin/usage/functions`).

### 7.4. Forms — единый паттерн

Сейчас в Z формы разбросаны (settings, admin, wizard). Каждая по-своему обрабатывает loading, validation, submit, error.

**Решение:** единый `<Form>` wrapper + `<FormField>`:

```typescript
<Form onSubmit={handleSubmit}>
  <FormField
    name="name"
    label="Название"
    required
    error={errors.name}
    description="Видно всем участникам"
  >
    <Input ... />
  </FormField>

  <FormSection title="Дополнительно" collapsible>
    <FormField ...>
      <Select ... />
    </FormField>
  </FormSection>

  <FormFooter>
    <LoadingButton loading={submitting} loadingText="Сохраняем…">
      Сохранить
    </LoadingButton>
    <Button variant="ghost" onClick={cancel}>Отмена</Button>
  </FormFooter>
</Form>
```

**Two-column layout** для settings (A-3 Amplitude):
```typescript
<SettingsLayout
  sidebar={<SettingsNav items={[...]} />}
  content={<>...</>}
/>
```

Применимо для `/settings/*` (15+ страниц) — все настройки получают одинаковый каркас.

### 7.5. Buttons — `LoadingButton`, `IconButton`, `MenuButton`

Сейчас inconsistent (G-3, G-11).

**Решение:** три новых wrapper'а:

```typescript
<LoadingButton loading={submitting} loadingText="Сохраняем…">
  Сохранить
</LoadingButton>

<IconButton
  icon={<Trash2 />}
  ariaLabel="Удалить"
  variant="ghost"
  tooltipContent="Удалить документ"
  destructive
/>

<MenuButton
  trigger={<Button>Действия ▼</Button>}
  items={[
    { label: 'Открыть', icon: <Eye />, action: () => {...} },
    { label: 'Удалить', icon: <Trash2 />, destructive: true, action: () => {...} },
  ]}
/>
```

Все три используют один стиль spinner (`Loader2`), один tooltip-компонент, один confirm-flow для destructive actions.

### 7.6. Charts — единая палитра + 5 типов

См. 4.1.3 (data-viz палитра), 4.4 (5 типов чартов).

**Решение:** ввести `frontend/src/ui/charts/`:

```
LineChart.tsx       — trends over time
BarChart.tsx        — comparisons (horizontal + vertical)
StatCard.tsx        — KPI с delta vs предыдущий период (используется в hero)
DataTable.tsx       — таблица (см. 7.3)
GaugeChart.tsx      — percentage (для tariff limit и т.п.)
```

Все используют:
- Единую палитру серий (8 цветов из 4.1.3).
- Единые tooltip / legend / axis labels (русский язык).
- Единый export action (PNG / CSV).
- Единые empty/loading/error states.

**Library:** recharts (lightweight, tree-shakeable, хорошие defaults) или visx (powerful, но больше work). Альтернатива — chart.js (более универсальный, но heavyweight). Решение per-TZ.

### 7.7. OrgSwitcher: упрощение 4 → 2 состояния

См. 5.4.

**Решение:** единый dropdown с поиском (CF-1 паттерн):

```typescript
<OrgSwitcher
  currentOrg={currentOrg}
  availableOrgs={availableOrgs}
  superAdminMode={isSuperAdmin && !currentOrgId}
  onSwitch={(orgId) => switchOrg(orgId)}
/>
```

States:
- **Visible:** dropdown с активной Org + chevron + поиск + список (если 5+ Org).
- **Hidden:** только внутри `/onboarding/company/*` и `(admin)/admin/login`.

### 7.8. CommandPalette: dynamic type registry

См. 5.5.

**Решение:** `frontend/src/ui/command-palette/entityTypes.ts`:

```typescript
export const ENTITY_TYPES = {
  card: { label: 'Карточка', icon: FolderKanban, route: (id) => `/cards/${id}` },
  meeting: { label: 'Встреча', icon: CalendarDays, route: (id) => `/meetings/${id}/result` },
  task: { label: 'Задача', icon: ListChecks, route: (id) => `/tasks/${id}` },
  role: { label: 'Должность', icon: IdCard, route: (id) => `/roles/${id}` },
  department: { label: 'Отдел', icon: Building2, route: (id) => `/structure?tab=departments&id=${id}` },
  person: { label: 'Сотрудник', icon: Users, route: (id) => `/persons/${id}` },
  document: { label: 'Документ', icon: FileText, route: (id) => `/documents/${id}` },
  theme: { label: 'Тема', icon: Sparkles, route: (id) => `/themes/${id}` },
} as const;
```

CommandPalette итерирует ключи, не hardcoded.

### 7.9. Toast → Sonner миграция

Текущее: custom toast context (`addToast({ type, message })`).

**Развилка:** мигрировать ли на Sonner?

| Вариант | За | Против |
|---|---|---|
| **A — Оставить custom context** | Полный контроль, нет dependency | Меньше features (queue, dismiss, position) |
| **B — Мигрировать на Sonner** | Industry-standard, animations, queue | Зависимость, миграция всех usages (~30 мест) |

**Рекомендация:** **B** (Sonner) — в коде он уже импортируется (`toast` from 'sonner' в `BillingAdminClient.tsx`). Унифицировать, иначе будут гибриды: одни компоненты `useToast` context, другие `import { toast } from 'sonner'`.

### 7.10. Color tokens cleanup

См. 4.1.2.

**Действия:**
- Зафиксировать `--accent-text` для light-mode mint problem (4.1).
- Добавить semantic darker shades для light-mode status colors (success/warning/danger).
- Добавить полную spacing scale (56/72/80/88/96).
- Зафиксировать в [tokens.css](../../frontend/src/ui/tokens.css) комментарием «не плодить ad-hoc цвета в компонентах, использовать токены».

### 7.11. Email-шаблоны как design system

См. 1.4.

Сейчас [mail.templates.ts](../../backend/src/modules/mail/mail.templates.ts) — inline text-only. Будут нужны:
- `member-invitation` (приглашение сотрудника)
- `tier-changed` (уведомление об изменении тарифа)
- `report-ready` (отчёт по встрече готов)
- `weekly-digest` (недельный AI-digest для admin)

**Развилка:**

| Вариант | За | Против |
|---|---|---|
| **A — Plain text** (текущее) | Минимум фильтрации антиспамом, легче парсить | Без brand, без CTA-кнопок |
| **B — HTML с inline styles** | Brand-aligned, кнопки кликабельные | Больше работы, антиспам-фильтры (reg.ru SMTP — нужны проверки) |
| **C — Hybrid (multipart text+html)** | Best of both | Самый объёмный код, но professional approach |

**Рекомендация:** **C** для важных писем (invitation, tier-changed), **A** для технических (password reset). Через React Email или MJML для maintenance.

### 7.12. Иконки — выбор и применение

См. 4.5.

Lucide — уже в коде. Главное правило:
- **Outline** стиль везде (Lucide default).
- **Размеры:** 14 / 16 / 20 / 24px (никаких 13, 15, 18, 22).
- **Stroke width:** 2px (default). Никаких 1px (слишком тонко на dark).
- **В кнопках:** иконка + текст-label, не только иконка (кроме IconButton с tooltip).
- **Decorative icons:** `aria-hidden="true"`.
- **Semantic icons:** `aria-label` + tooltip.

### 7.13. Avatar / Initial display

Сейчас в Z avatar только в UserCard (Sidebar) — initials placeholder без аватара-фото.

**Решение:**

```typescript
<Avatar
  src={user.avatarUrl}         // optional
  fallback={user.name}         // для initials
  size="xs | sm | md | lg | xl" // 24/32/40/56/80
  shape="circle | rounded"
  status="online | offline | busy"  // optional dot
/>
```

Палитра для initials background: 8 цветов из data-viz палитры (4.1.3), hash от user.id → выбор цвета. Consistent цвет per user.

### 7.14. AI-генерированный контент: visual marker

Сейчас в `AI-сводка` блок есть подпись «AI-сводка, может содержать ошибки», но визуально не выделено.

**Решение:** все AI-генерированные блоки получают:
- Sparkles иконка (`Sparkles` Lucide).
- Subtle accent border (mint `--accent-muted`).
- Footnote «AI-сводка может содержать ошибки» с link «Сообщить о неточности».

Применимо для: AI-сводка дашборда, AI-отчёт встречи, AI-ответы в чате, AI-описания тем.

### 7.15. Keyboard navigation

WCAG-обязательное. Сейчас Z частично поддерживает (Tab, Enter, Esc).

**Что добавить:**
- `?` — открыть keyboard shortcuts modal (cheatsheet).
- `⌘K` / `Ctrl+K` — CommandPalette (уже есть ✓).
- `\` или `[` — toggle Sidebar collapse.
- `g d` — go to dashboard.
- `g m` — go to meetings.
- `g a` — go to admin.
- `j` / `k` — навигация по списку (как Linear).
- `Esc` — закрыть modal / right-panel.
- Tab indicator должен быть visible на всех interactive (focus:outline-accent).

---

## 8. Action items с приоритетами

Все действия, сгруппированные по приоритетам и фазам. Это **готовый бэклог** для sub-TZ 0c и последующих фаз.

### 8.1. Priority 0 (Блокеры — нужно сделать до релиза Фазы 0)

| # | Действие | Где описано | Effort | Owner |
|---|---|---|---|---|
| P0-1 | **Fix mint-контраст в light-mode** — ввести `--accent-text` darker shade (или teal-700) | 4.1 | S | Frontend |
| P0-2 | **Унифицировать Empty/Loading/Error** компоненты в `frontend/src/ui/states/` (5 компонентов) + миграция всех usages | 5.3, 7.2 | L | Frontend |
| P0-3 | **App-level ErrorBoundary** (`error.tsx` в `app/`, `(authenticated)`, `(authenticated)/admin`) | G-4, 7.2 | M | Frontend |
| P0-4 | **Объединить Skeleton-компоненты** (shadcn/skeleton vs shared/Skeleton) | G-5 | M | Frontend |
| P0-5 | **Удалить эмодзи 📈 inline в коде** заменить на Lucide `TrendingUp` | P-6 6.2.1, C-8 | XS | Frontend |
| P0-6 | **Унифицировать loading indicators** в кнопках (Loader2 во всех) — убрать RefreshCcw inconsistency | G-2, G-11 | S | Frontend |

### 8.2. Priority 1 (Улучшения для UX — желательно в Фазе 0, обязательно к γ)

#### 8.2.1. Z-Admin

| # | Действие | Где |
|---|---|---|
| P1-1 | **Hero status в `/admin`** — добавить delta «vs прошлый период» к KPI | 6.1.1.3 |
| P1-2 | **Алерт-секция в `/admin`** — aggregated alerts (fail >5%, frozen Org, expired recordings) | 6.1.1.3 |
| P1-3 | **График «Расход по дням»** в `/admin` (line chart) | 6.1.1.3 |
| P1-4 | **`/admin/orgs` — sorting, pagination, status filters, status badges в шапке** | 6.1.2.3 |
| P1-5 | **`/admin/orgs` — убрать inline tier-dropdown** (риск опечатки → потеря $), только через `/billing` с confirm | 6.1.2.3 (P-7) |
| P1-6 | **`/admin/orgs` — заменить `window.confirm` на нормальный Dialog modal** | 6.1.2.3 (P-8) |
| P1-7 | **`/admin/orgs/[id]/billing` — добавить контекст-блок Org** (owner, members, MRR, last activity) | 6.1.3.3 |
| P1-8 | **`/admin/orgs/[id]/billing` — preview diff «Что изменится при сохранении»** | 6.1.3.3 (P-4, P-5) |
| P1-9 | **`/admin/orgs/[id]/billing` — tabs (Тариф / Overrides / Квоты / Журнал)** | 6.1.3.3 (P-7) |
| P1-10 | **`/admin/orgs/[id]/billing` — русифицировать «inherit», «override», убрать «failed safe» badge** | 6.1.3.3 (C-3) |
| P1-11 | **`/admin/usage/functions` — KPI hero + alerts + sortable columns + provider filter** | 6.1.4.3 |
| P1-12 | **`/admin/experiments` — inline results (winner, significance) + tabs (Активные/Архив/История)** | 6.1.5.3 |
| P1-13 | **`/admin/experiments` — primary CTA «Запустить эксперимент» прямо в списке** | 6.1.5.3 (P-2) |
| P1-14 | **`/admin/health` — добавить LLM providers секцию** (OpenAI/Anthropic/Vox/GigaAM) | 6.1.6.3 (P-6) |
| P1-15 | **`/admin/health` — добавить S3 мониторинг, manual queue actions (retry/pause), event-timeline** | 6.1.6.3 |
| P1-16 | **Объединение `(admin)/admin/*` и `(authenticated)/admin/*`** — план B (cross-links) для Фазы 0; план A (migrations) для γ | 5.1 |

#### 8.2.2. Org-кабинет

| # | Действие | Где |
|---|---|---|
| P1-17 | **`/dashboard` — реструктуризация 10 виджетов → 4 KPI + collapsible sections** | 5.2, 6.2.1.3 |
| P1-18 | **`/dashboard` — вынести OrgChat в отдельный экран** (`/chat`), не inline | 6.2.1.3 (P-7) |
| P1-19 | **`/dashboard` — period picker расширить** (день/неделя/месяц/квартал/custom) | 6.2.1.3 (P-3) |
| P1-20 | **`/me` — добавить avatar, attention-секцию, completeness % карты должности, drill-down ссылки** | 6.2.2.3 |
| P1-21 | **`/me` — UPPERCASE → нормальный case** в Cyrillic | 6.2.2.3 (P-10) |
| P1-22 | **`/structure` — counters в шапке + badge на tabs + global search** | 6.2.3.3 |
| P1-23 | **`/structure` — sticky right-panel preview + bulk actions** | 6.2.3.3 |
| P1-24 | **`/roles/[id]` — breadcrumb, metadata в шапке, tabs, completeness %** | 6.2.4.3 |
| P1-25 | **`/roles/[id]` — confirm modal для «Снять с должности»** | 6.2.4.3 (P-5) |
| P1-26 | **`/documents` — search/filter/sort, status icons, KPI hero, sticky right-panel preview** | 6.2.5.3 |
| P1-27 | **`/settings/admin/usage` — tariff context block + projection + 2-col секции** | 6.2.6.3 |

#### 8.2.3. Cross-cutting

| # | Действие | Где |
|---|---|---|
| P1-28 | **Breadcrumbs компонент** + integration в Header (desktop) и в шапке content (mobile) | 7.1.3 |
| P1-29 | **Filter Panel паттерн** (sticky right-panel desktop / Sheet mobile) | 7.1.4 |
| P1-30 | **DataTable унифицированный компонент** с density, sorting, mobile fallback, selection | 7.3 |
| P1-31 | **LoadingButton + IconButton + MenuButton** компоненты | 7.5 |
| P1-32 | **CommandPalette — dynamic type registry** (не hardcoded) | 5.5, 7.8 |
| P1-33 | **OrgSwitcher — упрощение 4 → 2 состояний** + поиск для 5+ Org | 5.4, 7.7 |
| P1-34 | **Sonner миграция** — все toasts через единую библиотеку | 7.9 |
| P1-35 | **Color tokens cleanup** — `--accent-text` + status colors для light + расширенный spacing scale | 4.1, 7.10 |
| P1-36 | **AI-content marker** (Sparkles + accent border + footnote) для всех AI-блоков | 7.14 |

### 8.3. Priority 2 (Желательно — после Фазы 0)

| # | Действие | Где |
|---|---|---|
| P2-1 | **Z-Admin визуальная сепарация** (отдельная топ-секция в Sidebar + Shield icon + danger color) | 5.6 |
| P2-2 | **Slim Header на desktop** с breadcrumbs + ⌘K hint + user menu | 7.1.2 (вариант B) |
| P2-3 | **Settings two-column layout** (sidebar nav + content) для всех 15+ под-страниц | 7.4 |
| P2-4 | **Forms wrapper компонент** (`<Form>`, `<FormField>`, `<FormSection>`, `<FormFooter>`) | 7.4 |
| P2-5 | **Avatar компонент** с initials fallback + status dot + consistent цвета | 7.13 |
| P2-6 | **Keyboard shortcuts** (`?` cheatsheet, `g d/m/a`, `j/k` навигация, `\` collapse) | 7.15 |
| P2-7 | **Charts library** (recharts или visx) + единая палитра + StatCard / LineChart / BarChart / GaugeChart | 7.6 |
| P2-8 | **AdminPagePermissionGate server-side** (P-9, чтобы HTML не светился в devtools) | G-9 |
| P2-9 | **Email-шаблоны hybrid HTML+text** (через React Email) | 7.11 |
| P2-10 | **Mobile-first viewer-first** — все 12 экранов работают на 360px (viewer mode) | 5.7 вариант B |

### 8.4. Priority 3 (Фаза γ и позже)

| # | Действие | Где |
|---|---|---|
| P3-1 | **Полная миграция `(admin)/admin/*` → `(authenticated)/admin/*`** | 5.1 вариант A |
| P3-2 | **Customizable widgets** на дашборде (Mixpanel Boards-style) | 5.2 вариант C |
| P3-3 | **AI-curated dashboard** (LLM решает порядок виджетов) | 5.2 вариант D |
| P3-4 | **Conversational wizard** для onboarding (вместо linear stepper) | 5.9 вариант D |
| P3-5 | **Полная mobile-first** — все 12 экранов работают на 360px с editing | 5.7 вариант A |
| P3-6 | **Per-Org default theme** (owner выбирает light/dark для своей Org) | 5.10 вариант D |
| P3-7 | **Tree-view для отделов** (использовать `parentDepartmentId`) | 6.2.3.8 (B) |
| P3-8 | **History для RoleProfile** (versioning, diff visualization) | 6.2.4.7 |
| P3-9 | **AB-experiment Kanban** (Запланированные / Активные / Завершённые / Архив) | 6.1.5.8 (C) |
| P3-10 | **Map view для Org** (если будем собирать геолокацию) | 6.1.2.8 (D) |

### 8.5. 12 design-system гэпов — где закрываются

| Гэп | Где закрывается |
|---|---|
| G-1 EmptyState несогласованность | P0-2 |
| G-2 3 стиля loading | P0-6 |
| G-3 нет LoadingButton | P1-31 |
| G-4 нет ErrorBoundary | P0-3 |
| G-5 две версии Skeleton | P0-4 |
| G-6 OrgSwitcher 4 состояния | P1-33 |
| G-7 CommandPalette hardcoded | P1-32 |
| G-8 Coming-soon не унифицирован | через `<ComingSoonPage>` компонент (есть в аналитике ЛК) |
| G-9 AdminPagePermissionGate клиент-сайд | P2-8 |
| G-10 /meetings master-detail без empty state | P1 (отдельный экран, не в скопе аудита но фиксируется как гэп) |
| G-11 Inconsistent loading в кнопках | P0-6 |
| G-12 Дизайн preview-страницы в навигации | удалить или интегрировать (за пределами скопа) |

### 8.6. Что НЕ делать в Фазе 0 (риски расширения скопа)

| Что | Почему отложить |
|---|---|
| Customizable widgets | Overkill для MVP |
| Conversational wizard | Linear stepper уже работает, риск багов |
| Full mobile-first с editing | Viewer-first достаточно для Фазы 0 |
| Charts library | Можно делать «псевдо-графики» через CSS gradient bars (как сейчас в SignalCounters) |
| Email-шаблоны HTML | Plain text работает для invitation/password |
| Avatar с фото | Initials enough; uploads — γ feature |
| Keyboard shortcuts полные | Базовых (⌘K, Esc) хватит |

---

## 9. Что отложили явно

Эти вещи **сознательно не включены** в скоп аудита, чтобы он не разросся. Перечисляю явно с причиной.

| Что | Причина |
|---|---|
| **Per-screen разбор `/meetings`** | Самый сложный экран (master-detail + фильтры), требует отдельного аудита уровня этого документа. Будет в отдельном `meetings-audit.md` |
| **Per-screen разбор `/chat`** | Чатовый UX — отдельная категория паттернов (Linear chat, Slack, etc.), не data-heavy admin |
| **Per-screen разбор `/onboarding/company/*`** | Wizard уже реализован по аналитике ЛК; визуальные улучшения — отдельная задача |
| **Public/share страницы** (`/m/[id]`, `/share/*`) | Гостевой UX, отдельный жанр (нет аутентификации, простая регистрация) |
| **Auth страницы** (`/login`, `/signup`, `/reset-password`) | Уже стандартизированы через AuthShell; не data-heavy |
| **Landing/home** (`/`) | Маркетинговый жанр, не data-heavy admin |
| **Recordings/expiring экран** | Operational, не основной flow |
| **Live meeting UI** (LiveKit React Components) | Сторонняя библиотека, custom theming — отдельная работа |
| **Email-шаблоны визуальный дизайн** | Упомянуто в 7.11, но детальный visual design — отдельная работа |
| **Тёмная-светлая тема визуальные различия** | Кроме mint contrast fix (4.1) — остальное via tokens automatically |
| **Анимации деталей** (page transitions, micro-interactions) | Базовые в 4.6 — достаточно для V1 |
| **Локализация (i18n)** | UI на русском фиксирован, английская версия — не в плане |
| **Accessibility audit** | WCAG AA принимается как фон. Полный audit (screen readers, keyboard-only) — отдельная задача |
| **Performance audit** | Lighthouse / Web Vitals — отдельная задача |
| **SEO для public pages** | Не в скопе data-heavy admin |

---

## 10. Связи и обновления других документов

После принятия этого аудита надо обновить или создать:

### 10.1. Обновить существующие

| Документ | Что обновить |
|---|---|
| [second-brain/02_architecture/design-system.md](../../second-brain/02_architecture/design-system.md) | Добавить раздел о design tokens (см. 4.1–4.6); обновить раздел 8 (что запрещено) ссылками на C-1..C-10 |
| [second-brain/13_glossary/copy-strings.ru.md](../../second-brain/13_glossary/copy-strings.ru.md) | Добавить строки: «Заполнена на X%», «обновлено N с назад», «Что важно для меня сегодня», «Все [Орг / Сотрудники / Документы] →», «Расход AI» (вместо «Расход LLM») |
| [second-brain/13_glossary/ui-glossary.md](../../second-brain/13_glossary/ui-glossary.md) | Добавить термины: Дашборд / KPI / тариф / лимит / прогноз / событие (в журнале) / алерт / sparkline |
| [plans/archive/2026-05-21-phase-0-roles-and-onboarding.md](../tz/2026-05-21-phase-0-roles-and-onboarding.md) | Добавить раздел L «UI/UX из аудита» в матрицу прослеживаемости — со ссылками на P0-* и P1-* действия |
| [plans/analysis/2026-05-21-user-cabinet-design.md](2026-05-21-user-cabinet-design.md) | Добавить в §10 (глоссарий) русские варианты «KPI», «tariff», «projection» |
| [second-brain/02_architecture/code-pitfalls.md](../../second-brain/02_architecture/code-pitfalls.md) | Добавить: «mint #14b8a6 не проходит WCAG AA на белом фоне — использовать `--accent-text` для текстовых случаев в light-mode»; «не плодить ad-hoc цвета — всегда через tokens.css» |
| [second-brain/02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md) | Добавить `frontend/src/ui/states/` и `frontend/src/ui/charts/` когда они появятся |
| [second-brain/index.md](../../second-brain/index.md) | Добавить ссылку на этот файл в раздел «Анализы» |

### 10.2. Создать новые

| Документ | Когда |
|---|---|
| `plans/tz/2026-05-22-phase-0-design-system-foundations.md` | Sub-TZ для P0 действий (mint fix, ErrorBoundary, Empty/Loading/Error унификация, Skeleton миграция) |
| `plans/tz/2026-05-22-phase-0-z-admin-improvements.md` | Sub-TZ для P1-1..P1-16 действий по Z-Admin |
| `plans/tz/2026-05-22-phase-0-org-cabinet-improvements.md` | Sub-TZ для P1-17..P1-27 действий по Org-кабинету |
| `plans/tz/2026-05-22-phase-0-cross-cutting-components.md` | Sub-TZ для P1-28..P1-36 (Breadcrumbs, FilterPanel, DataTable, ...) |
| `plans/analysis/2026-MM-DD-meetings-ui-audit.md` | Отдельный аудит для `/meetings` (см. 9) |
| `plans/analysis/2026-MM-DD-chat-ui-audit.md` | Отдельный аудит для `/chat` |
| `plans/analysis/2026-MM-DD-email-templates-design.md` | Отдельный аудит email-шаблонов |
| `second-brain/01_projects/design-system.md` | Новый файл — описание design language Z (раздел 4 этого аудита, переформатированный для долгой памяти) |

### 10.3. Зависимости (что блокирует что)

```
P0-1 (mint fix) ──────────────────────┐
P0-2 (Empty/Loading/Error)  ──────────┤
P0-3 (ErrorBoundary)  ────────────────┼─→ Все P1-* (могут использовать)
P0-4 (Skeleton miграция)  ────────────┤
P0-5, P0-6 (loading indicators)  ─────┘

P1-28 (Breadcrumbs) ──────────────────┐
P1-29 (FilterPanel) ──────────────────┤
P1-30 (DataTable) ────────────────────┼─→ P1-4 (orgs), P1-11 (functions),
P1-31 (LoadingButton) ────────────────┤     P1-22 (structure), P1-26 (documents)
                                       ┘
P1-32 (CommandPalette registry) ─────→ Независимо
P1-33 (OrgSwitcher) ──────────────────→ Независимо
P1-34 (Sonner) ───────────────────────→ Перед P1-* (чтобы новые экраны не вводили старый toast)
P1-35 (Color tokens) ─────────────────→ Базис для всего

P1-17 (Director Dashboard restructure) ─→ ничего не блокирует, отдельная работа
P1-18..P1-27 (Org-screens) ─────────────→ зависят от P1-28..P1-31
```

---

## 11. TLDR (для тех, кто читает только это)

### 11.1. Что аудитировали

12 ключевых экранов Z (6 Z-Admin + 6 Org-кабинет) + cross-cutting (Sidebar/Header/Tables/Forms/States). Эталоны: Mixpanel + Amplitude + Cloudflare Dashboard. Ограничения: mobile-first 360px, WCAG AA, русский UI, dark-first mint, «память не контроль».

### 11.2. Главные находки

1. **Light-mode mint #14b8a6 НЕ проходит WCAG AA** на белом (2.5:1). Dark-mode #5eead4 — 13:1 (AAA, отлично). Нужен `--accent-text` darker shade для light. **Critical fix.**
2. **Z-Admin раздвоен** (`/(authenticated)/admin/*` + `/(admin)/admin/*`) — архитектурный шов. План B (cross-links) на Фазу 0, план A (migrations) на γ.
3. **Director Dashboard перегружен** (10 виджетов простыня на мобиле) — нужна реструктуризация Hero KPI + Collapsible Sections.
4. **`/admin/orgs` — главная боль для собственника платформы** — нужны: sorting, pagination, status filters, hero counters, убрать inline tier-dropdown (риск $).
5. **12 design-system гэпов** (Empty/Loading/Error разные стили, нет ErrorBoundary, две версии Skeleton, hardcoded CommandPalette) — закрываются Priority 0.
6. **Cross-cutting компоненты отсутствуют:** Breadcrumbs, FilterPanel, DataTable, LoadingButton, единые charts — нужно ввести.
7. **Эталоны Mixpanel/Amplitude НЕ подходят на 100%** — они desktop-first, без mobile-friendly tables. Cloudflare ближе как mobile-парадигма.

### 11.3. Что менять в Фазе 0 (Priority 0 + важные P1)

- Mint contrast fix.
- Unified Empty/Loading/Error в `frontend/src/ui/states/`.
- ErrorBoundary на уровне app/.
- DataTable, Breadcrumbs, FilterPanel — новые компоненты.
- `/admin/orgs` — sorting, pagination, status filters, убрать inline tier-dropdown.
- `/dashboard` — реструктуризация 10 виджетов → 4 KPI + collapsible.
- `/admin/orgs/[id]/billing` — контекст-блок + preview diff + tabs.
- `/admin/health` — добавить LLM providers section.

### 11.4. Что оставить на γ

- Полная mobile-first с editing.
- Customizable widgets (Mixpanel Boards-style).
- Conversational wizard.
- AI-curated dashboard.
- Charts library с большим набором.
- Per-Org темы.

### 11.5. Следующие шаги

1. **Ревью этого документа** командой (особенно архитектурные решения раздела 5 и Priority 0/1 в разделе 8).
2. **Написание sub-TZ** на основе раздела 10.2:
   - `phase-0-design-system-foundations.md` (P0)
   - `phase-0-z-admin-improvements.md` (P1.Z-Admin)
   - `phase-0-org-cabinet-improvements.md` (P1.Org)
   - `phase-0-cross-cutting-components.md` (P1.Cross-cutting)
3. **Параллельно — обновить second-brain/02_architecture/design-system.md, copy-strings.ru.md, code-pitfalls.md** (раздел 10.1).
4. **Опционально — Этап 6 аудита**: прототипы 2-3 критичных компонентов через скилл `frontend-design` (`<DataTable>`, `<HeroKPI>`, переосмысленный Director Dashboard).
5. **Опционально — отдельные аудиты** для `/meetings`, `/chat`, email-шаблонов (раздел 9).

---

_Документ завершён. Дата: 2026-05-22. Статус: draft, ждёт ревью._
_Объём: 12 экранов разобраны, 30+ эталонных паттернов, ~50 action items по 4 приоритетам, 8 архитектурных развилок с вариантами._
