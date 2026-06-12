---
date: 2026-06-08
type: tz
status: draft
owner: Сергей
related:
  - plans/analysis/2026-06-08-dashboards-audit-numbered-ledger.md
  - plans/analysis/2026-06-08-dashboards-audit-per-board.md
  - plans/tz/2026-06-08-agents-daily-value-engine.md
  - docs/operations/feature-flags.md
  - docs/operations/prod-deploy-log.md
---

# ТЗ-2 «Изменение информации на дашбордах» — ревизия состава, переносы, объединения, новые экраны

## Цель

Привести дашборды Z/Кора в соответствие с правилом первого экрана (≤7 величин), убрать дубли и мёртвые/повторные виджеты, перенести ценность туда, где она уместна, объединить размазанный смысл и добавить недостающие срезы. Главный сдвиг по числам: перегруженная главная директора худеет (29 → 7 на первом экране), а пустой для рядового `/me` наполняется (5 → 9). Ничего ценного не удаляется — почти всё **переносится или объединяется**; «совсем убрано» только заглушки и мёртвые метрики.

Это ТЗ — про **информацию на экранах** (что показывать, где, как сгруппировать). Движок данных под этими экранами (агенты, доставка, новые поля БД, бюджет уведомлений) — в **ТЗ-1** [agents-daily-value-engine.md](2026-06-08-agents-daily-value-engine.md). Зависимости от ТЗ-1 указаны явно в каждой фазе.

## Контекст и источники истины

- **Главный источник — реестр по числам:** [dashboards-audit-numbered-ledger.md](../analysis/2026-06-08-dashboards-audit-numbered-ledger.md). Все ссылки «№N реестра» — на нумерацию оттуда. Обозначения: ✅ оставить · ➡️ перенести · 🔗 объединить · ✖️ убрать совсем (только заглушки/мёртвое) · ➕ добавить. Принцип: **перед удалением — перенос.**
- **Обоснования прозой:** [dashboards-audit-per-board.md](../analysis/2026-06-08-dashboards-audit-per-board.md) (правило первого экрана, исход важнее активности, мягкие оценки — не показатели, колонка «Причина» как наш плюс против Jira-пуллера).

### Код-якоря (верифицированы при написании этого ТЗ — НЕ повторять прежних ошибок анализа)

| Якорь | Что подтверждено по коду |
|---|---|
| `backend/src/modules/dashboard/services/director-dashboard.service.ts` | Главная директора: ~12 параллельных запросов в `getDirectorView`; KPI sentiment/commit/hanging, `strategicAlignment` (взвешенный `cachedAlignment`), `goalsTree`, `goalsPulse` (по `progressStatus`), narrative-LLM. **`narrativeSummary` — РЕАЛИЗОВАН** (LLM + citations parser), не заглушка. |
| `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` | Рендер вкладок; виджеты тянутся из двух мест: `@/ui/components/dashboard/*` (`CompassWidget`, `TeamHealthGrid`, `PeopleAtRiskWidget`, …) и `./widgets/*` (`GoalsPulseWidget`, `InsightsTopWidget`, `QualityScoreWidget`, `StrategicAlignmentWidget`). |
| `frontend/app/(authenticated)/dashboard/widgets/QualityScoreWidget.tsx` + `backend/src/modules/quality-score/*` | **`QualityScoreWidget` ПОЛНОСТЬЮ реализован** (DTO-цепочка `quality-score.api.ts` → `domain/quality-score` → виджет; реальный эндпоинт `GET /api/v1/org/dashboard/quality-score`; воркер `quality-score.worker.ts`). **НЕ заглушка, НЕ pending.** Реестровая №28 «Оценка качества — заглушка/убрать» — **ошибка анализа; не убирать.** |
| `frontend/app/(authenticated)/dashboard/widgets/InsightsTopWidget.tsx` + `insights.service.getTop` | Существует, без pending-маркеров. **НЕ переделывать.** Новый нужен только `IdeasService.getTop` + `IdeasTopWidget` (ТЗ-1 Ф4.A — бэкенд; здесь — фронт-виджет идей). |
| `backend/src/modules/operations/services/operations-dashboard.service.ts` | `fetchTeamTemperature` даёт И summary (overview), И полный `byPerson`. `fetchCapacity` НЕ мёртвая в коде — реально агрегирует `Appointment.loadPercent` per-person (`avgLoadPercent`, `overloadedCount`); «мёртвой» она выглядит, т.к. `loadPercent` почти не заполнен → ≈0. Нужен **per-team** агрегат (ТЗ-1 Ф4.D). |
| `frontend/.../operations/OperationsDashboardClient.tsx` | **`TeamTemperatureSection` УЖЕ имеет переключатель `overall ↔ byPerson`** (одна секция). Объединение «двух температур COO» (реестр №6) на COO-экране **уже сделано** — остаётся только дубль «настроение на главной директора ↔ температура COO». |
| `backend/src/modules/operations/services/weekly-per-person.service.ts` | **УЖЕ считает по автору** (`commitmentAuthorPersonId`), не по получателю. Баг recipient→author — **НЕ здесь**, а в `goal-vector-tracker.cron.ts:288` (`commitmentRecipientPersonId`) → чинится в **ТЗ-1 Ф3.D**. Здесь per-person нужны: колонка «без ответа» + дедуп 3 источников + self-view. |
| `backend/src/modules/dashboard/services/people-at-risk.service.ts` | `RISK_REASON_RU` маппинг готов; `pulseScore` — композит (engagement − штрафы). Нужна только рамка/подпись «оценка». |
| `backend/src/modules/dashboard/services/pulse-patterns.service.ts` | 7 паттернов в одном агрегаторе (busFactor, recurring, lowRoi, bottleneck, goalVector, knowledgeVelocity, irreversibleDecisions). Движок не трогаем — убираем повторный рендер. |
| `backend/src/modules/operations/services/daily-digest.service.ts:835+` | **`whoShined` РЕАЛИЗОВАН** (агрегация recognition/helpful/commitments, зелёный `daily-digest.who-shined.spec.ts`). Пустой `[]` в `toDto` (стр.522) — type-safe дефолт до `enrichDto`. **НЕ трогать, НЕ «доделывать».** |
| `schema.prisma:4057 Goal` | Есть `progressStatus (GoalProgressStatus: on_track/at_risk/stalled/achieved/dropped)`, `weight`, `horizon`. **Поля приоритета MoSCoW нет** → миграция (Ф6). |
| `schema.prisma:7213 ChatV2Message` | **Поля `helpful` нет** — плумбинг метрики чата (поле + эндпоинт оценки + `getChatUsageStats`) реализуется в **ТЗ-1 Ф5**; здесь (Ф5) — только фронт-виджеты, потребляющие готовый агрегатор. |

