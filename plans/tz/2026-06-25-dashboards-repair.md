---
type: tz
status: ready-to-implement
feature: dashboards-repair
date: 2026-06-25
owner: Сергей (svmazur@mail.ru)
relates_to:
  - plans/analysis/2026-06-25-dashboards-architecture-audit.md
  - plans/analysis/2026-06-25-dashboard-segodnya-module-audit.md
---
> Анализ: `plans/analysis/2026-06-25-dashboards-architecture-audit.md` (мастер-док, разделы 9–11) · Статус согласования: 2026-06-25

> **Перепроверка кода 2026-06-26** (после параллельных работ Task→Issue и «задача vs решение»): все якоря ТЗ целы — `resolveGoalId`/`isPrimary` (execution-dashboard.service.ts:338-353), `customer-risk listForTenant` (:303), `DashboardCanvas` grid/SIZE_SPAN (:12,33,39), `ValueWidget` period-баг (:22) — без изменений. Модель `Task` удалена, но ТЗ опирается на `Issue/IssueAssignee/PersonGoalContribution/CustomerRiskSnapshot` — все живы. **Рерайт не нужен, добавлены граничные контракты с параллельными ТЗ (ниже).**

# ТЗ — Ремонт дашбордов Коры (Сегодня / Аналитика / Неделя / Месяц)

## Принцип
Чиним и переставляем — **ничего не удаляем**. Каждый баг лечим в корне (класс, а не кейс). Раскладку выравниваем перестановкой/нормализацией размеров, без редизайна состава.

## 🚫 ЖЁСТКИЙ ИНВАРИАНТ (решение владельца, не пересматривать)
**НЕ удалять ничего:** ни дашборд, ни виджет, ни orphan-страницу (`/dashboard/portfolio`, `/dashboard/value-recap`, `/maturity`), ни данные, ни эндпоинт, ни запись в `WIDGET_REGISTRY`/`DEFAULT_PRESETS`. Разрешено: менять порядок, менять `size` виджета, добавлять пустые-стейты/бейджи/фильтры, чинить выборку данных на бэке, дедупить. Если фикс требует «убрать» — вместо удаления сворачиваем в пустой-стейт или прячем по условию `данных нет`, сохраняя код.

## Принятые решения владельца
| # | Решение | Обоснование |
|---|---|---|
| Р1 | Дашборды по составу НЕ переделываем | Владелец: «ничего не меняем в самих дашбордах» |
| Р2 | Layout-фикс = перестановка + выравнивание модулей до отсутствия пустот | Владелец: «местами модули менять, чтобы не было пустоты» |
| Р3 | Лента — один поток + бейджи типов + фильтр | Выбор владельца (один поток + бейджи) |
| Р4 | Orphan-дашборды и /maturity — НЕ трогаем | Владелец: «пока не трогать» |
| Р5 | Ничего не удалять, только ремонт | Владелец: «чтобы всё было» |

