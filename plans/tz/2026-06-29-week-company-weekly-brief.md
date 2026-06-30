---
type: tz
status: ready-to-implement
feature: week-company-weekly-brief
date: 2026-06-29
owner: Сергей (svmazur)
relates_to:
  - plans/analysis/2026-06-29-week-company-blueprint.md
  - plans/analysis/2026-06-29-week-company-prototype/index.html
  - plans/tz/2026-06-28-day-company-daily-brief.md
  - second-brain/01_projects/director-dashboard.md
supersedes:
---

> Анализ-основание: `plans/analysis/2026-06-29-week-company-blueprint.md` · Эталон вёрстки/состава: `plans/analysis/2026-06-29-week-company-prototype/index.html` (открыть в браузере; скриншоты в той же папке) · Аналог-предшественник (дневной, зеркальная архитектура): `plans/tz/2026-06-28-day-company-daily-brief.md` · Статус согласования развилок: 2026-06-29 (Р1–Р8 закрыты).

# ТЗ — «Неделя компании»: недельный брифинг владельца на главном экране

## Принцип

«Неделя компании» — недельный близнец «Дня компании». В начале рабочей недели (пн ~06:00 локального времени Org) Кора **сводит 5 ежедневных «Дней компании» (пн–пт)** в связный executive-брифинг за неделю (вердикт 4 оси + тренд по дням + письмо «как прошла неделя» + компас к цели) и показывает его на главном `/dashboard` под переключателем ритма **День ↔ Неделя**. Главная новинка — **таблица по сотрудникам «план ↔ факт»** (надёжность · обещания · задачи план→факт · **вклад в цель** · чек-ины + разворот по задачам) и под ней — срез **«Зависло ↔ кто держит»** (накопленный долг).

Реализуется как **расширение существующего недельного дайджеста** (`WeeklyOperationsDigest` + `WeeklyDigestService` + `OperationsWeeklyDigestCron`), зеркально тому, как «День компании» расширил дневной. **Новый извлекающий агент / модель не вводим.**

## Зачем (болезненное состояние → решение)

1. **Таблица план/факт уже построена, но недостижима с главного экрана.** Виджет `weekly-plan-fact` зарегистрирован в канве только для ритмов `week`/`month` (`presets.ts`), но `/dashboard` жёстко рендерит `rhythm="today"` ([DirectorDashboardClient.tsx:61](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L61)) и **переключателя ритма нет вообще** → пресеты `week`/`month` физически недостижимы; таблица видна только на закопанной странице `/dashboard/operations/weekly` (десктоп; на мобиле — `MobileDealsClient`). Это и есть «таблица пропала».
2. **Недельный отчёт спрятан и «сухой»** — без нарративного слоя «Дня компании» (вердикт 4 оси / письмо / компас), не на главной.
3. **Тайминг не отражает рабочую неделю** — крон бьёт пн в 08:00, окно 7 дней (пн–вс), хотя владелец работает пн–пт.
4. **Компас к цели выглядит дёшево** (плоский SVG) — владелец просит современный 3D-вид с вау-эффектом.

Решение: поднять недельный до уровня «Дня компании», вынести героя на `/dashboard` под переключателем День↔Неделя (он же — недостающий rhythm-switcher, возвращающий таблицу), сузить окно до 5 рабочих дней, переработать компас в премиум CSS/SVG-3D.

---

## REALITY-CHECK (по факту кода на 2026-06-29 — перед правкой перечитать, номера строк верифицировать якорь-символом)

