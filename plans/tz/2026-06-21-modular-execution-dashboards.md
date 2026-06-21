---
type: tz
status: ready-to-implement
feature: modular-execution-dashboards
date: 2026-06-21
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-21-modular-dashboards-and-execution-focus.md
  - plans/analysis/2026-06-21-execution-dashboards-prototype.html
  - plans/tz/2026-06-05-weekly-per-person-plan-fact.md
  - plans/tz/2026-06-05-goal-vector-compass.md
  - plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md
---
> Анализ: `plans/analysis/2026-06-21-modular-dashboards-and-execution-focus.md` · Кликабельный прототип (эталон вёрстки и поведения): `plans/analysis/2026-06-21-execution-dashboards-prototype.html` · Статус согласования: 2026-06-21

# Модульные дашборды исполнения — ритмы День / Неделя / Месяц

## Принцип
Дашборд отвечает на вопрос **«что с работой и где ей помочь»**, а не «кто молодец / кто плохой». Загрузка = «кому тяжело, куда перекинуть»; зависшая задача = «чему помочь сдвинуться»; разрез по людям = «где затык», не рейтинг. Это контрактный инвариант: язык UI-копий и заголовки модулей — про поток работы и помощь, не про оценку людей. Нарушение (рейтинговый/обвинительный тон) — дефект приёмки.

## Вне scope / отложено владельцем
- **Пользовательское перетаскивание (drag-n-drop) блоков и сохранение раскладки на конкретного пользователя** — vNext. Сейчас только ролевые пресеты (см. Решение Р3).
- **Редактирование раскладки из админки** — vNext; закладывается только крюк `getDynamic` (Решение Р3).
- **Светлая тема** — отдельный дизайн владельца (см. `plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md`).
- **Достройка связей «идея ↔ тема блоков»** (Theme↔Idea join) — vNext; идеи группируем через готовый `IdeaCluster`, не через `Theme`.

---

## Цель
Пересобрать дашборды Коры в **модульную систему из трёх ритмов** (День «Сегодня» → Неделя → Месяц «Итоги месяца») с фокусом на исполнении задач: план-факт, загрузка, зависшие задачи, блокеры и идеи **по темам**, решения, вектор к цели **с разворотом по людям**. Каждый модуль — переиспользуемый кирпич с единым контрактом; раскладка задаётся ролевым пресетом (владелец / опер.директор / сотрудник). С каждого модуля можно **провалиться в первоисточник** (встреча на таймкоде, сообщение в чате, задача в трекере) и вернуться назад.

### Зачем
Текущий главный дашборд (`DirectorDashboardClient.tsx`) — «обзор всего»: витринные метрики (польза за период), радар сигналов, оцифровано — на новой компании половина блоков пустые/в нулях, а ядро исполнения (зависшие, блокеры) не выделено. Утренний сценарий руководителя («что было вчера у команды, где затык, кому помочь») не закрыт. Раскладка захардкожена в JSX — менять состав/порядок нельзя без переписывания страниц. Обоснование подачи (работа, не люди; drive-of-usage) — `plans/analysis/2026-06-08-value-stickiness-roadmap.md`.

---

## REALITY-CHECK (фактический статус по коду на 2026-06-21)

Перед оценкой scope проверено по коду. **Бэкенд-данные готовы на ~85%, главный дефицит — фронтовый модульный слой.**