> **Чем эта работа НЕ является:** новые ML-метрики (хватает существующих агрегатов), рейтинг «худших сотрудников» (этика — developmental-рамка), переписывание уже работающих виджетов (`narrativeSummary`, `whoShined`, `InsightsTopWidget`, `QualityScoreWidget`), плодёж новых данных там, где смысл просто переезжает между вкладками.

---

## Принятые решения (развилки уже закрыты в анализе — не переоткрывать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | **Первый экран главной директора ≤7 величин**, всё прочее — на вкладках/drill-down. Целевой первый экран: Польза · Настроение · Обещания · Висящие решения · Компас(факт) · AI-сводка · Top-1 риск. | Правило первого экрана; dashboard fatigue. Реестр §1 «Итог по числам». |
| Р2 | **Компас вектора цели = единый вердикт движения к цели.** Факт-KR (`GoalKeyResult` прогресс) — первичен; LLM-оценка `cachedAlignment` — вторичный слой с подписью «оценка». Объединяет компас (№6) + стратегическую согласованность (№26) + пульс целей (№27) + компас-инфо повтор (№23). | Четыре индикатора одного смысла = шум; реестр 🔗. |
| Р3 | **`QualityScoreWidget` НЕ убирать** (реестр №28 ошибочна — виджет реализован, есть бэкенд-данные). Оставить как есть, подписать «оценка». | Верификация по коду. |
| Р4 | **«Что узнали» — единая карточка** (объединяет №7 темы + №8 сигналы + №9 решения + №16 «что узнали»). | Реестр 🔗; три карточки Обзора + дубль «Знаний» сливаются. |
| Р5 | **6 виджетов «Знаний» уходят в drill-down/«Спросите Кору»** (№15, 17, 18, 19 → drill-down; №21 инсайты → Операции). На главной из «Знаний» остаются 3: повторяющиеся темы (№14), открытые вопросы (№20), скорость ответа (№22). | Реестр ➡️; 9 виджетов активности на одном экране = перегруз. |
| Р6 | **Колонка «Причина» (provenance)** добавляется к сигналам/решениям/блокерам/строкам портфеля — это наш плюс против Jira-пуллера. Источник — `IdeaBlockEvidence`/`sourceBlockIds` → ссылка на встречу/решение. | per-board §«главный плюс». |
| Р7 | **Soft-цифры — только с плашкой «оценка» + знаменателем.** `pulseScore`, `cachedAlignment`, зрелость, `roiScore` — никогда как твёрдый показатель. | per-board «мягкие оценки — не показатели»; ТЗ-1 Р6. |
| Р8 | **`/me` сознательно растёт 5→9** — единственный экран, который наполняем (ежедневная ценность рядовому, self-scope, без рейтингов). | Реестр §8; ТЗ-1 Р8. |
| Р9 | **MoSCoW-приоритет — новое nullable-поле `Goal.priority` (enum Must/Should/Could/Wont)**, не отдельная сущность. Цель = инициатива (`Goal`). | Реестр §9.1; цели маппим на `Goal`. |
| Р10 | **Бэкенд метрики чата (поле `helpful`, эндпоинт оценки, `getChatUsageStats`) делается в ТЗ-1 Ф5**; в этом ТЗ Ф5 — **только фронт-виджеты**, потребляющие `GET /chat-v2/usage-stats`. Явное разграничение во избежание двойной реализации. | Брифинг; `ChatV2Message` без `helpful`. |
| Р11 | **Фикс `recipient→author` в `goal-vector-tracker.cron.ts` — в ТЗ-1 Ф3.D**, здесь только зависимость (per-person уже на author). Не дублировать реализацию. | Верификация: per-person корректен, баг в goal-vector. |
| Р12 | **Здоровье портфеля и value-recap маппим на `Goal`/память** — новых сущностей-целей не плодим; portfolio-снапшот и `ValueRecapSnapshot` (ТЗ-1 Ф5) — служебные снимки. | Реестр §9. |

---

## Общие инварианты (для всех фаз)

- **Стек:** Bun + Node + TypeScript. Никакого Python в `backend/`.
- **Миграции Prisma:** только `bun run prisma:migrate -- --name <…>` (файл в `prisma/migrations/`), НЕ `db push`. Все правки — non-destructive (новые nullable-поля/enum/таблицы, не ломать существующее).
- **Крутилки** (пороги шкалы здоровья, окна, лимиты) — в `AdminSetting` через `TypedConfigService.getDynamic(key, ENV_FALLBACK, default)` + seed-скрипт. Не ENV-only, не хардкод.
- **Флаги:** Ship-On — kill-switch ON по умолчанию; каждый новый флаг = строка в `docs/operations/feature-flags.md`.
- **DTO:** Zod (`nestjs-zod`) + Swagger на каждом эндпоинте; цепочка `ApiDto→DomainModel→UiModel` на фронте (см. skill `frontend-rules`).
- **Цветовые токены:** парные `bg-{color}` + `text-{color}-fg` (status-цвета через `var(--chip-*-fg)` в `tailwind.config.ts`). Никогда `text-white` на цветных фонах, никогда жёсткие hex/slate-классы.
- **UI — только русский**, английские термины при первом упоминании — в скобках с русским пояснением.
- **Скрипты:** `createPrismaClient()` из `backend/scripts/_lib/prisma.ts`; seed/patch/backfill регистрировать в `STEPS` массива `apply-prod-deploy.ts`.
- **Метрики:** prom-client через `BusinessMetricsService` по образцу `coo_*`.
- **LLM-промпты** (где есть): prompt registry + code-fallback; раздел «Совместимость с prompt caching» (стабильный SYSTEM, переменные данные в конце user).

---

## Ф1. Главная директора `/dashboard`: 29 → первый экран ≤7 «Польза»

> **Зависимости от ТЗ-1:** Ф1 (виджет идей читает `IdeasService.getTop`, ТЗ-1 Ф4.A) · Ф5 (метрика чата читает `GET /chat-v2/usage-stats`, ТЗ-1 Ф5) · Ф0 (доставка не нужна для экрана). Если ТЗ-1 ещё не выкачен — виджет идей и метрика чата рендерят graceful-empty («раздел появится после…»), остальная ревизия Ф1 самодостаточна.

