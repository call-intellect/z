---
type: tz
status: ready-to-implement
feature: week-month-company-v2
date: 2026-07-01
owner: Сергей (svmazur)
relates_to:
  - plans/architecture/2026-07-01-week-month-company-v2.md
  - plans/analysis/2026-07-01-week-month-dashboards-vs-day-v2.md
  - plans/tz/2026-06-30-day-company-report-v2.md
  - plans/tz/2026-06-29-week-company-weekly-brief.md
  - plans/tz/2026-06-29-month-company-monthly-brief.md
supersedes:
---

> Архитектура (одобрена владельцем 2026-07-01): `plans/architecture/2026-07-01-week-month-company-v2.md` (все 5 развилок §8 закрыты) · Анализ: `plans/analysis/2026-07-01-week-month-dashboards-vs-day-v2.md` · Образец (реализован): `plans/tz/2026-06-30-day-company-report-v2.md`.

# ТЗ — «Неделя/Месяц компании v2»: паритет с «Днём компании v2»

## Принцип

Три брифинга (день → неделя → месяц) должны быть **одним продуктом** на всех горизонтах. День переписан в v2 (письмо-COO с именами, перегруппированные плитки, сущность «решения» удалена). Неделя и месяц **уже реализованы (v1)** и синтезируются из дня, но остались прошлого поколения. Это ТЗ **поднимает** неделю/месяц по образцу дня — не строит с нуля. Образец кода для копирования — реализованный день v2 (`day-company/*`, `daily-digest.prompt.ts`, `buildDayPackage`).

## REALITY-CHECK (по коду на 2026-07-01, ветка `work/2026-06-29`)

- **Обе фичи реализованы и слиты** (неделя — `feature/week-company-weekly-brief`, месяц — `feature/month-company-and-report-navigation`). Модель недели уже несёт `verdictJson/letterJson/goalAlignmentWeekJson/dayTrendJson`; месяц — модель `MonthlyOperationsDigest`. **Миграций БД НЕ требуется** — новые данные кладём в существующий `metricsJson` (JSON-поле), не в колонки.
- **Письма v1:** `weekly-digest.prompt.ts:93` (`WEEK_COMPANY_PROMPT_VERSION='week-company-v1'`, `WEEK_LETTER_KEYS` :98) и `monthly-digest.prompt.ts:11` (`month-company-v1`, `MONTH_LETTER_KEYS` :16). Образец v2 — `daily-digest.prompt.ts:107` (`LETTER_KEYS` = 12 секций `intro,main,done,not_done,reporting,blocked,clients,ideas,attention,actions,delta,reflection`, few-shot `DAY_COMPANY_FEW_SHOT_JSON`, строгая zod `.strict()` + json_schema).
- **Вход недельного синтеза беден:** `buildWeekPackage` (`weekly-digest.service.ts:411`) читает из дневных снапшотов `select: { dateLocal, shortSummary, verdictJson }` (`:424`) — **полное v2-письмо дня (`letterJson`) не читается**, имена/конфликты в недельное письмо не доезжают.
- **Плитки берут live-top, не окно (баг среза):** `WeekCompanyHero.tsx:255` и `MonthCompanyHero.tsx:281` рендерят общий `RisksIdeas` из `day-company/`, данные — `insightsApi.top(5)`/`ideasApi.top(5)` = «топ прямо сейчас», а не за смотримую неделю/месяц. День берёт live потому что «сегодня»≈live; для исторического окна это неверно.
- **День кормит виджеты live-SWR:** `DayCompanyHero.tsx:97-105` — `["day-company.blockers"]` / `["day-company.frictions"]`; `DaySignalsGrid` получает `insights`/`frictions`/`clusters` + `risksSummary/ideasSummary` (из `digest.metrics`). `getTeamFrictions` (`operations-dashboard.service.ts:217`) — **без окна** (`{ tenantId }`); день зовёт его в `daily-digest.service.ts:1097`.
- **Метрики недели:** `WeeklyDigestMetricsDto` (`weekly-digest.dto.ts:3`) несёт `topBlockers`, `topInsights` (без `causeCategory`), `risksSummary`, `ideasSummary` — **нет причин рисков, кластеров идей, трений**.
- **`decisions`+`nextFocus` месяца** — LLM-синтез (`monthly-digest.prompt.ts:50,64,154,168,228,231`); фронт `MonthDecisions.tsx` «Что решить собственнику» из `digest.metrics.decisions`. Это НЕ снятая сущность `Decision`.
- **Canvas-гейт:** `DirectorDashboardClient.tsx:103` — `owner && rhythm==='day' ? null : <DashboardCanvas rhythm={week?'week':'today'} />`. Т.е. `owner+day` → canvas скрыт, **`owner+week` → canvas виден**. `/month` (`MonthDesktopClient.tsx`) рендерит canvas под `MonthCompanyHero`. Пресеты (`registry/presets.ts`): `owner.week` = verdict,goal-vector,trend,plan-fact,load,stale,chains,blockers,ideas,weekly-plan-fact,feed,value; `owner.month` = те же + **month-only** `month-recap,achievements,weekly-dynamics,maturity,bus-factor`.
- **Clamp:** `clampWeekVerdict` (`weekly-digest.service.ts:84`, зовётся :330), `clampMonthVerdict` (`monthly-digest.prompt.ts:449`, зовётся `monthly-digest.service.ts:290`) — клампят только `clients`/`execution`, **ось `team` без clamp по трениям**.