| Возможность | Статус | Где (path:line) |
|---|---|---|
| План-факт (план утром / факт вечером, настроение) | ✅ готово | `DailyCheckIn` schema.prisma:7101 (`kind` morning/evening, `plansJson`/`donesJson`/`blockersJson`, `sentiment`, `completedAt`) |
| Зависшие задачи (overdue / без движения) | ✅ готово | `Issue` schema.prisma:9175 (`dueDate`,`completedAt`,`lastOverdueDetectedAt`); `StaleIssuesCard` на операционном |
| Загрузка по людям | ✅ готово | `IssueAssignee.userId` + count `Issue.completedAt IS NULL` |
| **Связь задача ↔ цель** | ✅ готово (прямая) | `Issue.goalId` schema.prisma:9224; `Issue.goal @relation("IssueGoal")` schema.prisma:9278; `Goal.linkedIssues` schema.prisma:4432 |
| **Вклад человека в цель** (основа «вектора по людям») | ✅ готово | `PersonGoalContribution` schema.prisma:7600 (`personId`,`goalId`,`weekStart`,`proScore`,`contraScore`,`netScore`); `PulsePatternsService.getGoalVector()` `pulse-patterns.service.ts:279` |
| **★ Недельный план-факт по людям** | ✅ РЕАЛИЗОВАН | `weekly-per-person.service.ts` + контроллер; `GET /api/v1/dashboard/operations/weekly-per-person` и `/:personId/items`; DTO `WeeklyPersonRowDto`; `IdeaBlock.commitmentAuthorPersonId` schema.prisma:3418 (есть) |
| Блокеры по темам (обобщение) | ✅ готово | `BlockerSynthesis` schema.prisma:7326 (`clusterKey`,`representativeText`,`status` new/recurring,`daysOpen`,`businessImpactScore`,`responsiblePersonId`,**`relatedBlockIdsJson`**); `GET /dashboard/operations/blockers/chronic` |
| Причины блокеров по категориям | ✅ готово | `Insight.causeCategory` schema.prisma:6338; `insightsByCauseCategory` в overview |
| Идеи по темам | ✅ готово | `Idea` schema.prisma:6487 + `IdeaCluster` schema.prisma:6551 (`name`,`ideaIds[]`); `GET /ideas`, `/ideas/:id/clusters` |
| Решения (принято/застряло, доведение) | ✅ готово | `Decision` schema.prisma:6200 (`status`,`linkedTaskCount`,`implementationStatus` not_started/in_progress/done/stalled,`deadline`); `DecisionTaskLink` schema.prisma:7401 |
| Зависимости задач (цепочки) | ⚠️ данные есть, нет UI | `IssueRelation` schema.prisma:9602 (`sourceIssueId`,`targetIssueId`,`relationType` blocks/blocked_by) |
| Провенанс / проваливание в источник | ✅ инфраструктура готова | `ProvenanceService.buildProvenanceDeepLink()` `provenance.service.ts:145`; deepLink `/meetings/{id}?t={sec}` · `/chats/{id}?m={msgId}` · `/documents/{id}?page&q`; DTO `ProvenanceNode` :43; `GET /provenance/{entityType}/{entityId}` |
| Тренд день-к-дню / неделя-к-неделе | ✅ данные историчны | `DailyOperationsDigest` schema.prisma:7719 (uniq `tenantId,dateLocal`) и `WeeklyOperationsDigest` schema.prisma:7669 (uniq `tenantId,weekStart`) — каждый период отдельная запись, история уже есть |
| Зрелость / незаменимость (для месяца) | ✅ готово | `MaturityWidget` + bus-factor в `pulse?.busFactor` (operations) |
| **Ссылка-источник у СЫРОГО блокера чек-ина** | ❌ нет | `OperationsDashboardService.fetchBlockers()` `operations-dashboard.service.ts:452-502` → `sourceBlockId: null` (:493): `blockersJson` — массив текстов без FK на IdeaBlock |
| **Модульный слой** (реестр виджетов, конфиг раскладки, рендер по конфигу, пресеты) | ❌ нет | Раскладка захардкожена в JSX: `DirectorDashboardClient.tsx:320-451`, `OperationsDashboardClient.tsx:185-485` |
| **Эндпоинт «вектор к цели по людям»** | ❌ нет (данные есть) | Собирается из `PersonGoalContribution` + `Issue.goalId` + `IssueAssignee` |
| Поддержка `?m=` в чате (скролл к сообщению) | ❌ нет | deepLink формат есть, фронт `/chats/[id]` параметр не парсит |

**Вывод по scope:** обе «правки БД», подтверждённые владельцем, оказались минимальными — тренд НЕ требует новой таблицы (digest уже историчен per-period), а связь блокер↔источник для **тем** уже покрыта `BlockerSynthesis.relatedBlockIdsJson`; достроить нужно лишь источник для **сырого** блокера чек-ина (Ф2). Основной объём — фронтовый модульный слой и сборка экранов.

---

## Принятые решения владельца (2026-06-21, не пересматривать)

