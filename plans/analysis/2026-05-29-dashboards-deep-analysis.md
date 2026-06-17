---
date: 2026-05-29
status: ready for review
owner: Сергей
type: analysis
related:
  - plans/archive/2026-05-10-phase-8-director-dashboard.md
  - plans/archive/2026-05-24-sba-beta-8-1-coo-dobivka.md
  - plans/archive/2026-05-27-sprints.md
  - second-brain/01_projects/admin.md
  - second-brain/02_architecture/module-map.md
---

# Глубокий аудит дашбордов Z/Кора — 2026-05-29

## 0. Зачем эта аналитика

Сейчас в продукте **три дашборда**, и они дают мутную картину:

| URL | Внутреннее имя | Аудитория | Состояние |
|---|---|---|---|
| `/dashboard` | DirectorDashboardClient (Главная — «Привет, Сергей») | owner / admin / super_admin | **сломан + бутафория**: на скриншоте красная плашка `EntitlementGuard требует TenantGuard выше`, sparkline'ы карточек захардкожены фиктивными числами, виджеты в основном пустые |
| `/dashboard/operations` | OperationsDashboardClient (Операции — пульс компании) | coo / admin / owner | визуально опрятный, но мелкий и без drill-down: «0 блокеров, 0 целей, 0 конфликтов» = безжизненный экран, не понятно «и что мне с этим делать» |
| `/dashboard/operations/weekly` | WeeklyDigestClient (Недельная сводка) | coo / admin / owner | пустой stub: «Дайджест ещё не сгенерирован». Никакого preview, навигация по неделям мёртвая |

Пользователь ([Сергей, founder]) даёт ключевой запрос:

> «У нас нет финансовых метрик (выручки, расходов). Какие дашборды и отчёты тогда вообще полезны операционному директору? Как это делают другие? Сделай разносторонний анализ: сделай отдельные предложения для общего пульса, для спринта, для сотрудника. На сотруднике хочу видеть нотки депрессии, признаки скорого увольнения.»

Документ отвечает на 4 вопроса:

1. **Что у нас сейчас и почему оно слабое** (часть 1).
2. **Что делает реальный COO современной IT-компании без финансов** (часть 2, по результатам веб-исследования).
3. **Что у нас уже есть в данных, чтобы это построить** (часть 3, gap-карта).
4. **Что предложить** — три уровня дашбордов: **«пульс компании»**, **«пульс спринта»**, **«пульс сотрудника»** + roadmap (часть 4).

---

## Часть 1. Текущее состояние — реверс-инжиниринг 3 дашбордов

Это раздел «как сейчас работает». Без оценок — только факты.

### 1.1. Главная — `DirectorDashboardClient` (frontend) + `DirectorDashboardService` (backend)

**Маршрут.** `GET /dashboard` → server-обёртка `DashboardPage` → `DashboardRouter` → `DirectorDashboardClient`.

**API.** Один запрос: `GET /api/v1/dashboard/director?period=week|month`. Контроллер: [backend/src/modules/dashboard/director-dashboard.controller.ts](backend/src/modules/dashboard/director-dashboard.controller.ts).

**Guard'ы.** Декларативно: `@UseGuards(CookieAuthGuard, TenantGuard)` + `@RequireEntitlement('feature.dashboard_director')` + дополнительная проверка `RbacService.canViewDirectorDashboard(userId, tenantId)`. Доступ — только owner / admin / super_admin.