> ⚠️ Номера строк — на момент написания. Перед правкой файла **перечитать** и якориться по символу (имя функции/константы), не по номеру.

## Принятые решения владельца (2026-07-01, §8 архитектуры — не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Письмо недели И месяца → полный COO-голос v2 (имена, петля с прошлым периодом, «взгляд COO») | Единый продукт на всех горизонтах; имена дают конкретику (отчёт приватный) |
| Р2 | v2-плитки (блокеры-секция/риски-по-причине/идеи-кластеры/трения) на неделю И месяц, **данные за окно периода** | Повторяемость — сильнейший сигнал на неделе/месяце; live-top = баг среза |
| Р3 | `MonthDecisions` «Что решить собственнику» → переименовать («Развилки месяца»), концепт оставить | Ценный месяц-only блок; слово «решить/решения» путается с удалённой сущностью |
| Р4 | Скрыть canvas для owner на неделе/месяце + перенести уникальные month-виджеты в герой | Мирроринг дня убирает дубль; ничего ценного не теряем |
| Р5 | Ось «Команда» краснеет от повторяющихся трений за окно (порог — существующая крутилка) | Честнее вердикт: тлеющий конфликт виден в обложке |
| Д (доп.) | Недельный синтез читает полные дневные `letterJson`; месяц читает недельные сводки (не полные письма) | Имена/конфликты доедут до недельного письма; бюджет токенов месяца ограничен как в дне |

## Доказательство выбора (ключевые технические решения)

| # | Решение | Проход A / Проход B | Почему выбран |
|---|---|---|---|
| Б1 | Сигналы за окно — **снапшот в дайджест** при синтезе (в `metricsJson`), фронт рендерит из дайджеста | A: снапшот в дайджест. B: live-эндпоинты с `from/to`, фронт фетчит по окну | A: семантика «отчёт за период» (навигация в прошлые периоды показывает их снимок), 0 новых эндпоинтов, данные уже собираются в синтезе для письма — двойная польза. B: recompute-now для прошлого окна неверен (dynamicLabel/счётчики меняются во времени) + 4 новых query-контракта. **A.** |
| Б2 | Плитки недели/месяца — **форк** `DaySignalsGrid`/`DayBlockers` (WeekSignalsGrid/MonthSignalsGrid/…) | A: форк. B: параметризовать общий компонент под 3 ритма | Общий `RisksIdeas` уже ломал сборку недели/месяца при правке дня (рефлексия дня v2, п.4). Форк = независимые слайсы, безопасно. **A.** |
| Б3 | Поле `decisions` месяца → **`ownerForks`** сквозняком (промпт/схема/zod/DTO/domain/UI) | A: rename end-to-end. B: rename только UI-лейбл, backend-ключ `decisions` оставить | «Решения удалены везде» — оставлять внутренний ключ `decisions` = недо-чистка; поле в `metricsJson` (не колонка БД) → rename дёшев и без миграции. **A.** |
| Б4 | Месяц на входе — недельные **verdict+summary+signals**, НЕ полные недельные письма | A: компресс-вход (как сейчас). B: читать полные недельные `letterJson` | Бюджет токенов: месяц сводит 4 недели; полные письма раздуют контекст. День снял `maxTokens` для дня — месяц держим компрессию + страховочную обрезку. **A.** |