| # | Решение | Обоснование (почему) |
|---|---|---|
| Р1 | Модульность первой итерации = реестр виджетов + **ролевые пресеты**, без drag-n-drop | Состав модулей не устоялся; «собери сам» = работа, которую рядовой не сделает → дефолт. Анализ §9 |
| Р2 | Порядок ритмов: **День ⊂ Неделя ⊂ Месяц** — каждый горизонт = всё из предыдущего (за свой период) + добавки; модулей нарастает | Запрос владельца 2026-06-21; нагляднее, переиспользует модули |
| Р3 | Раскладка пресетов — **в коде (дефолт) через `getDynamic`**, переопределение из AdminSetting = vNext | Инвариант «крутилки в AdminSetting, дефолт = code-fallback» (CLAUDE.md §9); раскладка — структура, не бизнес-крутилка, редактирование из админки преждевременно |
| Р4 | **Достроить обе** фичи правок БД: источник сырого блокера + тренд период-к-периоду | Без источника не работает «проваливание в блокер»; тренд нужен на Неделе/Месяце. Реальная достройка минимальна (REALITY-CHECK) |
| Р5 | **Всё одним ТЗ, фазами**: модульный слой → Сегодня → Неделя → Месяц | Неделя дёшева (★ таблица готова), месяц переиспользует модули; цельная картина, один релиз |
| Р6 (инвариант) | Дашборд про **работу, а не людей**; разрез по людям = «где затык / кому помочь» | Drive-of-usage: дашборд кормится честными чек-инами; рейтинговый тон убивает поток данных |

---

## Доказательство выбора (сведение двух проходов)

**Проход A** (под текущий код): модульный слой на фронте (реестр + конфиг + canvas), бэкенд переиспользует готовые эндпоинты (`weekly-per-person`, `blockers/chronic`, `ideas/clusters`, `provenance`), добирает 2 новых (вектор по людям, источник сырого блокера).
**Проход B** (альтернатива): «дашборд как данные» — серверный layout-движок, бэкенд отдаёт готовый список секций с данными, фронт тупо рендерит.

| Критерий | A: фронтовый реестр | B: серверный layout-движок |
|---|---|---|
| Скорость до результата | ✓ переиспользует `modern/`-компоненты | ✗ новый серверный слой + контракт секций |
| Ролевые пресеты | ✓ конфиг в коде + getDynamic | ✓ но дороже (сервер решает видимость) |
| Drill-down (drawer, проваливание) | ✓ клиентское состояние, мгновенно | ✗ ре-запрос на каждый разворот |
| Соответствие стеку (ApiDto→Domain→Ui, SWR) | ✓ канон фронта Z | ✗ ломает слоистую модель |
| Риск over-engineering | ✓ низкий | ✗ серверный движок раскладки = код ради кода под несуществующую нагрузку |

**Выбор — A.** B отвергнут: серверная раскладка — преждевременная абстракция, ломает drill-down и слоистую модель фронта.
**Challenge-loop:** (1) корень, не симптом — да: модульный слой чинит КЛАСС «нельзя менять состав», а не один экран; (2) эффективнее — да: 85% данных готово, не строим бэкенд заново; (3) код ради кода — нет: реестр переиспользует существующие `modern/` и `widgets/`, новые только 2 эндпоинта.

---

## Scope

### Входит
- Модульный слой: `WidgetDescriptor` + `WIDGET_REGISTRY` + `DashboardCanvas` + `DashboardPreset` (3 роли × 3 ритма) + `visibleWhen` (нет данных → не рисуем) + `getDynamic`-крюк.
- Экран «Сегодня» (День) — модули M1–M10 (см. Каталог).
- Экран «Неделя» — модули Дня (за неделю) + ★ `weekly-per-person` + тренд + «висит неделями».
- Экран «Итоги месяца» — модули Недели (за месяц) + достижения, зрелость, незаменимость, динамика по неделям, тренд месяц-к-месяцу.
- Drill-down: разворот по людям (drawer, без ре-запроса) + проваливание в источник через `ProvenanceService` deepLink; поддержка `?m=` в `/chats/[id]`.
- 2 новых бэкенд-эндпоинта (вектор по людям; источник сырого блокера) + 1 тренд-маппер.

### Не входит
→ см. «Вне scope» выше (drag-n-drop, редактирование раскладки из админки, светлая тема, Theme↔Idea).

---

## Граничные контракты с другими ТЗ
- **`weekly-per-person` (ТЗ 2026-06-05) — РЕАЛИЗОВАН, не переписывать.** Модуль M-Week-PlanFact только потребляет `GET /dashboard/operations/weekly-per-person`; контракт `WeeklyPersonRowDto` берётся как есть.
- **Компас/goal-vector (ТЗ 2026-06-05).** Не дублировать расчёт вектора. Модуль «вектор по людям» переиспользует `PersonGoalContribution`; если компас ещё не выкатан — модуль работает независимо от его UI.
- **Операционный дашборд остаётся** как «копнуть глубже» (bus factor, customer risk, recurring topics и т.д. — не переносим на ритмы, только ссылаемся).

