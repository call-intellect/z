---
type: analysis
status: research-complete
feature: month-company-and-report-archive
date: 2026-06-29
snapshot_date: 2026-06-29
owner: Сергей (svmazur)
related:
  - plans/tz/2026-06-29-week-company-weekly-brief.md
  - plans/analysis/2026-06-29-week-company-blueprint.md
  - plans/tz/2026-06-28-day-company-daily-brief.md
  - second-brain/01_projects/director-dashboard.md
---

> Цель разбора: доказать состав и архитектуру ДВУХ связанных фич дашборда операционного директора — (A) «Месяц компании» как executive-герой-близнец недели и (B) навигация по датам + архив прошлых отчётов для всех трёх ритмов — так, чтобы `tz-author` взял документ без доработки.
> Следующий шаг → ТЗ: `plans/tz/2026-06-29-month-company-monthly-brief.md` (фича A) + `plans/tz/2026-06-30-report-date-navigation-archive.md` (фича B).

# Синтез — «Месяц компании» + архив/навигация прошлых отчётов

## Принцип

«Месяц компании» — **месячный близнец «Недели компании»**: 1-го числа Кора сводит **4 недельных снапшота** (`WeeklyOperationsDigest`) в executive-брифинг за месяц (вердикт 4 оси + письмо «как прошёл месяц» + компас к цели + таблица план/факт за месяц) и показывает его **героем над существующим месячным canvas на `/month`**. Главное отличие от недели — **смена горизонта**: не снимок состояния, а **накопленная траектория** (тренд осей по неделям, темп к цели, месяц-специфичные срезы: зрелость, незаменимость, решения собственнику). Реализуется **новой моделью `MonthlyOperationsDigest`** (зеркало Weekly/Daily), переиспользуя инфраструктуру дня/недели; `ValueRecapSnapshot` остаётся отдельной «витриной пользы» (виджет `month-recap` под героем).

Параллельно — фича B: бэкенд уже отдаёт отчёты по дате (`?date=`/`?weekStart=`/`?period=`), но в UI нет навигатора → «вернуться к отчёту за вчера» из кабинета невозможно. Достраиваем **inline-навигатор ‹ › + дата-выбор + лёгкий архив**, переиспользуя готовый `PeriodSelector` из value-recap.

---

## Рамка проблемы (две конкурирующие формулировки)

**Фича A — «Месяц компании».**
- Формулировка 1 (поверхностная): «у дня и недели есть герой, у месяца — нет, нужно дозеркалить». — Симптом.
- Формулировка 2 (корневая, выбрана): «владельцу SMB не хватает **месячного горизонта решений** — что накопилось за 30 дней, куда движется траектория, что решить в этом месяце. Недельный снимок этого не даёт, а месячные canvas-виджеты разрознены и без нарратива». — Корень (Iceberg: симптом «нет героя» → структурная причина «нет месячного executive-нарратива и forward-looking слоя»).
- Кто страдает: **owner/CEO** SMB (15–60 чел) — целевая роль дашборда; вторично coo.
- Метрика «решено»: owner за ≤60 сек на `/month` отвечает «как прошёл месяц, куда идём, что решить» — без обхода виджетов; месяц **не дублирует** неделю (антипаттерн MBR).

**Фича B — навигация/архив.**
- Формулировка (однозначная): «отчёт за прошлый период существует и хранится, но недостижим из UI — нет переключателя дат». Кто страдает: owner, пропустивший день/неделю. Метрика «решено»: с любого героя owner открывает отчёт за произвольный прошлый период за ≤2 клика.

---

## Дерево MECE (каркас фаз ТЗ)

**Фича A:** Схема (модель `MonthlyOperationsDigest`) → Синтез (сведение 4 недель + один LLM-проход + clamp + weekTrend) → Окно/Тайминг (крон 1-е число, границы месяца ↔ недели) → DTO+доступ → Фронт (MonthCompanyHero над canvas + месячные срезы) → Компас с темпом → Доставка/прод.

**Фича B:** Бэк-дельта (weekly `/latest` + эндпоинт «список доступных периодов» day/week/month) → Общий `PeriodNavigator` (вынести из value-recap) → Подключить навигатор к героям дня/недели/месяца → Архив-список (лёгкий) → empty-state «нет данных → ближайший доступный».

---

## REALITY-CHECK (по факту кода на 2026-06-29)

### Что уже работает (переиспользуем, НЕ переписывать)

