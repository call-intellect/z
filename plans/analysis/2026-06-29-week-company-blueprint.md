---
type: analysis
status: ready-for-tz
feature: week-company-weekly-brief
date: 2026-06-29
owner: Сергей (svmazur)
relates_to:
  - plans/tz/2026-06-28-day-company-daily-brief.md
  - plans/analysis/2026-06-28-day-company-daily-brief-blueprint.md
  - plans/analysis/2026-06-29-week-company-prototype/index.html
  - second-brain/01_projects/director-dashboard.md
  - second-brain/01_projects/goals-and-strategic-alignment.md
---

> Эталон вёрстки/состава: `plans/analysis/2026-06-29-week-company-prototype/index.html` (открыть в браузере) · скриншоты в той же папке. Аналог-предшественник (дневной): `plans/tz/2026-06-28-day-company-daily-brief.md`. Развилки согласованы с владельцем 2026-06-29.

# Анализ — «Неделя компании»: недельный брифинг владельца на главном экране

## Принцип

«Неделя компании» — недельный близнец «Дня компании»: в начале рабочей недели Кора сводит **5 ежедневных «Дней компании» (пн–пт)** в связный executive-брифинг за неделю (вердикт 4 оси + тренд по дням + письмо «как прошла неделя» + компас к цели) и выносит его на главный экран `/dashboard` под переключателем **День ↔ Неделя**. Главная новинка недельного — **таблица по сотрудникам «план ↔ факт»**: кто что обещал/планировал и что вышло.

Реализуется как **расширение уже существующего недельного дайджеста** (`WeeklyOperationsDigest` + `WeeklyDigestService` + `OperationsWeeklyDigestCron`), ровно как «День компании» был расширением дневного. Новый извлекающий агент/модель не вводим.

## Зачем (болезненное состояние → решение)

Главная находка анализа: **бóльшая часть фичи уже построена, но недостижима с главного экрана.**

1. **Таблица план/факт уже есть — но «осиротела».** Виджет `weekly-plan-fact` ([WeeklyPlanFactWidget.tsx](../../frontend/src/ui/components/dashboard/registry/widgets/WeeklyPlanFactWidget.tsx)) зарегистрирован в канве **только для ритмов `week` и `month`** ([presets.ts](../../frontend/src/ui/components/dashboard/registry/presets.ts) строки 28/48/77/97). Но главный экран **жёстко прибит к ритму `today`** — [DirectorDashboardClient.tsx:61](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L61) `<DashboardCanvas role={role} rhythm="today" />`, **переключателя ритма нет вообще**. Итог: пресеты `week`/`month` физически недостижимы; таблица видна только на закопанной странице `/dashboard/operations/weekly` (десктоп; на мобиле там вместо неё `MobileDealsClient`). Это и есть «таблица пропала».
2. **Недельный отчёт спрятан и «сухой».** `WeeklyDigestClient` живёт во вкладке операций, на главную не выходит, и у него нет нарративного слоя «Дня компании» (вердикт 4 оси / письмо / компас) — только метрики и markdown.
3. **Тайминг не отражает рабочую неделю.** Крон бьёт по понедельникам в **08:00** локального времени (`weeklyDigestLocalHour`/`weeklyDigestLocalDay`) и считает окно как **7 дней** (пн–вс). Владелец работает **пн–пт** (суббота-воскресенье не рабочие).

Решение: поднять недельный до уровня «Дня компании» (вердикт+письмо+компас+тренд по дням), вынести героя на `/dashboard` под переключателем День↔Неделя (он же — недостающий переключатель ритма, который возвращает таблицу), и сузить окно до 5 рабочих дней.

---

## REALITY-CHECK (что уже есть — по факту кода на 2026-06-29)