---

## Контракт-first: Каталог модулей (точечно по каждому — данные, фиксация, drill-down)

Формат: **ID · Название · ритмы · роли · Источник (модель:поле / эндпоинт) · Что показывает · Drill-down · Acceptance-маркер.** Все эндпоинты — `/api/v1/...`, Zod-DTO + Swagger (nestjs-zod), фронт `ApiDto→DomainModel→UiModel` через единый `api-client.ts`, SWR.

### M1 · Вердикт утра · день/неделя/месяц · owner,coo
- Источник: `dashboardApi.getDirectorView()` → `requiresAction.total`/`bySource`; статус сбора `collectorDown`.
- Показывает: «спокойное утро или нет» + сколько ждёт лично тебя.
- Drill-down: клик «ждут тебя» → раскрытие списка (drawer) по `bySource` (конфликты/задачи/probe).
- Acceptance: при `requiresAction.total=0` рендерит «ничего не ждёт»; при `collectorDown=true` — красный статус.

### M2 · Идём к цели + сводка Коры (объединённый широкий блок) · день/неделя/месяц · owner,coo
- Источник: вектор — `PulsePatternsService.getGoalVector()` (`proScore`/`contraScore`/`netScore` по `Goal.isPrimary`); текст — `dashboardApi.getDirectorView().narrativeSummary` (день) / digest `bodyMarkdown`.
- Показывает: стрелка направления к главной цели + AI-сводка «что было/что тормозит/главное на сегодня».
- Drill-down: **«Развернуть по людям»** → `GET /api/v1/dashboard/goal-vector/by-person?goalId=<primary>&period=<day|week|month>` (НОВЫЙ, Ф2). По каждому человеку: `netScore` вклада + его задачи по цели (`Issue.goalId == goal AND IssueAssignee.userId`) сделано/висит + мини-направление (up/side/down). Клик по затыку → его блокер (drawer M6).
- Acceptance: при отсутствии `Goal.isPrimary` рендерит «цель не задана»; by-person возвращает строки только по людям с `PersonGoalContribution` или с `Issue.goalId`.

### M3 · План и факт за период · день/неделя/месяц · owner,coo
- Источник: `DailyCheckIn` (kind morning/evening, `completedAt`, `donesJson` vs `plansJson`, `sentiment`). Агрегат настроения: доли `sentiment` green/yellow/red.
- Показывает: сколько отчитались / дел закрыто / перенесено + донат настроения команды.
- Drill-down: **«По людям»** → drawer: у кого план разошёлся с фактом + почему (его блокер). Эндпоинт `operationsDashboardApi.getMissingCheckIns()` + чек-ины по человеку.
- Acceptance: при 0 чек-инов — «нет чек-инов за период»; донат суммирует доли в 100%.

### M4 · Загрузка по людям · день/неделя/месяц · owner,coo
- Источник: `IssueAssignee.userId` GROUP BY + count `Issue.completedAt IS NULL`. (НОВЫЙ агрегат-эндпоинт `GET /api/v1/dashboard/load/by-person` или переиспользовать `getTeamCapacity` если отдаёт per-person.)
- Показывает: у кого сколько задач в работе; перегруз/норма/недогруз.
- Drill-down: «По людям» → drawer с полосками + «перекинуть задачу».
- Acceptance: подаётся как карта нагрузки (нет слов «отстающий»); сортировка по числу задач desc.

### M5 · Что зависло · день/неделя/месяц · owner,coo
- Источник: `operationsDashboardApi.getStaleIssues({staleDays, limit})` → `Issue` где `dueDate < now AND completedAt IS NULL` или без движения N дней; поля `issueId`,`identifier`,`title`.
- Показывает: просроченные/застрявшие задачи, чья, сколько дней.
- Drill-down: клик задачи → `/issues/{issueId}` (переход на карточку, готов). Если задача в цепочке — показать «блокирует X» (M5b).
- Acceptance: клик ведёт на `/issues/{id}`; список пуст → «зависших нет».

