---
type: tz
status: ready-to-implement
feature: dashboards-redesign-completion-full-dataviz
date: 2026-06-09
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md
  - plans/analysis/2026-06-09-dashboards-redesign-rollout-status.md
  - plans/analysis/2026-06-08-dashboards-design-audit/README.md
---
> Анализ статуса раскатки: `plans/analysis/2026-06-09-dashboards-redesign-rollout-status.md` · Базовое ТЗ языка (Ф1 фундамент уже сделан): `plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md` · Статус согласования развилок: 2026-06-09 (владелец).

# ТЗ: Доводка редизайна дашбордов до полного нового языка + максимум дата-виз

## Принцип

Привести ВСЕ частично-/не-мигрированные дашборды Коры к единому современному языку (стекло + градиенты + recharts, эталон `/redesign`) — так, чтобы **не осталось ни одной старой плоской `shadcn`-карточки на новом фоне**. Глубина дата-виз — **максимальная**: списки → таблицы/диаграммы, числа → KPI-карточки со спарклайнами, доли → пончики, тренды → area/bar. Недостающие временные ряды **добавляем на бэке** там, где это реальные данные (а не выдумка). Тема — только тёмная (светлая = Ф5 базового ТЗ, не здесь). Язык интерфейса — только русский. Ship-On: каждый экран выкатывается включённым, без флагов OFF.

**При расхождении источников приоритет: реальный код > этот анализ > базовое ТЗ.**

## Цель и зачем

**Болезненное состояние (по факту кода, см. анализ 2026-06-09):** новый фон (`MODERN_PAGE_BG`) накатан почти на все дашборды, но карточки мигрировали выборочно. Итог — «новые градиентные страницы со старыми плоскими карточками», что выглядит как недоделанный редизайн. Худший случай — `/dashboard/operations`: фон новый, а внутри 7 старых `KpiHero` + ~10 плоских `shadcn`-`Card`; `/me` вообще без нового фона.

**Чем решение лучше:** единый визуальный словарь на всех экранах из уже готовой библиотеки `frontend/src/ui/components/dashboard/modern/*` (Ф1 базового ТЗ закрыт — 15 компонентов готовы) + точечное обогащение бэка трендами для hero-графиков. Эталоны «как правильно» уже в проде: `/dashboard/portfolio` и `/dashboard/value-recap` (мигрированы полностью).

## REALITY-CHECK (что есть / мертво / сломано по факту)

| Объект | Факт | Вывод для ТЗ |
|---|---|---|
| `frontend/src/ui/components/dashboard/modern/*` (15 файлов) | ✅ ГОТОВО (Ф1 базового ТЗ). API см. «Шпаргалку компонентов» ниже | Не пересоздавать. Расширяем только `StatCard` (Ф0) |
| `/dashboard/portfolio`, `/dashboard/value-recap`, `/goals`, `/maturity`, `/actions` | ✅ Полностью на новом языке | **Эталоны паттернов. НЕ трогать.** `PortfolioDashboardClient.tsx` — образец page-shell + Gauge/Donut/ModernTable |
| `/dashboard/operations` (`OperationsDashboardClient.tsx`) | ⚠️ Только фон; 7×`KpiHero` (стр. 156–211) + ~10 `bg-bg-card`-секций; `modern` импортирован, но используется лишь `MODERN_PAGE_BG` | Ф2 — крупная миграция |
| `/me` (`MeClient.tsx`) | ⚠️ Нет нового фона (обёртка `mx-auto max-w-4xl`, стр. 110); верх — 3 `shadcn`-`Card`; низ (`DailyValueSection`, стр. 145) — 4 готовых glass-виджета | Ф3 |
| `/dashboard` (`DirectorDashboardClient.tsx`) | ⚠️ Фон + часть виджетов новые; KPI-строка `KpiHero` (стр. 365–392, 456–483), inline AI-сводка (стр. 496–506), виджеты табов (`SignalCounters/ActiveThemes/HotEntities/OpenQuestions`, стр. 902+) — старые `shadcn`-`Card` | Ф4 |
| `/dashboard/operations/daily` (`DailyDigestClient.tsx`) | ⚠️ Фон + 1 glass-секция (`ChronicBlockersSection`, стр. 632); ещё ~14 старых секций | Ф5 |
| `/dashboard/operations/weekly` (`WeeklyDigestClient.tsx`) | ⚠️ Фон + 1 glass-секция (`IdeasSection`, стр. 613); ещё ~13 старых секций | Ф6 |
| `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` | 🪦 Мёртвый код — не импортируется ни одним `page.tsx` (роутинг через `DashboardRouter` → `DirectorDashboardClient` / редирект на `/me`) | Ф7 — удалить |
| `KpiHero` (`src/ui/components/shared/KpiHero.tsx`) | Используется ещё в `/teams/[id]`, `/persons/[id]/pulse`, `KnowledgeVelocityKpi` (вне периметра) | **НЕ удалять.** Заменяем на `StatCard` только в Director+Operations |
| Директорские KPI sparkline | ✅ Бэк уже отдаёт `sparkline12w` (sentiment/commitment/hanging) | Доп. бэк для Director НЕ нужен |
| Operations overview | `BlockerSynthesis.createdAt`, `EntityLink.createdAt` дают реальный недельный инфлоу-ряд | Ф1 — добавить 2 ряда |
| kill-switch `reworkEnabled` (operations), `mainReworkEnabled` (director) | OFF-ветки = legacy-раскладка (аварийный откат) | Владелец Р2: **OFF-ветки не трогаем**, мигрируем только ON (default) |

## Принятые решения владельца (2026-06-09, не пересматривать)

| # | Решение | Значение | Обоснование |
|---|---|---|---|
| Р1 | Глубина дата-виз | **Максимум графиков как на `/redesign`**, включая добавление недостающих рядов на бэке там, где это реальные данные | Владелец выбрал «максимум» в батч-вопросе 2026-06-09 |
| Р2 | Легаси-код | Удалить мёртвый `DashboardClient.tsx`; OFF-ветки kill-switch (`reworkEnabled`/`mainReworkEnabled`) НЕ трогать — мигрировать только ON-раскладку | Владелец выбрал «удалить мёртвое, kill-switch не трогать». Kill-switch ON = разрешённый тип флага (CLAUDE.md §8) |
| Р3 | Тема | Только тёмная. Светлая = Ф5 базового ТЗ (отдельно) | Базовое ТЗ, ждём референсы владельца |

## Доказательство выбора (2 прохода + challenge-loop)

**Развилка: как добавлять временные ряды на бэке.**