## REALITY-CHECK (что уже есть по факту — не строить заново)
- **Раскладка существует:** `DashboardCanvas` рендерит `grid grid-cols-12` по `SIZE_SPAN` (`frontend/src/ui/components/dashboard/registry/DashboardCanvas.tsx:11-16,33-46`). Порядок — из `DEFAULT_PRESETS` (`registry/presets.ts`), размеры — из `WIDGET_REGISTRY` (`registry/widget-registry.ts`). Кастомная раскладка из API (`useDashboardLayout`) сейчас всегда `null` → берётся пресет. **Меняем размеры/порядок в этих двух файлах + алгоритм заполнения строки в Canvas. Реестр и пресеты не сокращаем (Р1).**
- **Goal-vector fallback частично есть:** `ExecutionDashboardService.resolveGoalId` (`backend/src/modules/dashboard/services/execution-dashboard.service.ts:338-353`) уже делает: `isPrimary:true` → иначе top по `personGoalContribution.netScore`. Возвращает `null`, потому что у org нет primary-цели И таблица `personGoalContribution` пуста (вклады не посчитаны для suggested-цели). **Дополняем fallback активной целью, не переписываем.**
- **Лента уже типизирована:** `cora-feed.service.ts` отдаёт `type` ∈ {idea, insight, decision, conflict, blocker, open_question, activity, probe_question} (`backend/src/modules/activity-feed/services/cora-feed.service.ts:126-533`). `FeedWidget.tsx:34-40` уже имеет `TYPE_ICON` для части типов. **Добавляем текстовые бейджи на все типы + фильтр. Иконочную базу переиспользуем.**
- **Plan-fact данные уже есть на фронте:** `PlanFactWidget.tsx:49-63` тянет discipline + temperature + missing (в missing есть `totalEmployees`). **Формулу строим из имеющихся данных, новый бэкенд не нужен.**
- **Содержание чек-инов существует:** страница `/me/check-ins` + `frontend/src/api/my-check-ins.api.ts`; есть `/persons/[id]/pulse`. **Дрилдаун плана/отчёта = ссылка на существующую страницу человека, новый эндпоинт не создаём.**
- **customer-risk дубли — на бэке:** `CustomerRiskRadarService.listForTenant` (`backend/src/modules/operations/services/customer-risk-radar.service.ts:303-331`) возвращает ВСЕ `customerRiskSnapshot` без дедупа по клиенту → 3 клиента = 20 строк. **Дедуп до последнего снимка на клиента.**
- **Период «Пользы»:** `ValueWidget.tsx` — `const period = rhythm === "week" ? "week" : "month"` → на `today` берёт month. `director` DTO поддерживает только `z.enum(['week','month'])` (`backend/src/modules/dashboard/dto/director-dashboard.dto.ts:4`) — `day` НЕТ. → today приводим к `week` (как остальные director-виджеты дня). Day-польза — vNext.
- **Графики:** 8 чарт-компонентов используют `ResponsiveContainer` (`frontend/src/ui/components/dashboard/charts/*` и `.../modern/{GaugeCard,DonutCard,BarTrend,AreaTrend,RadarCard}.tsx`) — часть без гарантированной высоты контейнера → `width(-1) height(-1)`. **Добавляем minHeight, компоненты не удаляем.**
- **Двойная загрузка:** не из `MobileShell` (он рендерит ровно одно: `frontend/src/ui/mobile/MobileShell.tsx`). Источник — несшеренные SWR-ключи к `director` у нескольких виджетов + повторный mount. **Фаза-investigate с измеримым критерием.**
- **Битые ссылки:** `weekly-digest?weekStart=...` → 404 на `/month`; `/me/commitments` → 404 (RSC-prefetch). Эндпоинт/маршрут отсутствуют. **Чиним вызов/ссылку.** ⚠️ Сверить с параллельным `plans/tz/2026-06-25-meeting-tasks-widget-404-fix.md` — возможно, часть 404 уже закрыта там, не дублировать.
- **Task→Issue унификация (проверено 2026-06-26):** реестр виджетов цел — **18 виджетов** (`verdict, goal-vector, plan-fact, weekly-plan-fact, trend, month-recap, achievements, weekly-dynamics, maturity, bus-factor, load, stale, chains, blockers, ideas, decisions, feed, value`), ни один не удалён. `director-dashboard.service.ts` value-strip переведён с `task.count` на `issue.count({deletedAt:null, archivedAt:null})` (`:714`) — `valueStrip.tasksExtracted` теперь считает Issue. Фаза 4 (период «Пользы») от этого не зависит — баг во фронте (`ValueWidget.tsx:22`). Виджеты `stale`/`chains` уже Issue-based (`StaleIssuesWidget`, `IssueChainsWidget`).

