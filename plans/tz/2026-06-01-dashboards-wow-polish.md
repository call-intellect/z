---
type: tz
status: ready-to-implement
date: 2026-06-01
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-05-30-pulse-full.md
  - plans/tz/2026-05-31-smart-tables.md
  - plans/tz/2026-05-31-demo-content-expansion-pulse.md
  - second-brain/01_projects/frontend-pages.md
  - second-brain/02_architecture/module-map.md
phases:
  - 0
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
  - 9
  - 10
  - 11
---

> **Статус:** ТЗ согласовано владельцем 2026-06-01. Стартовать с **Фазы 1** (dead routes) можно сразу — это короткая разблокирующая работа. Остальные фазы выполняются в порядке номеров. Если по ходу реализации появляется новая развилка — задать вопрос владельцу, не принимать «по-своему».

# Полная полировка дашбордов Z — «вау-эффект»

## Зачем

Вчера (2026-05-31) выкатили большую серию дашбордов: главный CEO-дашборд с 12 виджетами Pulse, карточку сотрудника `/persons/[id]/pulse`, Sprint Daily/Weekly панели, OperationsDashboard, smart-tables. **Архитектурно всё хорошо**, дизайн-система соблюдена на 100%, состояния прорисованы, всё на русском. Но при сегодняшней приёмке вылезли две группы проблем.

**1. Навигационные дыры — три DEAD ROUTES**
- `/tables` и `/tables/[id]` — smart-tables полностью реализованы, но **в Sidebar нет ни одной ссылки**. Пользователь не попадёт без прямого URL.
- `/persons/[id]/pulse` — Pulse-карточка сотрудника готова, но **нет кнопки с `/persons/[id]`** и нет в меню.
- `/sprints/archive` — доступна через `/sprints`, но не из меню (менее критично).

**2. Визуальный уровень — B+, надо A+ («вау»)**
Архитектура и DS отличные, но **визуализация данных слабая**: много «чисел в чипсах» вместо живых графиков. Конкретно слабые виджеты:
- `RecurringTopicsWidget` — список с числами без mini-bar по частоте
- `TeamHealthGrid` — таблица без цвет-кодирования строк по sentiment-tone
- `LowRoiMeetingsWidget` — ROI как plain-text, без bar/чипа-по-абсолюту
- `BusFactorWidget` — нет градиента/heatmap по severity (все красные одинаково)
- `GoalVectorWidget` — progress-bar есть, но нет вклада top-3 contributors
- `KnowledgeVelocityKpi` — опирается на голый KpiHero без sparkline

Реально секси сейчас: `BottleneckHeatmapWidget` (живая heatmap), `AiNarrativeWithSources` (inline-цитаты), `AssistantSidebar`, `SampleStoryBanner`, `SprintWeeklyPanel`. Их надо взять за **эталон тона** и подтянуть остальные.

Цель этого ТЗ: пройтись по **всем** дашбордам Z, закрыть навигационные дыры, поднять визуальный уровень с B+ до **A+ — "глаз радуется"**, и зафиксировать набор переиспользуемых мини-визуализаций, чтобы будущие виджеты сразу делались на этом уровне.

## Принципы (читать перед началом)