**Бэкенд — три модели-близнеца + витрина:**
- `WeeklyOperationsDigest` — [schema.prisma:7921](../../../backend/prisma/schema.prisma): `weekStart`/`weekEnd VarChar(10)`, `bodyMarkdown`, `metricsJson`, `sourcesJson`, `llmTaskRouteId?`, `verdictJson?`, `letterJson?`, `goalAlignmentWeekJson?`, `dayTrendJson?`; `@@unique([tenantId, weekStart])`.
- `DailyOperationsDigest` — [schema.prisma:7980](../../../backend/prisma/schema.prisma): зеркало с `dateLocal`, `shortSummary?`, `deliveredAt?`, `verdictJson?`/`letterJson?`/`goalAlignmentDayJson?`.
- `ValueRecapSnapshot` — [schema.prisma:7542](../../../backend/prisma/schema.prisma): месячная **витрина пользы** (`periodYm VarChar(7)`, единый `payloadJson`, `deliveredAt?`/`openedAt?`; `@@unique([tenantId, periodYm])`). НЕТ verdict/letter/компаса; навешан `assertNoForbiddenMetricKeys` (запрет ключей ₽/часы/было-стало).
- `PersonGoalContribution` — [schema.prisma:7850](../../../backend/prisma/schema.prisma): `netScore` по `(tenantId, personId, goalId, weekStart)` — источник колонки «Вклад в цель» (недельная гранулярность).
- `DailyDigestService.generate` — [daily-digest.service.ts:361](../../../backend/src/modules/operations/services/daily-digest.service.ts) — **эталон персиста нарратива**: `clampVerdict` поверх LLM, `Prisma.JsonNull` при fallback, lenient-парс [daily-digest.service.ts:304](../../../backend/src/modules/operations/services/daily-digest.service.ts) (`json_schema strict`, `reasoningEffort high`, `maxTokens 8000`).
- `WeeklyDigestService` — [weekly-digest.service.ts:63](../../../backend/src/modules/operations/services/weekly-digest.service.ts): `getStored`/`getOrGenerate`/`generate`, сводит сырьё недели одним LLM-проходом `operations-weekly-digest`. Недельный синтез вердикта/письма — scope недельного ТЗ (Ф2).
- `WeeklyPerPersonService.compute` — [weekly-per-person.service.ts:85](../../../backend/src/modules/operations/services/weekly-per-person.service.ts): план/факт по людям, **окно weekStart+6 ЗАШИТО** (нет параметра), Redis-кэш 5 мин.
- `ValueRecapService` — [value-recap.service.ts:46](../../../backend/src/modules/operations/services/value-recap.service.ts) + `monthBounds(periodYm)`/`shiftPeriod` [value-recap.service.ts:490](../../../backend/src/modules/operations/services/value-recap.service.ts) — **готовые границы месяца**; крон [value-recap.cron.ts:25](../../../backend/src/modules/operations/workers/value-recap.cron.ts) `@Cron('0 7 1 * *')`, 1-е число, `periodYm` = прошлый месяц.

**Фронтенд — герой дня + месячные виджеты + готовый навигатор:**
- `DayCompanyHero` — [DayCompanyHero.tsx:58](../../../frontend/src/ui/components/dashboard/day-company/DayCompanyHero.tsx) — единственный полноценный герой (оркестратор: `DayVerdictCover` → `DayLetter` → `GoalCompassCard` → `StaleTasksLinked` → `RisksIdeas` → `PeriodValue`), 3 состояния (skeleton/error/empty+пересборка). **Прямой шаблон `MonthCompanyHero`.**
- `MonthDesktopClient` — [MonthDesktopClient.tsx:12](../../../frontend/app/(authenticated)/month/MonthDesktopClient.tsx): `ModernPageShell('Итоги месяца')` + `DashboardCanvas rhythm='month'`, своего героя нет.
- Месячные виджеты (реализованы, в пресете `month` — [presets.ts:32](../../../frontend/src/ui/components/dashboard/registry/presets.ts)): `month-recap` (= embedded `ValueRecapDashboardClient`), `achievements`, `weekly-dynamics`, `maturity`, `bus-factor`, `trend` (параметризован `rhythm='month'`).
- **Навигатор по периодам уже существует** — [ValueRecapDashboardClient.tsx:135](../../../frontend/app/(authenticated)/dashboard/value-recap/ValueRecapDashboardClient.tsx): `PeriodSelector` ‹ ›, `selectedPeriod`-state, `shiftPeriodYm`/`formatPeriodYm` ([value-recap.ts:50](../../../frontend/src/domain/value-recap.ts)), `valueRecapApi.get(orgId, period?)`. **Эталон для навигации дня/недели.**
- `operationsDailyDigestApi` имеет `getByDate(date)`/`getLatest()`/`generate(date)` — [operations-daily-digest.api.ts:186](../../../frontend/src/api/operations-daily-digest.api.ts) — выбор даты на бэке **уже есть**, но [useDayCompany.ts:24](../../../frontend/src/hooks/useDayCompany.ts) зовёт только `getLatest()`.