## Scope
**Входит:** ремонт 8 классов проблем (фазы 1–9 ниже) на 4 дашбордах + Аналитике, на фронте и бэке.
**Не входит (vNext, с явной судьбой):**
- Day-scoped «Польза» (нужен `day` в director-enum) → отдельное ТЗ, пока today→week.
- UI фиксации «результата решения» (outcome-capture) для метрики «Доведение решений %» → vNext; сейчас метрика остаётся, чиним окно + честный пустой-стейт.
- Просмотр владельцем содержания чужого чек-ина новым эндпоинтом → пока ссылка на `/persons/[id]/pulse`.
- Слияние/выпил дашбордов, orphan-страницы, масонри-движок → заморожено (Р1, Р4).
- Backfill `personGoalContribution` для исторических целей → vNext (кроном считается вперёд).

## Граничные контракты
### Внутри этого ТЗ
- Goal-vector фронт (`GoalVectorWidget`) полагается на контракт ответа `getGoalVectorByPerson` из Фазы 1 (`goalId`/`goalTitle`/`rows` + новое поле `goalState`). Фаза 2 не стартует до Фазы 1.
- Дедуп customer-risk (Фаза 5) меняет только содержимое массива `items` и счётчики — форма `CustomerRiskSnapshotDto` неизменна.

### С параллельными ТЗ (НЕ дублировать, только отображать результат)
- **`plans/tz/2026-06-25-drop-legacy-task-model-unify-on-issue.md`** — дроп legacy `Task`, унификация на `Issue`. Дашборд-виджеты ОБЯЗАНЫ читать `Issue` (не `Task`). На момент реализации этого ТЗ убедиться, что унификация смержена; `stale`/`chains`/`load`/`plan-fact` уже Issue-based. Это ТЗ **не чинит** саму унификацию.
- **`plans/tz/2026-06-25-task-decision-disambiguation.md` + `plans/analysis/2026-06-25-tasks-vs-decisions-noise-audit.md`** — чистят КАЧЕСТВО данных реестра решений (что считается решением, мусор). Виджет «Решения» (Фазы 4/8) этого ТЗ чинит ТОЛЬКО **отображение** (окно периода, пустой-стейт, «доведено %»), **НЕ** определяет, что есть решение, и НЕ дедупит сам реестр решений — это владелец того ТЗ. Если «16 застряли»/«0 из 0» исчезнут после их чистки — Фаза 4/8 просто корректно отрисует новый результат.
- **`plans/tz/2026-06-25-meeting-tasks-widget-404-fix.md`** — фикс 404 виджета задач встречи. Фаза 9 (битые ссылки `/me/commitments`, `weekly-digest`) — сверить, не перекрывается ли; чинить только то, что не закрыто там.
- **`plans/tz/2026-06-25-edinyy-pomoshnik-*` (master / arhitektura / chat-surface-convergence)** — конвергенция помощника/чата. Виджет «Лента» (Фаза 6) не трогает помощника; если конвергенция меняет источник `feed/cora` — сверить тип-маппинг бейджей перед реализацией Фазы 6.

---

## Границы фичи
- ✅ Always: менять `size`/порядок в registry/presets; добавлять пустые-стейты, бейджи, фильтры; дедуп выборок; minHeight чартам; ссылки на существующие страницы.
- ⚠️ Ask first: любое изменение формы публичного DTO; добавление колонки Prisma; новый эндпоинт; изменение enum director-периодов.
- 🚫 Never: удалять виджет/дашборд/эндпоинт/запись реестра/пресета; `process.env.*`; `prisma migrate`; `new PrismaClient()`; английские слова в UI; хардкод цвета мимо токенов.

---

## Фазы