### M5b · Цепочки «задача держит задачу» · неделя/месяц · owner,coo
- Источник: `IssueRelation` (`relationType` blocks/blocked_by) — НОВЫЙ эндпоинт `GET /api/v1/dashboard/issue-chains?period=` (Ф2).
- Показывает: пары/цепочки A→B (пока не сделан A, не сдвинется B).
- Drill-down: клик узла → `/issues/{id}`.
- Acceptance: рендерит только связи `blocks`/`blocked_by`; пусто → не показывается (`visibleWhen`).

### M6 · Что мешает — блокеры по темам · день/неделя/месяц · owner,coo
- Источник: `GET /api/v1/dashboard/operations/blockers/chronic` → `BlockerSynthesis` (`representativeText` как тема, `status` new/recurring, `daysOpen`, `businessImpactScore`, `relatedBlockIdsJson`). Причины — `insightsByCauseCategory`.
- Показывает: тему блокера + сколько вхождений/дней + «чаще всего мешает: процессы/инструменты/внешнее».
- Drill-down: клик темы → drawer «источник»: самый острый блокер темы → `ProvenanceService` по `relatedBlockIdsJson[0]` → deepLink **встреча `/meetings/{id}?t=`** / **чат `/chats/{id}?m=`** / задача. Действия: «назначить решающего», «в задачу».
- Acceptance: у темы с непустым `relatedBlockIdsJson` drawer показывает ≥1 кнопку перехода в источник с валидным deepLink.

### M7 · Идеи команды по темам · день/неделя/месяц · owner,coo,member
- Источник: `GET /api/v1/ideas/:id/clusters` / `IdeaCluster` (`name`,`ideaIds[]`,`clusterWeight`) + `Idea` (`statement`,`supporterCount`,`status`).
- Показывает: тема идей + сколько идей + поддержка; «растёт/новое/копится».
- Drill-down: клик темы → drawer: все идеи темы + обобщение Коры + «создать эпик» / «в решение».
- Acceptance: тема показывает count = `ideaIds.length`; drawer перечисляет идеи кластера.

### M8 · Решения: принято / застряло · день/неделя/месяц · owner,coo
- Источник: `Decision` (`status`,`implementationStatus` stalled,`linkedTaskCount`,`deadline`); эндпоинты decision throughput/stalled (operations).
- Показывает: принято за период / застряли (ждут владельца) / % доведено до задач (`linkedTaskCount`).
- Drill-down: клик решения → карточка решения; «застряло» → кто должен решить.
- Acceptance: «застряло» = `implementationStatus='stalled'` ИЛИ (`linkedTaskCount=0` AND старше N дней); % доведено = решения с `linkedTaskCount>0` / всего.

### M9 · Лента (объединённая) · день/неделя/месяц · owner,coo
- Источник: `coraFeedApi.list()` (события/признания/решения) — свести бывшие «Активность команды» + «Лента дня» + «Кора-фид» в одну.
- Drill-down: клик события → его источник (встреча/задача).
- Acceptance: одна лента, не три дубля; пусто → `visibleWhen=false`.

### M10 · Польза Коры (витрина, вниз) · день/неделя/месяц · owner,coo
- Источник: `dashboardApi.getDirectorView().valueStrip` (`meetingsProtocoled`,`tasksExtracted`,`decisionsExtracted`,`questionsAnsweredByMemory`,`commitmentsKept`).
- Показывает: компактная полоса 5 чисел «накоплено за период». **Внизу экрана** (переехала с первого экрана — на старте нули).
- Acceptance: рендерится последним блоком пресета owner/coo; на «Сегодня» — за месяц-накопительно.

### M-Week-PlanFact (★) · неделя/месяц · owner,coo
- Источник: `GET /api/v1/dashboard/operations/weekly-per-person` → `WeeklyPersonRowDto` (`promisesGiven/Kept/Broken/Overdue`,`reliabilityPercent`,`tasksDone/Planned`,`checkInsCompleted`). **РЕАЛИЗОВАН — только подключить.**
- Показывает: таблица «держат слово» / «зоны риска», надёжность %, выгрузка.
- Drill-down: клик строки → `/:personId/items` (drill-down по человеку, готов).
- Acceptance: две группы (сорт по `reliabilityPercent`), тон «нужна помощь» а не «двоечники»; центральный блок недельного/месячного.