### Что сломано / в scope

- **Месяца-героя нет** (только canvas); нет `MonthlyOperationsDigest`, нет `api/domain/hook` месяца, нет промпта месяца.
- **`ValueRecapSnapshot` ≠ герой** — это витрина пользы (другой контракт, запрет метрик).
- **Навигатор по датам не подключён** к героям дня/недели; у недельного дайджеста нет `/latest`; нет эндпоинта «список доступных периодов» для архива; `PeriodSelector` заперт внутри value-recap (не общий компонент).
- **`WeeklyPerPersonService` без параметра окна** — месячная таблица план/факт требует окна 4 недель.
- **`PersonGoalContribution` гранулярен по `weekStart`** — месячный «вклад в цель» = агрегат 4 недельных `netScore`.

---

## Принятые решения владельца (2026-06-29 — не пересматривать)

Унаследовано от недельного (Р1–Р8 в [week-company-weekly-brief.md](../../tz/2026-06-29-week-company-weekly-brief.md)): сведение готовых снапшотов одним LLM-проходом; компас — общий `GoalCompass3D` (CSS/SVG-3D, без новых зависимостей); крутилки в AdminSetting; Ship-On; UI русский; clamp вердикта; live-таблица (не снапшотим).

Новые решения месяца/навигации:

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р-M1 | **Новая модель `MonthlyOperationsDigest`** (зеркало Weekly/Daily, `periodYm`), а НЕ расширение `ValueRecapSnapshot` | Вердикт «куда идём» и витрина «что Кора сняла» — **разные артефакты с разной аудиторией**; смешать в одном `payloadJson` = перегруз + конфликт `value-recap-narrative` (400 ток., запрет метрик) с письмом-прозой. Чистый близнец = единый контракт `getStored/generate/clamp/fallback`. Канон MBR — месяц отдельный артефакт. `ValueRecap` остаётся виджетом `month-recap` под героем. |
| Р-M2 | **Герой над canvas на `/month`**; таб «Месяц» в rhythm-switcher недели ведёт **ссылкой** на `/month` | `/week` и `/month` уже отдельные роуты; герой-над-canvas = ровно паттерн `DayCompanyHero` над canvas. Не дублируем canvas инлайн в switcher, не плодим тройную поверхность. Минус (навигация разнесена) приемлем для раннего пилота. |
| Р-M3 | **Смена горизонта**: герой-близнец + месяц-специфичные срезы | Практика MBR (triangulated): месяц = накопленная траектория, не снимок. Добавляем тренд осей **по неделям**, компас с **темпом/прогнозом** к цели, блок «что решить собственнику» (1–3), «фокус следующего месяца» + готовые виджеты (зрелость/незаменимость/достижения). Иначе месяц = «большая неделя» (антипаттерн). |
| Р-B1 | Навигация — **inline-навигатор ‹ › + дата-выбор + лёгкий архив-список**, НЕ отдельная страница «Архив» | Red-team (survives): отдельная страница — overkill для раннего пилота (~4 юзера, прод почти пуст); inline + явные подписи периода + default «последний завершённый» — практика для редко-открываемых поверхностей. `PeriodSelector` уже доказан в коде. |

---

## Архитектура «Месяца компании» (зеркало недели + смена горизонта)