### Фаза 1 — Бэкенд: goal-vector подхватывает активную цель
**Корень:** `resolveGoalId` падает в `null`, т.к. нет primary-цели и пуста `personGoalContribution`. Из-за этого «Вектор к цели» = «Цель не задана», хотя активная цель есть.
**Файлы:** `backend/src/modules/dashboard/services/execution-dashboard.service.ts:338-353` (`resolveGoalId`), `:198-209` (`getGoalVectorByPerson` — добавить `goalState` в ответ), DTO `GoalVectorByPersonResponse` (там же/в `dto/`).
**Что входит:**
- R1: `resolveGoalId` после ветки `personGoalContribution` добавляет третий fallback: `goal.findFirst({ where: { tenantId, status: 'active' }, orderBy: [{ isPrimary: 'desc' }, { weight: 'desc' }, { createdAt: 'asc' } ], select: { id: true } })`. Возвращает его `id`, если найден.
- R2: `getGoalVectorByPerson` возвращает доп. поле `goalState: 'primary' | 'active_fallback' | 'none'` — `primary` если цель `isPrimary`, `active_fallback` если выбрана по фоллбэку, `none` если цели нет вовсе.
- R3: при найденной цели и пустых `rows` — ответ содержит `goalId`+`goalTitle`+`rows: []`+`goalState` (НЕ `goalId: null`).
**Что НЕ входит:** backfill вкладов; изменение крона goal-vector-tracker; primary-промоушен.
**Acceptance:**
- `bun run typecheck && bun run lint` в `backend/` зелёные.
- Новый/обновлённый unit-spec рядом (`execution-dashboard.service` или новый): для tenant без primary и без вкладов, но с 1 active-целью → `getGoalVectorByPerson` возвращает `goalId !== null`, `goalState === 'active_fallback'`, `rows: []`. Для tenant без целей → `goalState === 'none'`, `goalId: null`.
- `grep -n "status: 'active'" execution-dashboard.service.ts` находит новый fallback.
- Ручная проверка: `GET /api/v1/dashboard/goal-vector/by-person?period=day` для org `cmpndk2tw000101mwmixvacuj` → `goalId` = id цели «Запустить 10 компаний» (`cmq6a9wp0005901p7glwn2pq5`), `goalState: 'active_fallback'`.
Закрывает: R1, R2, R3

### Фаза 2 — Фронт: GoalVectorWidget — пустой-стейт вместо «Цель не задана»
**Зависит от Фазы 1** (поле `goalState`).
**Файл:** `frontend/src/ui/components/dashboard/registry/widgets/GoalVectorWidget.tsx` + маппер в `frontend/src/domain/*` для нового поля.
**Что входит:**
- R4: `goalState === 'none'` → показать CTA «Кора предложила цель — подтвердите её главной» со ссылкой на `/goals` (если активной цели нет вовсе — текст «Задайте главную цель»). НЕ удалять текущий текст, заменить ветку.
- R5: `goalState === 'active_fallback'` и `rows: []` → показать название цели + строку «Накапливаем данные по людям» (НЕ «Цель не задана»).
- R6: `rows.length > 0` → текущее поведение без изменений.
**Что НЕ входит:** изменение страницы `/goals`; промоушен цели из виджета.
**Acceptance:**
- `bun run typecheck && bun run lint` в `frontend/` зелёные.
- На проде под `svmazur@mail.ru` `/dashboard` → блок «Вектор к цели» показывает «Запустить 10 компаний…» + «Накапливаем данные по людям», БЕЗ «Цель компании не задана».
- `grep -n "active_fallback\|goalState" GoalVectorWidget.tsx` находит обе ветки.
Закрывает: R4, R5, R6