| Критерий | A: расширить per-screen эндпоинты (выбран) | B: новый generic `/dashboard/trends?metric=` |
|---|---|---|
| Связность с кодом | ✓ каждый сервис уже агрегирует своё (паттерн `buildSparkline`) | ✗ новый сквозной слой, дублирует агрегацию |
| Риск/scope | ✓ ограничен 2 рядами в 1 эндпоинте | ✗ новая абстракция ради 2-4 рядов = код ради кода |
| Кэш | ✓ переиспользуем Redis-кэш существующих сервисов | ⚠ новый кэш-слой |
| RBAC/tenant | ✓ guard эндпоинта уже есть | ✗ новый guard |
| Time-to-value | ✓ инкрементально по экранам | ✗ сначала надо построить generic-слой |

Выбран **A**. Challenge-loop: (1) корень «частично» — выборочная миграция КАРТОЧЕК, не фон → основная работа фронтовая, ряды — обогащение ✓; (2) эффективнее — переиспользуем `buildSparkline`, без новой абстракции ✓; (3) не код ради кода — generic-эндпоинт под 2 ряда избыточен, вынесен в vNext, если рядов станет >8 ✓.

**Развилка: судьба KPI-компонента.** `StatCard` (glass) требует обязательные `spark/delta/up`; у Operations временных рядов части KPI нет. `KpiHero` живёт ещё в `/teams` и `/persons/pulse`. Решение Б2 (см. ниже): расширить `StatCard` (опциональные `spark/delta/up` + `href`), `KpiHero` оставить для его внешних потребителей. Альтернатива «перекрасить `KpiHero` под стекло» отвергнута — сломает его вид в `/teams`/`/persons` (общий компонент), плодит расхождение.

## Архитектурные решения (Б)