## Scope

**Входит:** переписать 2 письма-промпта (неделя/месяц) в COO-голос v2; кормить недельный синтез полными дневными письмами; собрать и **снапшотить сигналы за окно** (риски-по-причине, кластеры идей, трения, блокеры) в метрики недельного/месячного дайджеста; форкнуть плитки `WeekBlockers`/`WeekSignalsGrid`/`MonthBlockers`/`MonthSignalsGrid` (рендер из дайджеста, не live); переименовать `decisions`→`ownerForks` + UI «Развилки месяца»; расширить `clampWeekVerdict`/`clampMonthVerdict` осью `team` по трениям; скрыть canvas для owner на неделе/месяце + перенести month-only виджеты в герой; метрики/тесты/second-brain/прод.

**Не входит (границы):**
- Движок целей (компас/темп) — только читаем из готового. → уже реализовано, не трогаем.
- Новые таблицы/колонки/enum БД, миграции. → поля недели и модель месяца есть; сигналы в `metricsJson`.
- Новый извлекающий LLM-агент/модель. → синтез тем же одним capable-проходом.
- Таблица план↔факт + «Зависло↔кто держит» + компас + темп месяца. → уже v2, не трогаем.
- Менеджерский/coo-вид canvas. → гейтим только `owner`.
- Голос сотрудника отдельным слоем в неделю/месяц. → день покрыл; неделя агрегирует через дневные письма. vNext.
- Дневной экран. → день v2 закрыт `plans/tz/2026-06-30-day-company-report-v2.md`.

## Границы фичи

- ✅ Always: переиспользовать день-образцы (`daily-digest.prompt.ts`, `buildDayPackage`, `DaySignalsGrid`, `DayBlockers`), `WeeklyPerPersonWidget`/`GoalCompass3D`/`StaleTasksLinked`, `getTeamFrictions`; крутилки через `getDynamic`/`resolveSync`; идемпотентность окна; UI русский, парные токены.
- ⚠️ Ask first: менять контракт старой страницы `/dashboard/operations/weekly`; трогать `WeeklyPerPersonService` окно; менять RBAC-чтение.
- 🚫 Never: `prisma migrate`/новые колонки; `new PrismaClient()` (в скриптах `createPrismaClient()`); `process.env.*` мимо `env.schema.ts`; новый извлекающий агент/модель; дефолт-OFF флаг; удалять `/dashboard/operations/weekly`.

## Фазы

Граф зависимостей: **Ф1**(письмо недели+вход) ∥ **Ф2**(письмо месяца) — независимы. **Ф3**(сигналы-окно неделя, back) → **Ф5**(фронт неделя). **Ф4**(сигналы-окно месяц, back) → **Ф6**(фронт месяц). **Ф7**(clamp трений) — после Ф3/Ф4 (нужны трения в окне). **Ф8**(canvas-гейт+миграция) — независим (фронт). **Ф9**(прод/DoD) — последняя. Внутри back-волны Ф1/Ф3 и Ф2/Ф4 могут идти параллельно (разные аспекты одного сервиса — согласовать порядок правок one-writer на файл).

---

### Ф1 — Письмо недели v2 (COO-голос + вход дневных писем)

**Ценность:** как владелец, в понедельник утром читаю недельную сводку тем же живым голосом COO, с именами и петлёй на прошлую неделю, чтобы неделя не была беднее суммы своих дней.