**Уже работает, переиспользуется как есть (НЕ переписывать):**
- Модель `WeeklyOperationsDigest` — [schema.prisma:7921](../../backend/prisma/schema.prisma) (якорь `model WeeklyOperationsDigest {`): `weekStart`/`weekEnd VarChar(10)`, `bodyMarkdown Text`, `metricsJson Json`, `sourcesJson Json`, `llmTaskRouteId String?`, `externalSource String?`; `@@unique([tenantId, weekStart])`, `@@map("weekly_operations_digests")`.
- `WeeklyDigestService` — [weekly-digest.service.ts](../../backend/src/modules/operations/services/weekly-digest.service.ts): `getStored` (:63, ключ `tenantId_weekStart`), `getOrGenerate` (:74), `generate` (:87, taskType `operations-weekly-digest`, персист в `metricsJson`/`sourcesJson`/`bodyMarkdown`), сбор агрегатов читает дневные сущности по окну `dateLocal ∈ [weekStart, weekEnd]` (:205+).
- `OperationsWeeklyDigestCron` — [operations-weekly-digest.cron.ts](../../backend/src/modules/operations/workers/operations-weekly-digest.cron.ts): `@Cron('0 * * * *')` (:27), per-Org timezone, срабатывает при `localHour===weeklyDigestLocalHour && localDay===weeklyDigestLocalDay` (:72), окно `weekStart=todayLocal-7`, `weekEnd=weekStart+6` (:78), доставка `notifyRecipients` → `ConversationalService.sendNotification({ eventType: 'operations.weekly_digest', actionUrl: '/dashboard/operations/weekly?...' })` (:151), kill-switch `weeklyDigestEnabled` (:29).
- `WeeklyPerPersonService` — [weekly-per-person.service.ts](../../backend/src/modules/operations/services/weekly-per-person.service.ts): `compute` (:85), `getPersonWeekItems` (:122). Поля строки (DTO `WeeklyPersonRowDto`): `personName`/`departmentName`/`promisesGiven|Kept|Broken|Overdue|NoAnswer`/`reliabilityPercent` (null = «мало данных» при <`reliability.min_denominator`=3 обещаний)/`tasksDone|tasksPlanned|tasksNotDone`/`checkInsCompleted`. Разворот (`WeeklyPersonItemDto`): `kind ∈ task|commitment|checkin`, `title`, `plannedDue`, `factStatus ∈ done|open|overdue|fulfilled|missed|asked|planned`, `blockedBy`. Сортировки `reliability`/`risk`, `topReliable`/`topRisk`. Кэш Redis 5 мин.
- `PersonGoalContribution` — [schema.prisma:7850](../../backend/prisma/schema.prisma) (якорь `model PersonGoalContribution {`): `proScore`/`contraScore`/`netScore Decimal`, `signalsJson`, `@@unique([tenantId, personId, goalId, weekStart])`. Источник колонки **«Вклад в цель»**. Пишет goal-vector-tracker (weekly).
- DTO недельного — [weekly-digest.dto.ts](../../backend/src/modules/operations/dto/weekly-digest.dto.ts) (`WeeklyDigestMetricsDto`/`WeeklyOperationsDigestDto`); DTO план/факт — [weekly-per-person.dto.ts](../../backend/src/modules/operations/dto/weekly-per-person.dto.ts).
- Крутилки — [typed-config.service.ts:1560](../../backend/src/common/config/typed-config.service.ts): `weeklyDigestEnabled` (ENV `COO_WEEKLY_DIGEST_ENABLED`), `weeklyDigestLocalHour`/`weeklyDigestLocalDay` через `resolveSync('betaOps.weeklyDigestLocalHour', 'COO_WEEKLY_DIGEST_LOCAL_HOUR', …)` (admin→ENV→code).
- Фронт: страница `/dashboard/operations/weekly` — [WeeklyDigestClient.tsx](../../frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx) + [WeeklyPerPersonWidget.tsx](../../frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyPerPersonWidget.tsx) (таблица план/факт с разворотом); виджет канвы `weekly-plan-fact` — [WeeklyPlanFactWidget.tsx](../../frontend/src/ui/components/dashboard/registry/widgets/WeeklyPlanFactWidget.tsx); реестр/пресеты — [widget-registry.ts](../../frontend/src/ui/components/dashboard/registry/widget-registry.ts), [presets.ts](../../frontend/src/ui/components/dashboard/registry/presets.ts).

**Эталон нарративного слоя (брать подход у дневного, НЕ переписывать его):**
- `DailyOperationsDigest.verdictJson/letterJson/goalAlignmentDayJson` + `DailyDigestService` (clamp вердикта, lenient-парс LLM, «сухой» fallback) + герой `frontend/src/ui/components/dashboard/day-company/*` (`DayCompanyHero`, `GoalCompassCard`, `DayLetter`, …). Контракты — `plans/tz/2026-06-28-day-company-daily-brief.md` §Ф1–Ф2.

**Сломано / в scope:**
- Нет rhythm-switcher на `/dashboard` (hardcoded `today`) → таблица недостижима (Ф5a).
- Недельный без вердикта/письма/компаса и не на главной (Ф1, Ф2, Ф5).
- Окно 7 дней + крон 08:00 пн (Ф3).
- Плоский «дешёвый» компас (Ф5c).

---

## Принятые решения владельца (2026-06-29 — не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | Источник синтеза — **свести нарратив из 5 дневных «Дней компании» (пн–пт)** через один capable LLM-проход; числа/таблицу — live из сервисов | «Анализируем 5 дней ежедневных данных»; дёшево; нарратив консистентен с дневным; тренд по дням — бесплатно из дневных вердиктов. Числа точные, не сумма дневных. |
| Р2 | Тайминг — **пн ~06:00 локального**, окно = **5 рабочих дней (пн–пт)** | Сб/вс не рабочие; к утру пн синки за пт+выходные завершены. Правка крутилок + сужение окна. |
| Р3 | Поверхность — **переключатель День ↔ Неделя в одном герое** на `/dashboard` | Закрывает дыру «нет rhythm-switcher» и возвращает таблицу. Не плодит экраны. |
| Р4 | Таблица — **+ колонка «Вклад в цель»** (`PersonGoalContribution.netScore` за неделю) к 5 текущим | Связывает дисциплину с результатом: «двигал ли к цели», не только «много ли делал». Данные уже считаются. |
| Р5 | Разворот строки — **полный план→факт + блокер** (каждый task/commitment/checkin со статусом и причиной) | Данные есть (`getPersonWeekItems`); показывает и сделанное, и проваленное — справедливо. |
| Р6 | Группировка — **плоский список + сортировка** «По надёжности / По риску» | Команда до ~10 чел; сортировки уже в сервисе. Отделы/топ-5 — отложено (числовой триггер ниже). |
| Р7 | **Под таблицей — блок «Зависло ↔ кто держит»** (live stuck/cross-project, связка фильтром) | Не дубль: план/факт = темп этой недели; «зависло» = накопленный долг + «узел». Разные срезы. |
| Р8 | Компас — **премиум CSS/SVG-3D, без новых зависимостей** | Матрица ниже: WebGL (three.js) = +155 КБ gzip + риск версий R3F v9 на Next 14 + ssr:false-вспышка ради одного виджета; Lottie = +140 КБ + внешний ассет. CSS/SVG-3D = 0 КБ, SSR-safe, идеально в тёмную oklch-тему, тренд 2026 (dark glassmorphism). |