### M-Month-* (стратегический слой) · месяц · owner,coo
- Достижения: закрытые крупные цели/вехи (`Goal` status=achieved за месяц).
- Зрелость: `MaturityWidget` данные (overall % + домены).
- Незаменимость (bus factor): `pulse?.busFactor` (кто держит знания один).
- Динамика по неделям: 4× `WeeklyOperationsDigest.metricsJson` план-факт.
- Тренд месяц-к-месяцу: сравнение текущего и прошлого месяца (Ф2 тренд-маппер).
- Acceptance: каждый рендерится только при наличии данных (`visibleWhen`).

### Контракт модульного слоя (Ф1)
```ts
type Rhythm = 'today' | 'week' | 'month';
type Role = 'owner' | 'coo' | 'member';
interface WidgetDescriptor {
  id: string;                                  // 'today.plan-fact'
  title: string;
  rhythm: Rhythm[];                            // на каких ритмах живёт
  roles: Role[];
  size: 'sm' | 'md' | 'lg' | 'xl';
  visibleWhen?: (data: unknown) => boolean;    // нет данных → не рисуем
  Component: React.FC<{ rhythm: Rhythm }>;
}
const WIDGET_REGISTRY: Record<string, WidgetDescriptor>;
interface DashboardPreset { role: Role; rhythm: Rhythm; layout: string[]; }  // упорядоченные widget id
// дефолтные пресеты в коде; доступ через getDynamic('dashboard.preset.<role>.<rhythm>') с code-fallback
```
`<DashboardCanvas role={role} rhythm={rhythm} />` резолвит пресет → дескрипторы → грид.

### Достройка Ф2 — источник сырого блокера (Prisma)
`DailyCheckIn.blockersJson` — `Array<{text, severity, ownerHint?}>`; расширить элемент полем `sourceBlockId?: string` (FK-by-value на `IdeaBlock.id`), заполняемым при ingest чек-ина, где блокер уже стал блоком. `fetchBlockers()` (`operations-dashboard.service.ts:493`) отдаёт `sourceBlockId` вместо `null`. Prisma — через `prisma:push` (CLAUDE.md), не `migrate`. **Без новой таблицы** (JSON-поле уже есть). Идемпотентность не требуется (рантайм-ingest).

---

## Границы фичи
- ✅ Always: переиспользовать `modern/`-компоненты и готовые эндпоинты; русский UI; парные токены `bg/text-*-fg`; `visibleWhen` вместо пустых карточек.
- ⚠️ Ask first: любая новая Prisma-модель/колонка сверх `sourceBlockId`; новый `signalType`; изменение `weekly-per-person` контракта.
- 🚫 Never: drag-n-drop в этой итерации; `process.env.*` мимо `TypedConfigService`; `prisma migrate*`; `new PrismaClient()` в скриптах; рейтинговый/обвинительный тон в копи; перенос операционных виджетов (bus factor и т.д.) с операционного на ритмы.

---

## Фазы (dependency-ordered)

Граф: **Ф1 ∥ Ф2** (независимы) → **Ф3** (Сегодня, нужен Ф1+Ф2) → **Ф4** (Неделя) → **Ф5** (Месяц). Ф4 и Ф5 строго после Ф3 (переиспользуют модули и canvas).

### [x] Ф1 — Модульный слой (frontend)
Цель: реестр виджетов + canvas + ролевые пресеты + getDynamic-крюк.
Файлы: новые `frontend/src/ui/components/dashboard/registry/` (descriptor, registry, canvas, presets); образец стиля — `modern/` и прототип `plans/analysis/2026-06-21-execution-dashboards-prototype.html`.
Что НЕ входит: сами модули с данными (Ф3+); drag-n-drop.
Acceptance: `DashboardCanvas` рендерит набор по `{role,rhythm}` из пресета; `visibleWhen=false` скрывает блок; пресет резолвится через `getDynamic` с code-fallback (греп `getDynamic('dashboard.preset`); `bun run typecheck && bun run lint && bun run build` зелёные.
Закрывает: Р1, Р3.