**Что входит:**
- `weekly-digest.prompt.ts`: `WEEK_COMPANY_PROMPT_VERSION='week-company-v2'`; `WEEK_LETTER_KEYS` → 12 секций как в дне (`daily-digest.prompt.ts:107`), семантика петли `delta` = «против прошлой недели», `reflection` = «взгляд операционного директора за неделю» (5–6 предложений, без новых фактов/чисел). Переписать `WEEK_COMPANY_SYSTEM_PROMPT` (`:112`) в тон дневного SYSTEM: имена людей/клиентов прямо, «числа считает система — ты вставляешь». Обновить few-shot и `WEEK_COMPANY_JSON_SCHEMA` (`:135`, enum письма `:183`) + zod (`:228`) — строгий `.strict()`, отклонять ключ `decisions`.
- `buildWeekPackage` (`weekly-digest.service.ts:411`): в `select` дневных снапшотов (`:424`) добавить `letterJson`; передать дневные письма в пакет и в user-часть промпта (имена/конфликты). Страховочная обрезка сырья — крутилкой (переиспользовать/завести `operations.weekly_digest.raw_char_budget` через `getDynamic` + реестр + сид, по образцу дневного `raw_char_budget`).

**Что НЕ входит:** сигналы за окно (Ф3), виджеты (Ф5), clamp трений (Ф7).

**Файлы:** `backend/src/modules/operations/prompts/weekly-digest.prompt.ts`, `backend/src/modules/operations/services/weekly-digest.service.ts` (buildWeekPackage), `admin-setting-schema-registry.ts` + сид (если новая крутилка).

**Acceptance:**
- `grep "week-company-v2" weekly-digest.prompt.ts` → есть; `WEEK_LETTER_KEYS` содержит все 12 ключей дня; zod-enum письма отклоняет `'decisions'` (unit: невалидный ключ → отбрасывается/ошибка).
- `buildWeekPackage` `select` содержит `letterJson: true`; user-промпт включает текст дневных писем (unit: пакет с 5 днями → в prompt-payload попадают `letterJson`-секции).
- Совместимость с prompt caching: `WEEK_COMPANY_SYSTEM_PROMPT` стабилен (без дат/имён), переменные данные — в user-конце. `bunx vitest run backend/src/modules/operations/prompts/*weekly* backend/src/modules/operations/services/weekly-digest*` зелёные.

**Закрывает:** R1, R3.

---

### Ф2 — Письмо месяца v2 (COO-голос + петля с прошлым месяцем)

**Ценность:** как владелец, 1-го числа читаю месяц тем же голосом с именами и петлёй на прошлый месяц.

**Что входит:**
- `monthly-digest.prompt.ts`: `MONTH_COMPANY_PROMPT_VERSION='month-company-v2'`; `MONTH_LETTER_KEYS` (`:16`) → 12 секций дня; `delta`=«против прошлого месяца», `reflection`=«взгляд COO за месяц». Переписать `MONTH_COMPANY_SYSTEM_PROMPT` (`:30`) в тон дневного (имена прямо). Строгий zod/json_schema (`:57,113,187`).
- Оставить структурные поля `nextFocus` (как есть) и **переименовать `decisions`→`ownerForks`** в промпте/схеме/zod (`:50,64,154,228,231`) — текст правила «1–3 пункта развилок собственнику `{title, why}`». Вход месяца — недельные verdict+summary+signals (компресс, Б4), полные недельные письма НЕ читаем.

**Что НЕ входит:** сигналы за окно (Ф4), UI-переименование виджета (Ф6), clamp (Ф7).

**Файлы:** `backend/src/modules/operations/prompts/monthly-digest.prompt.ts`, `backend/src/modules/operations/services/monthly-digest.service.ts` (если поле `decisions` мапится в DTO — переименовать в `ownerForks`), `backend/src/modules/operations/dto/monthly-digest.dto.ts`.

**Acceptance:**
- `grep "month-company-v2" monthly-digest.prompt.ts` → есть; `MONTH_LETTER_KEYS` = 12 ключей дня; `grep -R "\.decisions" backend/src/modules/operations` в контексте месяца → 0 (переименовано в `ownerForks`), кроме исторической совместимости чтения legacy (если нужен — явный fallback-парс).
- unit: месяц с валидным LLM-выходом → `ownerForks: [{title,why}]`, `nextFocus` сохранён; невалидный ключ письма отклоняется.
- prompt caching: `MONTH_COMPANY_SYSTEM_PROMPT` стабилен. `bunx vitest run backend/src/modules/operations/*monthly*` зелёные.

**Закрывает:** R2, R7 (backend-часть).

---

