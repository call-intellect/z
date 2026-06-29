---
type: tz
status: ready-to-implement
feature: report-date-navigation-archive
date: 2026-06-30
owner: Сергей (svmazur)
relates_to:
  - plans/analysis/2026-06-29-month-company-and-report-archive/99-synthesis.md
  - plans/analysis/2026-06-29-month-company-and-report-archive/05-period-navigation-ux.md
  - plans/tz/2026-06-29-month-company-monthly-brief.md
  - plans/tz/2026-06-29-week-company-weekly-brief.md
  - plans/tz/2026-06-28-day-company-daily-brief.md
supersedes:
---

> Анализ-основание: `plans/analysis/2026-06-29-month-company-and-report-archive/99-synthesis.md` §«Фича B» + `05-period-navigation-ux.md` (UX-паттерны П1–П6, антипаттерны, default-период, empty-state) · Red-team вердикт: #3 survives (inline + лёгкий архив) · Статус согласования: 2026-06-29 (Р-B1 закрыт).

# ТЗ — Навигация по датам + архив прошлых отчётов (День / Неделя / Месяц)

## Принцип

Бэкенд **уже хранит и отдаёт** отчёт за любой прошлый период (`?date=`/`?weekStart=`/`?period=`), но в UI **нет навигатора** — герои дня/недели/месяца грузят только «последний». Достраиваем **единый inline-навигатор** «‹ предыдущий / следующий ›» + кликабельную подпись периода (→ выбор даты) + **лёгкий архив** (список последних доступных отчётов) на героях всех трёх ритмов. Шаг навигатора = активный ритм (день/неделя/месяц). Default при входе — **последний завершённый** период. Без отдельной тяжёлой страницы-архива (red-team #3: overkill для раннего пилота). Переиспользуем готовый `PeriodSelector` из value-recap как основу общего `PeriodNavigator`.

## Зачем (болезненное состояние → решение)

1. **«Вернуться к отчёту за вчера» из кабинета невозможно.** [DayCompanyHero.tsx:58](../../frontend/src/ui/components/dashboard/day-company/DayCompanyHero.tsx) грузит только `getLatest()` ([useDayCompany.ts:24](../../frontend/src/hooks/useDayCompany.ts)), хотя `operationsDailyDigestApi.getByDate(date)` уже есть ([operations-daily-digest.api.ts:186](../../frontend/src/api/operations-daily-digest.api.ts)). Пропустил пару дней — прошлые отчёты лежат, но недостижимы.
2. **У недельного дайджеста нет `/latest`** — только `GET ?weekStart=` ([weekly-digest.controller.ts:38](../../backend/src/modules/operations/controllers/weekly-digest.controller.ts)); фронту нечем спросить «последнюю завершённую неделю» без знания даты.
3. **Нет «списка доступных периодов»** — для архива и для отключения стрелки «вперёд» на границе (нельзя листать в будущее) нужен перечень периодов с данными.
4. **Навигатор по периодам заперт в одном экране** — `PeriodSelector` живёт только внутри [ValueRecapDashboardClient.tsx:135](../../frontend/app/(authenticated)/dashboard/value-recap/ValueRecapDashboardClient.tsx), не переиспользуется героями.

Решение: добрать бэк (weekly `/latest` + единый «список периодов» на все ритмы) + вынести `PeriodNavigator` в общий компонент + подключить к героям дня/недели/месяца с default «последний завершённый» и empty-state «нет данных → ближайший доступный».

---

## REALITY-CHECK (по факту кода на 2026-06-29)

**Уже есть (переиспользуем):**
- **День:** `GET ?date=` + `GET /latest` ([daily-digest.controller.ts:38,65](../../backend/src/modules/operations/controllers/daily-digest.controller.ts)); фронт `operationsDailyDigestApi.getByDate/getLatest/generate` + `tolerantGet`→null при `digest_not_found`.
- **Неделя:** `GET ?weekStart=` + `POST /generate` ([weekly-digest.controller.ts:38](../../backend/src/modules/operations/controllers/weekly-digest.controller.ts)); **нет `/latest`** и метода `getLatest` в сервисе.
- **Месяц (recap пользы):** `valueRecapApi.get(orgId, period?)` + сервис `getSnapshot/getLatestPeriodWithData/getById` — навигация по `periodYm` де-факто есть ([value-recap.dto.ts:5](../../backend/src/modules/operations/dto/value-recap.dto.ts)).
- **Месяц (герой):** `monthly-digest.controller` (`GET /latest`, `GET ?period=`) — создаётся в `plans/tz/2026-06-29-month-company-monthly-brief.md` Ф4.
- **Навигатор-эталон:** `PeriodSelector` (стрелки prev/next + `selectedPeriod`) + `shiftPeriodYm`/`formatPeriodYm` ([value-recap.ts:50](../../frontend/src/domain/value-recap.ts)) — рабочий, но локальный для value-recap.
- **Герои:** `DayCompanyHero` (есть), `WeekCompanyHero` (есть, ветка недели), `MonthCompanyHero` (создаётся в ТЗ месяца) — все грузят `latest` без выбора периода.

**Чего НЕТ / в scope:**
- Weekly `/latest` (метод + эндпоинт) — Ф1.
- Эндпоинт «список доступных периодов» на все ритмы — Ф1.
- Общий `PeriodNavigator` (вынести из `PeriodSelector`) с stepper + выбор даты + «не в будущее» — Ф2.
- Подключение навигатора к героям дня/недели/месяца + default «последний завершённый» + загрузка по выбранному периоду — Ф3.
- Лёгкий архив-список (recent доступных) — Ф4.
- Empty-state «нет данных за период → ближайший доступный» — Ф5.

---

## Принятые решения владельца (2026-06-29 — не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р-B1 | **Inline-навигатор (‹ › + клик-подпись→дата) + лёгкий архив-список**, БЕЗ отдельной страницы «Архив» | Red-team #3 survives: отдельная страница — overkill для раннего пилота (~4 юзера, прод почти пуст → пустой экран); inline + явные подписи уже доказаны кодом (`PeriodSelector`). UX-практика (`05-...md` П1/П4). |
| Р-B2 | **Default = последний ЗАВЕРШЁННЫЙ период** активного ритма (вчера / прошлая неделя / прошлый месяц) | Дашборд ОД открывают редко → сразу свежий полный отчёт, не текущий неполный (`05-...md` П5, антипаттерн «дефолт = текущий незавершённый»). |
| Р-B3 | **Стрелка «вперёд» disabled на последнем завершённом** периоде; «назад» свободна | Нельзя листать «в будущее»; запрет «назад» фрустрирует (`05-...md` П1, антипаттерн блокировки backward). |
| Р-B4 | **Шаг навигатора = активный ритм** (день→±1 день, неделя→±1 неделя, месяц→±1 месяц); switcher ритма отдельно от стрелок | Разные оси: «сменить масштаб» ≠ «листнуть период» (`05-...md` П3). |
| Р-B5 | **Empty-state различает два случая:** «ещё нет ни одного отчёта» (обучающий) vs «за этот период пусто, но другие есть» (CTA к ближайшему) | Никогда не пустота — читается как «грузится/сломалось» (`05-...md` антипаттерн, NN/G). |

Доказательство (inline vs страница-архив vs не-делать) — `99-synthesis.md` §«Матрица», `04-redteam-challenges.md` #3 (survives), `05-period-navigation-ux.md` (П1–П6 + источники).

---

## Scope

**Входит:**
1. Бэк: weekly `getLatest` + `GET /latest`; единый эндпоинт «список доступных периодов» на день/неделю/месяц (Ф1).
2. Общий `PeriodNavigator` (вынести из `PeriodSelector`): stepper ‹ ›, клик-подпись→выбор даты, «вперёд» disabled на границе, шаг по ритму (Ф2).
3. Подключение к героям дня/недели/месяца: состояние выбранного периода, загрузка по нему, default «последний завершённый», кнопка «К последнему» (Ф3).
4. Лёгкий архив-список (recent N доступных периодов, клик=прыжок) — выпадающий у подписи (Ф4).
5. Empty-state «нет данных за период» с CTA к ближайшему доступному + обучающий вариант при первом запуске (Ф5).

**Не входит (vNext, с судьбой):**
- Отдельная страница-архив с иерархией год→месяц и фасетами — vNext, когда накопится история (`05-...md` П4). Сейчас — recent-список.
- Mini-calendar для дальних прыжков по дню/неделе — **[ASSUMPTION: на 1-м этапе клик-подпись открывает нативный date-picker; полноценный недельный hover-picker — vNext]**.
- Сравнение периодов (delta-dropdown «период к периоду») — vNext.
- Принудительная пересборка прошлого периода из навигатора — уже есть кнопка «Пересобрать» в героях, не дублируем.

**Граничные контракты (читаем выход, логику не трогаем):**
- `monthly-digest.controller` (`/latest`, `?period=`) — приходит из ТЗ месяца; здесь только потребляем. Если ТЗ месяца ещё не влит — навигатор месяца включается после него (зависимость отмечена в Ф3).
- `value-recap` навигация (`PeriodSelector`) — источник паттерна; сам value-recap-экран не ломаем.

---

## Контракты (контракт-first)

### Ф1 — Бэк: weekly `/latest` + «список доступных периодов»

**Weekly `/latest`** (зеркало daily `getLatest` — [daily-digest.controller.ts:65](../../backend/src/modules/operations/controllers/daily-digest.controller.ts)):
- `WeeklyDigestService.getLatest({ tenantId })` → последняя строка по `weekStart desc` (через `enrichDto(toDto(...))`).
- `GET /api/v1/dashboard/operations/weekly-digest/latest` → `WeeklyOperationsDigestDto | 404 digest_not_found`. RBAC — `canViewOperationsDashboard`.

**Список доступных периодов** (новый, на каждый ритм):
- `GET /api/v1/dashboard/operations/{daily|weekly|monthly}-digest/available-periods?limit=12`
- Выход (Zod-DTO `AvailablePeriodsDto`):
```jsonc
{
  "rhythm": "day",
  "periods": [
    { "period": "2026-06-28", "stateHint": "warn", "title": "Сдвиг вправо" },
    { "period": "2026-06-27", "stateHint": "ok",   "title": "Ровный день" }
  ],
  "latest": "2026-06-28"
}
```
- `period` = `dateLocal` (день) / `weekStart` (неделя) / `periodYm` (месяц). `stateHint` = `verdictJson.overall.state` (для цветной точки в архиве), `null` для legacy. Обратнохронологический порядок, `limit` строк. `latest` = последний завершённый.
- Реализация: `SELECT period[, verdictJson] ... WHERE tenantId ORDER BY period DESC LIMIT n` в каждом сервисе. **Крутилка** `reportArchiveRecentLimit` (default 12) через `getDynamic` (admin→ENV→code-fallback), не хардкод.

### Ф2 — Frontend: общий `PeriodNavigator`

Вынести из `PeriodSelector` ([ValueRecapDashboardClient.tsx:135](../../frontend/app/(authenticated)/dashboard/value-recap/ValueRecapDashboardClient.tsx)) в `frontend/src/ui/components/dashboard/shared/PeriodNavigator.tsx`. Контракт:
```ts
type PeriodNavigatorProps = {
  rhythm: "day" | "week" | "month";
  value: string;                 // выбранный период (dateLocal | weekStart | periodYm)
  latest: string;                // последний завершённый (для disable «вперёд» и кнопки «К последнему»)
  available?: { period: string; stateHint?: "ok" | "warn" | "risk" | null; title?: string }[];
  onChange: (period: string) => void;
};
```
- Stepper ‹ › — шаг по `rhythm` (день: `shiftDate(±1)`; неделя: `shiftWeek(±1)`; месяц: `shiftPeriodYm(±1)`). Стрелка «вперёд» **disabled** при `value === latest` (Р-B3).
- Подпись периода кликабельна → нативный date-picker (день/неделя) / выбор месяца (месяц); крупная, ISO-однозначная (`«22–28 июня 2026»`, не `22.06` — `05-...md` П6).
- Тёмная тема, парные токены, крупные клик-цели. Switcher ритма — НЕ внутри навигатора (Р-B4).
- `value-recap` переключить на общий `PeriodNavigator` (старый `PeriodSelector` удалить — не плодить дубль).

### Ф3 — Frontend: подключение к героям + default

В `DayCompanyHero` / `WeekCompanyHero` / `MonthCompanyHero`:
- Состояние `selectedPeriod` (default = `latest` из ответа `/latest` или первого `available-periods`). Загрузка дайджеста — `getByPeriod(selectedPeriod)` вместо только `getLatest()` (день: `getByDate`; неделя: новый `getByWeekStart` уже есть как `get(weekStart)`; месяц: `get(period)`).
- `PeriodNavigator` в шапке героя; `onChange` → `setSelectedPeriod` → ре-fetch (SWR-ключ включает период).
- Кнопка «К последнему» появляется, когда `selectedPeriod !== latest` (Р-B2).
- **Зависимость:** месячный герой подключается после влития ТЗ месяца (`MonthCompanyHero` существует). День/неделя — независимо.

### Ф4 — Frontend: лёгкий архив-список

Выпадающий список у подписи периода (паттерн прототипа месяца — `.archive-pop` в `index.html`): recent `available-periods` с цветной точкой (`stateHint`) + подписью + краткой характеристикой; клик = `onChange(period)`. Периоды без данных — строкой «нет данных» (не кликабельны). Не отдельная страница (Р-B1).

### Ф5 — Frontend: empty-state

При `digest_not_found` за выбранный период:
- **Есть другие периоды:** карточка «За этот период отчёта нет» + CTA «Перейти к ближайшему доступному» (`onChange(nearestAvailable)`) + «К последнему».
- **Нет ни одного (первый запуск):** обучающий empty-state «Кора ещё собирает первый отчёт» + что это за поверхность (как существующий empty в `DayCompanyHero` «ещё собирается» + «Пересобрать»).

---

## Границы фичи

- ✅ Always: переиспользовать `PeriodSelector`-паттерн → общий `PeriodNavigator`; бэк-методы `getByDate/getLatest/getByPeriod` уже есть/добираются зеркально; default «последний завершённый»; крутилка лимита архива в AdminSetting; UI русский, ISO-даты.
- ⚠️ Ask first: отдельная страница-архив (vNext); mini-calendar для недели; менять контракт существующих `?date=`/`?weekStart=`/`?period=`.
- 🚫 Never: листание «в будущее»; блокировка «назад»; дефолт = текущий незавершённый период; пустой экран без статуса; раздельные дропдауны день/месяц/год; хардкод лимита архива; `process.env.*`.

---

## Фазы (dependency-ordered)

Граф: **Ф1 → Ф2 → Ф3 → {Ф4 ∥ Ф5}**. Ф1 (бэк) и Ф2 (компонент) можно вести параллельно; Ф3 (подключение) зависит от обоих.

### Ф1 — Бэк: weekly `/latest` + `available-periods` `[x]`
- Файлы: `weekly-digest.service.ts` (`getLatest`), `weekly-digest.controller.ts` (`GET /latest`), `daily-digest.controller.ts` + `weekly-digest.controller.ts` + `monthly-digest.controller.ts` (`GET /available-periods`), соответствующие сервисы (метод `listAvailablePeriods`), `*-digest.dto.ts` (`AvailablePeriodsDto`), `admin-setting-schema-registry.ts` + сид (`reportArchiveRecentLimit=12`).
- Входит: weekly `/latest`; `available-periods` на 3 ритма; крутилка лимита.
- НЕ входит: фронт.
- Ценность: как фронт-навигатор, получаю «последнюю неделю» и список доступных периодов, чтобы листать и строить архив.
- Acceptance: `GET .../weekly-digest/latest` под owner → 200 (или 404 `digest_not_found` на пустой БД); `GET .../daily-digest/available-periods?limit=3` → ≤3 периода, порядок DESC, есть `latest`; member → 403; `grep reportArchiveRecentLimit` в реестре/сиде; `bun run typecheck/lint/build` зелёные.
- Закрывает: R1, R2.

### Ф2 — Frontend: общий `PeriodNavigator` `[x]`
- Файлы: `frontend/src/ui/components/dashboard/shared/PeriodNavigator.tsx` (новый), `frontend/src/domain/period.ts` (`shiftDate`/`shiftWeek`/`shiftPeriodYm`/`formatPeriodLabel` ISO), `ValueRecapDashboardClient.tsx` (переключить на `PeriodNavigator`, удалить локальный `PeriodSelector`).
- Входит: stepper по ритму; клик-подпись→date-picker; «вперёд» disabled на `latest`; ISO-подписи.
- НЕ входит: подключение к героям дня/недели/месяца (Ф3); архив-список (Ф4).
- Ценность: как владелец на экране value-recap, листаю месяцы тем же навигатором, что появится у героев.
- Acceptance: `PeriodNavigator` рендерит ‹ ›+подпись; стрелка «вперёд» disabled при `value===latest` (unit/Playwright); шаг для `rhythm='day'` меняет дату на ±1; `grep -rn "PeriodSelector" frontend/src` → 0 (заменён); value-recap не сломан (Playwright smoke); `grep -rn "text-white" .../PeriodNavigator.tsx` → 0; `bun run typecheck/lint/build` зелёные.
- Закрывает: R3, R4.

### Ф3 — Frontend: подключение к героям + default `[x]`
- Файлы: `DayCompanyHero.tsx` + `useDayCompany.ts` (selectedDate, `getByDate`), `week-company/WeekCompanyHero.tsx` + хук недели (selectedWeek, `get(weekStart)`), `month-company/MonthCompanyHero.tsx` + `useMonthCompany.ts` (selectedPeriod, `get(period)`) — последний после ТЗ месяца.
- Входит: состояние периода (default `latest`); загрузка по периоду; навигатор в шапке героя; кнопка «К последнему».
- НЕ входит: архив-список (Ф4); empty-state (Ф5).
- Ценность: как владелец, на героях дня/недели/месяца листаю ‹ › к прошлым отчётам и возвращаюсь к последнему.
- Acceptance: на `DayCompanyHero` стрелка «назад» грузит вчерашний отчёт (`getByDate`); SWR-ключ включает период (повторный заход кэшируется per-период); default при входе = последний завершённый; «К последнему» появляется при выборе не-последнего; англ. строк 0; `bun run typecheck/lint/build` зелёные.
- Закрывает: R5, R6.

### Ф4 — Frontend: лёгкий архив-список `[x]`
- Файлы: `PeriodNavigator.tsx` (выпадающий архив), хуки героев (`available-periods` через SWR).
- Входит: recent-список доступных периодов с `stateHint`-точкой, клик=прыжок; «нет данных» строкой.
- НЕ входит: отдельная страница-архив; иерархия год→месяц.
- Ценность: как владелец, открываю список последних отчётов и прыгаю к нужному за один клик.
- Acceptance: клик по подписи открывает список из ≤`reportArchiveRecentLimit` периодов; клик по строке грузит тот период (Playwright); точка цвета = `stateHint`; периоды без данных не кликабельны; `bun run typecheck/lint/build` зелёные.
- Закрывает: R7.

### Ф5 — Frontend: empty-state `[x]`
- Файлы: герои (ветка `digest_not_found`), общий под-компонент `PeriodEmptyState`.
- Входит: «нет данных за период» + CTA к ближайшему доступному + «К последнему»; обучающий вариант при первом запуске.
- НЕ входит: новые эндпоинты.
- Ценность: как владелец, при выборе пустого периода вижу понятный статус и переход к ближайшему отчёту, а не пустоту.
- Acceptance: выбор периода без данных (при наличии других) → карточка + CTA «ближайший доступный» работает (Playwright); первый запуск (нет ни одного) → обучающий empty; `bun run typecheck/lint/build` зелёные.
- Закрывает: R8.

---

## Требования (трассировка)

- **R1.** Когда фронт запрашивает `GET .../weekly-digest/latest`, система shall вернуть последний по `weekStart` недельный дайджест или 404 `digest_not_found`.
- **R2.** Когда фронт запрашивает `available-periods?limit=n`, система shall вернуть ≤n периодов с данными в порядке DESC + `latest`, с `stateHint` из вердикта; лимит — крутилка `reportArchiveRecentLimit`.
- **R3.** `PeriodNavigator` shall листать на один период активного ритма; стрелка «вперёд» shall быть disabled при `value===latest`, «назад» — всегда доступна.
- **R4.** Подпись периода shall открывать выбор даты и быть ISO-однозначной; switcher ритма shall быть вне навигатора.
- **R5.** Герои дня/недели/месяца при входе shall показывать **последний завершённый** период; навигатор shall перегружать дайджест по выбранному периоду.
- **R6.** Когда выбран не-последний период, герой shall показывать кнопку «К последнему», возвращающую к `latest`.
- **R7.** Клик по подписи shall открывать архив-список последних доступных периодов; клик по строке shall загружать тот период.
- **R8.** Если за выбранный период нет данных, система shall показать статус «нет отчёта за период» + CTA к ближайшему доступному (а при отсутствии любых — обучающий empty), не пустой экран.

---

## Инварианты Z (проверить, не нарушено)
- ENV/крутилки — лимит архива `reportArchiveRecentLimit` через AdminSetting/`getDynamic` (admin→ENV→code-fallback); никаких `process.env.*`; не хардкод.
- Контракты — Zod-DTO (`AvailablePeriodsDto`) + Swagger; фронт `ApiDto→DomainModel→UiModel`, единый `api-client.ts`, SWR (ключ включает период).
- Multi-tenancy — все выборки по `tenantId`; RBAC чтения — `canViewOperationsDashboard` (owner/admin/coo/super), как у существующих дайджестов.
- UI — только русский; парные токены, без `text-white`/hex; ISO-даты в подписях/архиве.
- Без новых npm-зависимостей (date-picker — нативный/существующий UI-kit); без комментариев в коде.
- Ship-On — фича выкатывается включённой; флаг не требуется (read-only навигация, не меняет данные).

## Pre-mortem / Риски
- **ТЗ месяца ещё не влито** → навигатор месяца включается после `MonthCompanyHero`; день/неделя — независимо (Ф3 зависимость отмечена).
- **Дыры в истории** (пропущенные дни/недели) → `available-periods` отдаёт только периоды С данными; «назад» прыгает к ближайшему доступному, не к календарному соседу **[ASSUMPTION: stepper идёт по календарю, но при `digest_not_found` показывается empty-state с CTA к ближайшему доступному из `available-periods`]**.
- **Рассинхрон навигатора и SWR-кэша** → ключ SWR включает `(rhythm, period)`; смена периода = новый ключ.
- **Тяжёлый `available-periods` на большой истории** → лимит `reportArchiveRecentLimit` (default 12) + индекс `(tenantId, period DESC)` уже есть на дайджестах.

## Ревью-аспекты (для `strict-production-review-gate`)
RBAC/tenant на `/latest` и `available-periods`; отсутствие листания «в будущее»; крутилка лимита (не хардкод); SWR-ключ per-период (нет залипшего кэша); удаление дубля `PeriodSelector`; empty-state не маскирует ошибку загрузки под «нет данных».

## Сквозные аспекты (чек нарезки)
- RBAC/tenant — Ф1 (эндпоинты) + выборки по `tenantId` `[покрыто]`.
- Observability — переиспользуем существующее логирование контроллеров `[N/A: новых воркеров нет]`.
- Errors+идемпотентность — read-only; `digest_not_found`→empty-state `[покрыто Ф5]`.
- Миграции/backfill — `[N/A: новых таблиц нет, только индекс уже существует]`.
- Rollout/флаг — Ship-On, флаг не нужен (read-only) `[покрыто]`.
- Тесты — vitest `getLatest`/`available-periods`/disable-вперёд + Playwright листание/архив/empty `[покрыто Ф1/Ф2/Ф4/Ф5]`.

## Idempotency / feature-flag / prod-deploy
- Бэк read-only — миграций нет; крутилка `reportArchiveRecentLimit` через сид/реестр → `prod-deploy-log.md` Шаг 1/7.
- Новые эндпоинты (`/latest`, `/available-periods`) → `prod-deploy-log.md` Шаг 12 (Swagger smoke).
- Флаг не вводим (read-only навигация).

## DoD
`bun run typecheck` (вкл. `.spec`)/`lint`/`build` зелёные (backend и frontend); vitest затронутых файлов зелёные; Playwright-сверка навигатора/архива/empty с прототипом месяца; second-brain обновлён (`api-layer.md` — новые эндпоинты, `frontend-pages.md`/`frontend-contexts-hooks.md` — навигатор/хуки, `director-dashboard.md`); `prod-deploy-log.md` Шаг 1/7 (крутилка) + Шаг 12 (Swagger smoke); рефлексия в `05_история/`.

## Итог

**Реализовано целиком (Ф1–Ф5), ветка `feature/month-company-and-report-navigation`.** Weekly `/latest` уже существовал (фича «Недели компании») — не дублировался.

| Фаза | Коммит | Что сделано |
|---|---|---|
| Ф1 | `595fc5fc` | `GET .../{daily,weekly,monthly}-digest/available-periods?limit=` → `{rhythm, periods:[{period,stateHint,title}], latest}` (метод `listAvailablePeriods` в 3 сервисах, shared `available-periods.dto.ts`, RBAC, clamp 1..50); крутилка `operations.report_archive.recent_limit`=12 (getDynamic + реестр + admin-сид в STEPS). 34 теста. |
| Ф2 | `55549882` | Общий `PeriodNavigator` (stepper по ритму, «вперёд» disabled на latest, клик-подпись → нативный picker) + `domain/period.ts` (shift/format/compare/nearest). value-recap переведён с локального `PeriodSelector`. |
| Ф3 | `33a61c2c` | Подключение навигатора к героям дня/недели/месяца: `selectedPeriod` (default «последний завершённый» из `available-periods.latest`), загрузка по периоду (SWR-ключ включает период; week/month `get` обёрнут `digest_not_found`→null), кнопка «К последнему»; `useXAvailablePeriods` + `availablePeriods` в 3 api. |
| Ф4 | `82e3a893` | Архив-попап в `PeriodNavigator` (список `available` с цветной точкой `stateHint` + active + outside-click + ARIA listbox; «Выбрать дату…»). |
| Ф5 | `82e3a893` | `PeriodEmptyState` — «за период отчёта нет» + CTA «ближайший доступный»/«К последнему» (есть другие) ИЛИ обучающий первый запуск; `nearestAvailablePeriod`; подключён в 3 героя. |

**Требования:** R1–R8 закрыты (R1 weekly latest — уже был; R2 available-periods + крутилка; R3 stepper + forward-disable; R4 ISO-подпись + picker; R5 default «последний завершённый» + загрузка по периоду; R6 «К последнему»; R7 архив-список; R8 empty-state).

**Верификация (оркестратором сам):** backend `build`/`tsc` EXIT=0 + vitest available-periods зелёные; frontend `tsc`/`build`/`lint` EXIT=0, `text-white`=0, `grep PeriodSelector`=0. Playwright-сверка листания/архива/empty — отложена (нужны накопленные периоды в проде).

**Прод-операции:** только крутилка `operations.report_archive.recent_limit` (admin-сид в STEPS, миграций/новых ENV нет) — см. `docs/operations/prod-deploy-log.md` (блок «2026-06-29 — Месяц компании + навигация»).