### 1) Что УБРАТЬ (совсем)
- **№28 «Оценка качества» как заглушку — НЕ убирать** (реестр ошибочна, см. Р3). Единственное «убрать совсем» по реестру — **повтор компас-инфо в шапке (№23)**: пустой инфо-дубль «вектор в шапке», смысл переезжает в единый компас (Р2). Удалить рендер №23 из вкладки «Цели».

### 2) Что ПЕРЕНЕСТИ
- **№12 Лента вопросов Коры** → в `/me` (Ф5 этого ТЗ) и в Операции COO (реестр №17 операций — «принимает перенос»). С главной директора убрать.
- **№15 Тепловая карта узких мест** → drill-down/«Спросите Кору».
- **№17 Счётчики сигналов (8 типов)** → drill-down.
- **№18 Активные темы** → drill-down.
- **№19 Горячие сущности** → drill-down.
- **№21 Инсайты-топ (`InsightsTopWidget`)** → в Операции COO (там инсайт-радар уместен; виджет не переделывать — перенести рендер).

> «Drill-down» = вкладка «Знания» сжимается до 3 виджетов, остальные доступны по кнопке «Подробнее»/в разделе «Спросите Кору». Данные и эндпоинты не трогаем — меняется только размещение рендера на фронте.

### 3) Что ОБЪЕДИНИТЬ
- **Единый компас движения к цели (Р2):** №6 компас + №23 компас-инфо + №26 стратегическая согласованность + №27 пульс целей → один виджет `GoalVectorVerdictWidget`. Первичен факт-KR (`goalsTree[].keyResults[].progressPercent`, агрегат); вторичный слой — `strategicAlignment.average` (`cachedAlignment`) с подписью «оценка» (Р7). `goalsPulse` (распределение `progressStatus`) — встроить как мини-разбивку внутри этого виджета, не отдельной карточкой.
- **Единая карточка «Что узнали» (Р4):** №7 темы недели + №8 сигналы недели + №9 решения недели + №16 «что узнали (темы+сигналы)» → один виджет `WhatWeLearnedWidget` (3 секции: темы / сигналы / решения, каждая с колонкой «Причина», Р6). Источник — те же `newThemes`/`newSignals` из `DirectorDashboardService`.

### 4) Что ДОБАВИТЬ + технический спек
- **№30 ➕ Первый экран «Польза» (снятая рутина)** — новый верхний блок `ValueStripWidget`: встреч запротоколировано · задач/решений извлечено · вопросов отвечено памятью · договорённостей удержано.
  - **Backend:** новый агрегатор в `DirectorDashboardService.fetchValueStrip(tenantId, period)` → `DirectorDashboardValueStripDto { meetingsProtocoled, tasksExtracted, decisionsExtracted, questionsAnsweredByMemory, commitmentsKept }`. Источники: `Meeting`+`AiResult` (готовый отчёт), `Task`/`Decision`/`IdeaBlock(signalType=commitment)`, `ChatV2Message(role=assistant, citations непустой)`, `CommitmentReliability`. Все — `count`, без soft-оценок. Включить в `getDirectorView` ответ (доп. поле, non-breaking).
  - **Frontend:** `ValueStripWidget` поверх KPI-hero (первая строка экрана). Парные токены, `CountUp` (есть в `charts/`).
- **№31 ➕ Виджет идей** `IdeasTopWidget` рядом с `InsightsTopWidget` (на вкладке, не на первом экране).
  - **Frontend:** новый `frontend/app/(authenticated)/dashboard/widgets/IdeasTopWidget.tsx` по образцу `InsightsTopWidget.tsx`; SWR на `GET /api/v1/ideas/top?limit=5` (`ideas.api.ts` → `domain/idea` → виджет). **Backend `IdeasService.getTop` + эндпоинт — ТЗ-1 Ф4.A.** До его выката — виджет показывает empty-state.
- **№32 ➕ Метрика чата** `ChatUsageWidget` «спросили / ответили / помогло».
  - **Frontend:** SWR на `GET /api/v1/chat-v2/usage-stats?from=&to=` (**бэкенд — ТЗ-1 Ф5**). `helpedRate` показываем только при `rated≥10`, иначе «мало данных»; `answeredWithCitation` подписываем «ответы с источником», НЕ «дефлекция» (Р7/ТЗ-1 Р6). На вкладке «Знания»/первом экране — по месту (рекомендация: первый экран, рядом с «Пользой»).
- **№33 ➕ Колонка «Причина»** (Р6) к `WhatWeLearnedWidget` (сигналы/решения) и к `Top-1 риск` (№5).
  - **Backend:** в `DirectorDashboardSignalDto`/`newSignals` уже есть `evidenceMeetingId`; добавить `reasonSourceRef { meetingId?, meetingTitle?, decisionId? }` (из первого `IdeaBlockEvidence`). Маппинг в DTO.
  - **Frontend:** колонка/строка «Причина: встреча "…" 12 июня» со ссылкой.
- **№34 (опц.) Здоровье портфеля одной цифрой** — НЕ на первом экране главной; реализуется как отдельный дашборд в **Ф6**. На главной — только если владелец захочет; по умолчанию ссылка-карточка «Открыть портфель целей».

### Изменения схемы
Нет (Ф1 — только перекомпоновка + новые DTO-поля, считаемые из существующих таблиц).

### Метрики
- `dashboard_value_strip_served_total` · `dashboard_main_first_screen_widget_count` (gauge, для контроля ≤7).

### Флаги
- `dashboard.main_rework.enabled` — 🔴 A (kill-switch ON): новая компоновка главной (единый компас + «Что узнали» + «Польза» + переносы). Откат рубильником возвращает старый рендер. Строка в feature-flags.md.

### DoD
- [ ] Первый экран главной рендерит ровно 7 величин: Польза · Настроение · Обещания · Висящие решения · Компас(факт) · AI-сводка · Top-1 риск.
- [ ] Единый компас показывает факт-KR первично, `cachedAlignment` вторично с подписью «оценка»; №23/№26/№27 больше не рендерятся отдельно.
- [ ] `WhatWeLearnedWidget` объединил темы/сигналы/решения; у сигналов/решений есть колонка «Причина» со ссылкой на встречу.
- [ ] 6 виджетов «Знаний» убраны с первого экрана (3 остались: повторяющиеся темы, открытые вопросы, скорость ответа); остальные доступны в drill-down.
- [ ] Лента вопросов Коры убрана с главной (переехала в `/me` + Операции).
- [ ] `ValueStripWidget` показывает 5 твёрдых счётчиков; виджет идей и метрика чата рендерятся (или graceful-empty при отсутствии ТЗ-1).
- [ ] `QualityScoreWidget` НЕ удалён, подписан «оценка».
- [ ] typecheck + lint + build (frontend и backend) зелёные.
- [ ] Строка в feature-flags.md.