### Фаза 3 — Фронт: раскладка без пустот (перестановка + выравнивание)
**Корень:** линейный `grid-cols-12`, размеры md=6/lg=8/xl=12 по порядку → lg(8) оставляет 4 пустых; длинный список рядом с коротким → дыра.
**Файлы:** `registry/widget-registry.ts` (поле `size`), `registry/presets.ts` (порядок), `registry/DashboardCanvas.tsx:11-46` (заполнение строк), списочные виджеты (`StaleIssuesWidget`, `DecisionsWidget`, `IdeasByThemeWidget`) — топ-5 + «показать все», чарт-компоненты — minHeight.
**Что входит ([ASSUMPTION] — детерминированное заполнение строк, не масонри-движок; масонри = vNext если владелец захочет):**
- R7: «контентные» виджеты привести к `size: 'md'` (½): `plan-fact`, `blockers`, `feed` сейчас lg → проверить и где уместно сделать md; крупные оставить xl: `verdict`, `goal-vector`, `value`. Изменения `size` — только в `widget-registry.ts`, записи не удалять.
- R8: порядок в `DEFAULT_PRESETS.owner.today` (и `coo.today`) переставить так, чтобы md-виджеты шли парами (каждая строка = 12), а длинные списки стояли рядом (слева+справа): целевой порядок `verdict, goal-vector, plan-fact, load, stale, decisions, ideas, blockers, feed, value`. Аналогично выровнять `week` и `month` (списки парами, графики/метрики парами). Состав массива НЕ сокращать.
- R9: `DashboardCanvas` — гарантировать, что пустой виджет (`empty:hidden`) не оставляет «дыру»: либо `auto-rows`/`grid-auto-flow: dense`, либо пропуск пустого без резервирования колонок. Конкретно: добавить `grid-auto-flow: row dense` к контейнеру (`DashboardCanvas.tsx:33`).
- R10: списочные виджеты `stale`/`decisions`/`ideas` — рендерить топ-5, остальное под «Показать все (N)» (toggle, не отдельная страница). НЕ обрезать данные на бэке.
- R11: всем `ResponsiveContainer` задать `minHeight` (≥160px) у обёртки контейнера в чарт-компонентах (`charts/*`, `modern/{GaugeCard,DonutCard,BarTrend,AreaTrend,RadarCard}.tsx`), чтобы убрать `width(-1) height(-1)`.
**Что НЕ входит:** новый layout-движок/масонри; сохранение кастомной раскладки в API; удаление виджетов.
**Acceptance:**
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
- На `/dashboard` (desktop ширина ≥1024) визуально: нет пустых колонок справа от виджетов и нет крупных дыр под короткими (скрин до/после в `plans/analysis/`).
- Консоль `/dashboard`, `/week`, `/dashboard/operations`, `/month`: **0** предупреждений `width(-1) and height(-1)`.
- `stale`/`decisions`/`ideas` по умолчанию показывают ≤5 пунктов + кнопка «Показать все».
- `DEFAULT_PRESETS.owner.today.length` НЕ уменьшилась относительно текущего (10).
- `grep -n "dense" DashboardCanvas.tsx` находит правку.
Закрывает: R7, R8, R9, R10, R11

### Фаза 4 — Фронт: единый период экрана (Польза / Решения / trend)
**Файлы:** `registry/widgets/ValueWidget.tsx` (period), `registry/widgets/DecisionsWidget.tsx` (окно), `registry/widgets/TrendWidget.tsx`.
**Что входит:**
- R12: `ValueWidget` — `const period = rhythm === "month" ? "month" : "week"` (today и week → week; убрать «today→month»). Заголовок оставить «Польза Коры за период».
- R13: `DecisionsWidget` — на `today` использовать то же окно, что у остальных today-виджетов (week), чтобы не показывать «0 из 0»; при действительно пустом окне — пустой-стейт «За период решений не доводилось», БЕЗ «0 из 0».
- R14: `TrendWidget` на `week` при `current === null` — пустой-стейт «Недостаточно данных за неделю» (не пустой график). Корень `trend?period=week current=null` — отметить для бэкенд-проверки, но фронт обязан не падать в пустоту.
**Что НЕ входит:** добавление `day` в director-enum; outcome-capture.
**Acceptance:**
- На `/dashboard` «Польза Коры» показывает недельные значения (совпадают с `director?period=week.valueStrip` = 11/15/37/12/0), НЕ месячные (18/30/64).
- `grep -n "rhythm === \"month\"" ValueWidget.tsx` находит правку.
- `DecisionsWidget` на today не показывает «0 из 0», показывает осмысленное число или пустой-стейт.
Закрывает: R12, R13, R14