1. **Схема** — новая `MonthlyOperationsDigest`: `periodYm VarChar(7)`, `bodyMarkdown`, `metricsJson`, `sourcesJson`, `llmTaskRouteId?`, `verdictJson?`, `letterJson?`, `goalAlignmentMonthJson?`, `weekTrendJson?` (тренд осей по 4 неделям), `shortSummary?`, `deliveredAt?`, `createdAt`; `@@unique([tenantId, periodYm])`, `@@index([tenantId, periodYm])`. Аддитивная миграция.
2. **Синтез** — `MonthlyDigestService.generate(tenantId, periodYm)`: собрать пакет = **4 недельных `WeeklyOperationsDigest`** месяца (по понедельникам месяца через `getStored(weekStart)`; брать **компрессированно** — `verdictJson`/`shortSummary`/ключевые `metricsJson`, НЕ полные `letterJson`, чтобы не переполнить вход — см. revise R2 ниже) + детерминированные сигналы (надёжность/план-факт за месяц, повторяющиеся блокеры, динамика к прошлому месяцу через `getStored(shiftPeriod -1)`) + источник «пользы» из `ValueRecapService` → **ОДИН capable LLM-проход** (`json_schema strict`, как daily [daily-digest.service.ts:304](../../../backend/src/modules/operations/services/daily-digest.service.ts)) → строгий JSON (вердикт 4 оси + письмо месяца + компас + решения/фокус) → `clampVerdict` → персист в новые поля + `bodyMarkdown`. «Сухой» fallback (NULL) при провале LLM.
3. **`weekTrendJson`** — детерминированно: 4 оси × 4 недели из `verdictJson` каждой недели (зеркало `dayTrendJson`).
4. **Таблица план/факт за месяц** — `WeeklyPerPersonService` с опц. параметром окна (4 недели) ИЛИ агрегатор 4 недельных `compute()`; «вклад в цель» = сумма `netScore` по 4 `weekStart`.
5. **Тайминг** — крон 1-е число (`@Cron('0 6 1 * *')`, глобально как daily/value-recap; крутилки `monthDigestEnabled` kill-switch + час в AdminSetting). Граница месяц↔недели — `[ASSUMPTION: «недели месяца» = понедельники, попадающие в [1-е..последнее число]; неделя, пересекающая границу, относится к месяцу своего понедельника]`.
6. **DTO + доступ** — `MonthlyOperationsDigestDto` (зеркало weekly Ф4), чтение owner/admin/coo/super.
7. **Фронт** — `MonthCompanyHero` (шаблон `DayCompanyHero`) над `DashboardCanvas rhythm='month'` в `MonthDesktopClient`: обложка-вердикт → тренд осей **по неделям** → письмо месяца → **компас с темпом/прогнозом** → таблица план/факт (месяц) → блок решений «что решить собственнику» + «фокус месяца» → существующие виджеты (зрелость/незаменимость/достижения/снятая рутина) ниже.
8. **Доставка** — `operations.monthly_digest` (новый eventType, чтобы не конфликтовать с `operations.monthly_recap` витрины) ведёт на `/month`.

### Состав месяца — gap-таблица «практика MBR × Z»

| Срез (практика MBR) | Что у Z сейчас | Дельта/что строить | Тег |
|---|---|---|---|
| Тренд по неделям (динамика осей, не снимок) | `weekly-dynamics`, `TrendWidget month` | `weekTrendJson` в герое первым блоком | triangulated |
| Нарратив-«почему» на ось | письмо дня/недели | письмо месяца с разбором осей (сильная сторона Z — граф знаний) | verified |
| Компас к цели = темп/прогноз | компас «ближе/дальше» (дневной) | усилить: темп, прогноз «при текущем — к дате X», ведущий сигнал | triangulated |
| Вехи/крупные ставки R/Y/G | `achievements` (список «что сделали») | сделать действенным (статус + след. веха) — vNext, не блокер | verified |
| Незаменимость (bus-factor) | `bus-factor` виджет | подтверждён как месячный; показывать «зона × носитель × критичность» + дельта к прошлому мес. | triangulated |
| Зрелость/health | `maturity` виджет | дать структуру (суб-оси + сводный балл + дельта), связать с 4 осями | triangulated |
| Снятая рутина | `ValueRecapSnapshot`/`month-recap` | переиспользуем как виджет под героем | inferred |
| «Что решить собственнику» (1–3) | нет | новый блок героя — превращает отчёт в инструмент решения | verified |
| Фокус следующего месяца | нет | секция в конце письма | triangulated |

**Антипаттерны месяца (НЕ делать):** перегруз >12 KPI (−40% вовлечённости); повтор недельной операционки (блокеры/статус задач — территория недели); vanity-тоталы без «и что?»; дублирующая параллельная шкала здоровья мимо 4 осей; пересчёт медленных метрик (зрелость/bus-factor) с недельной дельтой = шум. Держать 5–8 ключевых срезов на первом экране, остальное в drill-down.

---