1. **Дизайн-система — закон.** Paired tokens (`bg-{color}` + `text-{color}-fg`), shadcn-aliases (`Card`, `Badge`, `Button`, `Skeleton`). Никаких `bg-white`, `text-white` на цветном, прямых hex, slate-классов. См. [feedback_paired_color_tokens](file:///C:/Users/USER/.claude/projects/c--work-z/memory/feedback_paired_color_tokens.md).
2. **Русский язык — без исключений.** Все строки, видимые пользователю, — на русском. Английские слова только в брендах. См. [feedback_admin_ui_russian_only](file:///C:/Users/USER/.claude/projects/c--work-z/memory/feedback_admin_ui_russian_only.md).
3. **Эталон тона — `BottleneckHeatmapWidget` + `AiNarrativeWithSources` + `SprintWeeklyPanel`.** Когда сомневаешься «достаточно ли секси» — открой эти три и сравни.
4. **«Вау» = визуализация + цвет + анимация + плотность.** Не «больше декораций». Если число можно превратить в полоску/график/чип-с-градиентом — превращай. Если несколько чисел можно положить в общую сетку с тонами — клади.
5. **Mobile-first.** Любой виджет должен корректно сжиматься на `sm:` и `md:`. Никаких `min-w-[NNNpx]` без `sm:min-w-0`.
6. **Микро-движение — да, цирк — нет.** `transition-colors`, `hover:scale-[1.01]`, `motion-safe:`, плавный count-up для KPI. Никаких влетающих-вращающихся блоков.
7. **Empty/loading/error не теряем.** Любой новый компонент сохраняет существующее поведение состояний (`Skeleton` / `EmptyState` / `Toast`).
8. **Никаких новых зависимостей без обоснования.** Проверять, что `recharts` уже в `package.json`. Если нет — обсудить (`recharts` тяжёлый, может быть `react-sparklines` или собственный SVG-компонент).

## Где источник правды по виджетам и страницам

- Главный CEO-дашборд: [frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx)
- Виджеты: [frontend/src/ui/components/dashboard/](../../frontend/src/ui/components/dashboard/)
- Sidebar и навигация: [frontend/src/ui/components/Sidebar.tsx](../../frontend/src/ui/components/Sidebar.tsx)
- AuthenticatedShell (FAB AssistantSidebar): [frontend/app/(authenticated)/AuthenticatedShell.tsx](../../frontend/app/(authenticated)/AuthenticatedShell.tsx)
- Operations: [frontend/app/(authenticated)/dashboard/operations/](../../frontend/app/(authenticated)/dashboard/operations/)
- Person Pulse: [frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx](../../frontend/app/(authenticated)/persons/[id]/pulse/PersonPulseClient.tsx)
- Sprint Daily/Weekly: [frontend/app/(authenticated)/sprints/[id]/SprintDailyPanel.tsx](../../frontend/app/(authenticated)/sprints/[id]/SprintDailyPanel.tsx), [SprintWeeklyPanel.tsx](../../frontend/app/(authenticated)/sprints/[id]/SprintWeeklyPanel.tsx)
- Smart-tables: [frontend/app/(authenticated)/tables/](../../frontend/app/(authenticated)/tables/)

---

## Фаза 0 — Реестр дашбордов и виджетов (документ, ~30 мин)

**Цель:** один файл, в который мы будем сверяться на каждой следующей фазе.

- [ ] Создать [docs/reference/dashboards-registry.md](../../docs/reference/dashboards-registry.md):
  - Таблица «Дашборд / Маршрут / Главный Client.tsx / Используется-в-меню / Категория (CEO / Operations / Person / Sprint / Tables)».
  - Таблица «Виджет / Файл / Использует Client.tsx / Поток данных (api/domain) / Текущий статус (✅ эталон / 🟡 нужна полировка / 🔴 черновик)».
  - Раздел «Эталонные виджеты» — ссылки на `BottleneckHeatmap`, `AiNarrativeWithSources`, `SprintWeeklyPanel`.
- [ ] Раздел «Что считать "вау"» — мини-чеклист из 7 пунктов (визуализация, цвет-кодирование, hover, skeleton, mobile, motion, русский).

**Готово, когда:** реестр коммитнут, дальнейшие фазы ссылаются на него.

---

## Фаза 1 — DEAD ROUTES (срочно, ~30 мин)

**Цель:** ни одной страницы без навигации.

- [ ] **Smart-tables в Sidebar.** В [Sidebar.tsx](../../frontend/src/ui/components/Sidebar.tsx) добавить пункт «Таблицы» с иконкой `Table2`/`Sheet` (lucide). Группа — `DAILY_GROUP` (или новая `WORKSPACE_GROUP`, если по навигации логично). Решение по группе зафиксировать в коммит-сообщении.
- [ ] **Person Pulse — кнопка с карточки сотрудника.** В компонент `PersonDetailClient` (или эквивалент на `/persons/[id]`) добавить заметную кнопку/таб **«Пульс»** → `/persons/[id]/pulse`. Стиль — primary outline с иконкой `Activity`.
- [ ] **Sprint Archive в Sidebar.** Под пунктом «Спринты» добавить подпункт «Архив» → `/sprints/archive`. Если sidebar не поддерживает nested-пункты — добавить вторичной ссылкой в верх страницы `/sprints/page.tsx`.
- [ ] **Поиск других orphan-страниц.** Прогнать ручной аудит: для каждой `app/(authenticated)/**/page.tsx` найти grep-входа `href="/path"` или `Link to=`. Список «нет ни одного входа» — добавить в реестр Фазы 0 как «требует навигации».
- [ ] Проверить, что у каждого нового пункта меню задан правильный `permission`-фильтр (если есть RBAC-видимость).

**Готово, когда:** все 3 dead routes доступны из основной навигации, в реестре нет «orphan» отметок.

---

## Фаза 2 — Библиотека мини-визуализаций (~2-3 часа)

**Цель:** один набор переиспользуемых SVG-компонентов, чтобы дальше каждый виджет получал sparkline/мини-bar одной строкой.

- [ ] Создать `frontend/src/ui/components/dashboard/charts/`:
  - `MiniSparkline.tsx` — `<svg>` 60×20 px, props: `{ data: number[], tone: 'success'|'warning'|'danger'|'accent'|'neutral', filled?: boolean }`. Цвет через `var(--chip-{tone}-fg)`, заливка `var(--chip-{tone}-bg)`. Без зависимостей — чистый SVG path.
  - `MiniBarRow.tsx` — горизонтальная полоска прогресса от 0 до max, props: `{ value, max, tone, label?, suffix? }`. Используется для ROI, goal progress, mention count.
  - `MiniStackedBar.tsx` — stacked bar из N сегментов с разными тонами, props: `{ segments: { value, tone, label? }[] }`. Для top-3 contributors в GoalVector.
  - `MiniDonut.tsx` — кольцо 28×28 px, props: `{ value: 0..1, tone, centerLabel? }`. Для health-score, RBAC-coverage.
  - `MiniHeatCell.tsx` — извлечь из `BottleneckHeatmapWidget` ту же логику расчёта opacity, оформить как переиспользуемую ячейку.
  - `CountUp.tsx` — анимация числа от 0 к target за 600мс, `motion-safe:` (если `prefers-reduced-motion` — без анимации). Для KPI-hero.
- [ ] Storybook-страница (или просто `app/(design-preview)/charts/page.tsx`) с примерами каждого компонента в трёх тонах и трёх размерах.
- [ ] Все компоненты — типизация на TS, без `any`, без `default export` (named only — правило проекта).
- [ ] `bun run typecheck` и `bun run lint` проходят.
- [ ] Решение по библиотеке зафиксировать: если для одного из компонентов оказался разумнее готовый пакет (например, лёгкий `react-sparklines` ~3KB) — добавить с обоснованием в коммите. По умолчанию **никаких зависимостей** — всё на чистом SVG.

**Готово, когда:** в preview-странице видно все 6 компонентов работающими, типы зелёные.

---

## Фаза 3 — Полировка слабых виджетов CEO-дашборда (~3-4 часа)

**Цель:** все 6 «слабых» виджетов выходят на уровень эталона.

Для каждого виджета — pattern «before / after» в PR-описании (скриншот до и после, если возможно).

- [ ] **RecurringTopicsWidget** — добавить `MiniBarRow` справа от каждой темы по `mentionCount`. Цвет тона: >10 — `danger`, 5-10 — `warning`, <5 — `success`. Сверху виджета — sparkline общей частоты по дням окна.
- [ ] **TeamHealthGrid** — каждая строка получает hover-tone по `sentiment.tone` (`hover:bg-chip-{tone}-bg/10`). Колонка `score` показывает `MiniDonut` вместо числа. Заголовок строки — аватар команды + название (если данных аватара нет — инициалы в цветном кружке).
- [ ] **LowRoiMeetingsWidget** — ROI как `MiniBarRow` (red→amber→green по абсолютному значению). Под названием встречи мини-чипы участников (max 3 + «+N»). При hover на строку — подсветка `bg-chip-danger-bg/5`.
- [ ] **BusFactorWidget** — для каждого класса знаний `MiniStackedBar` сегментов (эксперты × N + advanced × N + beginner × N). Чип severity — цветной с градиентом по риску. Сверху — общий sparkline ухудшения/улучшения bus-factor по неделям.
- [ ] **GoalVectorWidget** — под progress-bar каждой цели `MiniStackedBar` из top-3 contributors (имя + % вклада, каждый в своём accent-тоне). Слева цели — `MiniDonut` процента выполнения.
- [ ] **KnowledgeVelocityKpi** — `KpiHero` дополнить `MiniSparkline` фоном (полупрозрачным) и `CountUp` для главного числа. Стрелка тренда — цветная (`text-chip-success-fg` / `text-chip-danger-fg`).
- [ ] **ActivityFeedWidget** — событие получает иконку-категорию (lucide) на цветном круглом фоне `bg-{tone}/10`. Время в виде «5 мин назад» (использовать `formatDistanceToNow` из date-fns, который уже в проекте).
- [ ] **IrreversibleDecisionsAlert** — заменить плоский banner на градиентный (`bg-gradient-to-r from-chip-danger-bg/20 via-chip-warning-bg/10 to-transparent`) с иконкой `AlertTriangle` слева и сквозной полосой `border-l-4 border-chip-danger-fg/60`.

**Готово, когда:** ручной обход главной страницы — все 8 виджетов выглядят «дорого», ни один не выделяется «MVP-стилем». Чек по эталонам из Фазы 0.

---

## Фаза 4 — Режиссура главной страницы (~1-2 часа)

**Цель:** общая композиция `DirectorDashboardClient` — «cinema mode».

- [ ] Hero-strip KPI сделать с фоновым градиентом `bg-gradient-to-br from-bg-card via-bg-card to-accent/5`, скруглением `rounded-2xl`, лёгким `shadow-lg`. Каждый KPI — `CountUp` + `MiniSparkline` фоном.
- [ ] Sticky-header страницы оставить, но добавить тонкий нижний бордер `border-b border-border-subtle/50` и `bg-bg-base/80 backdrop-blur-md`.
- [ ] Между секциями виджетов — `border-t border-border-subtle/30` или мягкий divider с заголовком категории (`«Команда»`, `«Знания»`, `«Решения»`). Не пустое поле.
- [ ] AI-нарратив (`AiNarrativeWithSources`) — поместить в карточку с лёгким inner-glow (`shadow-[0_0_40px_-12px_var(--accent)/30]`), чтобы было ясно «это flagship-блок».
- [ ] Mosaic-layout: пересмотреть гриды виджетов. Размер виджета пропорционален «весу» (BottleneckHeatmap — крупная, RecurringTopics — узкая колонка). Цель — асимметричная композиция, не сетка 2×2 одинаковых квадратов.
- [ ] Enter-анимация при первой загрузке: `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2` с stagger по 60мс между виджетами. Не больше 400мс общая длина.

**Готово, когда:** при первом открытии главной — wow-эффект «как в Linear / Vercel», не «как в Jira».

---

## Фаза 5 — OperationsDashboard / Daily / Weekly (~2 часа)

**Цель:** Operations выходит на тот же уровень, что CEO-дашборд.

- [ ] Открыть [OperationsDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx), [daily/DailyDigestClient.tsx](../../frontend/app/(authenticated)/dashboard/operations/daily/DailyDigestClient.tsx), [weekly/WeeklyDigestClient.tsx](../../frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx).
- [ ] Для каждого — пройтись по чеклисту Фазы 0 (вау-критерии). Слабые секции — переоформить через библиотеку Фазы 2.
- [ ] Daily / Weekly — добавить «истоию изменений» (sparkline главных метрик за 7/30 дней) сверху.
- [ ] Связь между уровнями: с CEO-дашборда — ссылка «Операционная сводка» → `/dashboard/operations`. С Operations — «Сегодня» / «Неделя» как табы вверху.

**Готово, когда:** все три страницы выглядят как единая семья дашбордов.

---

## Фаза 6 — Person Pulse (карточка сотрудника, ~2 часа)

**Цель:** `/persons/[id]/pulse` — «дашборд сотрудника», который HR/руководитель открывает раз в неделю.

- [ ] Hero: аватар + имя + роль + один большой KPI «Pulse score» (`MiniDonut` 80px + `CountUp`).
- [ ] Под hero — 3 секции:
  - **Активность** (встречи, решения, идеи за период) — sparkline + цветные чипы.
  - **Здоровье / sentiment** — `MiniSparkline` тона за 4 недели + чипы по факторам.
  - **Связи** — top-5 коллег с которыми работает (мини-граф или просто аватарки с числами).
- [ ] Period-picker (7д / 30д / 90д) — на каждый период динамический пересбор всех чисел.
- [ ] Кнопка «Открыть полный профиль» → `/persons/[id]`.
- [ ] Empty-state «недостаточно данных» — иллюстрация + понятная подпись «нужно ≥3 встречи за период».

**Готово, когда:** руководитель смотрит на страницу и через 5 секунд знает «всё ок» / «что-то не так».

---

## Фаза 7 — Sprint Daily / Weekly polish (~1-2 часа)

**Цель:** довести Daily до уровня уже хорошей Weekly.

- [ ] SprintDailyPanel — добавить top-strip «Сегодня в спринте» (3 KPI с `CountUp`).
- [ ] Цвет-чипы по health-tone строк — как в TeamHealthGrid.
- [ ] AI-нарратив выделить визуально, как на CEO-дашборде.
- [ ] Sprint-archive — оформить список архивных спринтов карточками с мини-stat'ами (длительность, % выполнено, главный outcome), не плоским списком.

**Готово, когда:** Daily и Weekly выглядят однотипно «дорого».

---

## Фаза 8 — Smart-tables polish (~2-3 часа)

**Цель:** `/tables` выглядит как «Notion meets Linear», а не «Excel в браузере».

- [ ] **TablesListClient** — карточки таблиц с превью (первые 3 строки в minified-виде), иконкой типа, числом колонок/строк, временем последнего изменения.
- [ ] **GridView** (Glide Data Grid) — custom cell renderers:
  - Колонка `status` / `select` — цветной чип с tone по значению (использовать DS tokens, не hardcoded).
  - Колонка `number` / `currency` / `%` — числа справа, тонкая `MiniBarRow` фоном если есть max/range.
  - Колонка `date` — относительное время с tooltip абсолютной даты.
  - Колонка `link` — иконка + truncate.
  - Колонка `person` — аватар + имя.
- [ ] **RowDetail** — переоформить шапку строки (заголовок + цветной фон по статусу + breadcrumb «Таблица → Строка»).
- [ ] **TableHeader** — поиск, фильтры, переключатель views — выровнять с эстетикой остального продукта (paired tokens, иконки lucide, hover-states).
- [ ] **EmptyState** — приятная иллюстрация + CTA «Создать первую таблицу».
- [ ] **ColumnTypeSelector** — каждая опция типа колонки с иконкой и кратким примером.

**Готово, когда:** открываешь `/tables` и хочется работать, не сбежать в Excel.

---

## Фаза 9 — Мобильный режим всех дашбордов (~1-2 часа)

**Цель:** на 375px ширины — всё читаемо, ничего не вылезает.

- [ ] Прогнать каждый дашборд в DevTools на 375px / 768px:
  - CEO Director
  - Operations / Daily / Weekly
  - Person Pulse
  - Sprint Daily / Weekly
  - Tables list / detail
- [ ] Исправить найденные `overflow-x`, фикс. ширины, переполнение grid-колонок.
- [ ] AssistantSidebar (FAB) — проверить, что на мобильном открывается на полную ширину и не наезжает на контент.
- [ ] Sidebar на мобильном — должен корректно сворачиваться (drawer-режим).

**Готово, когда:** все дашборды на iPhone SE-ширине читаемы и работают.

---

## Фаза 10 — Микро-движение и финальная полировка (~1-2 часа)

**Цель:** добавить «жизнь» — но дозировано.

- [ ] Все интерактивные карточки виджетов — `hover:shadow-md hover:-translate-y-[1px] transition-all duration-150`.
- [ ] Числа KPI — `CountUp` (Фаза 2) на первом рендере.
- [ ] Sparkline в hero — лёгкая `motion-safe:animate-pulse` на длинной паузе (3-5 сек) для «живости».
- [ ] Все кнопки действий в дашбордах — единый стиль hover/active/disabled.
- [ ] Skeleton-состояния — заменить серые блоки на shimmer-эффект (`bg-gradient-to-r from-bg-overlay via-bg-card to-bg-overlay animate-pulse`).
- [ ] `motion-safe:` префиксы везде, где нужно. `prefers-reduced-motion` пользователи получают статичный UI.

**Готово, когда:** при наведении/клике/первом рендере есть приятные микро-реакции, но ничего не «прыгает» и не «крутится».

---

## Фаза 11 — Финальная верификация (~1 час)

**Цель:** убедиться, что ничего не сломалось и всё на месте.

- [ ] `bun run typecheck` (frontend) — зелёный.
- [ ] `bun run lint` (frontend) — зелёный.
- [ ] `bun run build` (frontend) — успешно.
- [ ] `bun run test:unit` (frontend) — все тесты проходят.
- [ ] Ручной обход всех дашбордов (по реестру из Фазы 0) — empty/loading/error состояния не пропали.
- [ ] Скриншот-сравнение «до / после» главных страниц (CEO, Operations, Pulse, Sprint, Tables) — приложить к финальному коммиту.
- [ ] Проверка mobile (Фаза 9) повторно после всех изменений.
- [ ] Обновить [second-brain/01_projects/frontend-pages.md](../../second-brain/01_projects/frontend-pages.md) — пометить полированные страницы, описать новую библиотеку charts.
- [ ] Рефлексия в `second-brain/05_история/2026-MM-DD-dashboards-wow-polish.md`.

**Готово, когда:** ТЗ имеет 100% `[x]`, тесты зелёные, скриншоты подтверждают «вау».

---

## Acceptance criteria (приёмка владельца)

1. **0 dead routes** — каждая страница из реестра имеет минимум одну точку входа в навигации.
2. **0 виджетов на уровне MVP** — каждый виджет в реестре с тегом 🟡 переведён в ✅.
3. **6 переиспользуемых мини-визуализаций** (Sparkline, BarRow, StackedBar, Donut, HeatCell, CountUp) задокументированы и используются ≥ в 3 виджетах каждый.
4. **Все 5 семейств дашбордов** (CEO / Operations / Person / Sprint / Tables) на одном уровне визуальной полировки — нельзя по скриншоту угадать «этот сделан раньше».
5. **Mobile** — все дашборды без horizontal-scroll на 375px.
6. **DS** — `bun run lint` не находит `bg-white`/`text-white` поверх цветного / hex / slate (если нужен — добавить eslint-правило, но не блокировать фазу).
7. **Motion** — есть, дозировано, `prefers-reduced-motion` обрабатывается.
8. **Русский** — ни одного английского слова в видимых строках (кроме брендов).

## Out of scope (явно НЕ делаем в этом ТЗ)

- Новые виджеты / новые метрики (только полировка существующих).
- Новые типы колонок в smart-tables (cell renderers — да, новые типы — нет).
- AI-улучшения промптов / pipeline (только UI).
- Изменения схемы БД.
- Изменения REST-эндпоинтов (только потребление существующих).
- Адаптация админки — отдельная задача.
- Темизация (dark/light переключение) — отдельная задача.

## Открытые вопросы (требуют решения до начала)

1. **Библиотека графиков:** делаем все мини-визуализации на чистом SVG (без зависимостей) или ставим `react-sparklines` (~3KB)? **Рекомендация:** чистый SVG, потому что у нас всего 6 простых форм и контроль над DS-токенами важнее.
2. **Sidebar-группа для `/tables`:** новый раздел «Рабочее пространство» или внутри «Каждый день»? **Рекомендация:** новая группа «Рабочее пространство» с `/tables` + последующими разделами (база знаний, документы).
3. **Person Pulse — выносить в новый таб карточки `/persons/[id]` или оставить отдельной страницей?** **Рекомендация:** оставить отдельной — это другой угол зрения (метрики/тренды), не CRUD.

---

## Итог (заполняется по завершении)

- [ ] Реализовано целиком.
- [ ] Реализовано частично. Что осталось: …
- [ ] Отменено. Причина: …
