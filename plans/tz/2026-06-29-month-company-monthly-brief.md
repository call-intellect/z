---
type: tz
status: ready-to-implement
feature: month-company-monthly-brief
date: 2026-06-29
owner: Сергей (svmazur)
relates_to:
  - plans/analysis/2026-06-29-month-company-and-report-archive/99-synthesis.md
  - plans/analysis/2026-06-29-month-company-prototype/index.html
  - plans/tz/2026-06-29-week-company-weekly-brief.md
  - plans/tz/2026-06-28-day-company-daily-brief.md
  - plans/tz/2026-06-30-report-date-navigation-archive.md
supersedes:
---

> Анализ-основание: `plans/analysis/2026-06-29-month-company-and-report-archive/99-synthesis.md` (+ per-source 01–05, red-team 04) · Эталон вёрстки/состава: `plans/analysis/2026-06-29-month-company-prototype/index.html` (открыть в браузере; скриншоты `month-proto-full.png`/`month-proto-top.png` там же) · Аналог-предшественник (Неделя компании, зеркальная архитектура, УЖЕ реализован на ветке): `plans/tz/2026-06-29-week-company-weekly-brief.md` · Статус согласования развилок: 2026-06-29 (Р-M1–Р-M3 закрыты).

# ТЗ — «Месяц компании»: месячный executive-брифинг владельца на `/month`

## Принцип

«Месяц компании» — **месячный близнец «Недели компании»**. 1-го числа Кора **сводит 4 недельных «Недели компании»** прошлого календарного месяца в executive-брифинг за месяц (вердикт 4 оси + тренд осей **по неделям** + письмо «как прошёл месяц» + компас к цели с темпом/прогнозом + таблица план/факт за месяц) и показывает его **героем `MonthCompanyHero` над существующим месячным canvas на `/month`**. Главное отличие от недели — **смена горизонта**: не снимок состояния, а накопленная траектория + блок «что решить собственнику» + «фокус следующего месяца», поверх уже готовых месячных виджетов (зрелость, незаменимость, достижения, снятая рутина).

Реализуется **новой моделью `MonthlyOperationsDigest`** (чистое зеркало `WeeklyOperationsDigest`) + `MonthlyDigestService` + `OperationsMonthlyDigestCron`, ровно как «Неделя компании» зеркалит «День компании». `ValueRecapSnapshot` (витрина пользы) **не трогаем** — остаётся виджетом `month-recap` под героем. Новый извлекающий агент/модель сигналов не вводим — сводим готовые недельные снапшоты.

## Зачем (болезненное состояние → решение)