Доказательство Р1/архитектуры — blueprint §«Доказательство выбора» (Проход A «расширить недельный дайджест + свести 5 дней» vs Проход B «пересчитать с нуля за 7 дней / новая модель `WeekCompanySnapshot`»; A выигрывает по reuse / стоимости / консистентности нарратива; B дублирует инфраструктуру и рискует рассинхроном с дневным). Challenge-loop: корень (нарратив+поверхность+таблица+тайминг+компас) закрыт; самое дешёвое (расширение, не новая модель/агент); тренд по дням — детерминированный, без лишнего LLM.

### Доказательство выбора компаса (Р8) — состязательная матрица

| Критерий | A · CSS/SVG-3D (выбран) | B · WebGL three.js (R3F) | C · Lottie |
|---|---|---|---|
| Вес бандла | **0 КБ** (нет зависимости) | +~155 КБ gzip three (+R3F/drei) | +~140 КБ рантайм + JSON-ассет |
| React 19 + Next 14 App Router | ✓ нативно | ✗ R3F v9/drei v10 официально таргет Next 15/16 — риск версий | ✓ (lottie-react совместим) |
| SSR | ✓ серверный рендер | ✗ только `ssr:false` → вспышка загрузки | ⚠️ обычно `ssr:false` |
| Тёмная тема / oklch-токены | ✓ те же токены, парные цвета | ⚠️ свой материал/освещение мимо токенов | ✗ цвета запечены в ассет |
| Привязка стрелки к данным | ✓ `--angle` из score | ✓ | ✗ управление прогрессом кадров вручную |
| Лицензия | n/a (свой код) | MIT (three, R3F) | MIT (lottie) + ассет |
| Перформанс | ✓ CSS-композитинг, без GPU-сцены | ⚠️ WebGL-контекст ради 170px виджета | ⚠️ JSON-плеер |
| «Вау» | ✓ глубина/стекло/glow/parallax | ✓✓ настоящий объём | ✓ плавность |