**Что вычисляет [director-dashboard.service.ts:82](backend/src/modules/dashboard/services/director-dashboard.service.ts#L82)** — 7 параллельных запросов через `Promise.all`:

| Виджет | Формула / источник | Период |
|---|---|---|
| Новые темы | `Theme WHERE status='active' AND createdAt ≥ since`, top-10 by `weight DESC, lastSignalAt DESC` | week=7 дн, month=30 дн |
| Новые сигналы | `IdeaBlock WHERE status='canonical' AND signalType IN (pain, churn_risk, risk, feature_request, decision, commitment, competitor_move, metric_change)` top-10 by `confidence DESC, dynamicScore DESC` | week/month |
| Signal counters | `groupBy(signalType)` на `IdeaBlock` за period → bucket'ы: pain, feature_request, churn_risk, objection, risk, decision, commitment, other | week/month |
| Активные темы | `Theme WHERE dynamic='growing'`, top-10 по weight | весь архив |
| Главные сущности (Hot entities) | Raw SQL: топ-10 `Entity` по `COUNT(DISTINCT IdeaBlock.id)` в period | week/month |
| Открытые вопросы | `IdeaBlock WHERE signalType='knowledge_gap'`, top-10 по `createdAt DESC` | весь архив |
| Strategic Alignment | Weighted avg по `Goal.cachedAlignment * Goal.weight` (активные не-archived); `alertGoals` где `delta ≤ -15 AND score ≤ 60` | snapshot, обновляет cron 24h |
| Narrative summary | LLM (taskType `dashboard-summary`) поверх всех вышеперечисленных агрегатов, кэш 24h | week/month |

**Виджеты в UI** ([DirectorDashboardClient.tsx](frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx)):
- **5 StatCards (KPI strip)**: «Новые темы», «Новые сигналы», «Сигналы клиентов» (сумма bucket'ов), «Активные темы», «Открытые вопросы».
- **IntroWizardWidget** — onboarding hint.
- **AI-сводка** (если есть `narrativeSummary`).
- 8 «больших» карточек: StructureSummary, WhatLearned (новые темы + сигналы), SignalCounters, ActiveThemes, HotEntities, OpenQuestions, StrategicAlignment, QualityScore, CurationPending, InsightsTop.
- **OrgChatPanel** внизу: чат «спросите про вашу компанию» с историей встреч.

**Кэш.** In-memory `AdminCacheService`, TTL 60 секунд для виджетов, 24 часа для narrative. Cron в 06:00 UTC сбрасывает narrative-кэш.

### 1.2. Операции — `OperationsDashboardClient` + `OperationsDashboardService`

**Маршрут.** `/dashboard/operations`.

**API.** Один запрос: `GET /api/v1/dashboard/operations/overview` + параллельно SWR `GET /api/v1/operations/daily-digest/latest` + `GET /api/v1/operations/commitments/open?days=14`.

**Что вычисляет [operations-dashboard.service.ts:92](backend/src/modules/operations/services/operations-dashboard.service.ts#L92)** — также `Promise.all` из 7 источников:

| Виджет | Формула / источник | Период |
|---|---|---|
| Блокеры | `DailyCheckIn.blockersJson` за 7 дней, плоский массив `{text, severity ∈ {low\|medium\|high}, ownerHint}` | 7 дн |
| Missed goals | `COUNT(Goal WHERE status='abandoned' AND archivedAt IS NULL)` + отдельно `COUNT(Goal WHERE cascadeMissed=true)` | весь архив |
| Team frictions | `EntityLink WHERE relationType='conflicted_with' AND status='active'` + JOIN Person.name через Entity | весь архив |
| Capacity | Сумма `Appointment.loadPercent` по personId; `overloadedCount = COUNT(loadPercent > 100)` | snapshot |
| Team temperature | `DailyCheckIn` за окно 7д с sentiment ∈ {green,yellow,red} → share по каждому + `redShareDelta` к прошлой неделе | 7 дн + сравнение |
| Insights by cause category | `Insight.groupBy(causeCategory)` за 7д, severity ≥ medium, 8 фиксированных bucket: `process_gap, tooling, role_skill, communication, priority, resource_constraint, external, unknown` | 7 дн |
| Maturity snapshot | `CompanyProfile.maturityScore` (рассчитывается `MaturityScorerCron` каждое утро 05:00 UTC) + top-3 / bottom-3 `FunctionalDomain` по completeness | snapshot, 24h |
| Yesterday digest | Отдельный SWR на latest `DailyDigest` (генерируется cron'ом каждое утро) | вчерашний день |

**Виджеты в UI** — на скриншоте видно:
- **YesterdayDigestCard** — короткая выжимка вчерашнего отчёта + ссылка «полный отчёт».
- **MaturityWidget** — зрелость компании.
- **4 цветные карточки**: блокеры (red если high>0), missed goals (red если >0), team frictions (amber), capacity (avg %).
- **TeamTemperatureWidget** — stacked bar 7 дней с подписью «зелёных X%, жёлтых Y%, красных Z%».
- **CauseCategoryMapWidget** — bar-chart 8 категорий причин.
- **OpenCommitmentsWidget** — сгруппированные по автору обещания за 14 дней.
- Списки «свежие блокеры» и «свежие конфликты».

**Кэш.** Redis 5 минут по ключу `ops_dashboard:<tenantId>:overview`. Метрики в Prometheus: `operations_blockers_total{severity}`, `team_frictions_total`, `coo_team_temperature_red_share`, `coo_insights_by_cause{cause}`, `coo_company_maturity_score`.

### 1.3. Недельная сводка — `WeeklyDigestClient` + `WeeklyDigestService`

**Маршрут.** `/dashboard/operations/weekly?weekStart=YYYY-MM-DD`.

**API.** `GET /api/v1/dashboard/operations/weekly?weekStart=...`.

**Что вычисляет [weekly-digest.service.ts:198](backend/src/modules/operations/services/weekly-digest.service.ts#L198)** — 7 параллельных запросов в `aggregate()`:

| Поле дайджеста | Формула / источник |
|---|---|
| totalCheckIns + green/yellow/red share | `DailyCheckIn` за `[weekStart, weekEnd]` с sentiment ∈ {green,yellow,red} |
| topBlockers | Группировка `DailyCheckIn.blockersJson[*].text` по `lowercase().slice(0,40)`, top-5 по count |
| topInsights | `Insight` за неделю, status='active', top-3 по `dynamicScore DESC` |
| goals | `Goal.updatedAt` в окне неделю → counts по achieved / abandoned / active + delta к предыдущей неделе |
| hangingDecisions | `Decision WHERE decidedAt < weekStart - 7d AND actualOutcomes IS NULL`, top-5 по age ASC |
| bodyMarkdown | LLM-вызов `operations-weekly-digest` (DeepSeek Pro), 4000 max tokens. На fallback — статический markdown из шаблона |

**Идемпотентность.** `@@unique([tenantId, weekStart])` — один дайджест на неделю. Cron: `operations-weekly-digest` каждый понедельник 08:00 локального времени Org. Метрики: `coo_weekly_digest_generated_total{tenantTop}`, `coo_weekly_digest_failed_total{reason}`.

**Виджеты UI** — на скриншоте «дайджест ещё не сгенерирован», то есть для текущей недели cron не успел отработать. После генерации показывает 5 секций (температура, цели, повторяющиеся блокеры, главные сигналы, висящие решения) + bodyMarkdown LLM-комментария + дату создания и модель.

### 1.4. Ежедневный отчёт — `DailyDigestService`

(Используется обоими: вчерашняя карточка на «Операциях», страница `/dashboard/operations/daily?date=...`.)

Не входит в скриншоты пользователя, но архитектурно живёт рядом. Cron `operations-daily-digest` каждое утро в локальной TZ Org. Идемпотентность по `(tenantId, dateLocal)`. Структура — аналогична weekly, но за вчерашний день.

---

## Часть 2. Найденные проблемы и баги — то что нужно «зафиксировать»

### 2.1. 🔴 Bug A: «EntitlementGuard требует TenantGuard выше» (Главная)

**Симптом.** На странице `/dashboard` сверху висит красная плашка с этим текстом, остальные виджеты загружаются нулями.

**Корень.** В [DirectorDashboardController](backend/src/modules/dashboard/director-dashboard.controller.ts#L34) объявлено:
```ts
@Controller('api/v1/dashboard')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.dashboard_director')
```

`EntitlementGuard` зарегистрирован глобально через `APP_GUARD` в `AppModule`. **Глобальные guard'ы в NestJS запускаются ДО controller-level guard'ов**. Поэтому `EntitlementGuard` читает `req.tenantId`, когда `TenantGuard` ещё не отработал, и кидает `tenant_required` (см. [entitlement.guard.ts:58-67](backend/src/modules/entitlements/entitlement.guard.ts#L58)).

**Решения (выбрать одно):**
- **A. TenantGuard в middleware** — самый чистый. `TenantGuard` сейчас по факту делает только парсинг `X-Org-Id` и проставление `req.tenantId`. Это работа middleware, не guard'а. Переписать в `TenantMiddleware` и подключить глобально через `consumer.apply(TenantMiddleware).forRoutes('*')` в `AppModule`.
- **B. EntitlementGuard как controller guard** — снять глобальную регистрацию, везде явно подключать `@UseGuards(EntitlementGuard)` после `TenantGuard`. Минус: лёгко забыть на новых контроллерах.
- **C. Hybrid — APP_GUARD с правильным порядком**. В Nest все APP_GUARD выполняются по порядку регистрации. Добавить `TenantGuard` тоже через APP_GUARD ПЕРЕД EntitlementGuard. Минус: TenantGuard сейчас рассчитан на наличие `@CurrentOrg()` декоратора и не во всех маршрутах нужен.

Рекомендация: **вариант A** (middleware). См. подзадачу в roadmap §4.5.

### 2.2. 🟡 Bug B: Фейковые sparkline-данные на Главной

**Симптом.** «Белое на белом, ничего не видно» — это скриншоты StatCard в KPI strip: после числа есть еле различимый микрографик-«линия», который выглядит как декорация без смысла.

**Корень.** В [DirectorDashboardClient.tsx:155-182](frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L155):
```tsx
<StatCard label="Новые темы" value={data?.newThemes.length ?? 0}
  sparkline={[2, 3, 4, 5, 4, 6, 8]}  // ← ЗАХАРДКОЖЕНО
  sparklineVariant="line" />
<StatCard label="Новые сигналы" value={...}
  sparkline={[3, 2, 5, 4, 6, 5, 7]}  // ← ЗАХАРДКОЖЕНО
  sparklineVariant="bar" />
// ...и так далее для всех 5 карточек
```

То есть **спарклайны — декорация без данных**. Это плохо по двум причинам:
1. **Ложь**: пользователь верит, что видит реальный тренд за 7 дней, на самом деле — обои.
2. **Низкая видимость**: дизайн рассчитан на оба варианта темы; цвет `var(--accent)` на dark surface даёт edge-блёклый mint, который сливается. На скриншоте не видно ни линии, ни столбцов.

**Решение.** На backend добавить в `DirectorDashboardDto` поле `kpiTrends: { newThemes: number[], newSignals: number[], signalCounters: number[], activeThemes: number[], openQuestions: number[] }` — по 7 точек, каждая = count за день за последние 7 суток. Frontend подставляет в `sparkline`. Карточка должна иметь явный delta-индикатор (`+15% к прошлой неделе`), а не только сам sparkline.

### 2.3. 🟡 Issue C: «70-е годы» — визуальная асимметрия между Главной и Операциями

Это не bug, а subjective design issue, но он реален:

- **Операции** (β-8) — карточки в `bg-chip-{color}-bg`, единый rounded-border, опрятная сетка `md:grid-cols-2 lg:grid-cols-4`.
- **Главная** (Phase 8 knowledge-core) — нагромождение виджетов разных эпох: StatCard (новый), Card+CardHeader (shadcn), линии-разделители без border-token, эмодзи 📈, badge'и без выровненной высоты.

Корень — оба дашборда писались разными авторами в разное время, без единого UI Kit. **Это надо чинить отдельным дизайн-проходом** (см. roadmap §4.5).

### 2.4. 🟠 Issue D: Пустые состояния хоронят ценность

Когда у tenant'а 0 встреч / 0 чек-инов — все 3 дашборда показывают «0 / 0 / 0 / 0%» и empty-strings типа «Сигналов высокой важности за период не зафиксировано». Это убивает first-impression. Реальный COO в первый день не видит **что инструмент вообще делает**.

**Решение** — паттерн «sample story»: когда данных нет, показать **синтетический пример** с ярлыком «вот так это будет выглядеть, когда команда начнёт отвечать на чек-ины» + одной кнопкой «настроить чек-ины». Делается на стороне frontend (mockData + watermark «образец»).

### 2.5. 🟠 Issue E: Нет drill-down

Каждая карточка — это терминальное число. Нельзя кликнуть «5 блокеров» → увидеть кто и какие. Нельзя кликнуть «красных 30%» → увидеть кто конкретно в красном. Это превращает дашборд в **смотровое окно**, а не в инструмент.

В Операциях `byPerson` в DTO для team temperature есть, но **в UI не используется**! Это упущенный win.

---

## Часть 3. Карта наших сущностей → метрики

Чтобы предлагать новые виджеты, нужно сначала понять, что **уже есть в данных**. Большинство нужных вещей у нас уже моделируется (что приятно — не надо городить новые таблицы).

### 3.1. Что у нас есть в БД

| Сущность | Ключевые поля | Что из неё можно вычислить |
|---|---|---|
| `DailyCheckIn` | `plansJson`, `donesJson`, `blockersJson`, `sentiment` (green/yellow/red), `sentimentRationale`, `parseConfidence`, `kind` (morning/evening), `dateLocal` | sentiment trend per person; коэффициент выполнения (count(dones)/count(plans)); blocker recurrence; **пропуски чек-инов** (no row for date) |
| `Goal` | `weight`, `horizon` (strategic→annual→quarterly→sprint), `parentGoalId`, `cascadeMissed`, `cachedAlignment` 0-100, `cachedAlignmentDelta` | каскад провалов, weighted alignment, движение к цели за период |
| `GoalAlignmentSnapshot` | `score`, `delta`, `explanation`, `signals` (pro/contra), `windowDays`, `themesCount` | timeline движения цели — НЕ ИСПОЛЬЗУЕТСЯ в UI пока |
| `IdeaBlock` | `signalType` (pain, risk, churn_risk, knowledge_gap, decision, commitment, …), `confidence`, `dynamicScore`, `criticalQuestion`, `trustedAnswer` | классификация сигналов, hot topics |
| `Theme` | `weight`, `dynamic` (stable/growing/declining/dormant), `branch`, `lastSignalAt` | какие темы растут / спят |
| `Entity` + `EntityLink` | `relationType` (conflicted_with, blocked_by, partnered_with, …), `confidence`, `validFrom` | граф отношений людей и объектов |
| `Insight` | `causeCategory` (process_gap, tooling, role_skill, communication, priority, resource_constraint, external), `severity`, `dynamicScore`, `firstObservedAt`, `lastObservedAt` | повторяющиеся системные проблемы |
| `Decision` | `status`, `decidedAt`, `actualOutcomes` | висящие решения |
| `Commitment` | `dueDate`, `askedAt`, `escalatedAt`, status | обещания и их «давность молчания» |
| `Appointment` | `loadPercent`, `validTo` | загрузка людей |
| `Project` + `Cycle` + `Issue` | tracker-таблицы; `Project.cycleViewEnabled`, scope-связки на Card/Vendor/Person/Department | спринты как Project+Cycle, задачи, владельцы |
| `SprintHint` | (нужно дочитать) | подсказка-кандидат для AI «вытащить идею в спринт» |
| `CompanyProfile` | `maturityScore`, `stage`, per-domain completeness | maturity dashboard |
| `PersonalRelation` | (модель в `operations` — связи между людьми из встреч) | конфликты, союзы, кто с кем работает |

### 3.2. Чего у нас НЕТ в данных (нужно завести, чтобы дашборды стали глубже)

| Чего нет | Зачем | Что добавить |
|---|---|---|
| **Гипотеза спринта** как структурированное поле | Без неё «спринт-дашборд» бессмысленен | Поле `Project.sprintHypothesis: { ifWeDo: text, weExpect: text, measuredBy: text }` или отдельная модель `SprintHypothesis` 1:1 на Project |
| **Sprint outcome** | Чтобы в ретроспективе зафиксировать «подтвердилась / опровергнута / inconclusive» | `Project.sprintOutcome: enum + summary` (заполняется на «Итогах спринта», тип встречи уже есть — `sprint_review`) |
| **eNPS / Engagement score** | Leading indicator outflow за 60-90 дней (см. часть 4) | Лёгкий weekly pulse-вопрос «по шкале 0-10 порекомендовал бы Z как место работы?» — отдельный тип `DailyCheckIn.kind='enps'` раз в неделю |
| **1-on-1 history** | Чтобы на странице сотрудника видеть «когда последний 1:1, что обсуждали» | Модель `OneOnOne { managerId, employeeId, scheduledAt, completedAt, topics: json }` |
| **Per-person turnover score** | Сводная оценка риска ухода | Не отдельное поле — это **вычисляемая метрика** из всех сигналов (см. §4.3) |

---

## Часть 4. Предложения по новым дашбордам

> **Контекст исследования.** Параллельно с этим документом запущены 3 веб-исследования (см. §5):
> 1. COO operational dashboards без финансов (HBR, MIT Sloan, Reforge, Atlassian Work Life).
> 2. Product teardown: 15Five, Lattice, Culture Amp, Officevibe, Range, Leapsome, Peakon + RU/СНГ (Happy Job, Yva.ai, TalentTech).
> 3. Sprint & hypothesis dashboards + early signals выгорания/увольнения.
>
> Этот раздел пишется опираясь на наши данные и общеизвестные best practices; **после возврата агентов раздел уточняется** конкретными референсами, скриншотами решений и цитатами.

Предлагаем три уровня дашбордов с разной аудиторией и частотой обновления.

### 4.1. Уровень 1 — «Пульс компании» (заменяет текущую «Главную»)

**Аудитория**: CEO / COO / Founder. **Частота**: ежедневно на 30 секунд + еженедельно на 15 минут.

**4 «маяка» (KPI heroes) — операционное здоровье за 30 секунд.** Подобрано из топ-5 рекомендованных метрик (§5.1.1), с порогами из индустриальных бенчмарков:

| Маяк | Формула | Зелёный / Жёлтый / Красный | Источник идеи |
|---|---|---|---|
| **eNPS команды** | `(% зелёных чек-инов − % красных)` за 7д, нормировано к шкале −100..+100 | ≥30 / 0..30 / <0 (бенчмарк AIHR 2026) | Peakon, SurveyMonkey, AIHR |
| **Commitment Reliability** | `Kept / (Kept + Broken + Overdue)` за 14 дней | ≥80% / 60-80% / <60% | §5.1.1 (новая для нас) |
| **Goal Confidence** | weighted avg `Goal.cachedAlignment * Goal.weight` (есть) **+ self-assessment confidence 1-10** (новое поле) | ≥70 / 50-70 / <50 | Mooncamp, Lattice, Teamflect |
| **Hanging Decisions** | `COUNT(Decision: decidedAt < now-7d AND actualOutcomes IS NULL AND raised ≥2 раз)` | 0-2 / 3-5 / >5 | DORA 2025, §5.1.1 |

**Каждый маяк кликабелен** — открывает drill-down: список конкретных людей / решений / обещаний с цитатами из встреч.

**Каждый маяк имеет настоящий sparkline 12 недель** + delta к прошлой неделе + аннотации событий («24.03 — запустили утренние стандапы»). НЕ захардкоженный массив (Bug B).

**Главный экран — три зоны (по §5.1.2 паттерну Hero + Trend + Drilldown):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ ЗОНА 1 — «Сейчас» (above the fold, 1 экран)                          │
│                                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │  eNPS    │ │ Commits  │ │  Goals   │ │ Hanging  │                │
│  │   +34    │ │   78%    │ │   62/100 │ │    7 ⏳  │                │
│  │ healthy  │ │ ▔▁▂▃▅▆▇ │ │ ▇▆▅▄▃▂▁ │ │ ↑ +3    │                │
│  │ ↑ +5     │ │ ↑ +4пп  │ │ ↓ -8     │ │ за нед. │                │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                │
│                                                                       │
│  ▸ AI-резюме за сегодня (3 строки + ссылки на источники)            │
│   «Падение Goal Confidence в команде Маркетинг (-12) связано с      │
│   нерешённым vendor-вопросом, поднимался 3× за 2 недели на          │
│   встречах [Mtg-413] [Mtg-421] [Mtg-431]»                            │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│ ЗОНА 2 — Health Monitor Grid (Atlassian/Spotify pattern §5.1.2)     │
│                                                                       │
│  Команды × Атрибуты — цвет + стрелка тренда                          │
│              │Promise │Decision│Sentiment│Conflict│Goal-flow│        │
│  Маркетинг   │ 🟢 ↑   │ 🟡 →   │ 🟢 ↑    │ 🟢 →   │ 🔴 ↓   │        │
│  Sales       │ 🟡 ↓   │ 🟢 ↑   │ 🟡 →    │ 🔴 ↓   │ 🟢 →   │        │
│  Dev         │ 🟢 →   │ 🟡 ↑   │ 🟢 ↑    │ 🟢 →   │ 🟡 →   │        │
│                                                                       │
│  Атрибуты считаются из НАШИХ данных:                                  │
│   - Promise:    Commitment reliability команды                       │
│   - Decision:   median time-to-decision команды                      │
│   - Sentiment:  eNPS команды (мин 5 чел; иначе «—»)                  │
│   - Conflict:   EntityLink.relationType='conflicted_with' активных   │
│   - Goal-flow:  hill-chart позиция и движение целей команды          │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│ ЗОНА 3 — «Hill chart целей» + «Карта причин» (паттерн §5.1.2)       │
│                                                                       │
│  ┌─ Цели на холме ────────────────────────────────────────────────┐ │
│  │            ___ "проблема ясна"___                              │ │
│  │       Goal-B●                  ●Goal-A                          │ │
│  │      ⬆                              ⬇                           │ │
│  │  Goal-D●  uphill               downhill ●Goal-C                  │ │
│  │  (неясно)                              (исполнение)              │ │
│  │  «Goal-B не двинулся 3 нед — застряли на стороне uphill»         │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─ Карта причин (текущая, оставляем) ─────────────────────────────┐ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────┐
│ ЗОНА 4 — «Что висит / что новое» (action items)                      │
│  • Hanging decisions (>7 дней без outcomes, top-5)                    │
│  • Broken commitments (top-5 по людям)                               │
│  • Insights radar (повторяющиеся причины проблем)                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Что меняется по сравнению с текущей Главной:**
- ❌ Убрать 5 vanity-карточек «новые темы/сигналы/...» → 4 KPI hero с порогами и реальными sparkline.
- ❌ Убрать захардкоженные `sparkline={[2, 3, 4, 5, 4, 6, 8]}` → backend отдаёт реальные 12-недельные ряды.
- ❌ Убрать дублирование с Операциями (Структура компании, QualityScore, CurationPending → вынести на отдельные роуты).
- ✅ Добавить Health Monitor Grid (команды × атрибуты) — замена унылой одной полоски температуры.
- ✅ Добавить Hill Chart для Goal — единственная визуализация, которая ловит «застрял, но не жалуется».
- ✅ AI-резюме **только с источниками** (каждое утверждение ссылается на Meeting / IdeaBlock).
- ✅ Каждый KPI → drill-down страница со списком людей/решений/обещаний/целей.

### 4.2. Уровень 2 — «Пульс спринта»

**Контекст.** Спринты в Z — это `Project` с включенным `cycleViewEnabled`. Сейчас нет полей под гипотезу. После доработки модели предлагаем такой дашборд **отдельной страницей** `/projects/[slug]/sprint-pulse`:

**Структура:**
1. **Сверху — карточка «Гипотеза спринта»** (in/out/measured-by + кто owner). Подсвечивается красным, если за 50% спринта нет ни одного evidence-блока, который её подкрепляет.
2. **Burndown + Outcome velocity** (две линии — задачи и outcomes; outcome ≠ задача).
3. **Daily stand-up аггрегация** — что говорят чек-ины членов команды спринта: блокеры за сегодня, что готово, sentiment команды.
4. **Risk panel** — что чувствуют члены спринта (отдельный sentiment-срез, ТОЛЬКО для людей в `ProjectMember`).
5. **Внешние сигналы** — IdeaBlock, упоминающие цели спринта или сущности, на которые он направлен (через Project.subjectPerson / customerCard / vendor / department).
6. **Финальный экран на «Итогах спринта»** (тип встречи `sprint_review` уже есть) — экспортируется как ретроспектива: гипотеза подтвердилась / нет, что узнали, что забираем дальше.

**AI-фичи спринт-дашборда:**
- **«Auto-стандап»**: LLM собирает за каждое утро 3 буллета по каждому участнику из его чек-ина (план/факт/блокер) и кладёт их в формат one-page.
- **«Detect drift»**: если % красных sentiment-ов у участников ≥ 30% или blockers per person/day ≥ 1.0 — поднимаем флаг «спринт под угрозой».
- **«Hypothesis check»**: за 24 часа до окончания спринта LLM ищет в IdeaBlock доказательства за / против гипотезы и черновик ретроспективы.

### 4.3. Уровень 3 — «Пульс сотрудника» (две страницы)

> ⚠️ **Этот раздел был пересмотрен после исследования §5.3.6.** Изначальный набросок (одна страница `/persons/[id]/pulse` с ранними сигналами для руководителя) **не соответствует EU AI Act / GDPR / best practice**. Используем модель **«care, not surveillance»**: две разные страницы с разными правами.

#### 4.3.1. Страница 1 — `/me/pulse` (личный кабинет сотрудника)

**Главный принцип**: эта страница существует **прежде всего для самого сотрудника**, не для руководителя. Она про **заботу**, а не про надзор. Видит её сам человек; руководитель — нет.

**Structure** (см. §5.3.7):

```
┌─ Шапка ──────────────────────────────────────────────────────────────┐
│ Аня Иванова · Дизайнер · в команде с 2025-03-15                       │
│ 💡 Это видишь только ты. Руководитель видит только агрегат команды.   │
└────────────────────────────────────────────────────────────────────────┘

┌─ Mood trend (личный) ────────────────────────────────────────────────┐
│ 🟢🟢🟢🟡🟡🟢🟡🟡🟡🔴🟡🔴🔴🔴   30 дней                                │
│ baseline за 90 дней: 78% зелёных / 17% жёлтых / 5% красных            │
│ сейчас:                42% / 35% / 23%   ⚠ ниже личного baseline      │
└────────────────────────────────────────────────────────────────────────┘

┌─ Energy budget / нагрузка ───────────────────────────────────────────┐
│ Сравнение с собой месяц назад:                                        │
│ Встречи: 14ч/нед (было 9ч)  •  Focus time: 6ч/нед (было 12ч)          │
│ After-hours: 4ч/нед (было 1ч)                                         │
│ ⚠ Время на встречах +56% за месяц                                     │
└────────────────────────────────────────────────────────────────────────┘

┌─ Обещания ───────────────────────────────────────────────────────────┐
│ Активные: 7  •  Закрыто вовремя: 11/14 (78%) за 30 дней               │
│ Тренд закрытия: ▇▆▅▅▄▃ ↓                                              │
│ AI: «Нагрузка обещаниями выросла на +35% за 2 недели, два хронически │
│ переезжают [Cmt-12] [Cmt-19] — обсудить с PM Игорем?»                 │
└────────────────────────────────────────────────────────────────────────┘

┌─ Карточка-приглашение (появляется при ≥2 red signals) ───────────────┐
│  Похоже, нагрузка большая. Хочешь поговорить?                          │
│  [ Запланировать 1:1 ]  [ Связаться с EAP анонимно ]                   │
│  [ Скрыть на 2 недели ]                                                │
└────────────────────────────────────────────────────────────────────────┘

┌─ Что про меня знает система (прозрачность) ──────────────────────────┐
│ ✅ Анализируем: твои чек-ины, agenda встреч (не транскрипт), время    │
│    ответов в каналах команды.                                          │
│ ❌ НЕ анализируем: личные сообщения, видео-эмоции, голосовой тон,     │
│    политические/религиозные взгляды, ориентацию, медицинские данные.   │
│ [ Выключить аналитику ]  [ Удалить данные за период ]                  │
└────────────────────────────────────────────────────────────────────────┘

┌─ AI-коуч (опц.) ─────────────────────────────────────────────────────┐
│ • Попробуй на этой неделе: запланировать 90 минут фокус-времени в пн  │
│ • Список твоих 1:1 за 6 недель — отметить, какие были важными         │
│ • Тема «выгорание» прозвучала в твоих чек-инах 5 раз — обсудить с    │
│   Игорем? [Mtg-413] [Mtg-431]                                          │
└────────────────────────────────────────────────────────────────────────┘
```

**Эскалационный guardrail (обязательно)**: если NLP-классификатор в чек-ине находит маркеры самоповреждения / суицидальной идеации — **немедленно** показать ссылку на горячую линию (РФ: 8-800-2000-122 — Телефон доверия для детей; для взрослых — выбрать локальный аналог) + опц. (с согласия) уведомить HR/EAP. Это прямое требование AI-chatbot guardrails (см. §5.3.6 п.6).

#### 4.3.2. Страница 2 — `/teams/[id]/health` (для руководителя)

**Главный принцип**: руководитель видит **только агрегаты команды**, без имён, **минимум 5 человек** для любого среза. Никаких индивидуальных flight-risk score, никаких «топ-3 кандидата на увольнение». Никаких индивидуальных цитат из чек-инов.

**Structure** (см. §5.3.7):

```
┌─ Заголовок ──────────────────────────────────────────────────────────┐
│ Команда «Маркетинг» · 7 человек · доступ: тимлид Маркетинга, COO      │
└────────────────────────────────────────────────────────────────────────┘

┌─ eNPS команды (агрегат) ─────────────────────────────────────────────┐
│ Текущий: +18 (acceptable)  бенчмарк отрасли: +35..+50                  │
│ Тренд 90д: ▆▅▅▄▃▂▂▁  ↓                                                │
│ Распределение: 🟢 3 человека · 🟡 3 человека · 🔴 1 человек            │
└────────────────────────────────────────────────────────────────────────┘

┌─ Five Gallup factors (агрегат) ──────────────────────────────────────┐
│ Самые слабые драйверы по команде (low / high из 5):                   │
│ ⚠ Manager support: ↓ 35%   (нужно обсудить на 1:1 с командой)         │
│ ⚠ Workload fairness: ↓ 42%                                            │
│   Communication: 65%                                                   │
│   Time pressure: 58%                                                   │
│   Role clarity: 72%                                                    │
└────────────────────────────────────────────────────────────────────────┘

┌─ Workload heatmap (без имён) ────────────────────────────────────────┐
│         Пн Вт Ср Чт Пт                                                 │
│  9-12   ▒  ▓  ▓  ▒  ░   ░=пусто  ▒=норма  ▓=перегруз                 │
│ 12-15   ▓  █  █  █  ▓   █=>120%                                       │
│ 15-18   █  █  █  █  █                                                 │
│ 18-21   ▒  ▓  ▒  ▓  ░   ⚠ после 18:00 — рост в 3 раза за месяц       │
└────────────────────────────────────────────────────────────────────────┘

┌─ Commitment Reliability команды ─────────────────────────────────────┐
│ Текущее: 64%  •  Тренд 12 нед: ▇▆▆▅▅▄▄▃▃▃▂▂ ↓                         │
│ ⚠ Падение от 84% до 64% — корреляция с приходом проекта «РольФ»       │
└────────────────────────────────────────────────────────────────────────┘

┌─ Alert (без имён) ───────────────────────────────────────────────────┐
│ ⚠ Команда показывает 3 red signals за 4 недели подряд:                │
│   - eNPS падает (-12 пп)                                              │
│   - Workload after-hours растёт (+200%)                               │
│   - Manager support driver упал ниже 40%                              │
│                                                                         │
│ Рекомендация: спланировать team wellbeing-сессию.                      │
│ [ Открыть гайд для тимлида ]                                           │
└────────────────────────────────────────────────────────────────────────┘

┌─ Privacy statement ──────────────────────────────────────────────────┐
│ Что вы видите: только агрегаты по команде (минимум 5 человек).        │
│ Что вы НЕ видите: индивидуальные mood, тексты чек-инов, кто конкретно │
│ выгорает. Это сделано намеренно — фокус продукта в улучшении культуры │
│ команды, а не surveillance отдельных людей.                            │
└────────────────────────────────────────────────────────────────────────┘
```

#### 4.3.3. Чего на странице руководителя НЕ ДОЛЖНО БЫТЬ (категорически)

- ❌ Индивидуальный flight-risk score (нарушает GDPR Art.9 + потенциально EU AI Act).
- ❌ Имя сотрудника с пометкой «вероятно уйдёт».
- ❌ Ранжирование сотрудников по mood / sentiment / engagement.
- ❌ Видео-эмоции / голосовой стресс-анализ (запрещено EU AI Act Art.5 с 02.02.2025).
- ❌ Индивидуальные тексты чек-инов любого формата.
- ❌ Чат-бот «спроси AI про сотрудника X» (поощряет surveillance-стиль).
- ❌ Команды <5 человек (показываем generic-overview без агрегатов).

#### 4.3.4. Сигналы, которые мы СЧИТАЕМ, но в команду показываем ТОЛЬКО АГРЕГИРОВАННО

Все 10 сигналов из §5.3.5 — мы их вычисляем для системных алертов и для **самого сотрудника** на его `/me/pulse`. Для руководителя — **только** агрегат по команде:
- eNPS team-level (мин 5 чел).
- Commitment reliability team-level.
- Workload heatmap без имён.
- 5 Gallup factors team-level.
- Aggregated alert «команда показывает 2+ red signals 4 недели» — **без имён**.

#### 4.3.5. Обновлённая модель доступа (нужно добавить в policy.csv)

| Роль | `/me/pulse` (свой) | `/me/pulse` (чужой) | `/teams/[id]/health` (агрегат) |
|---|---|---|---|
| Сам сотрудник | ✅ полная | ❌ | только своя команда |
| Тимлид (manager) | ✅ свой | ❌ | ✅ только свои команды (мин 5 чел) |
| COO / owner / admin | ✅ свой | ❌ | ✅ все команды (мин 5 чел) |
| HR-партнёр (новая роль) | ✅ свой | ✅ **только при opt-in сотрудника на wellbeing-программу** | ✅ все команды |
| Super_admin | ✅ свой | ❌ (даже супер-админу нельзя без opt-in) | ✅ все команды |

### 4.4. Сводная таблица «что куда»

| Метрика | Главная (Уровень 1) | Спринт (Уровень 2) | Сотрудник (Уровень 3) |
|---|---|---|---|
| Sentiment команды | green/yellow/red 7д | per-sprint только участники | per-person 30 дней |
| Цели (alignment) | weighted avg | цели спринта + outcomes | свои цели |
| Обещания | aggregate count | внутри спринта | его обещания |
| Блокеры | top-5 за 7д | sprint board | его блокеры |
| Конфликты | граф | members of sprint | граф связей |
| Гипотеза | ❌ | ✅ главное поле | ❌ |
| Knowledge core (темы/сигналы) | ✅ | связанные с целями | связанные с человеком |
| AI summary | за день/неделю | стандап + ретроспектива | «что обсудить на 1:1» |

### 4.5. Roadmap по фазам (обновлено по итогам исследования)

| # | Фаза | Цель | Скоп | Оценка |
|---|---|---|---|---|
| **0** | Хотфиксы видимого | Убрать стыд | Bug A (EntitlementGuard → TenantMiddleware) + Bug B (реальные sparkline 12 недель) + Issue C (унификация UI Kit между дашбордами) | 0.5-1 день |
| **1** | **Commitment Reliability Index** | Новая базовая метрика для маяка #2 | Backend: вычислять % kept/broken/overdue за окно, per-person + per-team; миграция полей `closedAt`, `brokenAt` в Commitment если нужно; sparkline 12нед | 1-2 дня |
| **2** | **Goal Confidence (self-assessment)** | Маяк #3 lead-индикатор провала | Новое поле `Goal.weeklyConfidence` (1-10); один вопрос в weekly чек-ине owner-у цели; виджет «confidence trend» | 2 дня |
| **3** | **eNPS из чек-инов + threshold-полосы** | Маяк #1 на индустриальном языке | Вычисление по формуле `(% green − % red)` нормированной к −100..+100; threshold-полосы (Andon chart) на trend; per-team разрез (мин 5 чел) | 1 день |
| **4** | **Hanging Decisions + Decision Velocity** | Маяк #4 | Доработать `DecisionRaiseService` — счётчик «поднималось ≥2 раз»; виджет «время до решения» (медиана) | 1-2 дня |
| **5** | **KPI Heroes на Главной (новые 4 маяка)** | Замена vanity-карточек | Frontend: 4 KPI cards с реальным sparkline + threshold-цвет + click-to-drilldown; убрать старые карточки «новые темы/сигналы» | 2 дня |
| **6** | **Health Monitor Grid (Atlassian-style)** | Замена «температуры команды» | Backend: matrix `team × attribute` (Promise / Decision / Sentiment / Conflict / Goal-flow), цвет + arrow trend; frontend: grid-component | 3-4 дня |
| **7** | **Hill Chart для Goals** | Ловить «застрял, не жалуется» | Поле `Goal.hillPosition` 0-100 (uphill/downhill), weekly update owner-ом; D3-кривая; история позиций | 3 дня |
| **8** | **AI Summary с Transparent Sourcing** (Lattice-style) | Доверие к LLM-блоку | Каждое утверждение `narrativeSummary` ссылается на конкретные `Meeting.id` / `IdeaBlock.id`; UI делает kompak-цитаты с tooltip | 2-3 дня |
| **9** | **Sprint Hypothesis модель** | Закрыть gap «спринт без гипотезы» | Миграция: новая модель `SprintHypothesis` (или JSON-поле на `Project`) с полями из §5.3.2 + Confidence Meter Гилада; UI в `/projects/[slug]/settings` | 2 дня |
| **10** | **Sprint Pulse page** `/projects/[slug]/sprint-pulse` | Уровень 2 дашборда | 5 паттернов §5.3.1: hypothesis top, outcome+burndown, owner-grid, daily lane, retro-card; AI auto-стандап + risk-detection | 5-7 дней |
| **11** | **Personal Pulse `/me/pulse`** (страница 1 уровня 3) | care-page для сотрудника | Mood trend, energy budget, commitments, AI-coach, прозрачность «что про меня знает система», эскалация в кризисе | 5-7 дней |
| **12** | **Team Health `/teams/[id]/health`** (страница 2 уровня 3) | manager view БЕЗ имён | Aggregated eNPS, 5 Gallup factors, workload heatmap без имён, commitment reliability команды, alerts «без имён» | 3-4 дня |
| **13** | **Min-5 enforcement + Privacy gates** | Compliance GDPR/EU AI Act | Все агрегаты per-team проверяют `COUNT(members) ≥ 5`, иначе «недостаточно данных»; новая роль `hr_partner` в policy.csv; opt-in flag на User для wellbeing-программы | 2 дня |
| **14** | **EAP escalation guardrail** | Юридический must-have | NLP-классификатор маркеров суицидальной идеации в чек-инах → блокирующий UI с горячей линией + opc. notify HR (только с opt-in) | 2-3 дня |
| **15** | **Drill-down navigation на все KPI** | Карточка → список | Каждый KPI hero на Главной + каждый аттрибут Health Grid → выделенная страница со списком людей/решений/обещаний + фильтрами | 3 дня |
| **16** | **Empty-state «sample story»** | First-impression | Synthetic dataset с watermark «образец» на всех дашбордах когда `COUNT(real data) = 0` | 1-2 дня |
| **17** | **Удалить дубли с Главной** | Чистка | StructureSummary, QualityScore, CurationPending, InsightsTop с Главной — вынести на отдельные страницы / не дублировать с Operations | 1 день |

**Итого**: ≈8-10 недель работы на одного бэкенд + одного фронтенд инженера, по фазам с возможностью cut'а после фазы 8 (минимально жизнеспособный новый набор) и после фазы 12 (полный заявленный продукт).

**Критический путь (что нельзя пропускать)**:
- 🚨 Фаза 0 — иначе пользователи видят стыд.
- 🚨 Фаза 13 — иначе **юридический риск** (GDPR Art.9, EU AI Act, штраф до €35M).
- 🚨 Фаза 14 — иначе **этический и репутационный риск** при суицидальном кейсе.

**Что можно отложить (P2)**:
- Фаза 8 (Transparent Sourcing) — желательно, но не блокирующее.
- Фаза 16 (sample story) — UX nice-to-have.
- Фаза 17 (чистка дублей) — можно делать постепенно при касании каждой страницы.

---

## Часть 5. Веб-исследование — синтез

Результаты трёх параллельных веб-исследований (2024-2026 источники), цитаты и ссылки — в конце каждого подраздела.

### 5.1. COO без финансов: 5 метрик, 5 паттернов визуализации, 6 anti-patterns

#### 5.1.1. Топ-5 операционных метрик, которые мы НЕ покрываем (но они ценны)

| Метрика | Формула | Зачем |
|---|---|---|
| **Commitment Reliability Index** | `Kept / (Kept + Broken + Overdue)` за окно, breakdown по человеку / команде | Самый честный non-financial индикатор операционного здоровья. У нас есть `Commitment`, но виден как сырой список. Best practice 2025 (Allo.io OKR check-ins): «vague commitments should be rejected … accountability evaporates without precise ownership» |
| **Decision Velocity + Hanging Decisions** | Медиана `decided_at − raised_at`; счётчик `decision` без `actualOutcomes` поднимаемых ≥2 раз | DORA-аналог для не-инженерных команд. DORA 2025: «rescheduling prioritization ceremonies to finalize business decisions before engineering committed to sprint goals improved delivery consistency» |
| **Meeting Tax / Collaboration Overload Index** | % рабочего времени в синхронных встречах + индекс «дублирующихся обсуждений» (одна `Theme` ≥3 раз за 14 дней) | Asana State of Work 2024: «individual contributors' unproductive meeting load has jumped to 3.7 hours, an **118% increase**»; «knowledge workers spend **60% of their time on work about work**». **Идеально совпадает с нашей моделью Theme + Meeting** |
| **eNPS из чек-инов** | `(% зелёных) − (% красных)` от daily check-ins | Стандартный язык для борда. Бенчмарки 2025 (SurveyMonkey / AIHR): `>50` exceptional, `30-50` strong, `10-30` healthy, `0-10` acceptable, `<0` red flag. Burnout sub-индикатор (Specific.app): «averaging below 3.0 for 2+ consecutive weeks needs immediate attention» |
| **Goal Confidence Score** | Self-assessment 1-10 раз в неделю «вероятность достижения», + delta week-to-week | Must-have в OKR-дашбордах 2025. Mooncamp: «The current confidence level should be displayed in the OKR dashboard, and scores should always be updated for the weekly OKR check-in». Lead-индикатор провала: команда сама не верит = провалится с большей вероятностью |

#### 5.1.2. 5 best-practice паттернов визуализации

1. **Health Monitor Grid (Atlassian/Spotify pattern).** Матрица `строки=команды × столбцы=атрибуты` с цветом + стрелкой тренда. У Atlassian — 8 атрибутов (team cohesion, balanced team, shared understanding, value/metrics, ways of working, engagement, continuous improvement); у Spotify — 11. **Spotify (Henrik Kniberg)**: «Arrow is the trend (is this generally improving or getting worse?)». **Atlassian**: «Are your reds and yellows moving toward green?». Это самая узнаваемая ops-визуализация индустрии. Для нас — заменить «температуру команды» этой матрицей.
2. **Hill Chart (Basecamp Shape Up).** Кривая холма, точки = scopes (у нас — Goals / Decisions). Левая сторона = uphill (неопределённость), вершина = «всё ясно, осталось сделать», правая = downhill (исполнение). Killer feature — **история**: «The hill chart allows everybody to see that somebody might be stuck without them actually saying it». Идеально совпадает с философией «памяти компании»: система видит застревание сама.
3. **Hero KPI + Trend + Drill-down (single-screen).** Three-zone layout: Hero (3-5 KPI с sparkline 12 недель + delta) → mid (один большой нарратив с аннотациями событий) → bottom (action items: hanging decisions, broken commitments). Правило: «**3-5 KPI per level** (company, function, team)» (insightsoftware 2026). **Наша Главная нарушает это правило**.
4. **Threshold lines + аннотации событий.** Любая trend-линия (eNPS, reliability) рисуется с горизонтальной зеленой/жёлтой/красной полосой + аннотациями организационных событий («24 марта — запустили новую систему ретро»). Andon chart (производственная метафора) — идеально для sentiment timeline.
5. **Cascading Goal Tree.** Дерево / sunburst: корень = company objective, листья = personal KRs; на каждом узле — confidence + health-цвет. «Cascading OKR view … particularly useful for identifying misalignment» (Quantive 2025). У нас уже есть `Goal.parentGoalId` — можно строить.

#### 5.1.3. Anti-patterns (6 штук)

1. **Watermelon dashboard** — «зелёный снаружи, красный внутри». «Watermelon KPIs appear green on dashboards but are red beneath the surface from the customer's perspective» (Alloy Software). Лечение: **показывать распределение**, а не только средние; цвет родителя = `MIN(детей)`, не `AVG`.
2. **Vanity metrics в hero-зоне.** Наши «новые темы / новые сигналы» — classic vanity: растущее число выглядит активно, но не отвечает «нужно ли действовать?». Заменить на «темы, требующие решения».
3. **Перегруз карточками одного уровня.** «Overloading the dashboard leads to decision fatigue». Лечение — progressive disclosure: 3-5 hero, всё остальное за tab.
4. **Метрика без baseline / threshold.** Число «eNPS = 12» бессмысленно. Должно быть «eNPS = 12 (бенчмарк 30-50, ваш уровень — healthy, ниже зоны strong)».
5. **Weekly = дубликат daily в другой шкале.** Best practice 2025: weekly view = **дельта и аномалии**, а не повтор daily-чисел.
6. **LLM-сводка без ссылок на сырые сигналы.** Anti-pattern для AI-дашбордов: narrative без drill-down к встречам / чек-инам / коммитментам. COO должен мочь кликнуть «снижение sentiment» → попасть к 3 конкретным красным чек-инам.

**Источники §5.1** (выжимка):
[Spotify Squad Health Check](https://engineering.atspotify.com/2014/09/squad-health-check-model) ·
[Atlassian Health Monitor](https://www.atlassian.com/team-playbook/health-monitor) ·
[Basecamp Hill Charts](https://basecamp.com/hill-charts) ·
[Shape Up Ch.13](https://basecamp.com/shapeup/3.4-chapter-13) ·
[Quantive OKR Guide 2025](https://quantive.com/resources/articles/okr-guide) ·
[Mooncamp OKR Dashboard](https://mooncamp.com/blog/okr-dashboard) ·
[AIHR eNPS Guide 2026](https://www.aihr.com/blog/employee-net-promoter-score-enps/) ·
[Asana State of Work 2024](https://asana.com/inside-asana/unproductive-meetings) ·
[DORA report 2025](https://brainhub.eu/library/devops-dora-metrics) ·
[Alloy Watermelon Effect](https://www.alloysoftware.com/blog/watermelon-effect/) ·
[Raw.Studio Dashboard Disasters](https://raw.studio/blog/dashboard-design-disasters-6-ux-mistakes-you-cant-afford-to-make/) ·
[Smashing UX Real-time Dashboards 2025](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/) ·
[insightsoftware COO KPI Guide 2026](https://insightsoftware.com/blog/best-15-operational-kpis-and-metrics-for-the-modern-coo/) ·
[Specific.app burnout pulse](https://www.specific.app/blog/employee-wellness-survey-questions-20-great-questions-for-burnout-detection-and-early-intervention/).

---

### 5.2. People Analytics платформы: что украсть, чего НЕ повторять

#### 5.2.1. Главные экраны 7 платформ (короткий teardown)

| Платформа | Главный экран COO | Главная метрика | AI 2024-2026 |
|---|---|---|---|
| **15Five** | Engagement Score + **Predictive Impact Model** (Top-5 statements по predicted impact) + Driver heatmap | Engagement Score (weighted avg 17 драйверов) + Predictive Impact per statement | **Predictive Impact** (Nov 2024) — decision-tree regression на 600K опросах; AI Summaries; declining sentiment detection |
| **Lattice** | **Employee Health Score H/M/L** (logistic regression) + Talent Reviews + DEIB | Employee Health 0-1 (signals: feedback activity, role changes, tenure, sentiment, growth, team stability) | **AI Agent with Transparent Sourcing** — каждый ответ показывает domain-источники (1:1, Reviews, Feedback) |
| **Culture Amp** | Engagement heatmap × benchmark + **Focus Agent** + AI Comment Comparisons между cohorts | Engagement Index + favorability per driver + eNPS + benchmark gap | **AI Coach** (Q3 2025): conversational interface → action plans + script templates |
| **Officevibe (Workleap)** | Team Manager Dashboard: 10 метрик radial/bar + Pulse Heatmap + eNPS | 10 драйверов (Recognition, Feedback, Happiness, Personal Growth, Manager relation, Peer relation, Alignment, Wellness, Ambassadorship, Satisfaction) — weighted 90d avg | AI modules 2025: themes from comments |
| **Range** | Team Dashboard: список с эмодзи + R/Y/G статус + mood history | **Mood (Red/Yellow/Green) + emoji из 1800+**. Red = distressed/distracted, Yellow = mixed, Green = good and ready | Минимальный AI; фокус UX + EQ |
| **Leapsome** | Модульный: Engagement + OKR progress + Review cycle status + 1:1 activity | eNPS + engagement scores per driver + OKR completion % | **AI OKR Generation** (1 предложение → KR + initiatives) + AI Insights + AI Review Summaries + AI Coach |
| **Peakon (Workday)** | **eNPS-первый экран** (одиночный gauge) + Attrition Risk by Segment heatmap | eNPS + **Attrition Risk per segment** (avg segment vs avg company) | Statistical model на миллионах данных; NLP по комментариям |

**RU/СНГ:**
- **Yva.ai** — **ближайший конкурент**: ONA + passive signals из MS365/Teams/Slack/Jira + burnout dashboard + 5 leadership styles + 3% informal leaders detection. Делает то, что западный мейнстрим только начинает.
- **Happy Job** — 1000+ компаний РФ; gamified surveys; eNPS + mNPS + Happy Index + NLP по комментариям.
- **TalentTech / Поток Опросы** — ML обучен на ответах российских компаний (отрасли, корп-сленг).

#### 5.2.2. 5 AI-фич которые стоит украсть

1. **Predictive Impact / Priority Scoring** (15Five). Не «низкий score», а «улучшение этого драйвера даст +X engagement». У нас: применить на скиллах/конфликтах — «какая интервенция даст максимум».
2. **AI Coach с action plans** (Culture Amp). Менеджер спрашивает «что сделать?» → conversational AI → план + script. У нас уникально: action plan может опираться на **прошлые встречи этого менеджера**.
3. **AI Comment Comparisons между cohorts** (Culture Amp). «Что отличает engaged от disengaged по темам». У нас: сравнить «зелёные» vs «красные» подразделения автоматически по чек-инам.
4. **AI OKR Generation в 2 клика** (Leapsome). У нас: генерация Commitment из встречи.
5. **Transparent AI Sourcing** (Lattice). Каждый AI-ответ показывает источник: «цитата из встречи Х + IdeaBlock Y». Критично для доверия. **Должно быть в каждом нашем LLM-блоке**.

#### 5.2.3. 5 чёрных дыр — наше преимущество

1. **Никто не строит граф из встреч как первоисточник.** Все 7 платформ — survey-driven (даже Yva.ai опирается на surveys + behavioral metadata, не на содержание встреч). У нас `MeetingTranscript → IdeaBlock → Entity → EntityLink` — это пласт «о чём вообще шла речь».
2. **Связь обещание ↔ исполнение не отслеживается.** Никто не делает «John обещал X на встрече 15 мая → дедлайн истёк → не сделано → сигнал». У нас есть `Commitment + Goal` — можно показать **commitment reliability как burnout/disengagement signal**.
3. **PersonalRelation / conflicts из реальных диалогов.** Yva.ai ONA считает «кто с кем общается», но не «между кем напряжение». У нас sentiment-пары из транскриптов → новая модель «риск-связки в команде».
4. **Sprint dashboards с гипотезами + цитатами обсуждений.** Только Leapsome и 15Five имеют OKR-cycles, но **не сцепленные с фактическими обсуждениями**.
5. **Burnout signals без MS365/Slack-метаданных.** Yva.ai зависит от calendar/email access — privacy red flag для РФ. У нас сигналы из **наших же встреч + чек-инов** — приватно и без интеграций.

**Источники §5.2** (выжимка):
[15Five Predictive Impact](https://success.15five.com/hc/en-us/articles/30285494216091-Predictive-Impact-Model-Tool-Overview) ·
[Lattice Employee Health Score](https://lattice.com/articles/how-lattices-employee-health-score-predicts-turnover) ·
[Culture Amp Q3 2025 (AI Coach + Insights)](https://www.cultureamp.com/blog/whats-new-culture-amp-q3-2025) ·
[Officevibe 10 Key Metrics](https://help.officevibe.com/hc/en-us/articles/226578988-The-10-Key-Metrics-of-Engagement) ·
[Range Mood Check-ins](https://www.range.co/help/article/mood-check-ins) ·
[Leapsome AI Insights](https://www.leapsome.com/product/ai-insights) ·
[Peakon Attrition Prediction](https://support.peakon.com/hc/en-us/articles/360019702600-Attrition-Prediction-methodology) ·
[Yva.ai dashboards](https://help.yva.ai/en/Yva.ai-dashboards.1534951609.html) ·
[Yva.ai ONA + burnout](https://www.yva.ai/blog/visier-explains-how-ona-and-ai-powered-hr-analytics-help-fight-employee-burnout) ·
[Happy Job](https://happy-job.ru/engagement/) ·
[TalentTech engagement](https://talenttech.ru/engagement/).

---

### 5.3. Спринт-дашборды и сигналы выгорания

#### 5.3.1. 5 паттернов спринт-дашборда

Сводя то, как делают Linear / Jira / Shortcut / ClickUp / Productboard / Notion / Asana / GIST Гилада:

1. **«Гипотеза + Sprint Goal» сверху.** Один артефакт из Sprint Planning, проверяется в обзоре. Шаблон Scrum.org: «We believe that <doing X> will result in <Y outcome>, measured by <Z>». **Layout:** строка во всю ширину — Hypothesis / Owner / Measured-by. За 5 секунд ответ на «зачем вообще этот спринт».
2. **«Outcome-meter, а не только burndown».** Two-column: слева Output (burndown / completion %), справа **Outcome** (целевая бизнес-метрика + delta от baseline). SVPG / Marty Cagan / Ravi Mehta: разделить output (что отгружено) и outcome (что изменилось в поведении).
3. **«Owner-grid задач со status + risk-чипом».** Компактная таблица: Task / Owner (avatar) / Status / Risk (зелёный/жёлтый/красный). Сортировка по риску ↓.
4. **«Daily check-in lane».** Лента справа/снизу: stand-up с 3 колонками на человека + AI-резюме сверху («вчера команда закрыла 3 задачи, два блокера X, Y, риск спилловера 30%»). **ScrumGenius, ClickUp Brain MAX, Atlassian Rovo** — все эту функцию автоматизируют 2025-2026.
5. **«Retro-карточка с проверкой гипотезы».** Снизу, изначально пустая («Retro pending») → после цикла: Hypothesis Confirmed / Partial / Refuted, evidence-links, next bet. Это прямой Itamar Gilad GIST: каждая идея через Confidence Meter с evidence-trail.

#### 5.3.2. Структура гипотезы (предлагаемая модель данных)

Минимальный набор полей (закладываем в БД спринта):

| Поле | Что означает | Пример |
|---|---|---|
| `hypothesisStatement` | «Верим, что [действие] для [сегмента] даст [outcome] измеряемый через [метрику]» | «Верим, что добавление AI-резюме встречи в письме хостам повысит retention_7d с 28% до 35%» |
| `inputMetric` | Что мы делаем (output, под контролем) | Доля встреч с AI-резюме (target 80%) |
| `outputMetric` | Желаемое изменение поведения / метрики | retention_7d активных хостов |
| `leadingIndicator` | Что появится **до** output | Open rate письма, CTR на «вернуться в Z» |
| `baseline` | Текущее значение output | 28% |
| `target` | Минимум, чтобы считать подтверждённой | ≥34% |
| `confidence` | 0-10 по Confidence Meter Гилада | 3.2 (опросы + аналог конкурента, нет своих A/B) |
| `killCriteria` | Что заставит остановить досрочно | leading indicator <15% после 1000 писем |

**Confidence Meter (Гилад):** Opinions → Assessment → Data → Test Results, шкала 0.1 → 10/10. Evidence pyramid: мнения (низ) → оценки → наблюдения и данные → результаты A/B (вершина).

#### 5.3.3. Sprint AI 2024-2026 (что реально работает)

- **Atlassian Rovo Agents in Jira** (открытая бета Feb 2026, Premium с Apr 2025): autoclose спринта триггерит retro-страницу; агент сравнивает 2 прошлых retro и подсвечивает паттерны.
- **Linear AI / Linear Agents** (Q1 2026): автономные триаж задач + cycle plan + owner по истории code review.
- **ClickUp Brain MAX**: собирает свежие комментарии, surface блокеров, draft stand-up status.
- **Predictive spillover**: модели по velocity + workload + unresolved blockers → какие задачи не успеют.
- **Auto blocker detection**: NLP по комментариям ловит маркеры «жду от X», «нужен доступ», «depends on».

Тренд: AI делает ритуалы **асинхронными и резюмированными** — stand-up без созвона, retro без копания. Принципиально: AI-блок **всегда** с источниками-ссылками.

#### 5.3.4. Sprint anti-patterns (4)

1. **Velocity как цель, а не калибровка.** Vanity metric. Кейс: SaaS-команда подняла velocity 30→50 за полгода, но churn вырос — выпускали фичи, которыми не пользовались. Velocity допустим **только** для прогноза ёмкости внутри одной команды, **никогда** для сравнения.
2. **Бесконечный backlog без kill criteria.** Backlog как кладбище идей. Лечение Гилада: каждая Idea имеет Confidence-score; не растёт от спринта к спринту → удаляется или назначается evidence-step.
3. **Output-focus вместо Outcome-focus.** SVPG: «феодальная IT-модель»: PO пушит «возьмите ещё тикеты», команда выгорает, бизнес-метрика не двигается. На дашборде Outcome всегда выше и крупнее Output.
4. **Sprint planning без Sprint Goal.** Превращает спринт в очередь задач. Если команда не может одной фразой ответить «зачем» — гипотеза не сформулирована.

#### 5.3.5. Топ-10 ранних сигналов выгорания / увольнения

| # | Сигнал | Источник | Порог |
|---|---|---|---|
| 1 | Падение eNPS у сегмента ≥10 пунктов за 60-90 дней | Workday Peakon attrition model | Promoters → Detractors shift >10 NPS pts за 2 pulse-волны |
| 2 | Sentiment dip ≥1σ от **личной baseline** в течение 14 дней | 14-day ambulatory mood vs PHQ-9 (PMC7787464) | rolling 14d mean < personal 30d mean − 1σ. **Сравнение с собой, не с командой** |
| 3 | Маркеры burnout в свободном тексте | arXiv 2409.14357 (13568 текстов, ensemble classifier) | всплеск «устал», «бессмысленно», «не вижу смысла» + снижение agency-слов (я/делаю → пассив) |
| 4 | Пропуск ≥30% запланированных 1:1 или встреч за 21 день | Humanyze/MIT Media Lab; Viva Insights | >30% skip rate vs personal baseline |
| 5 | Сокращение длины/частоты в командных каналах | Humanyze + Viva | -40% от 90d baseline в публичных каналах при сохранении DM |
| 6 | Рост response time в 2× за 14 дней | Viva Insights collaboration drag | median response time ≥2× baseline |
| 7 | Снижение Commitment Reliability | **Наша метрика**; модель OLBI exhaustion + disengagement | closed_rate < personal_baseline − 20% за 4 недели |
| 8 | Упоминания токсичности/несправедливости в тексте | MIT Sloan Glassdoor Culture 500: токсичная культура **в 10× сильнее** предсказывает уход, чем компенсация | тематические кластеры «не уважают», «обещали и не сделали», «нечестно» — на команду/менеджера |
| 9 | Повторяющиеся негативные упоминания одного имени | Gallup 2024: unfair treatment + lack of manager support — 2 из 5 ключевых факторов burnout | ≥3 mentions, sentiment <−0.4, окно 30d |
| 10 | Job-insecurity сигналы в check-in | MIT Sloan; IBM Watson 95% accuracy (~34 переменных) | всплеск тем «куда дальше», «реорганизация», «увольнения у соседей» |

**Aggregated red flag**: совпадение ≥3 сигналов у одного человека за 30 дней — это «high-confidence flight risk», и единственная разумная реакция — **не «список увольняемых» руководителю**, а триггер для HR-партнёра / EAP-программы / 1:1 о вовлечённости.

#### 5.3.6. 🚨 Этические и юридические ограничения (КРИТИЧНО)

> **Эти ограничения переписывают часть §4.3 — учитываем их при реализации Person Pulse page.**

1. **🇪🇺 EU AI Act Art. 5(1)(f) с 2 февраля 2025 ЗАПРЕЩАЕТ эмоция-распознавание сотрудников.** AI-системы, которые «выводят эмоции» работника через мимику, голос, биометрию — запрещены (за исключением медицинских и safety-целей). Штраф до €35M или 7% оборота. Значит: **никакого «индекса счастья» по голосу со встречи или эмоций на лице из записи** в продукте для ЕС-клиентов. Сейчас sentiment у нас идёт по **тексту** ответа на чек-ин — это OK, но нельзя расширять на войс/видео.
2. **Никаких персональных attrition-score руководителю.** Workday Peakon строит attrition-risk **на сегменты** (отдел/локация/возрастная группа), **не на конкретного человека-к-конкретному-руководителю**. Microsoft Productivity Score 2020 показывал имена и действия — после backlash Microsoft вынес метрики только на уровень организации. Microsoft Copilot benchmarks 2025 — минимум 20 человек в peer-группе.
3. **Минимальный размер группы для агрегатов — 5 человек.** Индустриальный стандарт (Viva Insights) + прямое требование GDPR data minimization. На команду из 4 человек — только generic-overview.
4. **Свободный текст чек-инов нельзя показывать руководителю по конкретному человеку.** Можно: (а) сам человеку — свой mood-trend; (б) HR-партнёру/EAP — индивидуально **только** при явном opt-in; (в) руководителю — **только** агрегаты по команде, **без** перехода к индивидуальным комментариям.
5. **Никаких inference про health, политические взгляды, ориентацию, веру** (GDPR Art. 9 «special categories»). NLP-классификаторы депрессии могут «вывести» подозрение на mental health condition — это special category, обработка почти всегда требует отдельного явного согласия.
6. **Обязательный эскалационный guardrail при кризисе.** Если в check-in NLP-классификатор находит маркеры самоповреждения / суицидальной идеации — **немедленно** ссылка на горячую линию + опц. (с согласия) уведомление HR/EAP. Это прямое требование AI-chatbot guardrails (Undark 2025).
7. **Кейсы провалов** (учим на чужих ошибках):
   - **Microsoft Productivity Score 2020** — провалился на индивидуальных метриках, откатили per-user dashboard.
   - **Humanyze (sociometric badges)** — формально безопасные, но discontinued как commercial-продукт: сотрудники не принимали.
   - **Урок**: правильный фокус — давать **руководителю** инструменты улучшить культуру, а **сотруднику** — инструменты заботы о себе; и **никогда** — список «кого пора уволить, чтобы не успел уволиться сам».

#### 5.3.7. Best-practice экран Employee Health page (care, not surveillance)

**Принцип**: экран существует **прежде всего для самого сотрудника**, руководитель видит только агрегаты, HR/EAP — индивидуально только по opt-in.

**Layout личного кабинета сотрудника**:
1. Mood-trend 30/90 дней + подпись «Это видишь только ты».
2. Energy budget / workload heatmap (сколько встреч / focus / after-hours) — сравнение с собой месяц назад.
3. Commitments-блок: сколько взял / закрыл / тренд + AI-подсказка «нагрузка обещаниями выросла за 2 недели, два хронически переезжают — обсудить с PM?».
4. **Сигналы (мягко)**: при ≥2 red signals — карточка «Похоже, нагрузка большая. Хочешь поговорить?» с тремя кнопками: «Запланировать 1:1», «Связаться с EAP анонимно», «Скрыть на 2 недели». **Никакого score «вы выгораете на 78%».**
5. Список рекомендованных action'ов AI-коуча: «попробуй запланировать 90 минут фокус-времени», «отметь важные 1:1 за 6 недель».
6. **Что про меня знает система** — прозрачный блок: «анализируем check-ins, agenda встреч (не транскрипт), время ответов. **Не** анализируем: личные сообщения, видео-эмоции, голосовой тон». Кнопки «выключить аналитику», «удалить данные за период».
7. Эскалация в кризисе (см. 5.3.6 пункт 6).

**Layout страницы «Здоровье команды» для руководителя**:
1. Aggregated eNPS team-level + тренд 90 дней (минимум 5 ответов, иначе «недостаточно данных»).
2. Five Gallup factors сводно по команде (fairness, workload, communication, manager support, time pressure).
3. Workload heatmap **без имён**, по дням недели и часам.
4. Закрытие Commitments по команде — агрегат.
5. Алерты типа «команда показывает 2+ red signals за 4 недели — спланировать wellbeing-сессию». **Без имён, без рангов.**
6. Privacy-statement: какие данные руководитель видит, какие нет, и почему.

**Чего на этом экране НЕ должно быть**:
- индивидуального flight-risk score,
- имени с пометкой «вероятно уйдёт»,
- ранжирования сотрудников по mood / sentiment,
- видео-эмоций / голосового стресс-анализа (запрещено EU AI Act),
- индивидуальных свободных текстов чек-инов.

**Источники §5.3** (выжимка):
[Itamar Gilad GIST](https://airfocus.com/templates/GIST-itamar-gilad/) ·
[Confidence Meter](https://itamargilad.com/hype/confidence-meter-low-evidence/) ·
[Reforge Product Strategy Stack (Ravi Mehta)](https://www.reforge.com/blog/the-product-strategy-stack) ·
[Atlassian Rovo Agents](https://www.atlassian.com/software/jira/ai) ·
[Scrum.org Sprint Backlog Anti-patterns](https://www.scrum.org/resources/sprint-backlog-antipatterns) ·
[SVPG From Features to Outcomes](https://www.svpg.com/videos/from-features-to-outcomes-transforming-product-teams/) ·
[EU AI Act Article 5](https://artificialintelligenceact.eu/article/5/) ·
[FPF EU AI Act emotion recognition ban](https://fpf.org/blog/red-lines-under-eu-ai-act-unpacking-the-prohibition-of-emotion-recognition-in-the-workplace-and-education-institutions/) ·
[Workday Peakon Attrition Methodology](https://doc.workday.com/peakon/en-us/workday-peakon-employee-voice/insights/reporting/attrition-prediction-methodology.html) ·
[MIT Sloan Toxic Culture](https://sloanreview.mit.edu/article/toxic-culture-is-driving-the-great-resignation/) ·
[IBM 95% turnover prediction](https://www.cnbc.com/2019/04/03/ibm-ai-can-predict-with-95-percent-accuracy-which-employees-will-quit.html) ·
[arXiv NLP for Burnout (2409.14357)](https://arxiv.org/abs/2409.14357) ·
[14d ambulatory mood vs PHQ-9 (PMC7787464)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7787464/) ·
[Microsoft Productivity Score backlash](https://www.theregister.com/2020/12/01/productivity_score/) ·
[Gallup 5 factors of burnout](https://www.gallup.com/workplace/612518/driving-federal-government-burnout.aspx) ·
[AI Chatbots need guardrails (Undark 2025)](https://undark.org/2025/09/18/opinion-chatbots-guardrails-mental-health/) ·
[AIHR People Analytics ethics](https://www.aihr.com/blog/people-analytics-ethical-considerations/).

---

## Часть 6. Открытые вопросы (после исследования)

Часть вопросов из черновика закрыта результатами исследования (§5). Что осталось:

1. **Sprint hypothesis: отдельная модель или JSON-поле?** Рекомендация после §5.3.2 — **отдельная модель `SprintHypothesis`** с историчностью (Confidence Meter Гилада требует версионирования: 3.2 → 5.0 → 7.5 → finished). JSON был бы быстрее, но потеряем evidence-trail.
2. **«Авто-стандап» — push или pull?** Рекомендация — **hybrid**: формируется автоматически утром по расписанию owner-а спринта, но **доставляется по запросу** (pull через web/Telegram-бот). Push спам быстро вызовет fatigue.
3. **OneOnOne модель — отдельная или внутри Meeting?** Рекомендация — **расширить Meeting** (тип `one_on_one` уже есть): добавить `oneOnOneAgenda: json` (повторно используемые темы) + `oneOnOneSummaryHidden: boolean` (видит только участник). Отдельная модель — избыточно.
4. **eNPS: weekly pulse separate from daily?** Рекомендация — **да, weekly**: 1 вопрос в пятницу через `DailyCheckIn.kind='enps'`. Обработка отдельным prompt'ом. Daily остаётся как сейчас.
5. **HR-партнёр роль**: новая роль `hr_partner` в `policy.csv` или подмешать к существующим? Рекомендация — **отдельная роль**: задачи отличаются от `admin` (HR смотрит wellbeing, не billing), и доступ к `/persons/[id]/pulse` чужого открывается только этой роли при opt-in.
6. **Опросник для 5 Gallup factors** — встраиваем в существующий weekly чек-ин или отдельный?
7. **Минимум 5 человек для агрегата** — что показывать команде <5? Generic «недостаточно данных для агрегата по приватности» или объединение в «прочие»? Рекомендация — первое (честнее).

---

## Часть 7. Что НЕ предлагаем (anti-patterns — расширено по итогам исследования)

### 7.1. По продуктовой части

- ❌ **«Turnover risk score 0-100»** на персону. Microsoft Productivity Score 2020 и Humanyze badges — оба провалились ровно на этой ошибке. Sentiment Лиссаповед: «10× сильнее предсказывает уход токсичная культура, чем индивидуальные сигналы» (MIT Sloan). Заменяем на агрегат команды + 5 Gallup factors.
- ❌ **«Productivity score»** — закрытый чёрный ящик, оптимизируется под себя. The Register 2020: «Microsoft will remove user names from Productivity Score after privacy backlash».
- ❌ **Realtime «кто что пишет в чек-ине прямо сейчас»** — только batch-агрегаты.
- ❌ **Рейтинг сотрудников с сортировкой** — токсично, ломает доверие.
- ❌ **Чат-бот «спроси AI про сотрудника X»** на странице руководителя — поощряет surveillance.
- ❌ **Velocity как KPI спринта** (vanity, см. §5.3.4). Только как калибровка ёмкости внутри одной команды.
- ❌ **Бесконечный backlog без kill criteria** — каждая идея проходит Confidence Meter Гилада.
- ❌ **Vanity-метрики в hero-зоне** — наши «новые темы / новые сигналы» уходят (см. §5.1.3).
- ❌ **Watermelon dashboards** — цвет родителя = `MIN(детей)`, не `AVG`; всегда показывать распределение.

### 7.2. По визуализации

- ❌ Метрики без baseline / threshold (см. §5.1.3 п.4).
- ❌ Weekly digest как дубль daily (см. §5.1.3 п.5). Weekly = дельта + аномалии.
- ❌ LLM-сводка без drill-down к источникам (Lattice AI Agent делает Transparent Sourcing — копируем).
- ❌ Перегруз карточками одного уровня (3-5 KPI per level — правило insightsoftware).

### 7.3. По юриспруденции и этике (КРИТИЧНО)

- ❌ **Эмоция-распознавание из видео/голоса/мимики** — **запрещено EU AI Act Art.5(1)(f) с 02.02.2025**, штраф до €35M или 7% оборота.
- ❌ **Inference про health, политические взгляды, ориентацию, веру** — GDPR Art.9, требует явного отдельного согласия.
- ❌ **Индивидуальный flight-risk score руководителю** — Microsoft + Humanyze precedent + GDPR data minimization.
- ❌ **Агрегат на команду <5 человек** — нарушает GDPR data minimization, индустриальный стандарт.
- ❌ **Свободный текст чек-инов руководителю** — даже агрегированный текст легко привязать к человеку.
- ❌ **Чат-бот без эскалационного guardrail в кризисе** — Undark 2025: «chatbot не должен успокаивать платитьюдами, когда нужна реальная эскалация».

### 7.4. По данным

- ❌ Сравнивать sentiment с командным средним вместо личного baseline — у людей разные базовые настроения. Сравнение с собой (см. §5.3.5 п.2).
- ❌ Использовать абсолютные пороги для «плохо» вместо относительных к baseline (примеры абсолютов в §5.3.5: ≥3 жёлто-красных — НО только если «необычно для этого человека»).

---

## Часть 8. Финальная сводка для пользователя

Документ дал ответ на все 4 поставленных вопроса:

1. **Что у нас сейчас и почему слабо** (§1, §2):
   - 2 баг видимых багов (EntitlementGuard, фейковые sparkline);
   - 3 design issue (асимметрия UI, мёртвые empty states, нет drill-down).

2. **Что делает реальный COO без финансов** (§5):
   - Топ-5 метрик (Commitment Reliability, Decision Velocity, Meeting Tax, eNPS, Goal Confidence);
   - 5 паттернов визуализации (Health Monitor Grid, Hill Chart, Hero+Trend, Threshold lines, Cascading Goal Tree);
   - 7 платформ teardown (15Five, Lattice, Culture Amp, Officevibe, Range, Leapsome, Peakon) + RU (Yva.ai, Happy Job, TalentTech);
   - 5 AI-фич которые стоит украсть.

3. **Что есть в наших данных** (§3):
   - 13 моделей покрывают почти все нужные метрики;
   - 5 gap'ов (sprint hypothesis, eNPS pulse, 1:1 history, confidence-score, role hr_partner).

4. **Что предложить** (§4):
   - **Уровень 1**: Главная с 4 KPI hero + Health Monitor Grid + Hill Chart + AI с Transparent Sourcing;
   - **Уровень 2**: `/projects/[slug]/sprint-pulse` с гипотезой по GIST Гилада + Confidence Meter;
   - **Уровень 3**: **две страницы** — `/me/pulse` (care для сотрудника) + `/teams/[id]/health` (agregate для руководителя);
   - **17 фаз** roadmap на 8-10 недель.

**Юридический контекст** (важно для GTM):
- EU AI Act Art.5 с 02.02.2025 → пересмотрена этическая модель Person Pulse.
- GDPR Art.9 → исключены любые inference про health/политику/религию.
- Microsoft / Humanyze precedents → отказались от индивидуальных surveillance-метрик в пользу command-aggregate + personal-care.

**Дальнейшие шаги:**
1. Согласовать с пользователем приоритизацию фаз 0-17.
2. Подготовить ТЗ для Фазы 0 (хотфиксы) — отдельный документ в `plans/tz/`.
3. Подготовить ТЗ для Фаз 1-5 (новая Главная) — отдельный документ.
4. Подготовить ТЗ для Фаз 13-14 (privacy/EAP guardrails) — критическое до релиза Уровня 3.