### Ф3 — Сигналы недели за окно (backend, снапшот в метрики)

**Ценность:** как владелец, вижу риски/идеи/трения/блокеры **за ту неделю**, что смотрю, а не за сегодня.

**Что входит:**
- `getTeamFrictions` (`operations-dashboard.service.ts:217`) — добавить опц. окно `{ tenantId, from?, to? }` (фильтр по дате конфликта; `since`-семантика как день, но с верхней границей). День (`daily-digest.service.ts:1097`) не ломать (передаёт только `since`/начало дня).
- `buildWeekPackage`: собрать за `[weekStart..weekEnd]` (мирроринг `buildDayPackage` day-сигналов, но окно недели): **риски-по-причине** (insights с `causeCategory`/`severity`/`dynamicLabel`/`sourceBlocksCount`), **кластеры идей** (`IdeaCluster`), **трения** (`getTeamFrictions({from:weekStart,to:weekEnd})`), **блокеры** (severity/person/days). Персистить в `WeeklyDigestMetricsDto` (`weekly-digest.dto.ts:3`) новыми полями: `risksByCause: InsightSignalDto[]`, `ideaClusters: IdeaClusterDto[]`, `teamFrictions: TeamFrictionDto[]`, `blockers: BlockerDto[]` (шейпы — как в `DaySignalsGrid`/`DayBlockers` props: `InsightListItemApi`/`IdeaClusterApi`/`OperationsTeamFrictionApi`). Пробросить в `WeeklyOperationsDigestDto` (`:115`, через `metrics`).
- Пустое окно → пустые массивы (не null-падения).

**Что НЕ входит:** фронт-виджеты (Ф5); clamp (Ф7 читает `metrics.teamFrictions`).

**Файлы:** `backend/src/modules/operations/services/weekly-digest.service.ts` (buildWeekPackage + toDto/enrichDto), `backend/src/modules/operations/dto/weekly-digest.dto.ts`, `backend/src/modules/operations/services/operations-dashboard.service.ts` (getTeamFrictions окно).

**Acceptance:**
- `WeeklyDigestMetricsDto` содержит `risksByCause/ideaClusters/teamFrictions/blockers`; `getTeamFrictions` принимает `from/to`.
- unit: синтез недели с данными в окне → метрики заполнены значениями **из окна**; данные вне `[weekStart..weekEnd]` не попадают (negative: конфликт с датой вне окна отсутствует в `teamFrictions`).
- Идемпотентность: повтор `generate(weekStart)` того же окна → те же метрики. `bunx vitest run backend/src/modules/operations/services/weekly-digest*` зелёные.

**Закрывает:** R4.

---

### Ф4 — Сигналы месяца за окно (backend, снапшот в метрики)

**Ценность:** как владелец, вижу сигналы **за месяц**, а не топ сейчас.

**Что входит:** зеркало Ф3 для `MonthlyDigestService` за окно месяца (`monthBounds(periodYm)`): `risksByCause/ideaClusters/teamFrictions/blockers` в метрики месяца (`monthly-digest.dto.ts`), `getTeamFrictions({from:1-е,to:последнее число})`. Пробросить в месячный DTO.

**Что НЕ входит:** фронт (Ф6); clamp (Ф7).

**Файлы:** `backend/src/modules/operations/services/monthly-digest.service.ts`, `backend/src/modules/operations/dto/monthly-digest.dto.ts`.

**Acceptance:** месячные метрики содержат 4 новых поля за окно месяца; negative — сигнал вне месяца не попал; идемпотентность окна. `bunx vitest run backend/src/modules/operations/*monthly*` зелёные.

**Закрывает:** R5.

---

### Ф5 — Фронт неделя: WeekBlockers + WeekSignalsGrid за окно

**Ценность:** как владелец, под недельным письмом вижу блокеры красной секцией, риски по причине, идеи кластерами, трения — за эту неделю.