### Prod-шаги
- Миграций нет. `seed-admin-setting-dashboard-main.ts` (флаг `dashboard.main_rework.enabled=true`) — STEPS phase `seed-base`.
- prod-deploy-log Шаг 1 (флаг), Шаг 12 (smoke: `GET /api/v1/dashboard?period=week` отдаёт `valueStrip`).
- **Зависит от:** ТЗ-1 Ф4.A (идеи), ТЗ-1 Ф5 (чат) — мягко (graceful-empty).

---

## Ф2. Операции COO `/dashboard/operations`: дедуп температуры, реальная capacity, «сколько закрыли»

> **Зависимости от ТЗ-1:** Ф4.D (per-team capacity-агрегат `TeamCapacityService`) · Ф3.A (накопительные блокеры `BlockerSynthesis` + «Причина»). Ф2 этого ТЗ — фронт-витрина поверх их данных + приём переносов.

### 1) Что УБРАТЬ (совсем)
- **Мёртвая «средняя загрузка» (реестр №«мёртвая»)**: НЕ удалять данные `fetchCapacity` (она реальна), а **заменить отображение** «средняя загрузка ≈0» на реальный per-team capacity (см. п.4). Старый per-person `capacityAvgPercent`, выглядящий мёртвым из-за пустого `loadPercent`, с экрана снять — показывать только когда `loadPercent` заполнен; иначе блок «команда»-уровня (Ф4.D).

### 2) Что ПЕРЕНЕСТИ (приём переносов с главной)
- **Принять ленту вопросов Коры** (с главной, №17 операций) — отдельная карточка на COO.
- **Принять инсайты-топ** (`InsightsTopWidget`, №21 главной) — рендер на COO (виджет не переделывать).

### 3) Что ОБЪЕДИНИТЬ
- **Две температуры → один переключатель (реестр №6 операций):** на COO-экране **уже сделано** (`TeamTemperatureSection` имеет `overall ↔ byPerson`). Проверить, что нет второго отдельного блока температуры; если есть остаточный — удалить. На уровне ТЗ это «подтвердить и зачистить остаток», не новая работа.

### 4) Что ДОБАВИТЬ + технический спек
- **№16 ➕ Реальная загрузка команд** (взамен мёртвой средней) — виджет `TeamCapacityWidget`: перегруз/недогруз по командам/отделам + подсказка «перелить».
  - **Backend:** `GET /api/v1/operations/team-capacity` — **ТЗ-1 Ф4.D** (`TeamCapacityService.aggregate`). Здесь — фронт.
  - **Frontend:** `TeamCapacityWidget` (group by department, бар перегруз/недогруз, парные токены). Empty-state, если `loadPercent` нигде не заполнен.
- **№15 ➕ «Сколько Кора помогла закрыть»** — зеркало к блокерам/конфликтам: рядом с «активные блокеры N» показать «закрыто за период M».
  - **Backend:** расширить `OperationsDashboardOverviewDto` полями `blockersResolvedCount`, `frictionsResolvedCount` (из `BlockerSynthesis(status=resolved)` ТЗ-1 Ф3.A и `EntityLink(relationType=conflicted_with, status≠active/resolved)`). Если ТЗ-1 Ф3.A не выкачен — `blockersResolvedCount=null` → UI скрывает зеркало.
  - **Frontend:** под каждым «список проблем»-KPI — подпись «закрыто M».
- **№13 ➡️ Свежие блокеры → накопительные + колонка «Причина»** — заменить `topRecentBlockers` (1-дневный срез) на хронические из `BlockerSynthesis` (статус `new/recurring N days/resolved`, `daysOpen`, «Причина»).
  - **Backend:** `GET /api/v1/operations/blockers/chronic` — **ТЗ-1 Ф3.A**. Здесь — фронт: карточка «Хронические блокеры» с `daysOpen` и колонкой «Причина».
- **№10 ➡️ Зрелость подписать «оценка»** (Р7): к `maturity.score` добавить плашку «оценка», знаменатель (доменов посчитано N).

### Изменения схемы
Нет (Ф2 — фронт + расширение DTO существующего overview; новые таблицы — в ТЗ-1).

### Метрики
- `coo_blockers_resolved_total` · `coo_team_capacity_widget_served_total`.

### Флаги
- `operations.dashboard_rework.enabled` — 🔴 A (ON): новая раскладка COO (capacity-команд, «сколько закрыли», хронические блокеры, приём переносов). Строка в feature-flags.md.

### DoD
- [ ] На COO одна секция температуры с переключателем (остаток второго блока, если был, удалён).
- [ ] Мёртвая «средняя загрузка» с экрана снята; вместо неё `TeamCapacityWidget` (или empty-state до ТЗ-1 Ф4.D).
- [ ] «Сколько закрыли» рендерится рядом с блокерами/конфликтами (или скрыто до ТЗ-1 Ф3.A).
- [ ] Свежие блокеры заменены накопительными с `daysOpen` и колонкой «Причина» (или fallback на старый срез до ТЗ-1 Ф3.A).
- [ ] Зрелость подписана «оценка» + знаменатель.
- [ ] Лента вопросов Коры и инсайты-топ приняты на COO.
- [ ] typecheck + lint + build зелёные. Строка в feature-flags.md.

### Prod-шаги
- Миграций нет. `seed-admin-setting-operations-dashboard.ts` (флаг) — STEPS `seed-base`.
- prod-deploy-log Шаг 1 (флаг), Шаг 12 (smoke: overview содержит `blockersResolvedCount`).
- **Зависит от:** ТЗ-1 Ф4.D, ТЗ-1 Ф3.A (оба мягко — graceful-fallback).

---

## Ф3. Дайджесты (дневной/недельный): idea-секция, ось динамики, доставка daily в Telegram

> **Зависимости от ТЗ-1:** Ф0 (включение Telegram-доставки daily — `operations.daily_digest.deliver_to_telegram=true`, реализуется в ТЗ-1 Ф0). Здесь — состав дайджеста.

### Дневная сводка `/dashboard/operations/daily`

#### 1) Что УБРАТЬ
- **`whoShined` (№6 дневной) — НЕ трогать** (реализован, `daily-digest.service.ts:835+`, зелёный spec). Реестровое «убрать совсем №6» относилось к мнимо-пустому массиву — это type-safe дефолт до `enrichDto`, а не заглушка. **Оставить как есть.**