1. **У месяца нет executive-нарратива.** `/month` сейчас — только набор canvas-виджетов ([MonthDesktopClient.tsx:12](../../frontend/app/(authenticated)/month/MonthDesktopClient.tsx)), без «героя» уровня дня/недели (вердикт/письмо/компас). Владелец SMB не получает ответа «как прошёл месяц, куда идём, что решить» за 30 секунд.
2. **Месяц рискует стать «большой неделей».** Практика MBR (`03-monthly-executive-composition.md`, triangulated): месяц должен **сменить горизонт** (тренды/нарратив/решения), а не повторить недельную операционку.
3. **Месячный recap пользы спрятан и узок.** `ValueRecapSnapshot` — витрина «что Кора сняла», но это не executive-вердикт траектории; смешивать их в одну модель нельзя (red-team #1).

Решение: поднять месяц до уровня недели (вердикт+письмо+компас+тренд по неделям) новой моделью-близнецом, вынести героем на `/month` над существующим canvas, добавить месяц-специфичные срезы (темп к цели, решения собственнику, фокус месяца) и переиспользовать готовые месячные виджеты.

---

## REALITY-CHECK (по факту кода на 2026-06-29 — перед правкой перечитать, номера строк верифицировать якорь-символом)

**Недельное ТЗ УЖЕ реализовано на ветке `feature/week-company-weekly-brief` — месяц зеркалит ГОТОВОЕ (НЕ переписывать):**
- `WeeklyOperationsDigest` с `verdictJson`/`letterJson`/`goalAlignmentWeekJson`/`dayTrendJson` — [schema.prisma:7921](../../backend/prisma/schema.prisma) (якорь `model WeeklyOperationsDigest {`). **Прямой шаблон полей `MonthlyOperationsDigest`.**
- `WeeklyDigestService.generate` УЖЕ: один LLM-вызов `operations-weekly-digest` (`WEEK_COMPANY_SYSTEM_PROMPT`, `WEEK_COMPANY_JSON_SCHEMA` strict, `reasoningEffort:'high'`, `maxTokens:8000`) → `extractWeekCompanyResponse` (lenient) → `clampWeekVerdict` → персист `verdictJson/letterJson/goalAlignmentWeekJson/dayTrendJson` через `Prisma.JsonNull` при fallback — [weekly-digest.service.ts:300-396](../../backend/src/modules/operations/services/weekly-digest.service.ts). **Эталон месячного `generate` 1:1.**
- **Компресс-вход (revise R2) уже в коде:** `buildWeekPackage` читает дневные снапшоты `select { dateLocal, shortSummary, verdictJson }` (НЕ полные `letterJson`) + `missingDays[]` graceful degradation — [weekly-digest.service.ts:398-440](../../backend/src/modules/operations/services/weekly-digest.service.ts). **Месяц повторяет на 4 недельных снапшотах.**
- `GoalCompass3D` (общий компас, CSS/SVG-3D, 0 зависимостей) **уже создан** — [GoalCompass3D.tsx](../../frontend/src/ui/components/dashboard/shared/GoalCompass3D.tsx) + `.module.css`. **Месяц переиспользует как есть (НЕ вводит).**
- `WeekCompanyHero` + под-компоненты (`WeekVerdictCover`, `WeekLetter`, `WeekGoalCompass`) — [week-company/](../../frontend/src/ui/components/dashboard/week-company/). **Прямой шаблон `MonthCompanyHero`.**
- rhythm-switcher на `/dashboard` **уже есть**: `useState<"day"|"week">`, читает `?rhythm=`, рендерит — [DirectorDashboardClient.tsx:16](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx). Таб «Месяц» в нём пока отсутствует — добавляется как **ссылка на `/month`** (Р-M2).
- `WeeklyPerPersonService.compute({ tenantId, weekStart, weekEnd, limit, offset, sort })` — окно **параметризуемо** (`weekEnd` в аргументах) — [weekly-per-person.service.ts:85](../../backend/src/modules/operations/services/weekly-per-person.service.ts). Для месяца — вызвать с месячным окном ИЛИ агрегировать 4 недельных вызова.
- `monthBounds(periodYm)` / `shiftPeriod(periodYm, n)` — готовые границы месяца — [value-recap.service.ts:490](../../backend/src/modules/operations/services/value-recap.service.ts). `ValueRecapCron @Cron('0 7 1 * *')` 1-е число, `periodYm=shiftPeriod(-1)` — [value-recap.cron.ts:25](../../backend/src/modules/operations/workers/value-recap.cron.ts). **Шаблон месячного крона.**
- `PersonGoalContribution.netScore` по `(tenantId, personId, goalId, weekStart)` — [schema.prisma:7850](../../backend/prisma/schema.prisma). Месячный «вклад в цель» = сумма 4 недельных `netScore`.
- Месячные виджеты canvas (реализованы): `month-recap` (=ValueRecap), `achievements`, `weekly-dynamics`, `maturity`, `bus-factor` — [widget-registry.ts:62](../../frontend/src/ui/components/dashboard/registry/widget-registry.ts), пресет `month` — [presets.ts:32](../../frontend/src/ui/components/dashboard/registry/presets.ts).

**Чего НЕТ / в scope:**
- Модели `MonthlyOperationsDigest` (Ф1), сервиса/промпта/крона месяца (Ф2–Ф3), DTO/контроллера месяца (Ф4).
- `MonthCompanyHero` + api/domain/hook месяца + таб «Месяц» в rhythm-switcher (ссылка) (Ф5a).
- Колонки «Вклад в цель» за месяц + месяц-специфичных блоков (темп/решения/фокус) в герое (Ф5b, Ф5c).
- Навигатор по периодам/архив — **отдельное ТЗ** `plans/tz/2026-06-30-report-date-navigation-archive.md` (НЕ в этом scope).

---

## Принятые решения владельца (2026-06-29 — не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р-M1 | **Новая модель `MonthlyOperationsDigest`** (зеркало Weekly), а НЕ расширение `ValueRecapSnapshot` | Вердикт «куда идём» и витрина «что Кора сняла» — разные артефакты с разной аудиторией (red-team #1); смешать в один `payloadJson` = перегруз + конфликт `value-recap-narrative` (400 ток., запрет метрик) с письмом-прозой. Чистый близнец = единый контракт `getStored/generate/clamp/fallback` как weekly. ValueRecap остаётся виджетом `month-recap`. |
| Р-M2 | **Герой `MonthCompanyHero` над canvas на `/month`**; таб «Месяц» rhythm-switcher ведёт **ссылкой** на `/month` | `/week`/`/month` уже отдельные роуты; герой-над-canvas = ровно паттерн `DayCompanyHero`/`WeekCompanyHero`. Не дублируем canvas инлайн в switcher, не плодим тройную поверхность (red-team #4). |
| Р-M3 | **Смена горизонта** (не дубль недели): тренд осей **по неделям** (`weekTrendJson`) + компас с **темпом/прогнозом** + блок «что решить собственнику» (1–3) + «фокус следующего месяца»; поверх — готовые месячные виджеты | Практика MBR/OHI (`03-...md`, triangulated): месяц = накопленная траектория + нарратив + решения. Антипаттерн — «месяц = сумма 4 недель». |
| Синтез | Свести **4 недельных** `WeeklyOperationsDigest` ОДНИМ capable LLM-проходом; вход **компрессированный** (`{ weekStart, shortSummary, verdictJson, ключевые metricsJson }`, НЕ полные `letterJson`); `missingWeeks[]` graceful degradation; post-LLM `clampMonthVerdict` | Зеркало уже работающего недельного сведения (revise R2 — паттерн `buildWeekPackage` уже в коде). Числа точные (live из сервисов), нарратив консистентен с недельным. |
| Тайминг | Крон **1-го числа месяца ~06:00** (глобально как daily/value-recap), окно = прошлый календарный месяц через `monthBounds(periodYm)`; «недели месяца» = понедельники в `[1-е..последнее число]` (4–5 недель) | Сб/вс не важны на месячном горизонте; к утру 1-го числа недельные снапшоты собраны. Крутилки в AdminSetting. |
| Доставка | Новый eventType **`operations.monthly_digest`** → `actionUrl /month` | Не конфликтовать с `operations.monthly_recap` витрины пользы (разные артефакты). |

Доказательство выбора модели (A новая vs B расширить ValueRecap) — `99-synthesis.md` §«Матрица 1» + `04-redteam-challenges.md` #1 (escalate → владелец выбрал A). Поверхность (A герой-над-canvas vs B инлайн-таб) — §«Матрица 2» + red-team #4 (escalate → A).

---

## Scope

**Входит:**
1. Модель `MonthlyOperationsDigest` (Ф1) — зеркало Weekly с `periodYm`.
2. `MonthlyDigestService` (`getStored`/`getOrGenerate`/`generate`) + промпт `operations-monthly-digest` + сведение 4 недель компресс-входом + `clampMonthVerdict` + `weekTrendJson` детерминированно + «сухой» fallback (Ф2).
3. `OperationsMonthlyDigestCron` 1-го числа + окно месяца + крутилки AdminSetting (Ф3).
4. `MonthlyOperationsDigestDto` + контроллер чтения owner/admin/coo/super (Ф4).
5. `MonthCompanyHero` над canvas на `/month` + таб «Месяц» (ссылка) в rhythm-switcher + слои api/domain/hook (Ф5a).
6. Колонка «Вклад в цель» за месяц в таблице план/факт + блок «Зависло ↔ кто держит» (live) + месяц-специфичные блоки «что решить собственнику» / «фокус месяца» (Ф5b).
7. Компас месяца на `GoalCompass3D` + панель **темпа/прогноза** к цели (Ф5c).
8. Доставка `operations.monthly_digest` → `/month` (Ф6).

**Не входит (vNext, с судьбой):**
- **Навигатор по периодам + архив прошлых отчётов** — отдельное парное ТЗ `plans/tz/2026-06-30-report-date-navigation-archive.md` (горизонтальное: день/неделя/месяц). Месячный герой здесь грузит **последний завершённый** месяц (latest); листание дат — там.
- TTS «Озвучить» — disabled-заглушка (как в дневном/недельном).
- Достижения R/Y/G со статусом+вехой (действенные вехи) — переиспользуем существующий `achievements`-виджет как есть; апгрейд — vNext.
- Зрелость/незаменимость как новые расчёты — переиспользуем существующие виджеты `maturity`/`bus-factor`; их пайплайны не трогаем.
- Мобильная вёрстка героя — отдельным проходом (тёмная десктоп — канон прототипа).

**Граничные контракты (читаем выход, логику не трогаем):**
- `WeeklyDigestService.getStored(weekStart)` (4 недели), `WeeklyPerPersonService.compute` (окно месяца), `PersonGoalContribution`, `stuck/cross-project`, `GoalCompass3D`, `ValueRecapSnapshot`/`month-recap`, существующие месячные виджеты — читаем/переиспользуем; их пайплайны не меняем.
- Таблицу план/факт и блок «зависло» **не снапшотим** — live; снапшотим только LLM-нарратив месяца.

---

## Контракты (контракт-first)

### Ф1 — Prisma: модель `MonthlyOperationsDigest`

Новая модель (зеркало `WeeklyOperationsDigest`, якорь `model WeeklyOperationsDigest {` — копировать структуру, заменить недельные поля на `periodYm`):

```prisma
/// «Месяц компании» — месячный executive-дайджест операционного директора.
/// Зеркало WeeklyOperationsDigest с окном «прошлый календарный месяц». Генерируется
/// глобальным OperationsMonthlyDigestCron 1-го числа ~06:00. MonthlyDigestService.generate
/// сводит 4 недельных WeeklyOperationsDigest месяца одним LLM-вызовом operations-monthly-digest.
/// Идемпотентность — @@unique([tenantId, periodYm]).
model MonthlyOperationsDigest {
  id             String   @id @default(cuid())
  tenantId       String
  /// YYYY-MM — месяц отчёта (например 2026-05).
  periodYm       String   @db.VarChar(7)
  /// Связный текст от LLM (markdown). «Сухой» вариант при падении LLM.
  bodyMarkdown   String   @db.Text
  /// Структурированные показатели месяца для виджетов. Свободный JSON.
  metricsJson    Json
  /// Провенанс: id недельных снапшотов/целей/решений, использованных в дайджесте.
  sourcesJson    Json
  /// Маршрут/модель LLM (`<promptVersion>+<model>`). NULL при сухом fallback.
  llmTaskRouteId String?
  /// Вердикт месяца: { overall:{state,emoji,title,oneLiner}, axes:[{key,state,label,why}] }.
  /// state ∈ 'ok'|'warn'|'risk'; key ∈ 'team'|'clients'|'execution'|'overall'. NULL для сухого fallback.
  verdictJson           Json?
  /// Письмо «как прошёл месяц»: [{ key, title, prose, cites:[{label,ref}] }] (TTS-friendly).
  letterJson            Json?
  /// Месячный компас к цели: { direction:'to_goal'|'drift'|'against', score, monthDelta, pace:{factToGoal,planToGoal,etaIso,leadingSignal}, why, pro:[], contra:[], goalId, goalName }.
  goalAlignmentMonthJson Json?
  /// Тренд осей по неделям: [{ key:'team'|'clients'|'execution'|'overall', weeks:[{weekStart, state}] }] (детерминированно из 4 недельных вердиктов).
  weekTrendJson         Json?
  /// Короткое резюме для рассылки/блока (как DailyOperationsDigest.shortSummary).
  shortSummary          String?  @db.Text
  /// Момент успешной доставки уведомления. NULL — не доставлено.
  deliveredAt           DateTime?
  createdAt      DateTime @default(now())
  /// audit — источник записи. 'demo' для seed демо-кабинета; null для боевых.
  externalSource String?

  tenant Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, periodYm])
  @@index([tenantId, periodYm])
  @@map("monthly_operations_digests")
}
```

Обратная связь в `model Org` — добавить `monthlyOperationsDigests MonthlyOperationsDigest[]` (как для weekly/daily). Версионируемая миграция: `bun run prisma:migrate -- --name add_monthly_operations_digest`; на проде `migrate deploy`. Аддитивная, без backfill. После — `bun run prisma:generate`.

### Ф2 — Синтез: сведение 4 недель + один LLM-проход

`operations-monthly-digest` (новый taskType — нужна отдельная настройка `maxTokens`/модели и независимый промпт месяца; **обоснование:** недельный `operations-weekly-digest` пинит свой пакет/промпт «5 дней», месяц сводит «4 недели» с иной структурой выхода — переиспользовать с флагом гранулярности связало бы два разных контракта в одной точке). Зеркало недельного `generate` ([weekly-digest.service.ts:300-396](../../backend/src/modules/operations/services/weekly-digest.service.ts)):

- `MONTH_COMPANY_SYSTEM_PROMPT` (стабильный, prompt-caching), `buildMonthCompanyUserMessage(pkg)` (переменные данные в конце USER), `MONTH_COMPANY_JSON_SCHEMA` strict, `reasoningEffort:'high'`, `maxTokens:8000`.
- **Пакет (`buildMonthPackage`)** — зеркало `buildWeekPackage`: для каждого понедельника месяца `prisma.weeklyOperationsDigest.findUnique({ select: { weekStart: true, shortSummary?: …, verdictJson: true, metricsJson: true } })`. **Брать компресс-форму** (verdict-states + краткие метрики), НЕ `letterJson`. Отсутствует неделя → `missingWeeks.push(weekStart)`, деградировать (не падать). `metricsJson` — взять только агрегатные числа (надёжность/план-факт/блокеры), не весь.
- Контракт выхода (зеркало недельного, Zod + JSON Schema strict):

```jsonc
{
  "verdict": {
    "overall": { "state": "warn", "emoji": "⚠️", "title": "Месяц половины пути", "oneLiner": "…" },
    "axes": [
      { "key": "team",      "state": "ok",   "label": "Окрепла",       "why": "надёжность 58→68% за месяц" },
      { "key": "clients",   "state": "warn", "label": "Под нагрузкой",  "why": "«Молочные реки» — 9 сигналов" },
      { "key": "execution", "state": "warn", "label": "Рывками",        "why": "цель 6/10 · блокер 3 недели" },
      { "key": "overall",   "state": "warn", "label": "Половина пути",  "why": "2 ровные недели из 4" }
    ]
  },
  "letter": [ { "key": "main", "title": "Главное за месяц", "prose": "…", "cites": [ { "label": "цель «10 тестов»", "ref": "goal:abc" } ] } ],
  "goalAlignmentMonth": { "direction": "drift", "score": 58, "monthDelta": "+6 из 10", "pace": { "factToGoal": 6, "planToGoal": 8, "etaIso": "2026-07-18", "leadingSignal": "если узел оплаты снят к 1-й неделе — сдвиг к началу июля" }, "why": "…", "pro": ["…"], "contra": ["…"] },
  "decisions": [ { "title": "Снять с себя оплаты и интеграции", "why": "узел №1: держал цель 3 недели из 4" } ],
  "nextFocus": [ { "title": "Дожать 4 теста до 10", "why": "при темпе 2-й недели — реально к середине июля" } ],
  "risksSummary": "…",
  "ideasSummary": "…"
}
```

- **`clampMonthVerdict`** (детерминированный clamp поверх LLM, зеркало `clampWeekVerdict`): негативный клиентский сигнал `severity ∈ {high,critical}` за месяц ⇒ `clients.state ≠ ok`; план/факт команды за месяц <50% ИЛИ блокер возрастом ≥ порога ⇒ `execution.state ≠ ok`; любая ось `risk` ⇒ `overall ≥ warn`.
- **`weekTrendJson`** — детерминированно (без LLM): для каждой оси взять `state` из `verdictJson` каждой недели месяца; пустая неделя → `state:'none'`.
- **Темп/прогноз компаса (`pace`)** — детерминированно из месячного `goalAlignment` + `PersonGoalContribution`: `factToGoal` (за месяц), `planToGoal` (плановая линия), `etaIso` (прогноз достижения при текущем темпе), `leadingSignal` (короткий текст ведущего сигнала; допускается из LLM-нарратива).
- Персист в новые поля + `bodyMarkdown`/`metricsJson`/`shortSummary`; «сухой» fallback (NULL вердикта/письма/компаса при падении LLM, `Prisma.JsonNull`).

### Ф3 — Окно месяца + тайминг

- `OperationsMonthlyDigestCron` — `@Cron('0 6 1 * *')` (1-е число 06:00; **[ASSUMPTION: глобально как daily/value-recap, не per-Org — ICP РФ; если владелец захочет per-Org TZ — отдельная правка]**). `periodYm = shiftPeriod(currentPeriodYm, -1)` (прошлый месяц); обход Org `deletedAt:null`; `getOrGenerate`; при `!deliveredAt` → `notifyRecipients` → `markDelivered`.
- Окно: `monthBounds(periodYm)` ([value-recap.service.ts:490](../../backend/src/modules/operations/services/value-recap.service.ts)). «Недели месяца» = понедельники, попадающие в `[from..to]` (хелпер `mondaysInMonth(periodYm)` → 4–5 `weekStart`).
- Крутилки: `monthlyDigestEnabled` (kill-switch, default true) + `monthlyDigestLocalHour` (default 6) — через `resolveSync('betaOps.monthlyDigest*', 'COO_MONTHLY_DIGEST_*', code-fallback)`; строки в [admin-setting-schema-registry.ts](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts) + сид (зеркало `weeklyDigestEnabled`/`weeklyDigestLocalHour`).

### Ф4 — DTO + доступ

`MonthlyOperationsDigestDto` (зеркало `WeeklyOperationsDigestDto`: `periodYm`, `bodyMarkdown`, `metrics`, опц. `verdict?`/`letter?`/`goalAlignmentMonth?`/`weekTrend?`/`shortSummary?`). Контроллер `dashboard/operations/monthly-digest`: `GET /latest`, `GET ?period=YYYY-MM`, `POST /generate` (admin/owner). Чтение — owner/admin/coo/super через `rbac.canViewOperationsDashboard` (зеркало [weekly-digest.controller.ts:106](../../backend/src/modules/operations/controllers/weekly-digest.controller.ts)).

### Ф5 — Frontend контракт

Слои `ApiDto → DomainModel → UiModel`. Вёрстка/состав/порядок — **1:1 по `plans/analysis/2026-06-29-month-company-prototype/index.html`**. UI только русский; парные токены, без `text-white`/hex.

- **Ф5a — герой + таб:** `MonthCompanyHero` (шаблон [WeekCompanyHero.tsx](../../frontend/src/ui/components/dashboard/week-company/WeekCompanyHero.tsx)) рендерится в `MonthDesktopClient` **над** `DashboardCanvas rhythm='month'`. Под-компоненты по прототипу: обложка-вердикт (4 оси + спарклайны) → тренд осей **по неделям** (из `weekTrend`) → кнопка «Читать письмо месяца» (одно разворачивание из `letter`) → слот компаса/таблицы. `useMonthCompanyDigest(orgId)` → `monthlyDigestApi.getLatest()`. Таб «Месяц» в rhythm-switcher ([DirectorDashboardClient.tsx:16](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx)) — **ссылка** на `/month` (не инлайн-canvas).
- **Ф5b — таблица + месячные блоки:** переиспользовать `WeeklyPerPersonWidget` с месячным окном; колонка «Вклад в цель» = сумма 4 недельных `netScore` (расширить `WeeklyPerPersonService`/DTO полем `goalContributionNet`, агрегат по 4 `weekStart`). Блок «Зависло ↔ кто держит» (live `stuck/cross-project` + агрегат по assignee, клик-фильтр). Месяц-специфичные блоки: «Что решить собственнику» (из `decisions`) + «Фокус месяца» (из `nextFocus`) по прототипу.
- **Ф5c — компас месяца:** `GoalCompass3D` (переиспользовать [GoalCompass3D.tsx](../../frontend/src/ui/components/dashboard/shared/GoalCompass3D.tsx)) с входом из `goalAlignmentMonth` + панель **темпа/прогноза** (`pace`: факт/план/ETA/ведущий сигнал) по прототипу. Без новых зависимостей.

---

## Границы фичи

- ✅ Always: новая `MonthlyOperationsDigest` зеркалом Weekly; сведение 4 недель компресс-входом + `missingWeeks`; переиспользовать `GoalCompass3D`/`WeekCompanyHero`-паттерн/`WeeklyPerPersonService`/`stuck/cross-project`/месячные виджеты; крутилки в AdminSetting; идемпотентность `(tenantId, periodYm)`; UI русский; clamp вердикта.
- ⚠️ Ask first: менять окно `WeeklyPerPersonService` глобально (вместо параметра); трогать контракт `ValueRecapSnapshot`/`month-recap`/существующих виджетов; per-Org timezone крона вместо глобального; RBAC за пределами чтения дайджеста.
- 🚫 Never: смешивать вердикт месяца в `ValueRecap.payloadJson`; новый извлекающий LLM-агент сигналов; новая npm-зависимость для компаса; снапшот таблицы план/факт или блока «зависло»; `new PrismaClient()`/`process.env.*`/`prisma migrate dev` на проде; дефолт-OFF флаг; навигатор/архив дат (он в парном ТЗ).

---

## Фазы (dependency-ordered)

Граф: **Ф1 → Ф2 → {Ф3 ∥ Ф4} → Ф5a → {Ф5b ∥ Ф5c} → Ф6**.

### Ф1 — Схема: модель `MonthlyOperationsDigest` `[x]`
- Файлы: `backend/prisma/schema.prisma` (+ `model Org` обратная связь), миграция `prisma/migrations/*_add_monthly_operations_digest/`.
- Входит: модель (Ф1-контракт), relation в Org, `prisma:generate`.
- НЕ входит: сервис/промпт/крон.
- Ценность: как владелец, получаю место для месячного нарратива, чтобы герой имел что показать.
- Acceptance: `grep -n "model MonthlyOperationsDigest" backend/prisma/schema.prisma` → 1; `grep -n "verdictJson\|letterJson\|goalAlignmentMonthJson\|weekTrendJson\|periodYm" backend/prisma/schema.prisma | grep -i monthly` присутствуют; миграция только `CREATE TABLE` (+ FK); `bun run prisma:generate` ok; `bun run typecheck` зелёный; повторный `migrate deploy` = no-op.
- Закрывает: R1.

### Ф2 — Синтез: сведение 4 недель + один LLM-проход `[x]`
- Файлы: `backend/src/modules/operations/services/monthly-digest.service.ts` (новый, зеркало weekly), `backend/src/modules/operations/prompts/monthly-digest.prompt.ts` (`MONTH_COMPANY_SYSTEM_PROMPT`/`buildMonthCompanyUserMessage`/`MONTH_COMPANY_JSON_SCHEMA`/`extractMonthCompanyResponse`/`clampMonthVerdict`/`monthCompanyToBodyMarkdown`), `seed-llm-task-routes-*.ts` (route `operations-monthly-digest`, capable DeepSeek, maxTokens 8000).
- Входит: `getStored`/`getOrGenerate`/`generate`; `buildMonthPackage` (4 недели компресс + `missingWeeks`); один LLM-вызов; `extractMonthCompanyResponse` (lenient); `clampMonthVerdict`; `weekTrendJson` детерминированно; персист новых полей + `bodyMarkdown`/`shortSummary`; «сухой» fallback.
- НЕ входит: крон/DTO/фронт.
- Ценность: как владелец, получаю связный месячный нарратив, сведённый из недель, чтобы понять «как прошёл месяц».
- Acceptance: новый unit на `clampMonthVerdict` (negative: красный клиентский сигнал ⇒ `verdict.axes[clients].state !== 'ok'`); `generate` пишет вердикт/письмо/компас/тренд непустыми при успешном LLM и NULL при смоук-фейле; `weekTrendJson` = 4 оси × ≤5 недель; `buildMonthPackage` берёт `select` БЕЗ `letterJson` (grep-маркер компресс-входа) и заполняет `missingWeeks`; раздел prompt-caching (стабильный SYSTEM — grep-маркер); `bunx vitest run backend/src/modules/operations/services/monthly-digest.*.spec.ts` зелёные; `bun run typecheck/lint/build` зелёные.
- Закрывает: R2, R3(данные тренда), R8(данные компаса/темпа).

### Ф3 — Окно месяца + тайминг `[x]`
- Файлы: `backend/src/modules/operations/workers/operations-monthly-digest.cron.ts` (новый), `monthly-digest.service.ts` (хелпер `mondaysInMonth`), `admin-setting-schema-registry.ts` + сид (`monthlyDigestEnabled`/`monthlyDigestLocalHour`), `operations.module.ts` (регистрация сервиса/крона/контроллера).
- Входит: крон 1-го числа 06:00; `periodYm=shiftPeriod(-1)`; окно `monthBounds`; крутилки.
- НЕ входит: доставка-нотификация (Ф6).
- Ценность: как владелец, 1-го числа утром вижу итог прошлого месяца.
- Acceptance: `operations-monthly-digest.cron.spec.ts` зелёный (окно прошлого месяца, гейт по дню/часу); `grep` дефолтов `monthlyDigestEnabled`/`monthlyDigestLocalHour=6` в реестре/сиде; `mondaysInMonth('2026-05')` → понедельники мая; крон зарегистрирован в `WorkersModule`/`operations.module`.
- Закрывает: R3.

### Ф4 — DTO + доступ `[x]`
- Файлы: `backend/src/modules/operations/dto/monthly-digest.dto.ts`, `backend/src/modules/operations/controllers/monthly-digest.controller.ts`.
- Входит: DTO (зеркало Ф2); `GET /latest`, `GET ?period=`, `POST /generate`; чтение owner/admin/coo/super.
- НЕ входит: фронт.
- Ценность: как владелец, читаю месячный дайджест с `/month` без 403.
- Acceptance: Swagger smoke — `GET /api/v1/dashboard/operations/monthly-digest/latest` под owner → 200 с `verdict`; под member → 403 `forbidden_role`; поля опц. (legacy NULL не падает); `bun run typecheck` зелёный.
- Закрывает: R4(доступ).

### Ф5a — Frontend: герой + таб «Месяц» `[x]`
- Файлы: `frontend/src/ui/components/dashboard/month-company/MonthCompanyHero.tsx` (+ под-компоненты по образцу `week-company/*`), `frontend/app/(authenticated)/month/MonthDesktopClient.tsx` (герой над canvas), `frontend/src/api/operations-monthly-digest.api.ts`, `frontend/src/domain/operations-monthly-digest.ts`, `frontend/src/hooks/useMonthCompany.ts`, `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` (таб «Месяц» — ссылка `/month`).
- Входит: обложка-вердикт + тренд по неделям + письмо (одно разворачивание) + слот компаса/таблицы; SWR на `monthly-digest/latest`; таб-ссылка.
- НЕ входит: таблица/вклад/решения/фокус (Ф5b); компас-темп (Ф5c); навигатор дат (парное ТЗ).
- Ценность: как владелец, на `/month` вижу вердикт+тренд по неделям+письмо месяца первым блоком.
- Acceptance: `/month` под owner показывает `MonthCompanyHero` над canvas; одно «Читать письмо месяца» раскрывает письмо; тренд по неделям рендерится из `weekTrend`; `grep -rn "text-white" frontend/src/ui/components/dashboard/month-company` → 0; англ. строк в новых компонентах — 0; таб «Месяц» в rhythm-switcher ведёт на `/month`; `bun run typecheck/lint/build` (frontend) зелёные.
- Закрывает: R4(поверхность), R5.

### Ф5b — Frontend: таблица + «Вклад в цель» + месячные блоки `[x]`
- Файлы: `MonthCompanyHero` (монтаж), `WeeklyPerPersonWidget` (месячное окно), `weekly-per-person.service.ts` + `weekly-per-person.dto.ts` (поле `goalContributionNet` — сумма 4 недель), блоки «Зависло ↔ кто держит» / «Что решить» / «Фокус месяца».
- Входит: таблица план/факт за месяц + колонка «Вклад в цель»; блок «зависло» (live, клик-фильтр); «что решить собственнику» (из `decisions`); «фокус месяца» (из `nextFocus`).
- НЕ входит: компас-темп (Ф5c); снапшот таблицы/зависшего.
- Ценность: как владелец, за месяц вижу по людям план↔факт+вклад в цель, что решить и куда ведём.
- Acceptance: в таблице колонка «Вклад в цель» (`goalContributionNet` в DTO — Swagger smoke); клик по строке раскрывает план→факт; клик по сотруднику в «зависло» фильтрует (Playwright по прототипу); блоки «решить»/«фокус» рендерятся из digest; empty-state при пустой таблице; `bun run typecheck/lint/build` зелёные.
- Закрывает: R6, R7.

### Ф5c — Frontend: компас месяца + темп/прогноз `[x]`
- Файлы: `MonthCompanyHero` (монтаж компаса), переиспользовать `shared/GoalCompass3D.tsx`, новый под-компонент панели темпа (`MonthGoalPace`).
- Входит: `GoalCompass3D` с входом `goalAlignmentMonth` + панель темпа (`pace`: факт/план/ETA/ведущий сигнал) по прототипу.
- НЕ входит: новые зависимости; правка `GoalCompass3D`.
- Ценность: как владелец, вижу не только «ближе/дальше», а темп и прогноз достижения цели.
- Acceptance: компас рендерится в месячном герое; `grep -rn "three\|@react-three\|lottie" frontend/package.json` → 0 новых; угол стрелки = функция `score`; панель темпа показывает факт/план/ETA; `prefers-reduced-motion` отключает анимацию (наследуется от `GoalCompass3D`); Playwright-скрин совпадает с прототипом; `bun run typecheck/lint/build` зелёные.
- Закрывает: R8.

### Ф6 — Доставка + прод `[x]`
- Файлы: `operations-monthly-digest.cron.ts` (`notifyRecipients`: eventType `operations.monthly_digest`, `actionUrl /month`, заголовок «Месяц компании», роли owner/coo), `docs/operations/prod-deploy-log.md` (Шаг 4 миграция; Шаг 1/7 крутилки-сид; Шаг 12 smoke крон/Swagger), `docs/operations/feature-flags.md` (kill-switch `monthlyDigestEnabled`).
- Входит: рассылка ведёт на `/month`; прод-запись; идемпотентность доставки (`deliveredAt`/`markDelivered`).
- НЕ входит: новый ENV (крутилки — AdminSetting).
- Ценность: как владелец, месячное уведомление 1-го числа открывает «Месяц компании».
- Acceptance: `grep -n "operations.monthly_digest\|/month" operations-monthly-digest.cron.ts`; `prod-deploy-log.md` Шаг 4 содержит миграцию `add_monthly_operations_digest`; `feature-flags.md` содержит строку `monthlyDigestEnabled`; повторная доставка по `deliveredAt` = no-op.
- Закрывает: R3, R5.

---

## Требования (трассировка)

- **R1.** Когда применяется миграция Ф1, существует `MonthlyOperationsDigest` с `periodYm`/`verdictJson`/`letterJson`/`goalAlignmentMonthJson`/`weekTrendJson`/`shortSummary` (nullable нарратив), `@@unique([tenantId, periodYm])`.
- **R2.** Когда крон/`generate` отрабатывает успешно, система shall сохранить вердикт (4 оси), письмо, месячный компас и тренд по неделям в снапшот `(tenantId, periodYm)`, сведя 4 недельных снапшота компресс-входом; повторный прогон = no-op по `getStored`.
- **R3.** Синтез shall запускаться 1-го числа ~06:00 и отчитываться за окно прошлого календарного месяца (`monthBounds(periodYm)`); доставка ведёт на `/month` (eventType `operations.monthly_digest`).
- **R4.** Чтение месячного дайджеста shall быть доступно owner/admin/coo/super на `/month`; владелец shall увидеть `MonthCompanyHero` над canvas.
- **R5.** Owner shall увидеть героя в порядке прототипа: вердикт+тренд по неделям → письмо (одно разворачивание) → компас+темп → таблица план/факт → «что решить»/«фокус» → месячные виджеты.
- **R6.** Таблица план/факт за месяц shall показывать колонку «Вклад в цель» (`goalContributionNet` = сумма 4 недельных `netScore`); блок «Зависло ↔ кто держит» shall фильтровать по клику на сотруднике.
- **R7.** Герой shall показывать блок «что решить собственнику» (1–3 из `decisions`) и «фокус следующего месяца» (из `nextFocus`).
- **R8.** Компас shall рендериться компонентом `GoalCompass3D` (без новых зависимостей) с углом от `score` и панелью темпа/прогноза (`pace`: факт/план/ETA/ведущий сигнал).

---

## Инварианты Z (проверить, не нарушено)
- Prisma — версионируемая файловая миграция (`prisma:migrate -- --name add_monthly_operations_digest`), `prisma:generate` после; в скриптах `createPrismaClient()`, импорты `../src`; никогда голый `new PrismaClient()`.
- ENV/крутилки — `monthlyDigestEnabled`/`monthlyDigestLocalHour` через AdminSetting/`resolveSync`; никаких `process.env.*` мимо `env.schema.ts`; kill-switch — строка в `feature-flags.md`.
- LLM — capable DeepSeek (как `operations-weekly-digest`), Anthropic нет; раздел «Совместимость с prompt caching»: стабильный `MONTH_COMPANY_SYSTEM_PROMPT`, переменные данные (4 недели + сигналы) в конце USER.
- Ship-On — выкат включённым; kill-switch `monthlyDigestEnabled` (default ON).
- Multi-tenancy — все выборки по `tenantId`; снапшот `@@unique([tenantId, periodYm])`, `@@index([tenantId, periodYm])`.
- Контракты — Zod-DTO + Swagger; фронт `ApiDto→DomainModel→UiModel`, единый `api-client.ts`, SWR.
- UI — только русский; парные токены, без `text-white`/hex на цветном.
- Компас — без новых npm-зависимостей (переиспользуем `GoalCompass3D`).
- Без комментариев в коде (CLAUDE.md): нарратив контрактов — в этом ТЗ и `docs/`, не в коде.

## Pre-mortem / Риски
- **Недельный снапшот за неделю месяца отсутствует** (новый Org / пропущенный крон) → `missingWeeks` + деградация нарратива; `weekTrend` ставит `state:'none'`. Эталон — `buildWeekPackage`/`missingDays`.
- **LLM не вернёт строгий JSON** → Zod + «сухой» fallback (NULL новых полей) — как недельный (`extractWeekCompanyResponse`).
- **Граница месяц↔недели** даёт 4 или 5 понедельников → `mondaysInMonth` принимает 4–5; пакет деградирует на отсутствующих.
- **Окно `WeeklyPerPersonService` за месяц** — передаём месячное окно параметром (compute уже принимает `weekEnd`); не менять глобальное поведение страницы операций.
- **Рассинхрон live-таблицы и снапшота-письма** → письмо = «прошлый месяц» (снапшот), таблица/виджеты = live; подписать периоды в UI.
- **Конфликт eventType с витриной** → новый `operations.monthly_digest` (не `operations.monthly_recap`).

## Ревью-аспекты (для `strict-production-review-gate`)
RBAC чтения (owner/admin/coo/super) + tenant-изоляция снапшота и `goalContributionNet`; идемпотентность `generate`/доставки (`deliveredAt`); отсутствие нового извлекающего агента; `clampMonthVerdict` (нельзя «зелёный» при красном клиенте); компресс-вход (не полные `letterJson` — переполнение); отсутствие новых npm-зависимостей; параметр окна не ломает страницу операций; `ValueRecapSnapshot` не тронут.

## Сквозные аспекты (чек нарезки)
- RBAC/tenant — Ф4 + все выборки по `tenantId` `[покрыто]`.
- Observability — метрики месячного крона (зеркало `incCooWeeklyDigestGenerated/Failed` → `incCooMonthlyDigest*`) + лог `missingWeeks` `[покрыто Ф2/Ф3]`.
- Errors+идемпотентность — fallback LLM + `getStored` no-op + доставка по `deliveredAt` `[покрыто Ф2/Ф6]`.
- Миграции/backfill — Ф1 аддитивная, backfill `[N/A: новая таблица]`.
- Rollout/флаг — kill-switch `monthlyDigestEnabled`, Ship-On `[покрыто Ф6]`.
- Тесты — vitest clamp/окно/пакет/`mondaysInMonth` + Playwright герой/таблица/фильтр/компас `[покрыто Ф2/Ф3/Ф5]`.

## Idempotency / feature-flag / prod-deploy
- Миграция Ф1 — аддитивная, повторный `migrate deploy` = no-op → `prod-deploy-log.md` Шаг 4.
- Дефолты крутилок — через сид/реестр AdminSetting → `prod-deploy-log.md` Шаг 1/7.
- Route `operations-monthly-digest` (llm-task-route) — сид → `prod-deploy-log.md` Шаг 7 + регистрация в `apply-prod-deploy.ts STEPS`.
- Флаг — kill-switch `monthlyDigestEnabled` (строка в `feature-flags.md`).

## DoD
`bun run typecheck` (вкл. `.spec`)/`lint`/`build` зелёные (backend и frontend); vitest затронутых файлов зелёные; Playwright-сверка героя/таблицы/фильтра/компаса/темпа с прототипом; second-brain обновлён (`director-dashboard.md` / `ai-jobs.md` / `workers-queues.md` / `data-model.md` / `module-map.md` / `api-layer.md` / `frontend-pages.md`); `prod-deploy-log.md` Шаг 4 (миграция) + Шаг 1/7 (крутилки/route-сид) + Шаг 12 (smoke крон/Swagger); `feature-flags.md` (kill-switch); рефлексия в `05_история/`.

## Итог

**Реализовано целиком (Ф1–Ф6), ветка `feature/month-company-and-report-navigation`.**

| Фаза | Коммит | Что сделано |
|---|---|---|
| Ф1 | `9c36a0b6` | Модель `MonthlyOperationsDigest` (таблица `monthly_operations_digests`, `@@unique([tenantId,periodYm])`) + relation в `Org` + миграция `20260630000000_add_monthly_operations_digest`. |
| Ф2 | `acdf17c6` | `MonthlyDigestService` + `monthly-digest.prompt.ts` (taskType `operations-monthly-digest`, strict JSON + lenient Zod) — свод 4 недель компресс-входом (select без `letterJson`) + `missingWeeks`; `clampMonthVerdict`; `weekTrend` детерминированно; `pace` (факт/план/ETA — код, leadingSignal — LLM); «сухой» fallback; метрики `coo_monthly_digest_*`; route-сид. 17 unit-тестов. |
| Ф3+Ф4 | `f25bbe69` | `OperationsMonthlyDigestCron` (`@Cron('0 * * * *')` + МСК-гейт 1-е число/час, `shiftPeriod(-1)`) + крутилки `betaOps.monthlyDigestEnabled`/`monthlyDigestLocalHour` (resolveSync + реестр + admin-сид) + `MonthlyDigestController` (`/?period=`/`/latest`/`/generate`, RBAC). 11 тестов. |
| Ф5a | `20a2f103` | `MonthCompanyHero` над canvas на `/month` + `MonthVerdictCover` (тренд по неделям) + `MonthLetter` + слои api/domain/hook. Таб «Месяц» в switcher уже был. |
| Ф5b+Ф5c | `376f2cb6` | Таблица план/факт за месяц (reuse `WeeklyPerPersonWidget`, `goalContributionNet` range-sum) + `MonthGoalCompass`+`MonthGoalPace` (компас+темп) + `MonthDecisions`/`MonthNextFocus`/`StaleTasksLinked`. |
| Ф6 | `f13f57a7` | Доставка `operations.monthly_digest` → `/month` (owner/coo) + `markDelivered` (идемпотентно по `deliveredAt`) + регистрация 2 сидов в `apply-prod-deploy` STEPS. |

**Требования:** R1–R8 закрыты (R1 модель+миграция; R2 свод 4 недель+no-op; R3 крон 1-го числа+доставка; R4 RBAC+герой; R5 порядок героя; R6 «вклад в цель» range-sum+«зависло»; R7 «решить»/«фокус»; R8 компас GoalCompass3D+pace).

**Верификация (оркестратором сам):** backend `bun run build` EXIT=0 + `tsc` EXIT=0; vitest по затронутым (clamp/пакет/`mondaysInMonth`/generate/cron/controller) — зелёные; frontend `tsc`/`build`/`lint` EXIT=0, `text-white`=0. Playwright-сверка героя с прототипом — отложена (в проде ещё нет месячного снапшота; визуальная приёмка после первого прогона крона/`generate`).

**Прод-операции:** см. `docs/operations/prod-deploy-log.md` (блок «2026-06-29 — Месяц компании + навигация»): миграция (авто), 3 сида (в STEPS), 2 опц. ENV, kill-switch `betaOps.monthlyDigestEnabled` в `feature-flags.md`.