**Что входит:**
- Форк `frontend/src/ui/components/dashboard/week-company/WeekSignalsGrid.tsx` и `WeekBlockers.tsx` из `day-company/DaySignalsGrid.tsx`/`DayBlockers.tsx` (тексты «за неделю» вместо «за день»).
- `WeekCompanyHero.tsx`: **убрать** `RisksIdeas` (`:255`) и live-SWR `insightsApi.top`/`ideasApi.top`; рендерить `<WeekBlockers items={digest.metrics.blockers} />` + `<WeekSignalsGrid insights={digest.metrics.risksByCause} clusters={digest.metrics.ideaClusters} frictions={digest.metrics.teamFrictions} risksSummary={digest.metrics.risksSummary} ideasSummary={digest.metrics.ideasSummary} />` — данные из дайджеста (по выбранному периоду навигатора), не live.
- Слой `ApiDto→DomainModel`: пробросить новые поля метрик через `weekly-digest.api.ts`/`domain`/`useWeekCompany`.
- Empty-state: нет сигналов за неделю → «за эту неделю рисков/идей/трений не зафиксировано» (не пустой блок).

**Что НЕ входит:** backend (Ф3); canvas (Ф8).

**Файлы:** `frontend/src/ui/components/dashboard/week-company/{WeekSignalsGrid,WeekBlockers}.tsx` (new), `WeekCompanyHero.tsx`, `frontend/src/api/weekly-digest.api.ts`, `frontend/src/domain/*weekly*`, `frontend/src/hooks/useWeekCompany.ts`.

**Acceptance:**
- `grep "RisksIdeas" WeekCompanyHero.tsx` → 0; `grep "insightsApi.top\|ideasApi.top" WeekCompanyHero.tsx` → 0.
- Навигация в прошлую неделю (PeriodNavigator) → плитки показывают сигналы **той** недели (из дайджеста периода).
- `bunx vitest run frontend/src/ui/components/dashboard/week-company` (если есть) + `frontend: bun run typecheck && bun run lint && bun run build` зелёные; `grep "text-white" WeekSignalsGrid.tsx WeekBlockers.tsx` → 0.

**Закрывает:** R6 (неделя).

---

### Ф6 — Фронт месяц: MonthBlockers + MonthSignalsGrid + «Развилки месяца»

**Ценность:** как владелец, под месячным письмом вижу те же сгруппированные плитки за месяц; блок «развилки» больше не путается с удалённой сущностью «решения».

**Что входит:**
- Форк `month-company/MonthSignalsGrid.tsx` + `MonthBlockers.tsx` (тексты «за месяц»); `MonthCompanyHero.tsx`: убрать `RisksIdeas` (`:281`) и live-SWR, рендерить из `digest.metrics` (зеркало Ф5).
- **Переименование Р3/Б3:** `MonthDecisions.tsx` → `MonthForks.tsx`, заголовок «Развилки месяца»; проп `decisions`→`ownerForks`; `MonthCompanyHero.tsx:277` и слой api/domain/hook — читать `digest.metrics.ownerForks`.

**Что НЕ входит:** backend rename (в Ф2); canvas (Ф8).

**Файлы:** `frontend/src/ui/components/dashboard/month-company/{MonthSignalsGrid,MonthBlockers,MonthForks}.tsx`, `MonthCompanyHero.tsx`, `frontend/src/api/monthly-digest.api.ts`, `frontend/src/domain/operations-monthly-digest.ts`, `frontend/src/hooks/useMonthCompany.ts`.

**Acceptance:** `grep "RisksIdeas\|MonthDecisions" MonthCompanyHero.tsx` → 0; заголовок «Развилки месяца» присутствует; плитки из `digest.metrics`; навигация в прошлый месяц → сигналы того месяца. `frontend: typecheck/lint/build` зелёные; `text-white`=0.

**Закрывает:** R6 (месяц), R7 (frontend-часть).

---

### Ф7 — Ось «Команда» в вердикте от трений (clamp)

**Ценность:** как владелец, вижу тлеющий конфликт уже в обложке-вердикте недели/месяца, а не только в плитке.

**Что входит:**
- `clampWeekVerdict` (`weekly-digest.service.ts:84`): если в окне есть трения с `confidence ≥` порога (существующая крутилка порога трений — та, что использует день; сверить имя в `admin-setting-schema-registry.ts`) в количестве ≥ порога — ось `team` не может быть `ok` (понизить до `warn`/`risk` по числу/уверенности). Сигналы clamp берём из `metrics.teamFrictions` (Ф3).
- `clampMonthVerdict` (`monthly-digest.prompt.ts:449`): зеркально по `metrics.teamFrictions` месяца (Ф4).