**Бэкенд — переиспользуется как есть (НЕ переписывать):**
- Модель `WeeklyOperationsDigest` — [schema.prisma:7921](../../backend/prisma/schema.prisma) (`weekStart`/`weekEnd` VarChar(10), `bodyMarkdown`, `metricsJson`, `sourcesJson`, `llmTaskRouteId?`, `externalSource?`; `@@unique([tenantId, weekStart])`).
- `WeeklyDigestService` — [weekly-digest.service.ts](../../backend/src/modules/operations/services/weekly-digest.service.ts): `getStored`/`getLatest`/`getOrGenerate`/`generate`; собирает агрегаты за неделю + один LLM-вызов `operations-weekly-digest`.
- `OperationsWeeklyDigestCron` — [operations-weekly-digest.cron.ts](../../backend/src/modules/operations/workers/operations-weekly-digest.cron.ts): `@Cron('0 * * * *')`, per-Org timezone, срабатывает при `localHour===weeklyDigestLocalHour && localDay===weeklyDigestLocalDay`; доставка через `ConversationalService.sendNotification({ eventType: 'operations.weekly_digest' })`; kill-switch `weeklyDigestEnabled`.
- **`WeeklyPerPersonService`** — [weekly-per-person.service.ts](../../backend/src/modules/operations/services/weekly-per-person.service.ts): по каждому сотруднику считает `promisesGiven/Kept/Broken/Overdue/NoAnswer`, `reliabilityPercent` (при ≥3 обещаниях, иначе «мало данных»), `tasksDone/tasksPlanned/tasksNotDone`, `checkInsCompleted`; метод `getPersonWeekItems` отдаёт разворот — каждый commitment/task/checkin с `factStatus` (`done/overdue/missed/fulfilled/asked/planned`) и `blockedBy`. Сортировки `reliability`/`risk`, `topReliable`/`topRisk`. DTO — [weekly-per-person.dto.ts](../../backend/src/modules/operations/dto/weekly-per-person.dto.ts).
- `PersonGoalContribution` — [schema.prisma:7850](../../backend/prisma/schema.prisma): `proScore`/`contraScore`/`netScore` по `(tenantId, personId, goalId, weekStart)` + `signalsJson` (провенанс). Источник колонки **«Вклад в цель»** в таблице.
- Контроллеры: `weekly-digest.controller`, `weekly-per-person.controller`, `my-weekly-per-person.controller`.

**Фронтенд — переиспользуется:**
- Страница `/dashboard/operations/weekly` — [WeeklyDigestClient.tsx](../../frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyDigestClient.tsx) (тренд, температура команды, цели, блокеры, инсайты, висящие решения, KPI-дельты, динамика команды, прогноз, идеи) + [WeeklyPerPersonWidget.tsx](../../frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyPerPersonWidget.tsx) (таблица план/факт с разворотом по людям).
- Реестр канвы: `weekly-plan-fact` в [widget-registry.ts](../../frontend/src/ui/components/dashboard/registry/widget-registry.ts) + пресеты `week`/`month`.

**Эталон нарративного слоя (взять подход у дневного):**
- `DailyOperationsDigest.verdictJson/letterJson/goalAlignmentDayJson` — [schema.prisma](../../backend/prisma/schema.prisma) + `DailyDigestService` (clamp вердикта, fallback) + герой `DayCompanyHero` (`frontend/src/ui/components/dashboard/day-company/*`). См. `plans/tz/2026-06-28-day-company-daily-brief.md`.

**Сломано / в scope:**
- Нет переключателя ритма на `/dashboard` (hardcoded `today`) → таблица недостижима.
- Недельный дайджест без вердикта/письма/компаса и не на главной.
- Окно 7 дней + крон 08:00 пн — не «рабочая неделя пн–пт, утро ~06:00».

---

## Принятые решения владельца (2026-06-29)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Источник недельного синтеза — **свести нарратив из 5 дневных «Дней компании» (пн–пт)**; числа и таблицу план/факт — из живых сервисов за неделю | Ровно «анализируем 5 дней ежедневных данных»; дёшево; нарратив консистентен с тем, что владелец читал по дням. Числа точные (не сумма дневных). |
| Р2 | Тайминг — **понедельник ~06:00 локального времени**, окно = **5 рабочих дней (пн–пт)** | Суббота-воскресенье не рабочие; к утру пн синки за пт+выходные завершены; правка крутилок `weeklyDigestLocalHour`/`Day` + сужение окна. |
| Р3 | Поверхность — **переключатель День ↔ Неделя в одном герое** на `/dashboard` | Он же закрывает дыру «нет переключателя ритма» и возвращает таблицу план/факт на поверхность. Не плодит экраны. |
| Р4 | Таблица план/факт — **+ колонка «Вклад в цель»** (net из `PersonGoalContribution`) к 5 текущим колонкам | Связывает дисциплину с результатом: видно не только «много ли делал», но «двигал ли к цели». Данные уже считаются. |
| Р5 | Разворот строки — **полный план→факт + блокер** (каждый task/commitment/checkin со статусом и причиной) | Данные уже есть (`getPersonWeekItems`); показывает и сделанное, и проваленное — справедливо и информативно. |
| Р6 | Группировка — **плоский список + сортировка** «По надёжности / По риску» | Для команды до ~10 человек идеально; сортировки уже в сервисе. Группировку по отделам/топ-5 отложить до больших команд. |
| Р7 | **Под таблицей план/факт — блок «Зависло ↔ кто держит»** (срез накопленного долга, связка «клик по человеку → фильтр списка») | Не дубль план/факт: план/факт = темп **этой** недели по людям; «зависло» = накопленный долг (задачи висят хоть с прошлого месяца) + «узел». Разные срезы. Данные live из `GET /api/v1/dashboard/stuck/cross-project` + stale-issues + агрегат по assignee (тот же виджет, что в «Дне компании», в недельной рамке). |
| Р8 | **Компас к цели — премиум CSS/SVG-3D, без новых зависимостей** (conic-зоны + стеклянный безель/купол + металлическая светящаяся стрелка + анимированный взмах + parallax-наклон; общий компонент `GoalCompass3D` для недельного и дневного героев) | WebGL (three.js/R3F) = +~155 КБ gzip + риск версий R3F v9 на Next 14 + ssr:false-вспышка ради одного 170px-виджета; Lottie = +~140 КБ + внешний дизайн-ассет + ручная привязка стрелки. CSS/SVG-3D = 0 КБ, SSR-safe, нативно React19/Next14, идеально в тёмную oklch-тему, тренд 2026 (dark glassmorphism). Полная матрица — в ТЗ. Эталон вида — раздел «Цель и компас» в прототипе. |