## Фича B — навигация/архив (дельта)

| Слой | Что есть | Дельта |
|---|---|---|
| Бэк день | `getByDate(date)`/`getLatest()` ✓ | — (готово) |
| Бэк неделя | `getStored(?weekStart=)`, `generate` | **+ `/latest`** (метод+эндпоинт); список доступных `weekStart` |
| Бэк месяц | `getLatestPeriodWithData`/`getById`/`?period=` ✓ | месячный герой: `getByMonth`/`getLatest`/список `periodYm` |
| Общий эндпоинт «список периодов» | нет | `GET .../available-periods?rhythm=day|week|month` → даты с данными (для архива) |
| Фронт навигатор | `PeriodSelector` заперт в value-recap | **вынести в общий `PeriodNavigator`** (стрелки + дата-выбор), подключить к героям дня/недели/месяца |
| Фронт день | `useDayCompany` зовёт `getLatest` | переключить на `getByDate(selectedDate)`, default = последний |
| empty-state | `tolerantGet`/`digest_not_found` → null | «нет данных за период → перейти к ближайшему доступному» |

Навигация по месяцу де-факто уже работает (PeriodSelector) — фича B доводит её до дня/недели и добавляет лёгкий архив-список.

---

## Доказательство выбора

### Матрица 1 — модель месяца (Р-M1)

| Критерий | A · новая `MonthlyOperationsDigest` (выбран) | B · расширить `ValueRecapSnapshot` | Источник |
|---|---|---|---|
| Контракт-консистентность с day/week | ✓ единый `getStored/generate/clamp` | ⚠️ чужой контракт (единый payload) | carto[0] |
| Смешение артефактов | ✓ разведены (вердикт ≠ витрина) | ✗ два контракта в одном payload | redteam #1 |
| Запрет-метрик-гард | ✓ не задевает | ⚠️ нужно обходить/расширять allow-list | value-recap.scoring.ts:41 |
| Объём кода | ⚠️ модель+миграция+сервис+крон | ✓ 3 nullable-поля | carto[0] gaps |
| Инфра (крон/доставка/навигатор) | ⚠️ новые | ✓ переиспользует value-recap | redteam #1 |
| Канон MBR (месяц = отдельный артефакт) | ✓ | ⚠️ | external monthly |

A проигрывает только по объёму кода/инфры, но выигрывает по чистоте контракта и отсутствию смысловой каши; код — зеркало уже написанного weekly. **Red-team вердикт: escalate → владелец выбрал A.**

### Матрица 2 — поверхность (Р-M2)

| Критерий | A · герой над canvas на `/month` (выбран) | B · инлайн-таб на `/dashboard` | Источник |
|---|---|---|---|
| Согласованность с паттерном дня | ✓ как `DayCompanyHero` над canvas | ⚠️ новый инлайн-canvas | carto[1] |
| Конфликт с недельным switcher | ✓ таб ведёт ссылкой | ✗ риск тройной поверхности | redteam #4 |
| Стоимость | ✓ дёшево | ⚠️ дорого (герой+канва инлайн) | redteam #4 |
| Единство навигации | ⚠️ разнесена (Месяц — переход) | ✓ один switcher | redteam #4 |

**Red-team вердикт: escalate → владелец выбрал A.** Зависимость: финал недельного ТЗ (switcher День↔Неделя↔Месяц-ссылка).

### Revise R2 — сведение 4 недель (учтено в архитектуре)

Red-team (verdict: **revise**) показал: недельный синтез кормит LLM **компрессированным** входом (`select {dateLocal, shortSummary, verdictJson}`, НЕ сырой `letterJson`) — [weekly-digest.service.ts buildWeekPackage](../../../backend/src/modules/operations/services/weekly-digest.service.ts). Месяц обязан повторить: свести 4 недельных **в компресс-форме** (verdict + shortSummary + ключевые метрики), а не 4 полных письма — иначе переполнение контекста. Плюс **`missingWeeks[]` graceful degradation** (новый Org / пропущенный крон → `verdictJson=NULL`): помечать пробел, не падать. Это учтено в п.2 архитектуры.

---

## Границы (reuse vs new)