**Что НЕ входит:** новые крутилки (переиспользуем существующий порог трений); UI (обложки уже рендерят оси).

**Файлы:** `backend/src/modules/operations/services/weekly-digest.service.ts`, `backend/src/modules/operations/prompts/monthly-digest.prompt.ts`.

**Acceptance:** unit: вердикт с `team:ok` + трения в окне выше порога → после clamp `team≠ok`; трений нет → `team` не понижается. `bunx vitest run backend/src/modules/operations/services/weekly-digest* backend/src/modules/operations/*monthly*` зелёные.

**Закрывает:** R9.

---

### Ф8 — Canvas-гейт для owner + миграция month-only виджетов

**Ценность:** как владелец, под геройем недели/месяца нет старой дублирующей сетки, при этом ценные месячные сводки не потеряны.

**Что входит:**
- `DirectorDashboardClient.tsx:103`: расширить условие скрытия — `owner && (rhythm==='day' || rhythm==='week') ? null : <DashboardCanvas .../>` (для owner canvas недели тоже скрыт).
- `/month` `MonthDesktopClient.tsx`: для `owner` не рендерить `DashboardCanvas` под `MonthCompanyHero` (не-owner — как раньше).
- **Миграция month-only:** перенести в `MonthCompanyHero` секцию «Итоги месяца» из существующих registry-виджетов, которых нет в герое: `month-recap`, `achievements`, `maturity`, `bus-factor`, `weekly-dynamics` (переиспользовать компоненты из `widget-registry.ts`, не переписывать). Неделя — миграция не требуется (герой покрывает суть; операционная детализация — на `/dashboard/operations`, как у дня).

**Что НЕ входит:** менять пресеты/canvas для coo/member; трогать сами registry-виджеты.

**Файлы:** `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx`, `frontend/app/(authenticated)/month/MonthDesktopClient.tsx`, `frontend/src/ui/components/dashboard/month-company/MonthCompanyHero.tsx` (+ секция «Итоги месяца»).

**Acceptance:** для `owner+week` и `owner+month` `DashboardCanvas` не в DOM (grep условия + рендер-тест); для `coo`/`member` — canvas на месте; месяц-герой содержит 5 перенесённых виджетов. `frontend: typecheck/lint/build` зелёные.

**Закрывает:** R8.

---

### Ф9 — Прод / observability / second-brain / DoD

**Ценность:** как компонент выката, гарантирую, что v2 недели/месяца наблюдаем, задокументирован и катится включённым.

**Что входит:**
- Метрики: переиспользовать существующие `coo_weekly_digest_*`/`coo_monthly_digest_*`; при новой крутилке `raw_char_budget` — сид в `apply-prod-deploy.ts STEPS` (idempotent).
- Флаги: **новых не вводим** — kill-switch `weeklyDigestEnabled`/`betaOps.monthlyDigestEnabled` уже есть (строки в `feature-flags.md` актуальны). Ship-On.
- Тайминг-сверка (не менять код): день 07:00 → неделя пн 06:00 читает прошлые пн–пт (сгенерены к сб 07:00) → месяц 1-е 06:00 читает недельные (`missingWeeks` graceful для частичной недели) — зафиксировать в ТЗ как проверенную цепочку.
- second-brain: обновить `01_projects/director-dashboard.md` (§«Неделя компании»/§«Месяц компании» → пометка v2), `02_architecture/data-model.md` (новые поля `metricsJson`), `01_projects/ai-jobs.md` (промпты v2). `prod-deploy-log.md`: Шаг 1/7 если новая крутилка; миграций нет — Шаг 4 N/A.
- Рефлексия в `05_история/`.

**Acceptance:** `docs/operations/feature-flags.md` — новых флагов не добавлено; `prod-deploy-log.md` обновлён при новой крутилке; second-brain-заметки обновлены по таблице производных; `bun run typecheck && bun run lint && bun run build` (backend+frontend) зелёные.

**Закрывает:** R10, R11.

## Требования (трассировка)