---

## Архитектура «Недели компании» (зеркало «Дня компании»)

1. **Схема** — расширить `WeeklyOperationsDigest` тремя nullable JSON-полями: `verdictJson` (4 оси + overall, как у дневного), `letterJson` (секции письма недели), `goalAlignmentWeekJson` (недельный компас). Аддитивная миграция, NULL валиден (legacy → сухой fallback). **Таблицу план/факт НЕ снапшотим** — тянем live из `WeeklyPerPersonService` (числа всегда свежие).
2. **Синтез** — расширить `WeeklyDigestService.generate`/промпт `operations-weekly-digest`: собрать пакет = **5 дневных снапшотов за пн–пт** (`DailyDigestService.getStored` × 5) + детерминированные сигналы недели (надёжность команды, план/факт, повторяющиеся блокеры/риски, динамика к прошлой неделе) → ОДИН capable LLM-проход → строгий JSON (вердикт/письмо/компас/тренд по дням/резюме рисков-идей) → post-LLM clamp вердикта (красный клиент/исполнение ⇒ ось ≠ ok) → персист в новые поля + `bodyMarkdown`/`metricsJson`. Fallback при провале LLM — как у дневного.
3. **Тренд по дням** — детерминированный: 4 оси × 5 дней берём из `verdictJson` каждого из 5 дневных снапшотов (без LLM).
4. **Окно** — сузить расчёт до пн–пт (5 рабочих дней) в кроне и в `WeeklyPerPersonService` (либо параметром окна).
5. **Тайминг** — крутилки `weeklyDigestLocalHour=6`, `weeklyDigestLocalDay=1` (пн).
6. **DTO + доступ** — расширить `WeeklyOperationsDigestDto` (verdict/letter/goalAlignmentWeek опц.); чтение на главной для owner/admin/coo/super (как у дневного — RBAC скорее всего уже пускает).
7. **Фронт** — единый герой на `/dashboard` с табом День↔Неделя: на «Неделя» рендерится `WeekCompanyHero` (обложка-вердикт + тренд по дням → недельное письмо → компас недели → **таблица план/факт** (переиспользуем `WeeklyPerPersonWidget` + новая колонка «Вклад в цель») → **блок «Зависло ↔ кто держит»** (live stuck/cross-project + агрегат по assignee, связка фильтром — срез накопленного долга, не план/факт) → риски/идеи недели → польза за неделю). Переключатель = недостающий rhythm-switcher (вместо hardcoded `today`).
8. **Доставка** — рассылка `operations.weekly_digest` ведёт на `/dashboard` (таб Неделя), заголовок «Неделя компании».

---

## Таблица план/факт — согласованный контракт (центр экрана)

Колонки (каждая ложится на реальное поле; источник — `WeeklyPerPersonService` + `PersonGoalContribution`):