#### 2) Что ПЕРЕНЕСТИ
- Ничего.

#### 3) Что ОБЪЕДИНИТЬ
- Ничего.

#### 4) Что ДОБАВИТЬ
- **№3 ➡️ Блокеры → накопительные** (вчера/позавчера, решён/повторяется N дней) — рендер из `BlockerSynthesis` (ТЗ-1 Ф3.A) вместо 1-дневного среза `daily-digest.service.ts:346-359`. 1-дневный срез оставить для дайджеста, «хронические» брать из синтеза. Здесь — секция «Хронические блокеры» в теле дайджеста.
- **🔧 Доставка daily в Telegram** — это не виджет, а канал. Включение `operations.daily_digest.deliver_to_telegram=true` — **ТЗ-1 Ф0** (Механизм 2, AdminSetting-гейт в `operations-daily-digest.cron.ts:71-79`). Здесь только зафиксировать как зависимость и проверить рендер дайджеста в Telegram-формате.

### Недельная сводка `/dashboard/operations/weekly`

#### Что ДОБАВИТЬ
- **№7 ➕ Секция идей** в недельный дайджест (сейчас агрегируются только инсайты). Источник — `IdeasService.getTop` (ТЗ-1 Ф4.A) / `Idea(status∈captured…shipped)` за неделю.
  - **Backend:** расширить генератор недельного дайджеста секцией `ideas` (топ-N по `weight`+`lastDiscussedAt`). Если ТЗ-1 Ф4.A не выкачен — секция пустая/скрыта.
- **№8 ➕ Ось «что изменилось к прошлой неделе»** — для каждой секции (температура/блокеры/инсайты/идеи) дельта к предыдущей неделе (рост/спад/новые/закрытые).
  - **Backend:** в недельном агрегаторе сравнить текущее окно с предыдущим (как `redShareDelta` в `fetchTeamTemperature`), отдать `deltaVsPrevWeek` по секциям. DTO + рендер.

### Изменения схемы
Нет.

### Метрики
- `weekly_digest_ideas_section_served_total` · `daily_digest_chronic_blockers_served_total`.

### Флаги
- Доставка daily — флаг `operations.daily_digest.deliver_to_telegram` (перевод ⚪ Долг → 🔴 A ON) **в ТЗ-1 Ф0**, здесь не дублировать. Новых флагов Ф3 не вводит (состав дайджеста — не за флагом, kill-switch на новые секции не нужен — деградируют в пусто).

### DoD
- [ ] `whoShined` в дневной сводке не тронут.
- [ ] Дневная сводка показывает накопительные блокеры (или fallback на 1-дневный срез до ТЗ-1 Ф3.A); daily уходит в Telegram (после ТЗ-1 Ф0).
- [ ] Недельная сводка содержит секцию идей и ось «что изменилось к прошлой неделе» (дельта по секциям).
- [ ] typecheck + lint + build зелёные.

### Prod-шаги
- Миграций нет. prod-deploy-log Шаг 12 (smoke: недельный дайджест содержит `ideas` и `deltaVsPrevWeek`).
- **Зависит от:** ТЗ-1 Ф0 (доставка), ТЗ-1 Ф3.A (хронические блокеры), ТЗ-1 Ф4.A (идеи) — мягко.

---

## Ф4. План-факт по людям `/dashboard/operations/weekly/per-person`: «без ответа», дедуп, self-view

> **Зависимости от ТЗ-1:** Ф3.D (фикс `recipient→author` в `goal-vector-tracker.cron.ts` — **там**, не здесь; per-person уже на author). Здесь — три добавки к экрану.

### 1) Что УБРАТЬ
- Ничего из состава (3 виджета — топ «держат слово», топ «зоны риска», таблица — оставить, реестр §5 ✅).

### 2) Что ПЕРЕНЕСТИ
- Ничего.

### 3) Что ОБЪЕДИНИТЬ
- Ничего.

### 4) Что ДОБАВИТЬ + технический спек
- **№4 ➕ Колонка «без ответа»** — не выдавать 100% надёжности при малом знаменателе.
  - **Backend (`weekly-per-person.service.ts`):** `calcReliability` уже отдаёт `null` при `denom=0` (R8). Добавить в `PersonAcc`/`WeeklyPersonRowDto` поле `promisesNoAnswer` (`commitmentStatus='asked'` без реакции) и **не показывать %** при `denom < N` (`AdminSetting reliability.min_denominator`, default 3 — общий с ТЗ-1 Ф3.D.2) — вместо процента «мало данных».
  - **Frontend:** колонка «Без ответа» в таблице; вместо `reliabilityPercent` при малом знаменателе — бейдж «мало данных».
- **🔧 Дедуп 3 источников** — обещания + задачи + чек-ины могут двоить «выполнено».
  - **Backend:** при сборке строки исключать двойной учёт одного и того же артефакта (обещание, ставшее задачей; задача, закрытая через чек-ин). Дедуп-ключ — `sourceBlockId`/`taskId`/`commitmentId`. Тот же класс дедупа, что в ТЗ-1 Ф2 (`PersonalDailyBriefService`). Покрыть unit-тестом.
- **№5 ➕ Личный self-view рядовому** — сотрудник видит свой план-факт (не только руководитель).
  - **Backend:** `GET /api/v1/me/weekly-per-person?weekStart=` (self-scope по `Person.userId`) — возвращает **только свою строку** + стрелку к цели команды. RBAC открыть только self (Р8/ТЗ-1 Р8), не операционные данные.
  - **Frontend:** мини-виджет в `/me` (Ф5 этого ТЗ) — «Мой план-факт за неделю».

### Изменения схемы
Нет (новые поля DTO считаются из существующих).

### Метрики
- `weekly_per_person_no_answer_total` · `weekly_per_person_self_view_served_total`.

### Флаги
- `operations.per_person_self_view.enabled` — 🔴 A (ON): self-view рядовому. Строка в feature-flags.md.

### DoD
- [ ] Колонка «без ответа» считается; при `denom < N` показывается «мало данных», не 100%.
- [ ] Дедуп: обещание-ставшее-задачей не считается дважды (unit-тест).
- [ ] `GET /me/weekly-per-person` отдаёт только свою строку; чужие не видны.
- [ ] Фикс `recipient→author` НЕ дублируется здесь (отмечено как зависимость ТЗ-1 Ф3.D).
- [ ] typecheck + lint + build зелёные. Строка в feature-flags.md.