- **R1** Письмо недели — 12 COO-секций v2, имена, петля с прошлой неделей, «взгляд COO», version `week-company-v2`, без `decisions`. `[Ф1]`
- **R2** Письмо месяца — 12 COO-секций v2, петля с прошлым месяцем, version `month-company-v2`. `[Ф2]`
- **R3** Недельный синтез читает дневные `letterJson` (имена/конфликты в письмо). `[Ф1]`
- **R4** Сигналы недели (риски-по-причине/кластеры/трения/блокеры) снапшочены за `[weekStart..weekEnd]` в метрики; не live-top. `[Ф3]`
- **R5** Сигналы месяца снапшочены за окно месяца. `[Ф4]`
- **R6** Герои недели/месяца рендерят `Week/MonthBlockers`+`Week/MonthSignalsGrid` из дайджеста (замена live `RisksIdeas`). `[Ф5,Ф6]`
- **R7** `decisions`→`ownerForks` сквозняком; UI «Развилки месяца». `[Ф2,Ф6]`
- **R8** Canvas скрыт для owner на неделе/месяце; month-only виджеты перенесены в герой. `[Ф8]`
- **R9** `team`-ось вердикта недели/месяца ≠ ok при трениях в окне выше порога. `[Ф7]`
- **R10** Пустые окна → явные empty-state; повтор `generate(период)` = те же данные (идемпотентность окна). `[Ф3,Ф4,Ф5,Ф6,Ф9]`
- **R11** Prompt caching сохранён (стабильный SYSTEM); observability/флаги/second-brain закрыты. `[Ф1,Ф2,Ф9]`

## Чек сквозных аспектов

- **RBAC/tenant:** `[N/A новое]` — чтение недельного/месячного дайджеста уже за `canViewOperationsDashboard`; все выборки сигналов — с `tenantId` (проверить `@@index([tenantId,...])` на insights/frictions используемых запросах).
- **Observability:** переиспячейка `coo_weekly/monthly_digest_*` `[Ф9]`; логи деградации пакета уже есть (`weekly-digest: … деградирую`).
- **Errors/идемпотентность:** снапшот сигналов детерминирован по окну; пустые массивы вместо null; повтор generate = no-op по данным `[Ф3,Ф4]`.
- **Миграции данных:** `[N/A]` — сигналы в `metricsJson`, backfill не нужен (старые дайджесты покажут пустые плитки до перегенерации — допустимо, empty-state).
- **Rollout/флаг:** Ship-On, kill-switch'и существуют, новых нет `[Ф9]`.
- **Тесты:** unit на письмо/схему (Ф1/Ф2), окно сигналов + negative (Ф3/Ф4), clamp трений (Ф7), рендер из дайджеста (Ф5/Ф6).

## Idempotency / feature-flag / prod-deploy

- Миграций БД нет (сигналы в `metricsJson`, поля недели/модель месяца существуют) → `prod-deploy-log.md` Шаг 4 **N/A**.
- Новая крутилка `operations.weekly_digest.raw_char_budget` (если заводится в Ф1) — дефолт через реестр AdminSetting + сид в `apply-prod-deploy.ts STEPS` (idempotent) → Шаг 1/7.
- Флаги — переиспользуем `weeklyDigestEnabled`/`betaOps.monthlyDigestEnabled`; новых строк в `feature-flags.md` нет.
- Промпты v2 (`week-company-v2`/`month-company-v2`) — если маршруты/промпты сидируются, повторный сид = no-op.

## DoD

`bun run typecheck` (вкл. `.spec`)/`lint`/`build` зелёные (backend и frontend); vitest затронутых файлов зелёные; Playwright-сверка героев недели/месяца с образцом дня (письмо-COO с именами разворачивается; плитки — блокеры/риски-по-причине/идеи-кластеры/трения за период; canvas-дубля под геройем нет; «Развилки месяца» вместо «Что решить»); second-brain обновлён по таблице производных заметок (`director-dashboard.md`/`data-model.md`/`ai-jobs.md`); `prod-deploy-log.md` Шаг 1/7 при новой крутилке (миграций нет); `feature-flags.md` без новых флагов; рефлексия в `05_история/`.

## Итог

_(заполняет tz-orchestrator по завершении: реализовано целиком/частично, коммиты по фазам, верификация, прод-diff.)_