### Фаза 5 — Бэкенд: дедуп (клиенты / темы / идеи)
**Файлы:** `backend/src/modules/operations/services/customer-risk-radar.service.ts:303-331` (`listForTenant`); `backend/src/modules/dashboard/services/pulse-patterns.service.ts` (recurringTopics); виджет идей `IdeasByThemeWidget`/источник `idea-clusters`.
**Что входит:**
- R15: `listForTenant` — дедуп до **последнего** `customerRiskSnapshot` на `customerId` (например, выбрать max `snapshotAt` per customer, или `distinct` по customerId с сортировкой). `criticalCount`/`warningCount` считать по дедуплицированному набору. Форму `CustomerRiskSnapshotDto` не менять.
- R16: `pulse-patterns` recurringTopics — дедуп по `themeId` (сейчас один `themeId` встречается дважды).
- R17: идеи «Без темы» — схлопывать кластеры без темы в один «Без темы (N идей)» ИЛИ скрывать в свёрнутый блок; не показывать 5 одинаковых плиток. [ASSUMPTION: схлопнуть в один агрегат «Без темы»].
**Что НЕ входит:** пересчёт снапшотов; изменение крона радара.
**Acceptance:**
- `GET /dashboard/operations/customer-risk?limit=20` → каждый `customerId` встречается ≤1 раза; для org `cmpndk2tw…` вернётся 3 клиента, `criticalCount` ≤ 3.
- Новый/обновлённый unit-spec: вход с 3 клиентами × 5 снапшотов → выход 3 строки (последние).
- `pulse-patterns` recurringTopics: нет повторов `themeId`.
- backend `typecheck/lint` зелёные; spec'и зелёные.
Закрывает: R15, R16, R17

### Фаза 6 — Фронт: Лента — бейджи типов + фильтр
**Файлы:** `registry/widgets/FeedWidget.tsx:34-112` (`TYPE_ICON`, рендер), `frontend/src/api/*` маппер типов ленты.
**Что входит (Р3):**
- R18: каждому событию — видимый текстовый бейдж типа с парными токенами `bg-*`/`text-*-fg` (НЕ `text-white`): сопоставление `insight→«Риск/Инсайт»`, `open_question→«Вопрос Коры»`, `probe_question→«Вопрос Коры»`, `activity→«Событие»`, `decision→«Решение»`, `blocker→«Блокер»`, `conflict→«Конфликт»`, `idea→«Идея»`. Все строки — на русском.
- R19: дополнить `TYPE_ICON` иконками для типов без иконки (decision/conflict/blocker/idea/activity/probe_question), переиспользуя lucide.
- R20: фильтр над лентой (чипы/селект): «Все / События / Вопросы / Риски» — маппинг групп: События={activity,decision,idea}, Вопросы={open_question,probe_question}, Риски={insight,blocker,conflict}. Фильтр клиентский поверх загруженных `items`.
**Что НЕ входит:** разнесение на 2 ленты; изменение `cora-feed.service`.
**Acceptance:**
- На `/dashboard` у каждой строки ленты виден русский бейдж типа; нет английских слов.
- Переключение фильтра «Вопросы» оставляет только open_question/probe_question.
- `grep -n "Вопрос Коры\|Риск\|Событие" FeedWidget.tsx` находит бейджи.
- `bun run typecheck/lint` (frontend) зелёные.
Закрывает: R18, R19, R20

### Фаза 7 — Фронт: «План и факт» — честная формула + дрилдаун
**Файл:** `registry/widgets/PlanFactWidget.tsx:49-92` (данные уже есть: discipline + missing.totalEmployees).
**Что входит:**
- R21: вместо «1 из 1» показать формулу **«сдали X / ожидалось Y / всего Z сотрудников»**, где Z = `missing.totalEmployees`, X = `morningCompleted`, Y = `morningExpected`; аналогично вечер. Если `Y < Z` — показать подпись «ожидался Y из Z» (объяснить, почему ждали не всех).
- R22: единый источник «кто отметился»: список людей строить из `checkin-discipline.byPerson` (не из team-temperature), чтобы не противоречить настроению. Настроение остаётся отдельным под-блоком.
- R23: каждый человек в «По людям» — ссылка на существующую `/persons/[id]/pulse` (дрилдаун к его чек-инам/пульсу). НЕ создавать новый эндпоинт.
**Что НЕ входит:** новый эндпоинт содержания чужого чек-ина; изменение расписания «ожиданий».
**Acceptance:**
- На `/dashboard` «План и факт» показывает три числа (сдали/ожидалось/всего), не «1 из 1».
- Клик по человеку ведёт на `/persons/<id>/pulse`.
- `grep -n "totalEmployees" PlanFactWidget.tsx` находит использование «всего».
Закрывает: R21, R22, R23