### [x] Ф2 — Бэкенд-достройки и контракты данных
Цель: 2 новых эндпоинта + источник сырого блокера + тренд-маппер.
Файлы: `dashboard`/`operations` модули; `schema.prisma` (поле `sourceBlockId` в элементе blockersJson — JSON, без миграции структуры); `operations-dashboard.service.ts:452-502`.
Что входит: `GET /dashboard/goal-vector/by-person`; `GET /dashboard/issue-chains`; `GET /dashboard/load/by-person` (если `getTeamCapacity` не per-person); `fetchBlockers` отдаёт `sourceBlockId`; тренд-маппер период-к-периоду (из существующих digest, без новой таблицы).
Что НЕ входит: новые модели; изменение `weekly-per-person`.
Acceptance: каждый эндпоинт — Zod-DTO + Swagger (smoke `/api/docs`); `goal-vector/by-person` возвращает строки `{personId, netScore, tasksDone, tasksOpen, direction}`; `fetchBlockers` больше не возвращает `sourceBlockId:null` для блокеров со связью; `bunx vitest run` по затронутым сервисам зелёный.
Закрывает: Р4 (источник + тренд), M2/M4/M5b/M6 данные.

### [x] Ф3 — Экран «Сегодня» (День)
Цель: модули M1–M10 на canvas, пресеты owner/coo/member, drill-down + проваливание + `?m=` в чате.
Файлы: `dashboard/` (новый рендер через `DashboardCanvas`), drawer-компоненты разворотов, `frontend/app/(authenticated)/chats/[id]` (парсинг `?m=`, скролл к сообщению).
Что НЕ входит: недельные/месячные модули.
Acceptance: пресет coo показывает M1–M10; member — только личные (M3/M6/M7 про себя, без команды); клик темы блокера открывает drawer с deepLink-переходом в `/meetings?t=`/`/chats?m=`; `/chats/[id]?m=<id>` скроллит к сообщению (греп `useSearchParams` + scroll в чат-клиенте); «по людям» открывает drawer без сетевого ре-запроса; тон копи — без рейтинга (ревью).
Закрывает: M1–M10, разворот по людям, проваливание.

### [x] Ф4 — Экран «Неделя»
Цель: модули Дня (rhythm=week) + ★ M-Week-PlanFact + M5b + тренд + «висит неделями».
Файлы: пресеты week; подключение `weekly-per-person`.
Что НЕ входит: месячный стратегический слой.
Acceptance: ★ таблица рендерит `WeeklyPersonRowDto` две группы; тренд показывает сравнение с прошлой неделей (из соседнего `WeeklyOperationsDigest`); «висит неделями» = `BlockerSynthesis.status='recurring'`.
Закрывает: Р2 (Неделя ⊃ День), M-Week-PlanFact.

### [x] Ф5 — Экран «Итоги месяца»
Цель: модули Недели (rhythm=month) + стратегический слой (достижения, зрелость, незаменимость, динамика по неделям, тренд месяц-к-месяцу).
Файлы: пресеты month; подключение Maturity/busFactor.
Acceptance: KPI месяца в ряд; ★ таблица за месяц; зрелость/незаменимость/динамика рендерятся при наличии данных, иначе `visibleWhen=false`; сайдбар «Итоги месяца» ведёт на экран.
Закрывает: Р2 (Месяц ⊃ Неделя), M-Month-*.

---

## Pre-mortem / Риски и ревью-аспекты
- **Пустой дашборд на старте** → `visibleWhen` обязателен у каждого модуля; витрина (M10) — вниз. Ревью: нет блока, рендерящего голые нули на первом экране.
- **Рейтинговый тон** (нарушение Р6) → ревью копи каждого модуля по людям: формулировки «кому помочь», не «кто хуже».
- **deepLink ведёт в никуда** → если `relatedBlockIdsJson` пуст или `buildProvenanceDeepLink` вернул `null` — кнопка перехода скрыта, не битая. Ревью: нет `href` с `null`.
- **Дубль расчёта вектора** → переиспользовать `PulsePatternsService`/`PersonGoalContribution`, не считать заново. Ревью `strict-production-review-gate`.
- **tenantId** → все новые эндпоинты под `TenantGuard`, `@@index([tenantId, …])` на запросах.
- **Перф разворота по людям** → drawer-данные приходят с основным запросом экрана (не N+1); ре-запрос только при отсутствии. Триггер оптимизации: при >50 человек в Org — пагинация (числовой порог, не сейчас).

## Idempotency / feature-flag / prod-deploy
- Новых seed/patch/backfill/migrate **нет**; `sourceBlockId` — рантайм-ingest, не скрипт.
- **Флаг — нет** (Ship-On): дашборды выкатываются включёнными, замена существующих экранов; аварийный рубильник не требуется (UI-фича без необратимых действий/денег). Строка в `docs/operations/feature-flags.md` не нужна (флага нет).
- prod-deploy: только `schema.prisma` затронут (JSON-поле `sourceBlockId`) → `prod-deploy-log.md` Шаг 4 (без опасных изменений — JSON-расширение); новые эндпоинты → Шаг 12 (Swagger smoke). ENV/очередей/cron не добавляется.