- ✅ Always: новая `MonthlyOperationsDigest` зеркалом Weekly/Daily; переиспользовать `DayCompanyHero`/`GoalCompass3D`/`PeriodSelector`/`monthBounds`/`WeeklyPerPersonService`(с окном); `ValueRecap` как виджет под героем; крутилки AdminSetting; идемпотентность `(tenantId, periodYm)`; компресс-вход 4 недель + `missingWeeks`.
- ⚠️ Ask first: менять окно `WeeklyPerPersonService` глобально (вместо параметра); трогать контракт `ValueRecapSnapshot`/`month-recap`; новый eventType доставки vs переиспользовать.
- 🚫 Never: смешивать вердикт месяца в `ValueRecap.payloadJson`; новая npm-зависимость для компаса; `prisma migrate dev` на проде / `new PrismaClient()` / `process.env.*`; дефолт-OFF флаг; удалять `/month` canvas или value-recap-витрину.

---

## Открытые вопросы (закрыты владельцем 2026-06-29)

- Модель месяца → **A (новая `MonthlyOperationsDigest`)**.
- Поверхность → **A (герой над canvas на `/month`, таб ссылкой)**.
- Глубина месяца → **смена горизонта (+месячные срезы)**.
- Навигация → **inline-навигатор + лёгкий архив** (Р-B1).

Оставшиеся мелкие `[ASSUMPTION]` для ТЗ (не требуют владельца, выводимы): граница месяц↔недели (понедельники месяца); «главная цель» для месячного компаса = приоритетная активная цель Org (как в недельном); eventType доставки = новый `operations.monthly_digest`.

## Допущения и риски

- **Нет недельных снапшотов** (новый Org / пропущенный крон) → `missingWeeks` + деградация нарратива (desirability/feasibility, уверенность high — паттерн недели уже это решает).
- **Граница месяц↔недели** даёт 4 или 5 понедельников → синтез принимает 4–5 недель (feasibility, medium).
- **Перегруз месяца** (соблазн «показать всё за 30 дней») → держать 5–8 срезов, остальное drill-down (desirability, triangulated).
- **Рассинхрон live-таблицы и снапшота-письма** → письмо = «прошлый месяц» (снапшот), таблица/виджеты = live; подписать периоды (как в дневном/недельном).
- **`PersonGoalContribution` агрегация** — сумма 4 недельных `netScore` корректна только если все 4 недели посчитаны goal-vector-tracker'ом (feasibility, medium).

## Ограничения и непроверенное

- **Контур navigation-archive-baseline (carto[2]) сбойнул** (StructuredOutput retry cap после 28 чтений) — навигационный baseline **восстановлен** из carto[1] (frontend) + red-team #3 + прямого чтения контроллеров автором. Якоря (`PeriodSelector`, `getByDate`, отсутствие weekly `/latest`) — `verified` (наш код), но полнота списка нужных эндпоинтов архива — `inferred`, уточнить при написании ТЗ B.
- **Контур ux-period-navigation (external[0]) вернул заглушку «test»** — полноценного fan-out по UX навигации по периодам НЕ было. Вывод «inline + явные подписи + default последний» опирается на **один retrieval red-team** (uxpilot/lazarev) + код value-recap, не на независимый веер. `[unverified для широкой UX-практики]` — при сомнении добрать перед ТЗ B.
- Backend-внутреннее (carto[0]) и frontend (carto[1]) — `verified` (прямое чтение кода).
- Состав месяца (external[1] monthly-executive) — `triangulated`/`verified` по первоисточникам (см. `03-monthly-executive-composition.md`).

## Источники

См. `03-monthly-executive-composition.md` (Amazon Working Backwards MBR, McKinsey OHI, board/CEO-репортинг, bus-factor, RU-управленческий отчёт, dashboard-overload, leading/lagging indicators) и `04-redteam-challenges.md` (4 состязательных вердикта с якорями кода). Внутренние факты — `01-backend-digest-stack.md`, `02-frontend-hero-canvas.md`.

## Что дальше

Готово к ТЗ. Два следующих документа:
1. `plans/tz/2026-06-29-month-company-monthly-brief.md` — фича A (по образцу недельного ТЗ: Схема → Синтез(сведение 4 недель, компресс-вход) → Окно/Тайминг → DTO/доступ → Фронт(MonthCompanyHero + месячные срезы) → Компас-темп → Доставка/прод).
2. `plans/tz/2026-06-30-report-date-navigation-archive.md` — фича B (горизонтальная: бэк-дельта `/latest`+available-periods → общий `PeriodNavigator` → подключение к героям → архив-список → empty-state). Можно реализовать независимо/параллельно A; перед ТЗ B при желании добрать UX-контур (см. Ограничения).