| Колонка | Источник | Вид |
|---|---|---|
| Сотрудник + отдел | `personName`, `departmentName` | аватар + имя |
| Надёжность | `reliabilityPercent` | % + полоска, цвет; «мало данных» при <3 обещаний |
| Обещания | `promisesGiven/Kept/Broken/Overdue` | пилюли дал/сдержал/сорвал/просрочил |
| Задачи план→факт | `tasksPlanned/tasksDone/tasksNotDone` | `8→4` + «4 не сделал» |
| **Вклад в цель** | `PersonGoalContribution.netScore` за неделю | `+N` / `0` / `−N` (к цели/нейтрально/мимо) |
| Чек-ины | `checkInsCompleted` | `4/5` |
| Итог | производный | бейдж Надёжный / В норме / Риск / Узкое место |
| Разворот | `getPersonWeekItems` | каждый task/commitment/checkin: статус (сделано/просрочено/сорвано/в плане) + блокер |

Сверху — сводка: надёжность команды, задачи план→факт по команде, чек-ины, «главный узел» (у кого больше всего несделанного). Сортировка «По надёжности / По риску». Низ — пояснение формулы надёжности и где полная история («Отчётность»).

---

## Доказательство выбора (двухпроходное сведение)

**Главная развилка — источник недельного синтеза.**

- **Проход A — свести 5 дневных снапшотов + live-числа (выбран).** Reuse дневных «Дней компании»; дёшево (один LLM-проход поверх готового сырья); нарратив консистентен с дневным; тренд по дням бесплатно из дневных вердиктов. Минус: при сбое дневного снапшота — пробел в нарративе (лечится fallback на сырьё за день).
- **Проход B — пересчитать неделю с нуля по сырью за 7 дней.** Как сейчас работает существующий недельный дайджест. Больше данных, но дороже, дублирует уже посчитанное дневными, и недельный нарратив может разойтись с тем, что владелец читал по дням.

A выигрывает по reuse / стоимости / консистентности; B проигрывает дублированием и риском рассинхрона. **Challenge-loop:** корень (нарратив + поверхность + таблица + тайминг) закрыт; самое дешёвое (расширение, не новая модель/агент); тренд по дням — детерминированный, без лишнего LLM.

**Вторая развилка — снапшотить ли таблицу план/факт.** Нет: числа должны быть свежими, `WeeklyPerPersonService` уже кэширует (Redis 5 мин). Снапшотим только LLM-нарратив.

---

## Границы (reuse vs new)

- ✅ Always: расширять существующий недельный дайджест; переиспользовать `WeeklyPerPersonService`/`WeeklyPerPersonWidget`/дневные снапшоты; крутилки в AdminSetting; идемпотентность `(tenantId, weekStart)`; UI русский, парные токены.
- ⚠️ Ask first: трогать контракт старого `WeeklyDigestClient`; менять окно `WeeklyPerPersonService` (повлияет на страницу операций); RBAC за пределами чтения для owner.
- 🚫 Never: новый извлекающий LLM-агент/модель; снапшот таблицы план/факт; `prisma migrate`/`new PrismaClient()`/`process.env.*`; удалять страницу `/dashboard/operations/weekly`; дефолт-OFF флаг.

---

## Открытые вопросы / риски (для ТЗ)

- **Переключатель ритма.** Сейчас `rhythm="today"` захардкожен. Нужно ввести состояние ритма на `/dashboard` (День/Неделя; Месяц — следующим шагом) — это правка `DirectorDashboardClient`, а не только новый виджет. Зафиксировать в ТЗ как отдельную фазу.
- **Окно пн–пт vs пн–вс.** Сужение окна затронет и страницу `/dashboard/operations/weekly`, и `WeeklyPerPersonService` (используется в обоих местах) — решить: параметр окна или глобально пн–пт.
- **Пустая таблица.** Если за неделю нет обещаний с дедлайном — таблица пуста (сервис стартует от commitments). Нужен явный empty-state «нет данных за неделю», а не пустота.
- **«Вклад в цель» при нескольких целях.** `PersonGoalContribution` по `(personId, goalId)`. Для колонки берём net по **главной** цели (или сумму) — уточнить в ТЗ.
- **Рассинхрон live-таблицы и снапшота-письма.** Письмо = «прошлая неделя» (снапшот), таблица = live; подписать периоды в UI (как у дневного).

## Что дальше

Готово к ТЗ (`plans/tz/2026-06-29-week-company-weekly-brief.md`) по образцу дневного: фазы Схема → Синтез(сведение 5 дней) → Окно/Тайминг → DTO/доступ → Фронт(герой + переключатель ритма + таблица с «Вклад в цель») → Доставка/прод. Прототип — эталон вёрстки и состава.