### Prod-шаги
- Миграций нет. `seed-admin-setting-per-person.ts` (флаг self-view; `reliability.min_denominator` — общий с ТЗ-1) — STEPS `seed-base` (или переиспользовать seed ТЗ-1).
- prod-deploy-log Шаг 1 (флаг), Шаг 12 (smoke: `/me/weekly-per-person`).
- **Зависит от:** ТЗ-1 Ф3.D (фикс вектора — независимо).

---

## Ф5. `/me` рядового (5 → 9): фронт-виджеты ежедневной ценности

> **РАЗГРАНИЧЕНИЕ С ТЗ-1 (Р10):** бэкенд метрики чата (поле `helpful` на `ChatV2Message` + `POST /chat-v2/messages/:id/feedback` + агрегатор `getChatUsageStats` с type-guard `jsonb_typeof(citations)='array'`) реализуется в **ТЗ-1 Ф5**. Бриф рядового (`PersonalDailyBrief`), доставка, бюджет — **ТЗ-1 Ф2/Ф0**. **В этом ТЗ Ф5 — ТОЛЬКО фронт-виджеты `/me`**, потребляющие готовые эндпоинты. Если соответствующий бэкенд ТЗ-1 не выкачен — виджет рендерит empty-state.

### 1) Что УБРАТЬ
- Ничего (реестр §8 ✅ все 5 подстраниц оставить).

### 2) Что ПЕРЕНЕСТИ (приём)
- **№12 Лента вопросов Коры** с главной директора → частично в `/me` (вопросы Коры ко мне). Уже есть подстраница «вопросы Коры ко мне» — усилить приёмом персональных вопросов.

### 3) Что ОБЪЕДИНИТЬ
- Ничего.

### 4) Что ДОБАВИТЬ + технический спек (4 новых виджета)
- **№6 ➕ «Память помогла тебе K раз»** — счётчик пользы чата.
  - **Frontend:** `MemoryHelpedMeWidget` в `/me`; SWR на `GET /api/v1/chat-v2/usage-stats?from=&to=&scope=self` (**бэкенд — ТЗ-1 Ф5**). Показывать `helpedUp`/`answeredWithCitation` для своих диалогов; при `rated<10` — без %. Кнопка «палец вверх/вниз» на ответах чата (`POST /chat-v2/messages/:id/feedback` — ТЗ-1 Ф5).
- **№7 ➕ Мой план-факт + стрелка к цели команды.**
  - **Frontend:** `MyWeeklyPlanFactWidget`; SWR на `GET /api/v1/me/weekly-per-person` (**бэкенд — Ф4 этого ТЗ**). Self-scope, стрелка вверх/вниз к цели.
- **№8 ➕ Судьба моих идей.**
  - **Frontend:** `MyIdeasFateWidget`; SWR на `GET /api/v1/me/ideas` (идеи, где `createdByUserId = me`, со `status`). **Бэкенд эндпоинт `/me/ideas`** — добавить здесь (тонкий self-фильтр поверх `Idea`), т.к. это чистый self-scope (не входит в ТЗ-1 Ф4.A `getTop`). Уведомление о смене статуса — ТЗ-1 Ф4.A.
- **№9 ➕ Доставка признаний** — сейчас «спасибо» пишутся приватно в базу и до человека не доходят.
  - **Frontend:** `RecognitionInboxWidget` в `/me`; SWR на `GET /api/v1/me/recognitions` (полученные признания). **Бэкенд `/me/recognitions`** — добавить здесь (self-фильтр поверх существующей recognition-модели, которую агрегирует `whoShined`). Доставка push-признаний — через бюджет ТЗ-1 Ф0 (опционально), но видимость в `/me` — этот виджет.

### Изменения схемы
Нет (все 4 виджета — self-фильтры поверх существующих моделей: `ChatV2Message`, `Idea`, recognition, per-person). Новых полей нет; поле `helpful` — в ТЗ-1.

### REST-эндпоинты (новые в этом ТЗ — тонкие self-обёртки)
- `GET /api/v1/me/ideas` (self) → мои идеи со статусом.
- `GET /api/v1/me/recognitions` (self) → полученные признания.
- (`GET /api/v1/me/weekly-per-person` — определён в Ф4.)
- (`GET /api/v1/chat-v2/usage-stats?scope=self` — определён в ТЗ-1 Ф5.)

> Все — self-scope по `Person.userId`/`createdByUserId`. RBAC не открывать сверх self (Р8).

### Метрики
- `me_dashboard_widget_served_total{widget}` · `me_recognitions_served_total` · `me_ideas_fate_served_total`.

### Флаги
- `me.daily_value_widgets.enabled` — 🔴 A (ON): 4 новых виджета `/me`. Строка в feature-flags.md.

### DoD
- [ ] `/me` показывает 9 поверхностей (5 старых + 4 новых); новые при отсутствии бэкенда ТЗ-1 — graceful-empty.
- [ ] «Память помогла K раз» читает агрегатор ТЗ-1 Ф5 (не дублирует его в этом ТЗ); при `rated<10` без %.
- [ ] Мой план-факт self-scope; судьба идей — только мои; признания — только полученные мной.
- [ ] Разграничение зафиксировано: бэкенд поля `helpful`/эндпоинт оценки/`getChatUsageStats` — НЕ в этом ТЗ.
- [ ] typecheck + lint + build зелёные. Строка в feature-flags.md.

### Prod-шаги
- Миграций нет. `seed-admin-setting-me-widgets.ts` (флаг) — STEPS `seed-base`.
- prod-deploy-log Шаг 1 (флаг), Шаг 12 (smoke: `/me/ideas`, `/me/recognitions`).
- **Зависит от:** ТЗ-1 Ф5 (метрика чата), ТЗ-1 Ф4.A (статусы идей), Ф4 этого ТЗ (per-person self).

---

## Ф6. Новые дашборды: здоровье портфеля целей + value-recap-экран

### Ф6.A — Здоровье портфеля целей одной цифрой

> **Зависимости:** самодостаточна (поверх `Goal`). Опционально мостит «Причину» (Р6).