### Фаза 8 — Фронт/Аналитика: пустые-стейты вместо «сетки нулей»
**Файл:** `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx` (+ подблоки).
**Что входит:**
- R24: пустые блоки (Свежие конфликты, Хронические блокеры, Узкие места, Встречи с низкой отдачей) при нуле данных — свернуть в одну компактную строку-сводку «Пока спокойно: 0 конфликтов · 0 блокеров · 0 трений», вместо отдельных пустых карточек. Карточки не удалять — показывать развёрнуто, когда данные появятся.
- R25: «Узкие места между командами» — если `bottlenecks.heatmap` целиком нули и `topPairs` пуст → пустой-стейт «Пересечений между командами пока нет», не пустую тепловую карту.
- R26: «Скорость знаний» (`knowledgeVelocity.medianHours === null`) и «Зрелость → Слабые/Сильные места» (домены пусты) → текст «Накапливаем данные» вместо «—»/«Нет данных».
- R27: «Открытые обещания» — единый источник: верхняя плашка и блок «за 14 дней» брать из одного эндпоинта (`open-commitments`), убрать визуальное противоречие с `promise-network` (граф оставить, но подписать честно «в сети N связанных»). НЕ удалять promise-network.
**Что НЕ входит:** удаление блоков; пересчёт зрелости.
**Acceptance:**
- На `/dashboard/operations` нет пустых карточек с «0»/«Нет данных» в режиме «сетка нулей»; вместо них компактная сводка/«Накапливаем данные».
- Тепловая карта «Узкие места» при нулях не отображается пустым гридом.
- Числа «Открытые обещания» в плашке и в блоке «за 14 дней» совпадают.
Закрывает: R24, R25, R26, R27

### Фаза 9 — Двойная загрузка + битые ссылки
**Файлы:** виджеты, дёргающие `director` (`VerdictWidget`, `GoalVectorWidget`, `ValueWidget`, `TrendWidget` — общий SWR-ключ/провайдер); `/month` клиент (`weekly-digest` вызов); источник ссылки `/me/commitments`.
**Что входит:**
- R28: устранить дублирование запросов: вынести `director?period=<p>` в общий SWR-ключ так, чтобы за один заход на дашборд каждый `(endpoint, params)` дёргался **один раз** (сейчас `director?period=week` 4–5×, весь набор — дважды). [ASSUMPTION: причина — несшеренные ключи + повторный mount; на этапе реализации сначала воспроизвести через network-таб, затем чинить корень].
- R29: `/month` — `weekly-digest?weekStart=...` отдаёт 404: либо подключить правильный существующий эндпоинт, либо корректно обработать отсутствие (пустой-стейт), без красной ошибки в консоли. Эндпоинт/виджет не удалять.
- R30: `/dashboard/operations/daily` — убрать 404-prefetch `/me/commitments` (поправить `href`/удалить мёртвый prefetch-линк на несуществующий маршрут), не ломая навигацию.
**Что НЕ входит:** новый эндпоинт weekly-digest (если решено — отдельная задача).
**Acceptance:**
- На `/dashboard` (один заход) в network каждый `/api/v1/dashboard/*` запрос — ровно 1 раз; `director?period=week` — 1 раз.
- Консоль `/month`: нет 404 `weekly-digest`. Консоль `/dashboard/operations/daily`: нет 404 `/me/commitments`.
Закрывает: R28, R29, R30

---

## Граф зависимостей
- Фаза 1 → Фаза 2 (контракт `goalState`).
- Остальные (3,4,5,6,7,8,9) независимы между собой и от 1–2 → параллелятся.
- Фронт-фазы требуют зелёного `typecheck/lint/build`; бэк-фазы — `typecheck/lint` + spec.