| # | Решение | Обоснование (почему) |
|---|---|---|
| Б1 | Новые ряды — расширением существующих per-screen эндпоинтов по паттерну `SentimentIndexService.buildSparkline` ([sentiment-index.service.ts:147](../../backend/src/modules/dashboard/services/sentiment-index.service.ts#L147)). Generic-эндпоинт — vNext | Связность + минимальный риск (см. таблицу выше) |
| Б2 | Расширить `StatCard`: `spark?`, `delta?`, `up?` опциональны, добавить `href?` (оборачивает в `next/link`). Добавить хелпер `kpiTone(value, threshold)` в `modern/tokens.ts` (возвращает цвет из `CHART`). `KpiHero` НЕ удалять | Единый glass-KPI на дашбордах; без выдуманных спарклайнов; без мёртвого кода (`KpiHero` нужен `/teams`,`/persons`) |
| Б3 | Вынести page-shell в `modern/`: `ModernPageShell({title, subtitle?, headerRight?, maxWidth?, children})` (фон `MODERN_PAGE_BG` + контейнер + glass-header). Образец разметки — `PortfolioDashboardClient.tsx:74-84` | DRY на 5 экранах, гарантия одинаковых фон+шапка; устраняет класс «забыли фон» (как в `/me`) |
| Б4 | Operations overview: добавить `weeklyInflow: { blockers: (number\|null)[]; frictions: (number\|null)[] }` (12 точек, `old→new`, `null`=нет данных — конвенция как `sparkline12w`) | Реальный инфлоу-ряд из `createdAt`; кормит hero-`AreaTrend` «операционная нагрузка» + спарклайны `StatCard`. Не выдумываем point-in-time ряды |
| Б5 | KPI без своего ряда рендерим `StatCard` БЕЗ `spark` (опционален после Б2) — не подсовываем фейковые точки | Честность данных (`feedback`: «sparkline не выдумываем», OperationsDashboardClient:148) |
| Б6 | recharts: всем контейнерам — `minWidth={0}` (уже в компонентах `modern/*`). Новые графики только через компоненты `modern/*`, не сырой recharts в экранах | Убирает `width(-1)` warnings; единый словарь |
| Б7 | Тренды дайджестов (Ф1b) строим из ИСТОРИИ persisted-снимков `DailyOperationsDigest`/`WeeklyOperationsDigest` (`metricsJson` за каждый день/неделю), не из выдуманных рядов. Индексы `@@index([tenantId,dateLocal])` / `@@index([tenantId,weekStart])` уже есть → выборка дешёвая. Добавляем в `enrichDto` (как уже делают runtime-секции) | Реальные данные (каждый дайджест = сохранённый снимок метрик); индексировано; согласовано с владельцем 2026-06-09 (follow-up: «если можно реальные тренды — давай») |

## Шпаргалка компонентов `modern/` (канон контракта — копировать пропсы 1-в-1)

Импорт: `import { … } from '@/ui/components/dashboard/modern';`

```
MODERN_PAGE_BG: string                       // фон страницы
glass(extra?): CSSProperties                 // inline-стиль стекла
CHART.{text,dim,faint,violet,indigo,blue,cyan,teal,mint,lime,amber,orange,pink,red}
GRAD.{violet,blue,teal,amber,pink}           // градиенты иконок
STATUS_TONE['ok'|'warning'|'risk']

GlassCard({ children, className?, style?, glow? })                          // p-6 стекло
CardTitle({ icon: ReactNode, grad: string, children })                      // градиент-иконка + h3
StatCard({ icon, grad, label, value:string, tone:string,                    // KPI
           spark?, delta?, up?, href? })       // ← spark/delta/up/href ОПЦИОНАЛЬНЫ ПОСЛЕ Ф0
GaugeCard({ title, icon, grad, value:number, max=100, footer?:{t,v,c}[] })  // спидометр
AreaTrend({ title?, titleIcon?, titleGrad?, data:[], xKey, headline?,       // area+градиент
            series:{key,color,label,strokeWidth?,fillOpacity?}[], height=260 })
BarTrend({ title, icon, grad, data:[], xKey, dataKey, height=220 })         // столбцы cyan→violet
DonutCard({ title, icon, grad, data:{name,value,c}[], centerValue?, centerLabel? })
RadarCard({ title, icon, grad, data:{k,v}[] })
Heatmap({ title, icon, grad, rows:string[], cols:string[], grid:number[][], hue? })
AiCard({ title, text, ctaLabel?, onCta? })                                  // glow AI-сводка
ModernTable<T>({ title?, titleIcon?, titleGrad?, columns:ModernTableColumn<T>[], rows:T[], getKey })
Avatar({name,grad?}) · ProgressBar({percent}) · StatusPill({status:'ok'|'warning'|'risk'})
Legend({items:{c,t}[]}) · ChartTip
```

**Page-shell паттерн** (до Ф0 — инлайн как в Portfolio; после Ф0 — `ModernPageShell`):
```tsx
<div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
  <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight" style={{ color: CHART.text }}>…</h1>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>…</p>
    </header>
    …
  </div>
</div>
```

## Scope

**Входит:** Ф0–Ф7 ниже — фундамент (`StatCard`+`ModernPageShell`+`kpiTone`), бэк-ряды операций, миграция `/dashboard/operations`, `/me`, `/dashboard` (director), `/dashboard/operations/daily`, `/dashboard/operations/weekly` + их вторичные виджеты, удаление мёртвого `DashboardClient.tsx`, сквозная QA-приёмка.

**Не входит (с судьбой):**
- Светлая тема, a11y-контраст на стекле, perf-лимит `backdrop-blur` → **Ф5 базового ТЗ** `2026-06-08-dashboards-redesign-modern-visual-language.md` (не здесь).
- Админка `/admin/*` (super-admin) → **Ф4 базового ТЗ** (отдельная волна, не здесь).
- `/sprints/[id]` (`SprintDashboardClient`) → вне периметра редизайна; vNext-ТЗ при необходимости.
- _(Перенесено в scope, Ф1b — решение владельца 2026-06-09)_ Исторические трендовые ряды для daily/weekly дайджестов строятся из persisted-истории `DailyOperationsDigest`/`WeeklyOperationsDigest` — это реальные данные. См. Ф1b + Ф5/Ф6.
- OFF-ветки kill-switch (`reworkEnabled`/`mainReworkEnabled`) — не трогаем (Р2).
- `KpiHero` в `/teams`, `/persons/pulse` — вне периметра, не трогаем.

## Границы фичи

- ✅ Always: переписывать JSX дашбордов на компоненты `modern/*`; добавлять поля в DTO/domain-mapper операций; писать unit-тест на новый бэк-агрегатор.
- ⚠️ Ask first: любое изменение СМЫСЛА метрики (не визуала); удаление функциональных состояний (loading/empty/error) — их сохранять.
- 🚫 Never: трогать OFF-ветки kill-switch; удалять `KpiHero`; вводить новый флаг; менять бизнес-логику API кроме добавления рядов; сырой `recharts` в экранах (только через `modern/*`); английские слова в UI.

## Граф зависимостей фаз

```
Ф0 (FE-фундамент) ─┬─> Ф2 (operations)  <── Ф1  (BE: weeklyInflow, независим)
                   ├─> Ф3 (/me)
                   ├─> Ф4 (director)
                   ├─> Ф5 (daily)        <── Ф1b (BE: трендовые ряды дайджестов, независим)
                   └─> Ф6 (weekly)       <── Ф1b
Ф7 (уборка + сквозная QA) ── после Ф2–Ф6
```
- **Строго раньше:** Ф0 раньше Ф2–Ф6 (все используют `StatCard`-ext/`ModernPageShell`). Ф1 раньше Ф2 (operations потребляет `weeklyInflow`). Ф1b раньше Ф5/Ф6 (daily/weekly потребляют `trend`).
- **Параллельно:** Ф0 ∥ Ф1 ∥ Ф1b (разные файлы/слои); после них Ф2/Ф3/Ф4/Ф5/Ф6 независимы друг от друга (разные файлы) — можно одной волной.

---

## Ф0 — Фундамент: StatCard-ext + ModernPageShell + kpiTone (frontend)

**Цель.** Закрыть пробелы библиотеки `modern/`, чтобы экраны мигрировались без дублирования и без выдуманных спарклайнов.

**Файлы:**
- `frontend/src/ui/components/dashboard/modern/StatCard.tsx` — расширить.
- `frontend/src/ui/components/dashboard/modern/tokens.ts` — добавить `kpiTone`.
- `frontend/src/ui/components/dashboard/modern/ModernPageShell.tsx` — НОВЫЙ.
- `frontend/src/ui/components/dashboard/modern/index.ts` — экспорт `ModernPageShell`, `kpiTone`.

**Что входит:**
1. `StatCard`: сделать `spark?`, `delta?`, `up?` опциональными. Рендер: если `spark` отсутствует/пуст — не рендерить блок спарклайна (значение занимает всю ширину); если `delta` отсутствует — не рендерить дельта-плашку. Добавить `href?: string` — при наличии обернуть карточку в `<Link href={href}>` (как в `KpiHero.tsx:177-187`). Существующие вызовы (`spark/delta/up` переданы) работают без изменений.
2. `kpiTone(value: number, threshold?: { green: number; yellow: number; inverted?: boolean }): string` — порт логики `KpiHero.thresholdTone` ([KpiHero.tsx:63-73](../../frontend/src/ui/components/shared/KpiHero.tsx#L63)) → возвращает `CHART.mint` (ok) / `CHART.amber` (warning) / `CHART.red` (danger) / `CHART.dim` (neutral, threshold отсутствует). Для `tone` у `StatCard`.
3. `ModernPageShell` (Б3): пропсы `{ title: string; subtitle?: string; headerRight?: ReactNode; maxWidth?: 'max-w-4xl'|'max-w-6xl'; children: ReactNode }`. Разметка = page-shell паттерн выше (`max-w-6xl` по умолчанию). Заголовок `CHART.text`, подзаголовок `CHART.dim`.

**Что НЕ входит:** миграция экранов; удаление `KpiHero`; новые графики.

**Acceptance:**
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные.
- `<StatCard icon={…} grad={GRAD.violet} label="X" value="1" tone={CHART.violet} />` (без `spark/delta/up`) компилируется и рендерит без спарклайна/дельты (мини-render-тест `StatCard.spec.tsx` или storybook-free smoke).
- Витрина `/redesign` не сломана (она использует `StatCard` со всеми пропсами): `grep` — старая сигнатура вызова валидна.
- `grep "export { ModernPageShell" frontend/src/ui/components/dashboard/modern/index.ts` → есть; `grep "kpiTone" tokens.ts` → есть.

**Закрывает:** R1, R2.

---

## Ф1 — Бэк: недельный инфлоу-ряд для операций (backend, независим)

**Цель.** Дать `/dashboard/operations` реальные тренды для hero-графика и спарклайнов KPI.

**Мини-картография:**
- Контроллер: `backend/src/modules/operations/controllers/operations-dashboard.controller.ts` → `overview()` (`GET /api/v1/dashboard/operations/overview`).
- Сервис: `backend/src/modules/operations/services/operations-dashboard.service.ts` → `getOverview({ tenantId })`.
- DTO: `backend/src/modules/operations/dto/operations-dashboard.dto.ts` → интерфейс `OperationsDashboardOverviewDto`.
- Паттерн агрегации (копировать структуру): `SentimentIndexService.buildSparkline` ([sentiment-index.service.ts:147-191](../../backend/src/modules/dashboard/services/sentiment-index.service.ts#L147)) — `findMany` по дате + раскладка по 12 недельным bucket'ам в памяти, `old→new`, `null` для пустых.
- Модели (имена/поля проверить re-Read перед кодом): `BlockerSynthesis` (`createdAt`, `tenantId`), `EntityLink` (`createdAt`, `tenantId`, `relationType='conflicted_with'`).

> ⚠️ Номера строк и имена полей даны на момент написания — sub-агент ОБЯЗАН перечитать модель в `schema.prisma` и сервис перед правкой (контракт мог сдвинуться).

**Что входит:**
1. DTO: добавить в `OperationsDashboardOverviewDto`:
   ```ts
   /** Недельный инфлоу за 12 недель, old→new. null = неделя без данных. Конвенция как sparkline12w. */
   weeklyInflow: {
     blockers: Array<number | null>;   // BlockerSynthesis.createdAt по неделям
     frictions: Array<number | null>;  // EntityLink(relationType='conflicted_with').createdAt по неделям
   };
   ```
2. Сервис: приватный `buildWeeklyInflow(tenantId, now)` по паттерну `buildSparkline` (12 недель, bucket-индекс `Math.floor((t-start)/WEEK_MS)`, `null` если в неделе 0 событий — иначе count). Подключить в `getOverview`, добавить в возврат. Переиспользовать существующий Redis-кэш overview, если он есть (если нет — без кэша, как сейчас).
3. Frontend-зеркало контракта: `frontend/src/api/operations-dashboard.api.ts` (тип `OperationsOverviewApi`) + `frontend/src/domain/operations-dashboard.ts` (`OperationsOverviewDomain` + `fromOperationsOverviewApi`, [строки 50-71, 102-125](../../frontend/src/domain/operations-dashboard.ts#L50)) — добавить `weeklyInflow` с защитным дефолтом `{ blockers: [], frictions: [] }` (как сделано для `reworkEnabled ?? true`).

**Что НЕ входит:** новые ряды для daily/weekly (vNext); изменение смысла существующих метрик; новые индексы (если `EXPLAIN` покажет seq-scan на больших tenant — добавить `@@index([tenantId, createdAt])` в `postgres-init.sql` Шаг 5; иначе НЕ добавлять — преждевременно).

**Acceptance:**
- `bun run typecheck` · `bun run build` (backend) — зелёные.
- Unit-тест `operations-dashboard.service.spec.ts` (или новый): подменить `now`, засеять 3 `BlockerSynthesis` в недели i=0,5,11 → `weeklyInflow.blockers` длиной 12, ненулевые на 0/5/11, `null` в пустых неделях. Negative: 0 событий → массив из 12 `null`.
- Swagger smoke: `GET /api/v1/dashboard/operations/overview` содержит `weeklyInflow.blockers`/`.frictions` (12 элементов).
- Frontend `typecheck` зелёный с новым полем в domain.

**Закрывает:** R3.

---

## Ф1b — Бэк: трендовые ряды из истории дайджестов (backend, независим)

**Цель.** Дать `/daily` и `/weekly` РЕАЛЬНЫЕ тренды из уже persisted-снимков (`DailyOperationsDigest`/`WeeklyOperationsDigest`) — это история сохранённых метрик за каждый день/неделю, не выдумка (Б7). Индексы `@@index([tenantId,dateLocal])` / `@@index([tenantId,weekStart])` уже есть ([schema.prisma:7492,7442](../../backend/prisma/schema.prisma#L7465)) → выборка дешёвая, новых индексов не нужно.

**Мини-картография (перечитать перед правкой):**
- `backend/src/modules/operations/services/daily-digest.service.ts` — `enrichDto` (стр. 581), `toDto` (стр. 540). `metricsJson` точки: `totalCheckIns`, `greenShare`, `redShare`, `goals.completed`, `goals.failed`, `newBlockers[]` (длина = число блокеров).
- `backend/src/modules/operations/services/weekly-digest.service.ts` — `getStored`→`enrichDto` (стр. 61-70), `toDto`. `metricsJson` точки: `totalCheckIns`, `greenShare`, `redShare`, `goals.completed`, `goals.failed`, `topBlockers[]`.
- DTO: `daily-digest.dto.ts` (`DailyOperationsDigestDto`, стр. 174), `weekly-digest.dto.ts` (`WeeklyOperationsDigestDto`, стр. 135).
- Паттерн обогащения: тренд кладём в `enrichDto` — там же, где уже считаются runtime-секции (один доп. `findMany`).

**Что входит:**
1. Daily DTO: новый
   ```ts
   export interface DailyDigestTrendPointDto {
     dateLocal: string;            // YYYY-MM-DD
     totalCheckIns: number;
     greenShare: number;           // 0..1
     redShare: number;
     blockers: number;             // metricsJson.newBlockers.length
     overdueCommitments: number;   // metricsJson.overdueCommitments.length — «обещания» (реально хранится)
     goalsCompleted: number;
     goalsFailed: number;
   }
   ```
   + поле `trend: DailyDigestTrendPointDto[]` в `DailyOperationsDigestDto` (порядок **old→new**, до 14 точек, заканчивая `dateLocal` текущего дайджеста). В `toDto` дефолт `trend: []`. (Висящих решений в daily-`metricsJson` НЕТ — их тренд живёт в weekly и на директорском дашборде, не выдумываем для daily.)
2. Daily service: приватный `buildTrend({ tenantId, dateLocal, days = 14 })` →
   `findMany({ where: { tenantId, dateLocal: { lte: dateLocal } }, orderBy: { dateLocal: 'desc' }, take: days, select: { dateLocal, metricsJson } })`,
   парсинг каждой строки в точку, `reverse()` (old→new). Вызвать в `enrichDto`, добавить `trend` в возвращаемый объект (best-effort: ошибка → `trend: []`, как у прочих секций).
3. Weekly DTO: `WeeklyDigestTrendPointDto { weekStart; totalCheckIns; greenShare; redShare; goalsCompleted; goalsFailed; blockers; hangingDecisions }` где `blockers` = `topBlockers.reduce((s,b)=>s+b.count,0)` (суммарный счёт; если смысл иной — `topBlockers.length`, задокументировать выбор), `hangingDecisions` = `metricsJson.hangingDecisions.length` («висящие решения», реально хранится) + `trend: WeeklyDigestTrendPointDto[]` в `WeeklyOperationsDigestDto` (old→new, до 12 точек, заканчивая `weekStart`). (Счётчика обещаний в weekly-`metricsJson` НЕТ — тренд обещаний живёт в daily и на директорском дашборде.)
4. Weekly service: `buildTrend({ tenantId, weekStart, weeks = 12 })` симметрично (`orderBy weekStart desc`), подключить в `enrichDto`.
5. Frontend-зеркало: `frontend/src/api/daily-digest.api.ts` / `weekly-digest.api.ts` типы + соответствующие domain-мапперы — добавить `trend` с защитным дефолтом `[]`.

**Что НЕ входит:** новые таблицы/индексы (существующие достаточны); регенерация дайджестов; изменение смысла метрик; отдельный trend-эндпоинт (кладём в существующий ответ — один вызов фронта).

**Acceptance:**
- `bun run typecheck` · `bun run build` (backend) зелёные.
- Unit-тест (daily): засеять 3 `DailyOperationsDigest` за d-2,d-1,d с разными `greenShare`/`newBlockers` → `trend` длиной 3, порядок old→new, значения совпадают с `metricsJson`. Negative: 0 строк → `trend: []`. Аналогично weekly-тест.
- Swagger smoke: `GET /dashboard/operations/daily-digest` содержит `trend[].greenShare`/`.blockers`/`.overdueCommitments`; `weekly-digest` — `trend[].weekStart`/`.goalsCompleted`/`.hangingDecisions`.
- Frontend `typecheck` зелёный с новым `trend` в domain.

**Закрывает:** R11, R12.

---

## Ф2 — /dashboard/operations → полный новый язык (frontend, deps: Ф0, Ф1)

**Файл:** `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx` (+ вторичные виджеты ниже). ON-ветка (`reworkEnabled !== false`) — мигрируем; OFF-ветку (стр. 299-324 «Свежие блокеры») НЕ трогаем (Р2).

**Карта миграции секций (порядок рендера; якоря — перечитать перед правкой):**

| Секция (якорь) | Сейчас | Стало |
|---|---|---|
| Обёртка + `header` (стр. 127-137) | inline bg + `text-fg-primary` | `ModernPageShell title="Операции — пульс компании" subtitle="Обновлено …"` (`OperationsTabs` + `RequiresActionBanner` внутри shell, до контента) |
| KPI-зоны «Люди/Исполнение» (`KpiHero` ×4, стр. 150-213) | `KpiHero` | `StatCard` (grad по семантике: люди→`GRAD.pink`, блокеры→`GRAD.amber`, цели→`GRAD.violet`, обещания→`GRAD.teal`; `tone=kpiTone(value, threshold)`; `spark` = из `data.weeklyInflow.blockers`/`.frictions` (map в `{i,v}`) где есть, иначе без `spark`; `href` сохранить) |
| Hero-график (НОВОЕ) | — | `AreaTrend title="Операционная нагрузка" data` из `weeklyInflow` (2 серии: blockers `CHART.amber`, frictions `CHART.pink`), `xKey="w"`, `height=240` |
| `TeamTemperatureSection` (стр. 362-500) | `rounded border bg-bg-card` + полоса | `GlassCard` + `CardTitle`; режим «Общая» → `DonutCard` (доли green/yellow/red как сегменты, `CHART.mint/amber/red`, centerValue=`totalCheckIns`); режим «По людям» → оставить `TeamTemperatureHeatmap`, но обернуть в `GlassCard`. Переключатель — стеклянные пилюли |
| `MissingCheckInsCard` (стр. 630-676) | `section bg-bg-card` | `GlassCard` + `CardTitle icon={UserX} grad={GRAD.amber}`; список — glass-строки |
| `StaleIssuesCard` (стр. 685-738) | `section bg-bg-card` | `ModernTable` (колонки: задача · статус-`StatusPill` · просрочка) |
| `OpenCommitmentsWidget` (стр. 502-569) | `section bg-bg-card` | `GlassCard` + сгруппированный список (Avatar автора + count) |
| «Свежие конфликты» (стр. 326-349) | `section bg-bg-card` | `GlassCard` + glass-строки |
| Зона «Сигналы» (`MaturityWidget`, `CauseCategoryMapWidget`, `InsightsTopWidget`, стр. 266-290) | заголовок + виджеты | обернуть в `GlassCard`/`CardTitle`; `CauseCategoryMap` (8 категорий) → `DonutCard` или `BarTrend`; см. вторичные виджеты |
| `TeamCapacityWidget` (стр. 252) | уже glass | не трогать |
| `ChronicBlockersWidget` (стр. 297) | уже glass | не трогать |

**Вторичные виджеты этой фазы (привести к glass, если ещё нет):**
- `dashboard/operations/widgets/MaturityWidget.tsx` — обернуть в `GlassCard`+`CardTitle`; зрелость по доменам → `RadarCard` (оси = домены, `v` = completenessPercent) или `BarTrend`.
- `dashboard/operations/widgets/CauseCategoryMapWidget.tsx` — `DonutCard` по 8 cause-категориям.
- `dashboard/widgets/InsightsTopWidget.tsx` — заменить `shadcn`-`Card` на `GlassCard`+`CardTitle`.

**Что НЕ входит:** OFF-ветка `reworkEnabled===false`; смена смысла KPI; backend.

**Acceptance:**
- `grep -n "shadcn/card" OperationsDashboardClient.tsx` → 0; `grep -n "KpiHero" OperationsDashboardClient.tsx` → 0.
- `grep -nE "bg-bg-card|bg-bg-surface|rounded border" OperationsDashboardClient.tsx` → 0 в ON-ветке (OFF-ветка исключается; если grep ловит OFF — задокументировать строки исключения в отчёте фазы).
- `grep "from '@/ui/components/dashboard/modern'"` → импортируются `StatCard, AreaTrend, DonutCard, GlassCard, CardTitle, ModernPageShell` минимум.
- Сохранены все состояния loading/error/empty (grep по текстам «Загрузка дашборда…», «Нет доступа к COO», empty-тексты температуры/чек-инов).
- `typecheck/lint/build` зелёные. Визуальная приёмка через `qa-tester` по словарю `/redesign` (нет плоских карточек).

**Закрывает:** R4, R5.

---

## Ф3 — /me (Кабинет «Я») → новый фон + glass (frontend, deps: Ф0)

**Файлы:** `frontend/app/(authenticated)/me/MeClient.tsx`, `me/MyPositionCard.tsx`, `me/MyTelegramCard.tsx`. Низ (`DailyValueSection`, 4 виджета) — уже glass, не трогать.

**Карта миграции:**
| Секция (якорь) | Сейчас | Стало |
|---|---|---|
| Обёртка `Content` (стр. 110) + `ProfileHeader` (стр. 203-249) | `mx-auto max-w-4xl`, без фона | `ModernPageShell maxWidth="max-w-4xl"` title=имя, subtitle=должность·отдел (вынести из `ProfileHeader` в `headerRight`/shell) |
| `RoleProfileBlock` «Моя карта должности» (стр. 251-294) | `shadcn Card` | `GlassCard`+`CardTitle icon={IdCard} grad={GRAD.violet}` |
| `MyPositionCard` | `shadcn Card` | `GlassCard`+`CardTitle` |
| `MyTelegramCard` | `shadcn Card` | `GlassCard`+`CardTitle` |
| `MyDocumentsBlock` (стр. 296-342) | `shadcn Card` | `GlassCard`+`CardTitle icon={FileText}`; список → glass-строки или `ModernTable` (имя + `StatusPill`) |
| `MyMeetingsBlock` (стр. 344-394) | `shadcn Card` | `GlassCard`+`CardTitle icon={Calendar}`; список → glass-строки |
| `DailyValueSection` (стр. 145) | уже glass | не трогать |
| `ProfileNudgeBanner` (стр. 161) | `accent`-баннер | оставить (функциональный nudge), допустимо лёгкое стеклянное оформление |

Сохранить якоря `#me-card-position` / `#me-card-telegram` (на них ведут ссылки nudge-баннера).

**Что НЕ входит:** изменение SWR-логики/контрактов; backend.

**Acceptance:**
- `grep -n "shadcn/card" MeClient.tsx MyPositionCard.tsx MyTelegramCard.tsx` → 0.
- `grep -n "MODERN_PAGE_BG\|ModernPageShell" MeClient.tsx` → есть (фон применён).
- `grep -n "id=\"me-card-position\"\|id=\"me-card-telegram\"" ` сохранены.
- Состояния loading/error/empty/404 («Раздел в разработке») сохранены.
- `typecheck/lint/build` зелёные; QA-приёмка.

**Закрывает:** R6.

---

## Ф4 — /dashboard (Director) → KPI/AI/табы на новый язык (frontend, deps: Ф0)

**Файл:** `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx`. Мигрируем ON-ветку (`mainReworkEnabled !== false`, стр. 435-526) + tab-контент (рендерится всегда). OFF-ветку (стр. 356-434) НЕ трогаем (Р2). Фон уже есть (`MODERN_PAGE_BG`, стр. 283).

**Карта миграции:**
| Секция (якорь) | Сейчас | Стало |
|---|---|---|
| KPI-строка ON (`KpiHero` ×3 «Настроение/Обещания/Висящие решения», стр. 456-483) | `KpiHero` | `StatCard` (`spark` из `data.kpi*.sparkline` map в `{i,v}` — **ряды уже есть на бэке**; `delta`/`up` из `data.kpiCommitmentReliability.delta`/`trend`; `tone=kpiTone(value, threshold)`; `href` сохранить) |
| inline AI-сводка «Сводка Коры» (стр. 496-506) | `rounded-2xl border bg-bg-card` | `AiCard title="Сводка Коры" text={narrative}`; если есть `AiNarrativeWithSources` — обернуть в `AiCard`-обёртку (glow), сохранив источники |
| `SignalCountersWidget` (стр. 902-979) | `shadcn Card` + полосы | `GlassCard`+`CardTitle`; полосы → `BarTrend`/glass-bars |
| `ActiveThemesWidget` (стр. 983-1040) | `shadcn Card` | `GlassCard`+`CardTitle` + glass-список |
| `HotEntitiesWidget` (стр. 1044-1088) | `shadcn Card` | `GlassCard`+`CardTitle` |
| `OpenQuestionsWidget` (стр. 1092-1134) | `shadcn Card` | `GlassCard`+`CardTitle` |
| `<details>` обёртка «Подробнее» (стр. 759) | `border bg-bg-card` | стеклянная обёртка (`glass()` style) |
| Первый экран: `ValueStripWidget/ChatUsageWidget/GoalVectorVerdictWidget` | уже glass | не трогать |

**Что НЕ входит:** OFF-ветка `mainReworkEnabled===false`; `KpiHero` в других файлах; backend (sparkline уже есть).

**Acceptance:**
- `grep -n "KpiHero" DirectorDashboardClient.tsx` → 0.
- `grep -nE "shadcn/card" DirectorDashboardClient.tsx` → 0 (либо только в неиспользуемых типах — задокументировать).
- `grep -n "AiCard\|StatCard" DirectorDashboardClient.tsx` → есть.
- Табы (`overview/team/knowledge/goals`) и их empty-states (`TabEmptyState`) работают; матрица 6 состояний (`MainEmptyState`) не сломана.
- `typecheck/lint/build` зелёные; QA-приёмка всех 4 табов.

**Закрывает:** R7.

---

## Ф5 — /dashboard/operations/daily → все секции glass + графики (frontend, deps: Ф0, Ф1b)

**Файл:** `frontend/app/(authenticated)/dashboard/operations/daily/DailyDigestClient.tsx`. Фон уже есть (стр. 128). `ChronicBlockersSection` (стр. 632) уже glass — образец в файле.

**Hero-тренд (НОВОЕ, из `digest.trend` Ф1b):** добавить вверху два графика:
- `AreaTrend title="Настроение по дням"` — серии `greenShare`→`CHART.mint`, `redShare`→`CHART.red`, `xKey="dateLocal"`.
- `AreaTrend title="Нагрузка по дням"` — серии `blockers`→`CHART.amber` (блокеры), `overdueCommitments`→`CHART.pink` (просроченные обещания), `xKey="dateLocal"`.

Если `trend.length < 2` — карточка-заглушка «Тренд появится за несколько дней» (не пустой график).

**Секции к миграции** (~14; полный список — перечитать файл, порядок рендера):
header (стр. 131) → `ModernPageShell`; date-picker (стр. 145) → стеклянная панель; Short Summary (стр. 239) → `GlassCard`; CountersRow «Главное за день» (стр. 300, 6 KPI) → ряд `StatCard` БЕЗ spark (Б5) или `BarTrend`; Team Temperature (стр. 282) → `DonutCard` (доли green/yellow/red); `UrgentItemsSection`/`EventsTimelineSection`/`WhoShinedSection`/`WhoStruggledSection` (стр. 470-622) → `GlassCard`+`CardTitle`+glass-списки; Full Report markdown (стр. 271) → `GlassCard`; New Blockers / Overdue Commitments / Red Check-ins (стр. 316-378) → `GlassCard`-списки или `ModernTable`; empty-state (стр. 262) → `GlassCard`.

**Что НЕ входит:** backend-ряды (vNext); изменение генерации дайджеста.

**Acceptance:**
- `grep -nE "bg-bg-surface|bg-bg-card|rounded border" DailyDigestClient.tsx` → 0.
- `grep -n "DonutCard\|GlassCard\|ModernPageShell\|AreaTrend\|BarTrend" DailyDigestClient.tsx` → есть.
- Hero-тренд рендерится из `digest.trend` (реальные данные); при `<2` точках — заглушка, не пустой график.
- Все состояния (loading/error/empty `allRuntimeEmpty`/«Перегенерировать») сохранены; date-picker работает.
- `typecheck/lint/build` зелёные; QA-приёмка.

**Закрывает:** R8, R11.

---

## Ф6 — /dashboard/operations/weekly → все секции glass + графики (frontend, deps: Ф0, Ф1b)

**Файлы:** `frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx` + `weekly/WeeklyPerPersonWidget.tsx` (проверить — уже glass по grep; если нет — привести). Фон уже есть (стр. 67). `IdeasSection` (стр. 613) уже glass — образец.

**Hero-тренд (НОВОЕ, из `digest.trend` Ф1b):** два графика:
- `AreaTrend title="Настроение по неделям"` — серии `greenShare`→`CHART.mint`, `redShare`→`CHART.red`, `xKey="weekStart"`.
- `AreaTrend title="Исполнение по неделям"` — серии `goalsCompleted`→`CHART.mint` (закрытые цели), `hangingDecisions`→`CHART.red` (висящие решения), `xKey="weekStart"`. (Опц. `BarTrend dataKey="blockers"` отдельной карточкой.)

При `trend.length < 2` — карточка-заглушка.

**Секции к миграции** (~13): header (стр. 70) → `ModernPageShell`; week-picker (стр. 83) → стеклянная панель; `KpiDeltasSection`/`KpiDeltaCard` (стр. 401-417, 4 KPI с дельтами) → `StatCard` (`delta`/`up` из дельт; без spark); Team Temperature (стр. 151) → `DonutCard`; Goals (стр. 161) → `StatCard`/`GlassCard`; Top Blockers (стр. 172, counts) → `BarTrend` (count по типу); Top Insights (стр. 196) → `GlassCard`-список; Hanging Decisions (стр. 225) → `GlassCard`-список; `TeamDynamicsSection` (стр. 480) → `GlassCard` (улучшилось/упало); `ForecastSection` (стр. 542) → `GlassCard` + `StatusPill` для confidence; Commentary markdown (стр. 248) → `GlassCard`; `IdeasSection` — не трогать.

**Acceptance:**
- `grep -nE "bg-bg-card|rounded border" WeeklyDigestClient.tsx` → 0.
- `grep -n "StatCard\|BarTrend\|DonutCard\|AreaTrend\|ModernPageShell" WeeklyDigestClient.tsx` → есть.
- Hero-тренд рендерится из `digest.trend` (реальные недельные снимки); при `<2` точках — заглушка.
- KPI-дельты сохраняют знак/цвет; week-picker и все состояния работают.
- `typecheck/lint/build` зелёные; QA-приёмка.

**Закрывает:** R9, R12.

---

## Ф7 — Уборка + сквозная QA-приёмка (deps: Ф2–Ф6)

**Что входит:**
1. Удалить мёртвый `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` (Р2). Перед удалением — `grep -rn "DashboardClient" frontend/app frontend/src` подтверждает 0 импортов (кроме самого файла и `DirectorDashboardClient`/`*DashboardClient` других страниц — их НЕ трогать).
2. Финальный `grep` по ВСЕМ мигрированным экранам: остаточные `KpiHero` (Director/Operations) = 0, `shadcn/card` = 0, плоские `bg-bg-card`/`bg-bg-surface` = 0 (вне OFF-веток).
3. Проверить, не стал ли `KpiHero` мёртвым: `grep -rn "KpiHero" frontend` — должен остаться в `/teams`, `/persons/pulse`, `KnowledgeVelocityKpi`. Если 0 потребителей — тогда удалить (но ожидаемо НЕ 0).
4. Сквозная QA-приёмка (скилл `qa-tester`, прод/локально): обойти `/dashboard`, `/dashboard/operations`, `/dashboard/operations/daily`, `/dashboard/operations/weekly`, `/me` — единый стеклянный язык, нет плоских карточек, графики рендерятся без `width(-1)` в консоли.

**Acceptance:** все grep-предикаты из п.2; `DashboardClient.tsx` отсутствует; `typecheck/lint/build` зелёные; QA-отчёт со скриншотами.

**Закрывает:** R10.

---

## Требования (трассировка)

- **R1.** `StatCard` принимает вызов без `spark/delta/up` и рендерит KPI без спарклайна/дельты; с `href` — кликабелен.
- **R2.** Существует `ModernPageShell` (фон+контейнер+glass-header) и `kpiTone(value,threshold)` в `modern/`.
- **R3.** `GET /dashboard/operations/overview` возвращает `weeklyInflow.blockers`/`.frictions` (12 точек, `null` для пустых недель); пустой tenant → 12×`null`.
- **R4.** `OperationsDashboardClient` (ON-ветка) не содержит `KpiHero`, `shadcn/card`, плоских `bg-bg-card`/`bg-bg-surface`/`rounded border`.
- **R5.** Operations показывает hero-`AreaTrend` по `weeklyInflow` и `DonutCard` температуры.
- **R6.** `/me` применяет `MODERN_PAGE_BG`; верхние блоки — `GlassCard`; якоря `#me-card-*` сохранены.
- **R7.** Director (ON) — KPI=`StatCard` (с реальным sparkline), AI-сводка=`AiCard`, виджеты табов=`GlassCard`; `KpiHero`=0 в файле.
- **R8.** `/daily` — 0 плоских карточек; температура=`DonutCard`.
- **R9.** `/weekly` — 0 плоских карточек; KPI-дельты=`StatCard`.
- **R10.** Мёртвый `DashboardClient.tsx` удалён; сквозной QA пройден.
- **R11.** `GET /dashboard/operations/daily-digest` возвращает `trend[]` (old→new, ≤14 точек, поля вкл. `blockers`, `overdueCommitments`) из истории `DailyOperationsDigest`; `/daily` рендерит тренд настроения + тренд «блокеры/обещания» по нему; пустая история → `trend: []` и заглушка в UI.
- **R12.** `GET /dashboard/operations/weekly-digest` возвращает `trend[]` (old→new, ≤12 точек, поля вкл. `goalsCompleted`, `hangingDecisions`) из истории `WeeklyOperationsDigest`; `/weekly` рендерит тренд настроения + тренд «цели/висящие решения» по нему.

## Совместимость с prompt caching

Не релевантно — фаза не вводит и не меняет LLM-промпты. Существующие AI-агенты дашборда (forecaster/summary) не затрагиваются.

## Риски / Pre-mortem (для `strict-production-review-gate`)

| Риск | Митигация |
|---|---|
| Потеря функциональных состояний (loading/empty/error/404) при переписывании JSX | Acceptance каждой фазы явно требует grep по текстам состояний; ревью-аспект |
| `width(-1)` warnings recharts на узких контейнерах | Все `modern/*` уже с `minWidth={0}`; не использовать сырой recharts |
| Случайно задеть OFF-ветку kill-switch | Р2: миграция только в ON-ветке; grep-исключения документировать в отчёте фазы |
| `weeklyInflow` тяжёлый запрос на крупном tenant | Сначала reuse-паттерн `findMany`+in-memory bucket (как `buildSparkline`); индекс `@@index([tenantId,createdAt])` только если `EXPLAIN` покажет seq-scan |
| `StatCard`-ext ломает витрину `/redesign` | Опциональность аддитивна; smoke на `/redesign` в Ф0 |
| Контраст/perf стекла | Вне scope (Ф5 базового ТЗ); не регрессируем — те же `modern/*`, что в проде |

## Идемпотентность / флаги / прод

- **Флаги:** новых нет (Ship-On). OFF-ветки существующих kill-switch не трогаем (Р2). Строк в `docs/operations/feature-flags.md` не добавляется.
- **Идемпотентность:** seed/patch/backfill/migrate нет.
- **Prisma/схема:** изменений схемы НЕТ (только DTO-интерфейсы + сервис-методы). Миграции не нужны.
- **Prod-deploy:** прод-операций нет — достаточно `docker compose up -d --build` (backend пересборка ради `weeklyInflow` + фронт-сборка). Шаги 1/4/5/6-10/12 `prod-deploy-log.md` не затрагиваются (если в Ф1 НЕ добавлялся индекс; если добавлялся — Шаг 5).

## DoD (общий чек качества)

- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` зелёные на frontend и backend.
- `bunx vitest run` для нового бэк-теста (Ф1) зелёный.
- Обновлён `second-brain/`: `01_projects/dashboards-*` / `frontend-pages.md` (новый визуальный статус экранов); если менялся overview-контракт — `01_projects/api-layer.md`.
- `prod-deploy-log.md`: правок не требует (прод-операций нет), кроме случая нового индекса в Ф1 → Шаг 5.
- Рефлексия в `second-brain/05_история/`.
- QA-приёмка (Ф7) со скриншотами по словарю `/redesign`.

## Итог

**Реализовано (9 коммитов `e57b3b3d..5a07143b`, ветка `feature/query-understanding-and-support-desk`):** все фазы Ф0–Ф7.
- **Ф0** — фундамент библиотеки `modern/*`: `StatCard` — пропсы `spark`/`delta`/`up` сделаны опциональными + добавлен `href`; новый компонент `ModernPageShell({title, subtitle?, headerRight?, maxWidth?, children})` (фон `MODERN_PAGE_BG` + контейнер + glass-header); хелпер `kpiTone(value, threshold)` в `tokens.ts`; экспорты в `index.ts`; render-smoke `StatCard.spec.tsx`.
- **Ф1** — бэк: поле `OperationsDashboardOverviewDto.weeklyInflow = { blockers, frictions }` (12 недель, `old→new`, `null`=пустая неделя) из `BlockerSynthesis.createdAt` и `EntityLink(relationType='conflicted_with').createdAt` по паттерну `buildSparkline`; чистая функция `bucketizeWeeklyInflow` + unit-тест; FE-зеркало `operations-dashboard.{api,ts}`.
- **Ф1b** — бэк: поля `DailyOperationsDigestDto.trend[]` (≤14) и `WeeklyOperationsDigestDto.trend[]` (≤12) из истории persisted-снимков `DailyOperationsDigest`/`WeeklyOperationsDigest` (`metricsJson`), читаются в `enrichDto` через `buildDailyTrend`/`buildWeeklyTrend`; чистые мапперы `mapDailyDigestRowsToTrend`/`mapWeeklyDigestRowsToTrend` + unit-тесты; FE-зеркало: daily — `api`+`domain`, weekly — только API-тип (domain-слоя у weekly нет).
- **Ф2** — `/dashboard/operations` (+ виджеты `MaturityWidget`/`CauseCategoryMapWidget`/`InsightsTopWidget`): `ModernPageShell`, 4 `KpiHero`→`StatCard`, hero-`AreaTrend` «Операционная нагрузка» по `weeklyInflow`, `DonutCard` температуры, `RadarCard` зрелости, `GlassCard`/`ModernTable`. OFF-ветка `reworkEnabled` не тронута.
- **Ф3** — `/me` (`MeClient`/`MyPositionCard`/`MyTelegramCard`): `ModernPageShell` + `GlassCard`-карточки; якоря `#me-card-position`/`#me-card-telegram` сохранены.
- **Ф4** — `/dashboard` (Director, ON-ветка): 3 `KpiHero`→`StatCard` (реальный sparkline), AI-сводка→`GlassCard` glow, виджеты табов→`GlassCard`. OFF-ветка `mainReworkEnabled` не тронута.
- **Ф5** — `/dashboard/operations/daily`: все секции glass + 2 hero-`AreaTrend` (настроение/нагрузка) из `digest.trend`; заглушка при `<2` точках.
- **Ф6** — `/dashboard/operations/weekly`: все секции glass + hero-`AreaTrend`+`BarTrend` из `digest.trend`.
- **Ф7** — удалён мёртвый `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` (0 импортёров); `KpiHero` сохранён (используется в `/teams`, `/persons/pulse`, `KnowledgeVelocityKpi`).

**Верификация:** backend `typecheck`+`build`+`vitest` (47 файлов / 355 тестов) — зелёные; frontend `typecheck`+`lint` (0 errors)+`build` — зелёные.

**Осталось:**
- **Визуальная QA со скриншотами** (Ф7 п.4, словарь `/redesign`) — требует запущенного приложения; на проде сейчас старый код, приёмка глазами через `qa-tester` имеет смысл только после прод-выката ветки.
- **Условный индекс `@@index([tenantId, createdAt])` на `BlockerSynthesis`/`EntityLink`** для `weeklyInflow` — отложен по ТЗ (Б, прецедент `buildSparkline`): добавлять только если `EXPLAIN` покажет seq-scan на крупном tenant. Зафиксировано в `second-brain/04_не-сделано/README.md`.

Один экран = один коммит; приёмка глазами по `/redesign`-словарю. Вне scope (по решению владельца): светлая тема, a11y/perf стекла (Ф5 базового ТЗ), админка (Ф4 базового ТЗ), `/sprints`. (Трендовые ряды дайджестов переведены В scope — Ф1b.)
</content>