#### 4) Что ДОБАВИТЬ + технический спек
- **Агрегат здоровья одной цифрой** — `portfolioHealth` (0–100) поверх `Goal.progressStatus` + KR-прогресса.
  - **Шкала (AdminSetting `portfolio.health.*`):** ≥60 здоров · 40–59 тревога · <40 критично.
  - **Donut статусов** — распределение по `progressStatus` (on_track/at_risk/stalled/achieved/dropped) — `MiniDonut` (есть в `charts/`).
  - **Разрез по приоритету MoSCoW** с % выполнения — **новое поле `Goal.priority`** (Р9).
  - **Колонка «Причина»** (Р6) у каждой строки — ссылка на встречу/решение из `sourceBlockIds`/`IdeaBlockEvidence`.
  - **Недельный снапшот** для сравнения «неделя к неделе».

#### Изменения схемы (миграция `goal_priority_moscow`)
- **enum `GoalPriority`** (`must | should | could | wont`) — по образцу `GoalProgressStatus`.
- **`Goal`** += `priority GoalPriority?` (nullable, non-destructive; NULL = «не приоритизировано»).
- **`PortfolioHealthSnapshot`** (недельный снимок для дельты): `id`, `tenantId`, `dateLocal String @db.VarChar(10)`, `healthScore Int`, `byStatusJson Json` (распределение по `progressStatus`), `byPriorityJson Json` (% выполнения по MoSCoW), `goalsCount Int`, `snapshotAt DateTime @default(now())`. `@@unique([tenantId, dateLocal])`, `@@index([tenantId, snapshotAt(sort: Desc)])`.

#### Сервисы / cron
- **`PortfolioHealthService.compute({ tenantId })`** — активные живые `Goal` (как `fetchGoalsPulse`/`fetchGoalsTree`: `status='active'`, `promotionState='active'`, `validUntil=null`, `archivedAt=null`); `healthScore` = взвешенная функция доли on_track/achieved минус штраф за stalled/dropped (формула + веса — AdminSetting); `byStatus`, `byPriority` (% выполнения = доля achieved в каждой MoSCoW-группе); upsert `PortfolioHealthSnapshot` (для дельты).
- **`PortfolioHealthSnapshotCron`** (`@Cron('0 5 * * 1')` — понедельник, недельный снимок).

#### REST-эндпоинты
- `GET /api/v1/operations/portfolio-health` (owner/admin/coo) → `{ healthScore, scale, byStatus, byPriority, rows[{ goalId, name, progressStatus, priority, reason }], deltaVsPrevWeek }`.
- `PATCH /api/v1/goals/:id/priority` (owner/admin) → выставить MoSCoW (решение владельца по приоритету — обычный CRUD, не флаг).

#### Frontend
- Новый дашборд `/dashboard/portfolio` (route в `(authenticated)/dashboard/`): большая цифра здоровья + шкала-светофор + `MiniDonut` статусов + таблица MoSCoW с % + колонка «Причина». Парные токены для светофора (`bg-success/text-success-fg` и т.д.).

#### Метрики
- `portfolio_health_score` (gauge) · `portfolio_health_snapshot_total` · `portfolio_priority_set_total{priority}`.

#### Флаги
- `operations.portfolio_health.enabled` — 🔴 A (ON). Строка в feature-flags.md.

### Ф6.B — Value-recap-экран («Что Кора сделала за месяц»)

> **РАЗГРАНИЧЕНИЕ С ТЗ-1:** агрегатор `ValueRecapService.build`, `ValueRecapSnapshot`, `GET /operations/value-recap`, push-доставка, экспорт-эндпоинт — **ТЗ-1 Ф5**. В этом ТЗ Ф6.B — **фронт-экран drill-down** поверх готового снапшота + расширение существующего `Export` (с meeting на dashboard) для экспорта в слайды/PDF.

#### 4) Что ДОБАВИТЬ
- **Экран `/dashboard/value-recap`** — drill-down месячного recap: ведущая ось «снятая рутина» (твёрдые счётчики), второй слой «команда лучше» (soft с плашкой «оценка» + знаменателем, Р7). Только твёрдые данные (ТЗ-1 Р6: без часы×ставка=₽, без «до Коры», без `medianHoursToAnswer`).
  - **Frontend:** SWR на `GET /api/v1/operations/value-recap?period=YYYY-MM` (**бэкенд — ТЗ-1 Ф5**).
- **Экспорт в слайды/PDF** — расширить существующий `Export` (сейчас scope=meeting) на `scope=dashboard`/`value_recap`.
  - **Backend (картография при реализации):** найти текущий Export-модуль (экспорт отчёта встречи); добавить `dashboard`/`value_recap` как source. Эндпоинт `GET /api/v1/operations/value-recap/:id/export?format=slides|pdf` определён в ТЗ-1 Ф5 — здесь подключить генератор слайдов/PDF к dashboard-данным. **Если Export-модуль meeting-only и расширение нетривиально — задокументировать в реестр не-сделанного и отдать PDF-экспорт минимально (печатная вёрстка экрана).**

#### Изменения схемы
Нет в Ф6.B (снапшот — в ТЗ-1; расширение Export — поле `sourceType` если требуется, проверить при картографии, предпочесть без миграции).

#### Метрики
- `value_recap_screen_served_total` · `value_recap_export_total{format}`.

#### Флаги
- `operations.value_recap_export.enabled` — 🔴 A (ON): экспорт recap в слайды/PDF. Строка в feature-flags.md (сам recap — флаг ТЗ-1 Ф5).

### DoD (Ф6)
- [ ] `/dashboard/portfolio`: одна цифра здоровья + шкала ≥60/40-59/<40 + donut статусов + таблица MoSCoW с % + колонка «Причина».
- [ ] Миграция `goal_priority_moscow` (enum + `Goal.priority` + `PortfolioHealthSnapshot`) применяется; `PATCH /goals/:id/priority` работает; недельный снапшот пишется.
- [ ] `/dashboard/value-recap` рендерит recap из ТЗ-1 Ф5 (или empty-state до выката); экспорт в слайды/PDF формируется (или минимальный PDF + строка в реестре не-сделанного).
- [ ] Разграничение зафиксировано: агрегатор/снапшот/push value-recap — НЕ в этом ТЗ.
- [ ] typecheck + lint + build зелёные. Строки в feature-flags.md.

### Prod-шаги (Ф6)
- Миграция `goal_priority_moscow` (авто `migrate deploy`).
- `seed-admin-setting-portfolio-health.ts` (шкала, веса healthScore, флаги) — STEPS `seed-base`.
- prod-deploy-log Шаг 4 (модель `PortfolioHealthSnapshot` + enum `GoalPriority` + поле `Goal.priority`), Шаг 7 (seed), Шаг 12 (smoke: cron `PortfolioHealthSnapshotCron`, эндпоинты `/operations/portfolio-health`, `/goals/:id/priority`, `/dashboard/portfolio`, `/dashboard/value-recap`).
- **Зависит от:** ТЗ-1 Ф5 (value-recap-агрегатор) — для Ф6.B; Ф6.A независима.