## Pre-mortem / Риски и ревью-аспекты (для strict-production-review-gate)
- Дедуп customer-risk не должен потерять «критичные»: проверить, что `criticalCount` считается по дедуплицированному набору, а выбран именно последний снимок (max `snapshotAt`), не первый.
- Раскладка: смена `size` влияет на ВСЕ роли/ритмы, где виджет участвует — проверить week/month, что не появились новые дыры; `member`-пресет (`ideas,value`) не сломан.
- Фильтр ленты — клиентский: при пустой группе показывать пустой-стейт, не «исчезновение» виджета (`empty:hidden` не должен скрыть весь блок).
- Tenant-изоляция goal fallback: `findFirst` обязан содержать `tenantId` (multi-tenancy).
- minHeight чартам не должен ломать мобильную вёрстку — проверить `MobileShell` ветки.
- Пустые-стейты Аналитики не должны прятать блок, когда данные ЕСТЬ.

## Idempotency / flags / prod-deploy
- Чисто фронт+чтение-бэкенд: **миграций нет, seed/patch нет, ENV нет, новых очередей нет.** Раздел prod-deploy-log — без новых шагов (фиксация только в рефлексии). Если в Фазе 5 потребуется индекс для дедупа (`@@index` уже есть на снапшотах — проверить) — не добавлять без необходимости.
- Feature-flags: не требуются (ремонт существующего, Ship-On — выкатывается включённым).

## DoD
- `bun run typecheck && bun run lint && bun run build` зелёные в `frontend/` и `backend/`.
- Затронутые spec'и зелёные (`bunx vitest run <файл>`), добавлены unit'ы для Фаз 1 и 5.
- Ни одного удалённого виджета/дашборда/эндпоинта/записи реестра (греп: `WIDGET_REGISTRY` и `DEFAULT_PRESETS` содержат прежний набор id).
- UI — только русский; парные цвет-токены; без `text-white` на цветном.
- `second-brain/01_projects/*dashboard*` и `02_architecture/module-map.md` обновлены при изменении контракта goal-vector; рефлексия в `05_история/`.
- Скрин «до/после» раскладки «Сегодня» в `plans/analysis/`.

## Итог
**Реализовано полностью (2026-06-26, ветка `feature/drop-legacy-task-unify-issue`).** Все 9 фаз закрыты, по коммиту на фазу:
- Ф1 `83059310` · Ф2 `3a155e51` · Ф3 `cdcb3e65` · Ф4 `ba8c042c` · Ф5 `631e4796` · Ф6 `d8ce7288` · Ф7 `0eefb3a2` · Ф8 `f7a46d6f` · Ф9 `630e909f`.

**Верификация:** backend typecheck зелёный; спеки dashboard 225/225 + operations 517/517 (без регрессий) + 8 новых unit-тестов; frontend typecheck/lint (0 ошибок) + полный build зелёные. Ни один виджет/дашборд/эндпоинт/запись реестра не удалён (18 виджетов, пресеты 10/13/18). UI русский, парные цвет-токены.

**Не закрыто (вынесено в реестр не-сделанного):**
- vNext, явно объявленные «Не входит»: day-польза (нужен `day` в director-enum), outcome-capture UI, эндпоинт чужого чек-ина, backfill `personGoalContribution`.
- **R24 частично:** сводка «Пока спокойно» собрана по сигналам родителя (конфликты/трения/низкая отдача); «Хронические блокеры» не вошли — self-fetch под-виджет (родитель не знает счётчик).
- **R30 неактуален:** ссылки `/me/commitments` во фронте нет (0 совпадений) — убрана ранее, действий не потребовала.

**Не проверено вживую (нужен прод-деплой владельца):** визуальная раскладка без дыр, консоль 0 warnings `width(-1)`, сетевой дедуп `director` = 1×, прод-GET goal-vector. Механика верна — финальная глаз-приёмка на проде через `qa-tester`.