A проигрывает B только по «настоящему объёму», но выигрывает по всем инженерным осям и не рискует версиями ради одного виджета. Источники: [three bundle ~155 КБ gzip](https://github.com/pmndrs/react-three-fiber), [R3F install / версии](https://r3f.docs.pmnd.rs/getting-started/installation), [CSS-гейджи](https://dev.to/madsstoumann/how-to-create-gauges-in-css-3581), [dark glassmorphism 2026](https://timgraf.com/ui/glassmorphism-vs-neumorphism-high-end-ui-guide-2026/).

---

## Scope

**Входит:**
1. Расширение `WeeklyOperationsDigest` тремя nullable JSON-полями (`verdictJson`, `letterJson`, `goalAlignmentWeekJson`) + поле тренда по дням (в `metricsJson` или отдельное `dayTrendJson`).
2. Расширение синтеза `WeeklyDigestService.generate` + промпт `operations-weekly-digest`: сбор пакета = 5 дневных снапшотов (пн–пт) + детерминированные сигналы недели → ОДИН capable LLM-проход → строгий JSON (вердикт/письмо/компас недели/резюме) + post-LLM clamp вердикта; тренд по дням — детерминированно из 5 дневных `verdictJson`; «сухой» fallback.
3. Сужение окна до 5 рабочих дней (пн–пт) и перенос тайминга на пн 06:00 (крутилки).
4. Расширение `WeeklyOperationsDigestDto` (verdict/letter/goalAlignmentWeek/dayTrend) + чтение для owner/admin/coo/super на главной.
5. **rhythm-switcher День↔Неделя на `/dashboard`** (чинит hardcoded `today`) + герой `WeekCompanyHero` по прототипу.
6. Колонка **«Вклад в цель»** в таблице план/факт (новый эндпоинт/расширение `WeeklyPerPersonService` → netScore по главной цели) + блок «Зависло ↔ кто держит» (live).
7. **Премиум-компас `GoalCompass3D`** (CSS/SVG-3D) — общий компонент, используется недельным героем И дневным (`GoalCompassCard` переключается на него — оба получают апгрейд).
8. Доставка `operations.weekly_digest` ведёт на `/dashboard` (таб Неделя), заголовок «Неделя компании».

**Не входит (vNext, с судьбой):**
- Ритм **Месяц** на `/dashboard` — переключатель закладываем расширяемым (День/Неделя/Месяц), но «Месяц»-герой и контент — отдельным ТЗ (`plans/tz/` vNext). Сейчас таб «Месяц» ведёт на существующую страницу/disabled.
- TTS «Озвучить» — disabled-заглушка (как в дневном).
- Группировка таблицы по отделам / топ-5 — **[ASSUMPTION: триггер — при >12 строк в таблице]**; пока плоский список.
- Слияние/чистка старой страницы `/dashboard/operations/weekly` — не трогаем (владелец: «по шагам»).
- Событийная цепочка тайминга на завершение синков — vNext (фикс-час решает).
- Мобильная вёрстка героя — отдельным проходом (тёмная десктоп — канон прототипа).

**Граничные контракты (читаем выход, логику не трогаем):**
- `WeeklyPerPersonService`/`getPersonWeekItems`, `PersonGoalContribution` (goal-vector-tracker), `stuck/cross-project`, `DailyDigestService.getStored` (5 дней), `DailyOperationsDigest.verdictJson` — читаем; их пайплайны не меняем.
- Таблицу план/факт и блок «зависло» **не снапшотим** — live из существующих эндпоинтов; снапшотим только LLM-нарратив недели.

---

## Контракты (контракт-first)

### Ф1 — Prisma: расширить `WeeklyOperationsDigest`

Добавить в `model WeeklyOperationsDigest` (якорь `model WeeklyOperationsDigest {`) nullable-поля (старые строки = NULL → «сухой» fallback):

```prisma
  /// Вердикт недели: { overall:{state,emoji,title,oneLiner}, axes:[{key,state,label,why}] }.
  /// state ∈ 'ok'|'warn'|'risk'; key ∈ 'team'|'clients'|'execution'|'overall'. NULL для legacy/сухого fallback.
  verdictJson          Json?
  /// Письмо «как прошла неделя»: [{ key, title, prose, cites:[{label,ref}] }] — чистая проза (TTS-friendly).
  letterJson           Json?
  /// Недельный компас к цели: { direction:'to_goal'|'drift'|'against', score, weekDelta, why, pro:[], contra:[], goalId, goalName }.
  goalAlignmentWeekJson Json?
  /// Тренд осей по дням пн–пт: [{ key:'team'|'clients'|'execution'|'overall', days:[{dateLocal, state}] }] (детерминированно из 5 дневных вердиктов).
  dayTrendJson         Json?
```

Версионируемая файловая миграция (`bun run prisma:migrate -- --name add_week_company_fields_to_digest`; на проде `migrate deploy`). Аддитивная, без backfill (NULL валиден). После — `bun run prisma:generate`. (Обход shadow-БД при необходимости — как в дневном Ф1: ручной `migration.sql` + `migrate deploy`.)

### Ф2 — Контракт выхода LLM-синтеза (строгий JSON)

`operations-weekly-digest` на финальной стадии (Zod + JSON Schema strict; стабильный SYSTEM, переменные данные пакета — в конце USER):

```jsonc
{
  "verdict": {
    "overall": { "state": "warn", "emoji": "⚠️", "title": "Неделя сдвига вправо", "oneLiner": "…" },
    "axes": [
      { "key": "team",      "state": "ok",   "label": "Норма",   "why": "надёжность 68% · план/факт 25 из 38" },
      { "key": "clients",   "state": "risk", "label": "Риск",    "why": "«Молочные реки» — 3 сигнала за неделю" },
      { "key": "execution", "state": "warn", "label": "Буксует", "why": "цель 2/5 · блокер держал всю неделю" },
      { "key": "overall",   "state": "warn", "label": "Сдвиг",   "why": "3 дня с трением из 5" }
    ]
  },
  "letter": [ { "key": "main", "title": "Главное за неделю", "prose": "…", "cites": [ { "label": "цель «10 тестов»", "ref": "goal:abc" } ] } ],
  "goalAlignmentWeek": { "direction": "drift", "score": 41, "weekDelta": "+2 из 10", "why": "…", "pro": ["…"], "contra": ["…"] },
  "risksSummary": "Два системных узла держали неделю…",
  "ideasSummary": "Онбординг-чеклист собрал поддержку 5 человек…"
}
```

**Пакет на вход синтеза (собрать в `generate`):** 5 дневных снапшотов пн–пт (`DailyDigestService.getStored` × 5 по `dateLocal`; читаем `verdictJson`/`letterJson`/`shortSummary`/`metricsJson` каждого) + детерминированные сигналы недели (надёжность команды и план/факт из `WeeklyPerPersonService.compute`; повторяющиеся блокеры/риски — частота за неделю; динамика к прошлой неделе — `getStored(weekStart-7)`; компас — `goalAlignmentWeek` агрегат). При отсутствии дневного снапшота за день — пометка пробела, нарратив деградирует (не падает).

**Ограничители вердикта (детерминированный clamp поверх LLM, в `WeeklyDigestService`):** негативный клиентский сигнал `severity ∈ {high,critical}` за неделю ⇒ `clients.state ≠ ok`; план/факт команды <50% или блокер возрастом ≥ порога ⇒ `execution.state ≠ ok`.

**Тренд по дням (`dayTrendJson`) — детерминированно**, без LLM: для каждой оси взять `state` из `verdictJson` каждого из 5 дневных снапшотов; пустой день → `state:'none'`.

### Ф3 — Окно пн–пт + тайминг

- Крутилки-дефолты: `weeklyDigestLocalHour` 8→**6**, `weeklyDigestLocalDay` остаётся **1** (пн). Через AdminSetting-реестр (`admin-setting-schema-registry.ts`) + сид; ENV-fallback `COO_WEEKLY_DIGEST_LOCAL_HOUR`. **[ASSUMPTION: `weeklyDigestLocalDay` уже =1 (пн); если иное — выставить 1.]**
- Окно расчёта недели — **пн–пт (5 рабочих дней)**: в кроне `weekEnd = weekStart+4` (вместо `+6`); параметр окна прокинуть в `WeeklyDigestService.generate` и в сбор 5 дневных снапшотов (пн..пт). `WeeklyPerPersonService` — добавить опц. параметр окна (по умолчанию сохранить текущее поведение для страницы операций; недельный герой передаёт пн–пт), чтобы не сломать `/dashboard/operations/weekly`.

### Ф4 — DTO + доступ

`WeeklyOperationsDigestDto` += опц. `verdict?`, `letter?`, `goalAlignmentWeek?`, `dayTrend?` (Zod зеркалит Ф2). Чтение `/latest` и `/?weekStart=` доступно owner/admin/coo/super (как у дневного — проверить `canViewOperationsDashboard`, скорее всего уже пускает; если нет — допустить owner/admin). Существующие поля не трогаем (обратная совместимость `WeeklyDigestClient`).

### Ф5 — Frontend контракт

Слои `ApiDto → DomainModel → UiModel`. Вёрстка/состав/порядок — **1:1 по `plans/analysis/2026-06-29-week-company-prototype/index.html`**. UI только русский; парные токены, без `text-white`/hex на цветном.

**Колонка «Вклад в цель»:** расширить `WeeklyPerPersonDto.rows[]` полем `goalContributionNet: number | null` (net по **главной** цели Org за неделю из `PersonGoalContribution`; нет цели/данных → null/0). Источник — джойн `PersonGoalContribution` по `(tenantId, personId, goalId=главная цель, weekStart)`. **[ASSUMPTION: «главная цель» = активная цель Org с наивысшим приоритетом; если целей несколько — берём приоритетную, не сумму.]**

**rhythm-switcher:** ввести состояние ритма на `/dashboard` (`day`|`week`; `month` — таб ведёт на vNext/disabled). По умолчанию `day`; в понедельник по умолчанию `week` **[ASSUMPTION: дефолт-таб в пн = week, считается по локали Org]**. Заменяет hardcoded `rhythm="today"` ([DirectorDashboardClient.tsx:61](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L61)).

### Ф5c — Премиум-компас `GoalCompass3D` (контракт визуала, CSS/SVG-3D, 0 зависимостей)

Общий компонент `frontend/src/ui/components/dashboard/shared/GoalCompass3D.tsx`. Вход: `{ direction:'to_goal'|'drift'|'against', score:number(0..100), caption:string }`. Эталон — раздел «Цель и компас» в прототипе (улучшенная версия). Обязательные элементы:
- **Зоны** — `conic-gradient` кольцо: к цели (верх, mint) · дрейф (бока, amber) · против (низ, red), мягкие переходы, маска-кольцо (`radial-gradient` mask), внешний glow.
- **Глубина/3D** — стеклянный безель (gradient-border + inset/outset тени), купол-блик (`radial-gradient` highlight, `pointer-events:none`), `perspective` + **parallax-наклон по мыши** (`rotateX/rotateY` на `mousemove`, сброс на `mouseleave`).
- **Стрелка** — металлический градиент (amber→violet) + `drop-shadow` glow + светящийся кончик; угол из данных через CSS-переменную `--angle` (0° = к цели/верх; маппинг score→angle детерминирован); **анимированный взмах** на маунт (`@keyframes` к `var(--angle)`, `cubic-bezier` с лёгким overshoot).
- **Центр** — хаб с числом `score` и подписью зоны.
- **Доступность/перф** — `prefers-reduced-motion` → без parallax/взмаха (статичная стрелка); без WebGL/canvas; только CSS-композитинг.

Используется в `WeekCompanyHero` и в дневном `GoalCompassCard` (одна точка правды компаса).

---

## Границы фичи

- ✅ Always: расширять существующий недельный дайджест; переиспользовать `WeeklyPerPersonService`/`WeeklyPerPersonWidget`/`stuck/cross-project`/5 дневных снапшотов; крутилки в AdminSetting; идемпотентность `(tenantId, weekStart)`; UI русский; компас — общий компонент.
- ⚠️ Ask first: менять контракт старого `WeeklyDigestClient`/страницы операций; менять окно `WeeklyPerPersonService` глобально (вместо параметра); RBAC за пределами чтения дайджеста; новый ENV вместо AdminSetting.
- 🚫 Never: новый извлекающий LLM-агент/taskType/модель; снапшот таблицы план/факт или блока «зависло»; новая зависимость для компаса (three.js/lottie); `prisma migrate dev` руками на проде / `new PrismaClient()` / `process.env.*`; удалять страницу `/dashboard/operations/weekly`; дефолт-OFF флаг.

---

## Фазы (dependency-ordered)

Граф: **Ф1 → Ф2 → {Ф3 ∥ Ф4} → Ф5a → {Ф5b ∥ Ф5c} → Ф6**. Ф5a (rhythm-switcher + каркас героя + вердикт/тренд/письмо/компас-слот) раньше Ф5b (таблица+вклад+зависло) и Ф5c (компас). Ф6 (доставка/прод) последняя.

### Ф1 — Схема: поля снапшота `[x]`
- Файлы: `backend/prisma/schema.prisma` (`WeeklyOperationsDigest`), миграция `prisma/migrations/*_add_week_company_fields_to_digest/`.
- Входит: 4 nullable JSON-поля (Ф1-контракт). `prisma:generate`.
- НЕ входит: backfill; правки сервиса/промпта.
- Ценность: как владелец, получаю место для хранения недельного нарратива, чтобы герой имел что показать.
- Acceptance: `grep -n "verdictJson\|letterJson\|goalAlignmentWeekJson\|dayTrendJson" backend/prisma/schema.prisma` → 4; миграция только `ADD COLUMN`; `bun run prisma:generate` ok; `bun run typecheck` зелёный; повторный `migrate deploy` = no-op.
- Закрывает: R1.

### Ф2 — Синтез: сведение 5 дней + сигналы + один LLM-проход `[x]`
- Файлы: `backend/src/modules/operations/services/weekly-digest.service.ts` (`generate`/сбор пакета/clamp/`dayTrend`), `backend/src/modules/operations/prompts/weekly-digest.prompt.ts` (SYSTEM/USER + JSON Schema strict), `seed-llm-task-routes-*.ts` (если меняется max_tokens capable-бюджета).
- Входит: сбор 5 дневных снапшотов пн–пт (`DailyDigestService.getStored`) + детерминированные сигналы недели (надёжность/план-факт из `WeeklyPerPersonService`, повторяемость блокеров/рисков, динамика к `getStored(weekStart-7)`); ОДИН capable LLM-вызов (taskType `operations-weekly-digest`) → строгий JSON (Ф2) → post-LLM `clampVerdict`; детерминированный `dayTrendJson` из 5 дневных вердиктов; персист в новые поля + `bodyMarkdown`/`metricsJson`; «сухой» fallback (NULL новых полей).
- НЕ входит: новый taskType/очередь; правки 3.5/3.6/goal-vector-tracker.
- Ценность: как владелец, получаю связный недельный нарратив, сведённый из дней, чтобы понять «как прошла неделя».
- Acceptance: `bunx vitest run backend/src/modules/operations/services/weekly-digest.*.spec.ts` зелёные; новый unit на clamp (negative: красный клиентский сигнал ⇒ `verdict.axes[clients].state !== 'ok'`); `generate` пишет 4 новых поля непустыми при успешном LLM и NULL при смоук-фейле; `dayTrendJson` имеет 4 оси × ≤5 дней; раздел prompt-caching в промпте (стабильный SYSTEM — grep-маркер); `bun run typecheck/lint/build` зелёные.
- Закрывает: R2, R4, R8(данные компаса).

### Ф3 — Окно пн–пт + тайминг `[x]`
- Файлы: `operations-weekly-digest.cron.ts` (`weekEnd=weekStart+4`), `weekly-digest.service.ts` (параметр окна), `weekly-per-person.service.ts` (опц. параметр окна), `admin-setting-schema-registry.ts` + сид (дефолт `weeklyDigestLocalHour=6`).
- Входит: окно пн–пт; дефолт 06:00; `WeeklyPerPersonService` — опц. окно (страница операций не меняет поведение).
- НЕ входит: событийная цепочка (vNext).
- Ценность: как владелец, в понедельник утром вижу итог именно рабочей недели.
- Acceptance: `operations-weekly-digest.cron.spec.ts` адаптирован и зелёный (окно пн–пт); `grep` дефолта 6 в реестре/сиде; на момент пн 06:00 локали окно = пн..пт прошлой недели; страница `/dashboard/operations/weekly` не сломана (smoke).
- Закрывает: R3.

### Ф4 — DTO + доступ `[x]`
- Файлы: `weekly-digest.dto.ts` (опц. verdict/letter/goalAlignmentWeek/dayTrend), `weekly-digest.controller.ts` (доступ чтения owner/admin/coo/super).
- Входит: расширение DTO (зеркало Ф2); чтение на главной.
- НЕ входит: новые эндпоинты дайджеста.
- Ценность: как владелец, читаю недельный дайджест с главной без 403.
- Acceptance: Swagger smoke — `GET /api/v1/.../weekly-digest/latest` под owner → 200 с `verdict`; под member → 403 `forbidden_role`; поля опц. (старый клиент не падает); `bun run typecheck` зелёный.
- Закрывает: R5(контракт), R7(доступ).

### Ф5a — Frontend: rhythm-switcher + каркас героя `[x]`
- Файлы: `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` (состояние ритма вместо hardcoded `today`), новые `frontend/src/ui/components/dashboard/week-company/WeekCompanyHero.tsx` + под-компоненты (обложка-вердикт + тренд по дням + «Читать недельное письмо» + слот компаса), `src/api/*.api.ts` + `src/domain/*.ts` (DTO→Domain→Ui), SWR-хук на `weekly-digest/latest`.
- Входит: переключатель День↔Неделя(↔Месяц-disabled); рендер обложки-вердикта (4 оси) + тренд по дням (из `dayTrend`) + одно разворачивание письма (из `letter`); слот под компас и таблицу.
- НЕ входит: таблица/вклад/зависло (Ф5b); реализация компаса (Ф5c); ритм Месяц-контент.
- Ценность: как владелец, на `/dashboard` переключаюсь на «Неделя» и вижу вердикт+тренд+письмо недели первым блоком.
- Acceptance: на `/dashboard` под owner есть переключатель День↔Неделя; `grep -n 'rhythm="today"' frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` → 0 (заменён состоянием); одно «Читать недельное письмо» раскрывает всё письмо; `grep -rn "text-white" frontend/src/ui/components/dashboard/week-company` → 0; англ. строк в новых компонентах — 0; `bun run typecheck/lint/build` (frontend) зелёные.
- Закрывает: R5, R6(поверхность).

### Ф5b — Frontend: таблица план/факт (+«Вклад в цель») + блок «Зависло ↔ кто держит» `[x]`
- Файлы: `WeekCompanyHero` (монтаж), переиспользовать `WeeklyPerPersonWidget` (+ колонка «Вклад в цель»), `weekly-per-person.service.ts` + `weekly-per-person.dto.ts` (поле `goalContributionNet`), блок «зависло» (live `stuck/cross-project` + агрегат по assignee, связка фильтром).
- Входит: колонка «Вклад в цель» (`+N/0/−N`); разворот полный план→факт+блокер; сортировка надёжность/риск (плоский список); блок «зависло» по прототипу (левый список + правый «у кого» + клик-фильтр).
- НЕ входит: снапшот таблицы/зависшего; группировка по отделам.
- Ценность: как владелец, за неделю вижу по людям план↔факт и вклад в цель, и отдельно — что зависло и у кого.
- Acceptance: в таблице 7 колонок (вкл. «Вклад в цель»); `goalContributionNet` в DTO (Swagger smoke `/weekly-per-person` → поле присутствует); клик по строке раскрывает план→факт+блокер; клик по сотруднику в «зависло» фильтрует список (Playwright по прототипу-эталону); empty-state при пустой таблице (нет обещаний за неделю); `bun run typecheck/lint/build` зелёные.
- Закрывает: R4(UI), R7(блок «зависло»).

### Ф5c — Frontend: премиум-компас `GoalCompass3D` `[x]`
- Файлы: `frontend/src/ui/components/dashboard/shared/GoalCompass3D.tsx` (+ стили), подключение в `WeekCompanyHero` и замена в дневном `day-company/GoalCompassCard`.
- Входит: компас по контракту Ф5c (conic-зоны, стеклянный безель+купол, металлическая стрелка+glow, `--angle` из score, анимированный взмах, parallax-наклон, `prefers-reduced-motion`-fallback). Без новых зависимостей.
- НЕ входит: WebGL/three.js/lottie; новые npm-пакеты.
- Ценность: как владелец, вижу современный «вау»-компас к цели вместо плоского SVG (и в недельном, и в дневном).
- Acceptance: `GoalCompass3D` рендерится в недельном и дневном героях; `grep -rn "three\|@react-three\|lottie" frontend/package.json` → 0 новых (зависимость не добавлена); угол стрелки = функция `score` (unit/визуальная проверка: score 41/drift → стрелка в amber-зоне); `prefers-reduced-motion` отключает анимацию/parallax; `grep -rn "text-white" .../GoalCompass3D.tsx` → 0; `bun run typecheck/lint/build` зелёные; Playwright-скрин совпадает с эталоном прототипа.
- Закрывает: R8.

### Ф6 — Доставка + прод `[x]`
- Файлы: `operations-weekly-digest.cron.ts` (`notifyRecipients`: `actionUrl`→`/dashboard` таб Неделя; заголовок «Неделя компании»), `docs/operations/prod-deploy-log.md` (Шаг 4 — миграция; Шаг 1 — дефолт крутилки если через сид), `docs/operations/feature-flags.md` (kill-switch `weeklyDigestEnabled` — обновить строку).
- Входит: рассылка ведёт на главный экран (таб Неделя); прод-запись.
- НЕ входит: новый ENV/флаг (kill-switch `weeklyDigestEnabled` переиспользуем).
- Ценность: как владелец, недельное уведомление в пн утром открывает «Неделю компании» на главной.
- Acceptance: `grep -n "/dashboard" operations-weekly-digest.cron.ts` (actionUrl обновлён); `prod-deploy-log.md` Шаг 4 содержит миграцию `add_week_company_fields_to_digest`; идемпотентность доставки (`deliveredAt`/существующая логика) сохранена.
- Закрывает: R3, R5.

---

## Требования (трассировка)

- **R1.** Когда применяется миграция Ф1, `WeeklyOperationsDigest` имеет `verdictJson`/`letterJson`/`goalAlignmentWeekJson`/`dayTrendJson` (nullable), старые строки = NULL.
- **R2.** Когда крон/`generate` отрабатывает успешно, система shall сохранить вердикт (4 оси), письмо-секции, недельный компас и тренд по дням в снапшот `(tenantId, weekStart)`; повторный прогон = no-op по `getStored`.
- **R3.** Синтез shall запускаться в пн ~06:00 локального времени Org и отчитываться за окно **пн–пт** прошлой недели.
- **R4.** Если в сигналах недели есть негативный клиентский сигнал `severity ∈ {high,critical}`, then ось `clients` вердикта shall быть не `ok`; таблица план/факт shall показывать колонку «Вклад в цель» (`goalContributionNet`).
- **R5.** Owner на `/dashboard` shall переключателем открыть «Неделя» и увидеть героя: вердикт+тренд по дням → письмо (одно разворачивание) → компас → таблица план/факт → «Зависло ↔ кто держит» → риски/идеи → польза, в порядке прототипа.
- **R6.** `/dashboard` shall иметь rhythm-switcher День↔Неделя (заменяя hardcoded `today`); в пн дефолт-таб shall быть «Неделя».
- **R7.** Чтение недельного дайджеста на главной shall быть доступно owner/admin/coo/super; блок «Зависло ↔ кто держит» shall фильтровать список задач по клику на сотрудника.
- **R8.** Компас к цели shall рендериться компонентом `GoalCompass3D` (CSS/SVG-3D, без новых зависимостей), с углом стрелки как функцией `score` и `prefers-reduced-motion`-fallback.

---

## Инварианты Z (проверить, не нарушено)
- Prisma — версионируемые файловые миграции (`prisma:migrate -- --name …`), `prisma:generate` после; в скриптах `createPrismaClient()`.
- ENV/крутилки — `weeklyDigestLocalHour/Day` через AdminSetting/`resolveSync`; никаких `process.env.*`; kill-switch `weeklyDigestEnabled` (новый флаг не вводим).
- LLM — capable DeepSeek V4 Pro (как `operations-weekly-digest`), Anthropic нет; **раздел «Совместимость с prompt caching»**: стабильный SYSTEM, переменные данные (5 дней + сигналы) в конце USER.
- Ship-On — выкат включённым; новый флаг не вводим.
- Multi-tenancy — все выборки по `tenantId`; снапшот `@@unique([tenantId, weekStart])`.
- Контракты — Zod-DTO + Swagger; фронт `ApiDto→DomainModel→UiModel`, единый `api-client.ts`, SWR.
- UI — только русский; парные токены, без `text-white`/hex на цветном.
- Компас — **без новых npm-зависимостей** (CSS/SVG-3D).

## Pre-mortem / Риски
- **Дневной снапшот за день недели отсутствует** (сбой/выходной) → нарратив помечает пробел, не падает; `dayTrend` ставит `state:'none'` за день.
- **LLM не вернёт строгий JSON** → Zod + «сухой» fallback (NULL новых полей) — как в дневном (lenient-парс: toolCalls + обёртка `{result}`).
- **Сужение окна ломает страницу операций** → `WeeklyPerPersonService` получает окно параметром, дефолт сохраняет текущее поведение.
- **Пустая таблица** (нет обещаний за неделю) → явный empty-state.
- **Рассинхрон live-таблицы и снапшота-письма** → письмо = «прошлая неделя» (снапшот), таблица/зависло = live; подписать периоды в UI.
- **Компас «вау» не дотянет до ожидания** → эталон в прототипе, Playwright-сверка; parallax/взмах за `prefers-reduced-motion`.

## Ревью-аспекты (для `strict-production-review-gate`)
RBAC чтения дайджеста (owner/admin/coo/super) + tenant-изоляция снапшота и `goalContributionNet`; идемпотентность `generate`/доставки; отсутствие нового извлекающего агента/модели; clamp вердикта (нельзя «зелёный» при красном клиенте); обратная совместимость `WeeklyDigestClient` и страницы операций; отсутствие новых npm-зависимостей у компаса; параметр окна не ломает страницу операций.

## Сквозные аспекты (чек нарезки)
- RBAC/tenant — Ф4 (доступ) + все выборки по `tenantId` `[покрыто]`.
- Observability — переиспользуем метрики недельного крона (`incCooWeeklyDigestFailed`) + лог пробелов синтеза `[покрыто Ф2]`.
- Errors+идемпотентность — fallback LLM + `getStored` no-op `[покрыто Ф2]`.
- Миграции/backfill — Ф1 аддитивная, backfill `[N/A: NULL валиден]`.
- Rollout/флаг — kill-switch `weeklyDigestEnabled`, Ship-On `[покрыто Ф6]`.
- Тесты — vitest clamp/окно/синтез + Playwright герой/фильтр/компас `[покрыто Ф2/Ф3/Ф5]`.

## Idempotency / feature-flag / prod-deploy
- Миграция Ф1 — аддитивная, повторный `migrate deploy` = no-op → `prod-deploy-log.md` Шаг 4.
- Дефолт крутилки 06:00 — через сид/реестр AdminSetting → `prod-deploy-log.md` Шаг 1/7 (если сид).
- Флаг — kill-switch `weeklyDigestEnabled` (строка в `feature-flags.md`); новый не вводим.
- Seed/patch/backfill — нет (NULL валиден; дефолт крутилки — через реестр).

## DoD
`bun run typecheck` (вкл. `.spec`)/`lint`/`build` зелёные (backend и frontend); vitest затронутых файлов зелёные; Playwright-сверка героя/таблицы/фильтра/компаса с прототипом; second-brain обновлён по таблице производных заметок (`director-dashboard.md` / `ai-jobs.md` / `data-model.md` / `api-layer.md` / `frontend-pages.md`); `prod-deploy-log.md` Шаг 4 (миграция) + Шаг 1/7 (крутилка); рефлексия в `05_история/`.

## Итог

**Реализовано целиком (Ф1–Ф6, R1–R8).** Ветка `feature/week-company-weekly-brief`, 9 коммитов:
- `1ae60242` Ф1 — 4 nullable JSONB + миграция `20260629010000_add_week_company_fields_to_digest` (ручная файловая, локальной БД нет).
- `11485adb` Ф2 — синтез (свод 5 дней + сигналы → один capable LLM-проход json_schema strict + `clampWeekVerdict` R4 + детерминированный `dayTrend` + «сухой» fallback; контракт `WEEK_COMPANY_*`). Конструктор += `WeeklyPerPersonService`.
- `c8214ae0` Ф3 — окно пн–пт (cron weekEnd+4) + тайминг пн 06:00 (R3) + опц. окно `WeeklyPerPersonService` (страница операций не меняется).
- `ae94cb59` Ф4 — `getLatest` + `GET /weekly-digest/latest` (R5/R7-доступ через `canViewOperationsDashboard`) + ручной generate пн–пт.
- `37754bf0` Ф5a — rhythm-switcher День↔Неделя (R6, убран hardcoded `rhythm="today"`) + каркас `WeekCompanyHero` (R5).
- `68a9c509` Ф5b-backend — `goalContributionNet` (R4-UI: вклад в главную цель из `PersonGoalContribution`).
- `36bf81c7` Ф5c — общий `GoalCompass3D` (R8, CSS/SVG-3D, 0 зависимостей) в недельном И дневном.
- `afabee9b` Ф5b-frontend — колонка «Вклад в цель» + таблица + «Зависло ↔ кто держит» в герое (R4/R7).
- `2bcc7df8` Ф6 — доставка `/dashboard?rhythm=week` «Неделя компании» (R3/R5) + prod-deploy-log + feature-flags.

**Ф4** по RBAC оказался не no-op (как в дневном): у недельного контроллера не было `/latest` — добавлен (зеркало дневного, нужен фронт-герою). Доступ чтения `canViewOperationsDashboard` уже пускал owner/admin/coo/super.

**Верификация:** backend typecheck 0 (8GB heap) / lint 0 / 560 operations-тестов; frontend typecheck 0 / lint 0 / `next build` ok / 35 unit-тестов. Визуальная сверка компаса с прототипом — совпадает; живая приёмка в кабinете — после выката.

**vNext (вне scope, объявлено в ТЗ → реестр `04_не-сделано/`):** ритм «Месяц»-герой, TTS «Озвучить» (disabled-заглушка стоит), группировка таблицы по отделам/топ-5 (>12 строк), мобильная вёрстка героя, событийная цепочка тайминга на завершение синков, слияние старой страницы `/dashboard/operations/weekly`.

**Прод-операция:** 1 аддитивная миграция (авто через migrate-контейнер) + дефолт крутилки `weeklyDigestLocalHour` 8→6 (авто через `apply-prod-deploy` seed-base). seed/patch/backfill/ENV/новые флаги — не требуются. Детали — `docs/operations/prod-deploy-log.md` Шаг 4/7.