## DoD
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные (backend и frontend).
- `bunx vitest run` по затронутым сервисам/мапперам зелёный; добавлены unit на `goal-vector/by-person` (3 человека → корректные direction) и тренд-маппер (есть/нет соседнего периода).
- second-brain обновлён по таблице производных: `01_projects/` дашборды, `02_architecture/module-map.md` (новый registry-слой), `01_projects/api-layer.md` (новые эндпоинты).
- `prod-deploy-log.md` Шаг 4/12 обновлён.
- Прототип-эталон вёрстки и поведения сверен: `plans/analysis/2026-06-21-execution-dashboards-prototype.html`.
- Рефлексия в `second-brain/05_история/`.

## Итог
Реализовано **целиком, все 5 фаз** (ветка `dev`, 4 коммита):
- **Ф1** — модульный слой: `WidgetDescriptor` + `WIDGET_REGISTRY` + `DashboardCanvas` + `DEFAULT_PRESETS` (3 роли × 3 ритма) + `useDashboardLayout` + getDynamic-крюк `dashboard.preset.<role>.<rhythm>` → коммит `9ee6d531`.
- **Ф2** — бэкенд: `GET /dashboard/layout` · `goal-vector/by-person` · `issue-chains` · `load/by-person` · `operations/trend`; `fetchBlockers` отдаёт `sourceBlockId`; чистые `directionFromNet`/`buildGoalVectorRows`/`computeDeltas` + unit → коммит `4e5d3748`.
- **Ф3** — экран «Сегодня» (M1–M10) на `DashboardCanvas` + разворот по людям (без ре-запроса) + проваливание (`ProvenanceDrawer`, `?t=` встречи, `?m=` чата — переиспользованы, уже работали); `relatedBlockIds` у хронических блокеров → коммит `1b9ed454`.
- **Ф4+Ф5** — «Неделя» (тренд неделя-к-неделе + ★ таблица план-факт по людям) и «Итоги месяца» (достижения/зрелость/незаменимость/динамика по неделям + тренд месяц-к-месяцу; ValueRecap сохранён виджетом `month-recap`) → коммит `f244ada6`.

**Верификация:** backend+frontend `typecheck`/`lint`/`build` зелёные; `vitest` (execution-dashboard) 11 тестов зелёные; реестр когерентен (18 виджетов, все id пресетов покрыты). Живая визуальная приёмка (Playwright) НЕ выполнялась — нужен поднятый стек с засеянными данными; приёмка кода+сборки выполнена.

**Решения оркестратора (приняты по ходу, не отложены):**
- Пресеты — Option B: дефолты в коде фронта (рядом с реестром, нет дрейфа id), getDynamic-крюк на бэке отдаёт override-или-`null`; vNext admin-override = только ключ `AdminSetting`, без правки кода.
- `?m=`/`?t=`/`?page=` провaливание уже было реализовано ранее (provenance-коммиты) — переиспользовано, не дублировано.
- `sourceBlockId` — только read-side: точки population при ingest нет (блокер чек-ина не становится дискретным `IdeaBlock`), ТЗ это допускает. Схема НЕ менялась (JSON-поле) → миграции нет.
- Пороги загрузки (`dashboard.load.overload_threshold`/`idle_threshold`) — getDynamic с code-fallback (не хардкод), без UI-регистрации (прецедент rework-флагов).

**Осознанные границы (vNext, не баги):**
- Персональные «про себя» модули рядового (M3/M6 для `member`) — требуют связки User→Person + личных эндпоинтов; сейчас рядовой видит только коллаборативное (`ideas`, `value`), личный кабинет = существующий `/me`. Командные per-person данные рядовому НЕ показываются (инвариант Р6).
- Выбор периода (date-picker недели/месяца) на ритм-экранах — виджеты берут текущий/прошлый период; picker = vNext (на `/dashboard/operations/weekly` старый picker остался).
- Drag-n-drop и admin-редактирование раскладки — вне scope (Р1/Р3).
- Достижения месяца фильтруются по `Goal.updatedAt` (нет `achievedAt`) — приближение «стала achieved в этом месяце».