---

## Итог по числам (по каждому дашборду)

| Дашборд | Было | Осталось | Перенесено | Объединено | Убрано совсем | Добавлено | После ревизии |
|---|---|---|---|---|---|---|---|
| **Главная директора** `/dashboard` | 29 | 16 | 6 (№12,15,17,18,19,21) | 6 (№8,9,16→№7; №23,26,27→№6) | 1 (№23 повтор; №28 **НЕ** убрана — ошибка реестра) | 4 (Польза №30, идеи №31, чат №32, «Причина» №33) | **20** (первый экран **7**) |
| **Операции COO** `/dashboard/operations` | 14 (+1 мёртвая) | 11 | — (принял 2: лента вопросов, инсайты) | 1 (№6 темп. — уже сделано) | 1 (мёртвая средняя загрузка → команд-capacity) | 2 (№15 «закрыли», №16 capacity команд) | **~13** |
| **Дневная сводка** `/dashboard/operations/daily` | 7 | 6 (вкл. `whoShined` — **не тронут**) | — | — | 0 (№6 **НЕ** убрана — реализована) | 0 (доставка daily в Telegram — ТЗ-1 Ф0) | **6** |
| **Недельная сводка** `/dashboard/operations/weekly` | 6 | 6 | — | — | 0 | 2 (№7 идеи, №8 ось динамики) | **8** |
| **План-факт по людям** `/.../weekly/per-person` | 3 | 3 | — | — | 0 | 2 (№4 «без ответа», №5 self-view) + дедуп | **5** |
| **People-at-risk** `/dashboard/people-at-risk` | 4 | 4 | — | — | 0 | 0 (рамка/подпись «оценка») | **4** |
| **Pulse-паттерны** (движок) | 7 | 7 | — | — | 0 | 0 (убран двойной рендер 3 из них) | **7 движок** |
| **`/me` рядовой** | 5 | 5 | принял 1 (лента вопросов) | — | 0 | 4 (память №6, план-факт №7, идеи №8, признания №9) | **9** (растёт) |
| **Новые дашборды** | 0 | — | — | — | — | 2 (портфель-здоровье Ф6.A, value-recap-экран Ф6.B) | **+2** |

**Поправки к реестру (по верификации кода):** №28 «Оценка качества» — **не заглушка, не убирать** (`QualityScoreWidget` реализован); №6 дневной `whoShined` — **не убирать** (реализован, не пустая заглушка); объединение двух температур COO (№6 операций) — **уже сделано** на фронте (`TeamTemperatureSection` toggle); фикс `recipient→author` — **в `goal-vector-tracker.cron.ts`**, а per-person уже на author (фикс в ТЗ-1 Ф3.D).

---

## Порядок реализации (волны)

| Волна | Фаза | Почему | Зависимость от ТЗ-1 |
|---|---|---|---|
| **W1** | **Ф1** (главная директора) | Самый грубый перегруз (29→7); ядро ревизии; почти всё самодостаточно (переносы/объединения). | мягко: Ф4.A (идеи), Ф5 (чат) — graceful-empty |
| **W2** | **Ф4** (план-факт по людям) | Дешёвые точечные добавки + дедуп; чинит честность цифры. | Ф3.D (фикс вектора — независимо) |
| **W3** | **Ф2** (Операции COO) | Витрина поверх данных ТЗ-1; приём переносов с Ф1. | Ф4.D (capacity), Ф3.A (блокеры) — graceful-fallback |
| **W4** | **Ф3** (дайджесты) | Состав дайджестов поверх блокеров/идей/доставки ТЗ-1. | Ф0 (доставка), Ф3.A, Ф4.A |
| **W5** | **Ф5** (`/me` рядовой) | Фронт-наполнение поверх бэкенда ТЗ-1 Ф2/Ф5 + Ф4 этого ТЗ. | Ф5 (чат), Ф4.A (идеи), Ф0 (доставка) |
| **W6** | **Ф6** (новые дашборды) | Портфель самодостаточен (Ф6.A); value-recap-экран последним (поверх ТЗ-1 Ф5). | Ф6.B зависит от ТЗ-1 Ф5 |

> Каждая фаза самодостаточна (tz-orchestrator берёт по одной); зависимости от ТЗ-1 деградируют в graceful-empty/fallback, поэтому ТЗ-2 можно начинать параллельно ТЗ-1, не дожидаясь его полного выката. Жёсткий порядок только внутри: Ф1 даёт переносы, которые принимают Ф2 и Ф5.

---

## Реестр не-сделанного (добавить при старте реализации)

В `second-brain/04_не-сделано/README.md`:
- Экспорт value-recap в слайды/PDF (Ф6.B) — если Export-модуль meeting-only и расширение на dashboard нетривиально: отдать минимальный PDF (печатная вёрстка), полноценный слайд-экспорт — отдельной строкой. Кто разблокирует: владелец/решение по формату защиты.
- Per-person capacity per-person `loadPercent` почти не заполнен в проде (Ф2) — реальная загрузка появится, когда `Appointment.loadPercent` начнёт наполняться источником; до этого `TeamCapacityWidget` в empty-state.

---

## Итог

Реализовано целиком: **нет** (это контракт, не код). ТЗ-2 проводит ревизию информации на всех дашбордах по реестру-числам: главная худеет 29→7 (первый экран), `/me` растёт 5→9, COO дедуплицируется и поворачивается к «что закрыли», дайджесты получают идеи/динамику/доставку, план-факт честнеет («без ответа»+дедуп+self-view), добавляются два новых дашборда (портфель-здоровье с MoSCoW-полем + value-recap-экран). **Ключевые поправки верификации:** `QualityScoreWidget`, `whoShined`, `InsightsTopWidget`, `narrativeSummary` уже реализованы — не переделываются; объединение двух температур COO уже сделано; фикс recipient→author — в goal-vector (ТЗ-1), а не в per-person. Жёсткое разграничение с ТЗ-1: весь бэкенд-движок (агенты, доставка, бюджет, поле `helpful`, value-recap-агрегатор) — в ТЗ-1; здесь — состав экранов, перекомпоновка, новые DTO-поля из существующих таблиц, фронт-виджеты и два новых поля БД (`Goal.priority` + `PortfolioHealthSnapshot`). Развилки владельца закрыты разделом «Принятые решения».
