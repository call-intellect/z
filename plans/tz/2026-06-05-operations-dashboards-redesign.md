---
type: tz
status: ready-to-implement
feature: operations-dashboards-redesign
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/tz/2026-06-05-weekly-per-person-plan-fact.md
  - plans/tz/2026-06-05-dashboard-main-polish-and-honesty.md
---

> Анализ-карта: plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md (секция «ТЗ-C») · Простым языком: plans/analysis/2026-06-05-dashboards-prostym-yazykom.md (дашборды 2, 3, 4) · Решения владельца: 2026-06-05.

# ТЗ-C — Операционные дашборды: содержательный редизайн

Три операционных экрана: **Панель операций** (`/dashboard/operations`), **Ежедневный отчёт** (`/dashboard/operations/daily`), **Недельная сводка** (`/dashboard/operations/weekly`).

## Цель

Привести три операционных дашборда к виду «новой главной» (объёмные `KpiHero`, кликабельность, свежесть данных, по-русски), убрать мёртвые/дублирующие/вводящие в заблуждение блоки и заменить мёртвый показатель «Средняя загрузка» на живой текстовый сигнал из разговоров — БЕЗ финансов, только русский UI.

## Зачем (болезненное состояние по факту)

- **Панель операций** выглядит как «другой продукт»: плоские локальные `Card` (серые плашки), 11 блоков простынёй, карточки не нажимаются, дубль «Вчерашний отчёт» внутри «Обзора», два блока про температуру подряд, английский подзаголовок в KPI (`EntityLink relationType=conflicted_with`), мёртвая «Средняя загрузка» (почти всегда 0, считается из `Appointment.loadPercent`, который никто не заполняет), `overview` грузится императивным `useEffect` (не SWR — нет авто-ревалидации/мутаций).
- **Ежедневный отчёт**: внутри «Обзора» панели операций тот же `YesterdayDigestCard` (двойной показ); «Кто выделился позитивом» всегда пуст (`whoShined` захардкожен `[]` на бэке, хотя данные есть); жаргон `conf 80%` и `high` в карточках.
- **Недельная сводка**: связный текст показан в `<pre>` (как «простыня кода»), грузится императивным `useEffect` (не SWR), английские единицы `pts`/`pp` в подписях; нет кнопок действия к проблемам и светофора срочности.

---

## REALITY-CHECK

| Факт | Доказательство (path:line + символ) | Влияние на фазы |
|---|---|---|
| Панель операций рисует локальный плоский `Card`, не общий `KpiHero` | `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx:293` — `function Card(props: {` | Ф1 заменяет на `KpiHero` |
| `overview` грузится императивным `useEffect` + `Promise.all`, не SWR | `OperationsDashboardClient.tsx:86` — `useEffect(() => {` + `:51` `useState<...>(null)` | Ф1 переводит на SWR |
| Дубль «Вчерашний отчёт» внутри «Обзора» панели | `OperationsDashboardClient.tsx:154` — `<YesterdayDigestCard` + локальный компонент `:516` `function YesterdayDigestCard` | Ф4 удаляет дубль из «Обзора» |
| Два блока про температуру подряд (summary-полоса + heatmap по людям) | `OperationsDashboardClient.tsx:193` `<TeamTemperatureWidget` и `:195` `<TeamTemperatureHeatmapCard` | Ф3 сворачивает в один с переключателем |
| Английский подзаголовок в KPI «Конфликты» | `OperationsDashboardClient.tsx:182` — `subtitle="EntityLink relationType=conflicted_with"` | Ф1 русифицирует |
| «Средняя загрузка» из `Appointment.loadPercent` (мёртвый, ≈0) | `backend/.../operations/services/operations-dashboard.service.ts:691` `private async fetchCapacity` + `:728` `overloadedCount` | Ф2 заменяет на живой показатель |
| «Открытые обещания» уже грузятся на этом экране (готовые данные) | `OperationsDashboardClient.tsx:91` — `commitmentsApi.listOpen({ days: 14, limit: 100 })`; `OpenCommitmentsListApi.total` | Ф2 берёт `total` без нового бэка |
| Recharts 3.8.1 уже в зависимостях | `frontend/package.json:60` — `"recharts": "^3.8.1"` | Recharts только при реальных рядах (нет — не вводим) |
| `whoShined` захардкожен пустым на бэке | `backend/.../operations/services/daily-digest.service.ts:785` — `const whoShined: DailyDigestPersonShinedDto[] = [];` | Ф4 реализует из готовых данных |
| Лейблы причин «выделился» уже есть на фронте | `frontend/.../daily/DailyDigestClient.tsx:641` `function shinedReasonLabel` (`recognition_received`/`helpful_acts`/`commitments_kept`) | Ф4 не трогает фронт-лейблы |
| Жаргон `conf` в карточке блокеров; `high` в urgent-бейдже | `DailyDigestClient.tsx:320` `conf {Math.round(b.confidence * 100)}%`; бэк `daily-digest.service.ts:777` `badge: 'high'` | Ф4 русифицирует |
| Права «Перегенерировать» на фронте уже включают `owner` | `DailyDigestClient.tsx:79` — `canRegenerate = isSuperAdmin \|\| currentOrgRole === 'admin' \|\| currentOrgRole === 'owner'` | Ф4 — проверить бэк-политику (см. ниже) |
| Бэк-эндпоинт regenerate: проверить роль (фронт пускает owner, бэк может вернуть `forbidden_role`) | `DailyDigestClient.tsx:100` — обработка `e.code === 'forbidden_role'` | Ф4 — выровнять бэк под owner ИЛИ убрать кнопку у owner |
| ДАННЫЕ для `whoShined` существуют: `Recognition`, `HelpfulnessSpotlight`, `IdeaBlock.commitmentStatus='fulfilled'` | `schema.prisma:8835` `model Recognition`, `:8798` `model HelpfulnessSpotlight`, `:2982` `commitmentStatus` | Ф4 строит whoShined из них |
| Недельный текст в `<pre>` (не Markdown), хотя на dev есть ReactMarkdown+rehypeSanitize | `frontend/.../weekly/WeeklyDigestClient.tsx:237` `<pre className=...>{data.bodyMarkdown}</pre>`; для образца — `DailyDigestClient.tsx:266` `<ReactMarkdown rehypePlugins={[rehypeSanitize]}>` | Ф5 заменяет на ReactMarkdown |
| Недельный грузится императивным `useEffect`, не SWR | `WeeklyDigestClient.tsx:36` `useEffect(() => {` + `:32` `useState<...>(null)` | Ф5 переводит на SWR |
| Английские единицы `pts`/`pp` | фронт `WeeklyDigestClient.tsx:338` `k.unit === 'pts' ? ' pts'`; бэк `weekly-digest.service.ts:947` `+${delta} pts`, `:973` `+${delta} pp` | Ф5 русифицирует |
| `OperationsTabs` — 3 таба, существует и работает | `frontend/src/ui/components/dashboard/OperationsTabs.tsx:27` `const ITEMS` | НЕ трогаем (3 таба сохраняются) |
| `KpiHero` поддерживает `href` (кликабельность), `threshold`, `numericValue`, `format` | `frontend/src/ui/components/shared/KpiHero.tsx:96` `export function KpiHero`, `:177` `if (href)` | Ф1 использует `href` |

---

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р(глоб) | БЕЗ финансов; только русский UI; парные токены | Кора слышит только текст (задачи/обещания/решения/настроение). Инвариант продукта. | 2026-06-05 |
| C1 | Панель операций → `KpiHero` + 3 зоны (Люди / Исполнение / Сигналы) | Унифицировать с «новой главной»; группировка снимает «простыню». | 2026-06-05 |
| C2 | Мёртвую «Средняя загрузка» заменить на **«Открытые обещания»** (живой текстовый показатель из разговоров) | `Appointment.loadPercent` не заполняется (≈0 → роняет доверие). `Открытые обещания` уже грузятся на экране. | 2026-06-05 |
| C3 | Свернуть 2 блока температуры в **один** с переключателем «Общая / По людям» | Дубль удлиняет страницу; переключатель = один блок, два среза. | 2026-06-05 |
| C4 | Ежедневный — НЕ сливать с «Обзором», **оставить 3 таба**; убрать лишь дубль `YesterdayDigestCard` из «Обзора» | Карта ТЗ-C прямо предписывает не сливать экраны (вопреки фразе из «простым языком»). 3 таба = понятная навигация. | 2026-06-05 |
| C5 | `whoShined` реализовать из **готовых** данных (recognition / kept commitments / helpful acts) | Демотивирующий «отчёт только про проблемы»; данные у Коры уже есть. | 2026-06-05 |
| C6 | Недельный текст: `<pre>` → `ReactMarkdown` + `rehypeSanitize` (как в daily) | `<pre>` читается как «код»; на dev уже есть тот же безопасный рендер. | 2026-06-05 |
| C7 | Recharts вводить ТОЛЬКО при реальных временных рядах | В overview/daily/weekly DTO нет временных рядов → графики не выдумываем. | 2026-06-05 |

### Доказательство выбора C2 (была развилка «чем заменить загрузку»)

Кандидаты на замену мёртвой «Средней загрузки»: (а) «Открытые обещания», (б) «Не отчитались сегодня», (в) «Зависли задачи». Выбор — (а) **«Открытые обещания»**, потому что:
1. Данные **уже грузятся** на этом экране (`commitmentsApi.listOpen` → `total`) — нулевая стоимость бэка, в отличие от любого нового сервиса.
2. Обещания — ядро Коры (устные обещания → дисциплина), тогда как (б)/(в) уже представлены отдельными карточками ниже на странице (`MissingCheckInsCard`, `StaleIssuesCard`) — дубль был бы хуже.
3. Текстовый, не финансовый — соответствует инварианту.

---

## Scope

### Входит
- Ф1: Панель операций → `KpiHero` + 3 зоны (Люди / Исполнение / Сигналы), кликабельные карты (`href`), `overview` на SWR, русификация подзаголовков KPI.
- Ф2: заменить KPI «Средняя загрузка» на «Открытые обещания» (из уже загруженных `commitments.total`).
- Ф3: свернуть 2 блока температуры в один с переключателем «Общая / По людям».
- Ф4: Ежедневный — убрать дубль `YesterdayDigestCard` из «Обзора»; реализовать `whoShined` на бэке; выровнять права «Перегенерировать»; русифицировать `conf`/`high`.
- Ф5: Недельный — `<pre>`→`ReactMarkdown(rehypeSanitize)`, на SWR, русификация `pts`/`pp`, кнопки действия к проблемам + светофор срочности.

### Не входит
- **Разрез по людям в недельной сводке** (топ-5 «держат слово» / топ-5 «зоны риска», `commitmentAuthorPersonId`) → **ТЗ-D** `plans/tz/2026-06-05-weekly-per-person-plan-fact.md`. Светофор срочности в Ф5 строится только над уже существующими блоками (повторяющиеся блокеры / висящие решения / сигналы), без разреза по людям.
- Изменение схемы Prisma — в этом ТЗ **нет** (whoShined и все KPI строятся над существующими полями). `commitmentAuthorPersonId`/`ownerPersonId` — чужой scope (ТЗ-D/ТЗ-F).
- Полировка Hero/честность данных на ГЛАВНОЙ (`/dashboard`) → ТЗ-A `plans/tz/2026-06-05-dashboard-main-polish-and-honesty.md`.
- Recharts-графики (нет реальных временных рядов в этих DTO) → vNext, когда появятся ряды.
- LLM-промпты daily/weekly digest (текст уже генерируется) — НЕ трогаем (см. «Совместимость с prompt caching»).

---

## Граничные контракты с другими ТЗ (что НЕ трогать)

- **`schema.prisma`** — ТЗ-C его НЕ трогает. Поля `commitmentAuthorPersonId` (ТЗ-D), `Goal.ownerPersonId` (ТЗ-F), `Goal.isPrimary` (ТЗ-B) — чужой scope. Если при реализации Ф4 захочется автора kept-commitment — использовать `commitmentRecipientPersonId` НЕЛЬЗЯ как «автора»; вместо этого kept-commitment в `whoShined` строить через `commitmentAuthorPersonId` **только если поле уже существует в схеме** (graceful: при отсутствии поля — пропустить причину `commitments_kept`, оставив `recognition_received` + `helpful_acts`). Так ТЗ-C не блокируется ТЗ-D.
- **`OperationsTabs.tsx`** — НЕ трогать (3 таба сохраняются, C4).
- **`KpiHero.tsx`** — переиспользуем как есть; новых пропов НЕ добавляем (всё покрыто `value`/`numericValue`/`format`/`threshold`/`href`). Если потребуется правка `KpiHero` — это влияет на главную (ТЗ-A) → согласовать, не ломать существующий контракт.
- **`/dashboard/director` (главная)** — не наш экран; Ф1 не меняет главную.

---

## Контракт-first (единый источник правды фронт↔бэк)

### Ф2 — KPI «Открытые обещания» (без нового бэка)

Источник — уже вызываемый на экране метод. Контракт не меняется:

```ts
// frontend/src/api/commitments.api.ts:17 — существующий тип, НЕ менять
export interface OpenCommitmentsListApi {
  items: CommitmentApi[];
  total: number; // ← KPI «Открытые обещания» = total
}
// Вызов уже есть: OperationsDashboardClient.tsx:91
//   commitmentsApi.listOpen({ days: 14, limit: 100 })
```

KPI рендерится в зоне «Исполнение» через `KpiHero`:
```tsx
<KpiHero
  label="Открытые обещания"
  value={commitments?.total ?? 0}
  numericValue={commitments?.total ?? 0}
  threshold={{ green: 5, yellow: 15, inverted: true }} // меньше = лучше
  href="/dashboard/operations/weekly"
/>
```
Пороги `green/yellow` — локальные UI-константы фазы (НЕ финансовые, НЕ крутилки super_admin: это визуальный порог цвета, как у существующих KPI; см. инвариант — крутилки только для прайсов/лимитов/retention). Если `commitments === null` (запрос упал) — показать `KpiHero` со `value={0}` и нейтральным тоном (без `threshold`), не ронять зону.

### Ф4 — Бэк: `whoShined` (DTO не меняется)

DTO остаётся прежним (фронт-лейблы уже есть, `DailyDigestClient.tsx:641`):

```ts
// backend/.../operations/dto/operations-daily-digest.dto.ts — СУЩЕСТВУЮЩИЙ тип
export interface DailyDigestPersonShinedDto {
  personId: string;
  personName: string;
  reason: 'recognition_received' | 'helpful_acts' | 'commitments_kept';
  detail: string;   // до 120 символов, человеческий текст
  link: string;     // `/persons/:id`
}
```

Алгоритм (в `daily-digest.service.ts`, заменить `:785` `const whoShined = [];`):

```
whoShined(tenantId, dayStart, dayEnd, dateLocal):
  map = Map<personId, DailyDigestPersonShinedDto>   // дедуп; приоритет причин:
        // recognition_received > helpful_acts > commitments_kept
  // 1) recognition_received — Recognition.createdAt в окне, toUserId → Person
  //    select toUserId, type, message; group by toUserId; detail = кол-во + последний type
  // 2) helpful_acts — HelpfulnessSpotlight: periodFrom/periodTo пересекают день
  //    ИЛИ createdAt в окне; helperUserId → Person; detail = `помог N раз`
  // 3) commitments_kept — IdeaBlock signalType='commitment',
  //    commitmentStatus='fulfilled', updatedAt в окне [dayStart,dayEnd)
  //    атрибуция автора:
  //      ЕСЛИ поле commitmentAuthorPersonId существует в схеме → по нему;
  //      ИНАЧЕ причину commitments_kept ПРОПУСТИТЬ (graceful, см. границы)
  return Array.from(map.values()).slice(0, 8)
```

User↔Person: маппинг `toUserId`/`helperUserId` (User) → Person через существующий резолвер организации (как в других местах daily-digest используется `Person`); если Person не найден — запись пропустить (не показывать «Без имени» в позитивной секции). Окно — то же `[dayStart, dayEnd)` в МСК, что у `whoStruggled` (`daily-digest.service.ts:790` redCheckIns по `dateLocal`).

Машинные коды ошибок: новых нет (метод внутренний, без HTTP-контракта).

### Ф4 — Бэк: права «Перегенерировать» (выровнять под owner)

Фронт пускает `owner` (`DailyDigestClient.tsx:79`). Найти RBAC-проверку POST-эндпоинта regenerate и привести политику к `owner | admin | super_admin` (как на фронте). Если по продуктовому решению regenerate остаётся admin-only — тогда **убрать owner из `canRegenerate` на фронте**, чтобы кнопка не показывалась тому, кому бэк ответит `forbidden_role`. Канон (C4): **выровнять бэк под owner** (owner — самый активный, ему логично пересобирать). Контракт ошибки сохраняется:
```
POST regenerate → 403 { code: 'forbidden_role' }  // только если роль вне whitelist
```

### Ф4 — Бэк: русификация бейджа urgent

```ts
// daily-digest.service.ts:777 — было badge: 'high'
badge: 'важный сигнал'   // вместо англ. 'high'
```

### Ф5 — Бэк: русификация единиц (weekly-digest.service.ts)

```
// :947 `+${delta} pts`  → `+${delta} балл.`  (настроение, шкала пунктов)
// :973 `+${delta} pp`   → `+${delta} п.п.`   (процентные пункты обещаний)
```
Фронт-подпись единиц (`WeeklyDigestClient.tsx:338`):
```ts
const unitSuffix = k.unit === '%' ? '%' : k.unit === 'pts' ? ' балл.' : ' шт';
```
(значение поля `unit` API НЕ меняем — меняем только человеческую подпись на фронте; `pp` встречается только в `detail`-строке бэка, поэтому правится на бэке).

### ASCII-поток данных Панели операций (после Ф1–Ф3)

```
SWR ['operations-overview']  →  getOverview()  ─┐
SWR ['operations-open-commitments'] → listOpen ─┤
                                                ├─► KpiHero × зоны:
  ┌──────────── Люди ──────────────┐            │   [Конфликты][Не отчит.][Темп.красн.]
  ┌──────────── Исполнение ────────┐            │   [Блокеры][Провал.цели][Откр.обещания]
  ┌──────────── Сигналы ───────────┐            │   [Сигналы по причинам][Зрелость]
                                                │
TeamTemperature (один блок, переключатель) ◄────┘  «Общая % / По людям heatmap»
```

---

## Границы автономии (локально для фичи)

- ✅ **Always**: заменять локальный `Card` на `KpiHero`; добавлять `href` к картам; переводить `useEffect`-загрузку на SWR; русифицировать строки; сворачивать дубли; реализовать `whoShined` над существующими таблицами.
- ⚠️ **Ask first**: любое изменение `schema.prisma`; любое изменение `KpiHero.tsx` (общий компонент главной); изменение SYSTEM-промптов daily/weekly digest; изменение DTO-контрактов overview/daily/weekly.
- 🚫 **Never**: вводить финансовые/денежные KPI; англ. слова в UI; `text-white`/hex/`slate-*`; Recharts без реальных временных рядов; сливать 3 таба в один; `prisma migrate`; `new PrismaClient()` в скриптах.

---

## Фазы (dependency-ordered)

Граф зависимостей:
```
Ф1 (Панель: KpiHero + зоны + SWR) ──► Ф2 (KPI «Открытые обещания») ──► Ф3 (свернуть температуру)
Ф4 (Ежедневный)   — независима от Ф1–Ф3 (другой экран)
Ф5 (Недельный)    — независима от Ф1–Ф4 (другой экран)
```
Порядок выполнения: **Ф1 → Ф2 → Ф3 → Ф4 → Ф5** (Ф2/Ф3 правят то же дерево, что Ф1; Ф4/Ф5 можно делать параллельно после Ф1, но рекомендуется последовательно).

---

### Ф1 — Панель операций: KpiHero + 3 зоны + кликабельность + SWR

**Цель.** Унифицировать Панель операций с «новой главной»: `KpiHero` вместо плоского `Card`, KPI сгруппированы в 3 зоны (Люди / Исполнение / Сигналы), карты кликабельны (`href`), `overview` грузится через SWR.

**Что входит.**
- Удалить локальный `function Card` (`OperationsDashboardClient.tsx:293`), заменить все 4 KPI на `KpiHero`.
- Перевести загрузку `overview` + `open-commitments` с `useEffect`/`useState` (`:51`, `:86`) на `useSWR` (как уже сделано для `dailyDigestSwr`/`temperatureSwr` в этом же файле, `:59`, `:70`).
- Сгруппировать KPI-карты в 3 визуальные зоны с подзаголовками «Люди» / «Исполнение» / «Сигналы».
- Кликабельность: каждой `KpiHero` дать `href` на профильный экран (блокеры → `#`-якорь секции «Свежие блокеры» на той же странице или `/dashboard/operations/weekly`; конфликты → секция «Свежие конфликты»; обещания → `/dashboard/operations/weekly`). Если нет подходящего drill-down маршрута — `href` не задавать (карта остаётся некликабельной, без выдуманных ссылок).
- Русифицировать подзаголовок KPI «Конфликты»: `subtitle="EntityLink relationType=conflicted_with"` → `subtitle` с человеческим текстом (напр. `конфликтов в команде` или скрыть subtitle).

**Что НЕ входит.** Замена «Средней загрузки» (Ф2); сворачивание температуры (Ф3); правка бэка.

**Точные файлы.**
- `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx:51` (`useState data`), `:86` (`useEffect`), `:165-191` (grid из 4 `<Card>`), `:293` (`function Card`), `:182` (англ. subtitle).
- Импорт: `import { KpiHero } from '@/ui/components/shared/KpiHero';`

**Зависимости.** Нет.

**Acceptance.**
- `grep -n "function Card" OperationsDashboardClient.tsx` → пусто (локальный Card удалён).
- `grep -n "KpiHero" OperationsDashboardClient.tsx` → ≥4 вхождения.
- `grep -n "useEffect" OperationsDashboardClient.tsx` → нет загрузки overview через useEffect (остаётся только синхронизация, если нужна; основной overview — через `useSWR`).
- `grep -n "EntityLink relationType" OperationsDashboardClient.tsx` → пусто.
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- Пример: при `blockersBySeverity.high>0` карта «Активные блокеры» имеет `data-tone="danger"` (через `threshold`); при `0` → нейтральный/успех.

Закрывает: R1, R2, R7.

---

### Ф2 — KPI «Открытые обещания» вместо мёртвой «Средней загрузки»

**Цель.** Убрать мёртвый показатель «Средняя загрузка» (≈0) и поставить живой текстовый из разговоров — «Открытые обещания» (`commitments.total`, уже загружается).

**Что входит.**
- Удалить KPI «Средняя загрузка» (`OperationsDashboardClient.tsx:184-190`, `value={data.capacityAvgPercent}`).
- Добавить `KpiHero label="Открытые обещания"` в зону «Исполнение», `value/numericValue = commitments?.total ?? 0`, `threshold={{green:5,yellow:15,inverted:true}}`, `href="/dashboard/operations/weekly"`.
- Бэк `fetchCapacity`/`capacityAvgPercent` — НЕ удалять из DTO (может использоваться в другом месте); просто перестать рендерить на этом экране. (Проверить grep: если `capacityAvgPercent`/`capacityOverloadedCount` больше нигде не читаются на фронте — оставить в DTO, не ломая контракт.)

**Что НЕ входит.** Удаление полей capacity из DTO/сервиса; новый эндпоинт.

**Точные файлы.**
- `OperationsDashboardClient.tsx:184` (`<Card title="Средняя загрузка"`), `:91` (`commitmentsApi.listOpen`), `:52` (`commitments` state — после Ф1 через SWR).

**Зависимости.** Ф1 (зоны и `KpiHero` уже на месте).

**Acceptance.**
- `grep -n "Средняя загрузка" OperationsDashboardClient.tsx` → пусто.
- `grep -n "Открытые обещания" OperationsDashboardClient.tsx` → ≥1.
- `cd frontend && bun run typecheck && bun run build` — зелёные.
- Пример вход→выход: `commitments.total = 22` → KPI показывает `22`, тон `danger` (>15, inverted). `total = 3` → тон `success`. `commitments = null` → KPI `0`, нейтральный, экран не падает.

Закрывает: R3.

---

### Ф3 — Свернуть 2 блока температуры в один с переключателем

**Цель.** Объединить `TeamTemperatureWidget` (общая полоса зелёный/жёлтый/красный) и `TeamTemperatureHeatmapCard` (по людям) в **один** блок с переключателем «Общая / По людям».

**Что входит.**
- Один контейнер-секция «Температура команды» с табами/сегмент-контролом (парные токены, как `OperationsTabs`): «Общая» (рендерит существующий контент `TeamTemperatureWidget`) и «По людям» (рендерит `TeamTemperatureHeatmap`).
- Сохранить оба источника данных (`data.teamTemperature` и `temperatureSwr`); по умолчанию активна «Общая».
- Empty-states обоих режимов сохранить (текущие тексты `:358`, `:595`).

**Что НЕ входит.** Изменение heatmap-компонента; новые данные.

**Точные файлы.**
- `OperationsDashboardClient.tsx:193` (`<TeamTemperatureWidget`), `:195` (`<TeamTemperatureHeatmapCard`), `:328` (`function TeamTemperatureWidget`), `:581` (`function TeamTemperatureHeatmapCard`).

**Зависимости.** Ф1.

**Acceptance.**
- На странице ровно **один** заголовок-секция про температуру (визуально), переключатель с 2 режимами.
- `grep -n "Температура команды" OperationsDashboardClient.tsx` — заголовки сохранены, но рендерятся внутри одного контейнера (оба под-режима не показываются одновременно).
- Сегмент-контрол использует `bg-accent/15 text-accent-fg` для активного (парные токены), без `text-white`/hex.
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.

Закрывает: R4.

---

### Ф4 — Ежедневный отчёт: дубль, whoShined, права, русификация

**Цель.** Убрать дубль `YesterdayDigestCard` из «Обзора» панели операций (НЕ сливать экраны — 3 таба остаются), реализовать `whoShined` на бэке из готовых данных, выровнять права «Перегенерировать» под owner, русифицировать `conf`/`high`.

**Что входит.**
1. **Убрать дубль**: удалить рендер `<YesterdayDigestCard>` (`OperationsDashboardClient.tsx:154`) и локальный компонент `function YesterdayDigestCard` (`:516`) с «Обзора» панели. Ежедневный отчёт доступен через таб «Сегодня» (`/dashboard/operations/daily`). SWR `dailyDigestSwr` (`:59`) — удалить, если больше не используется на «Обзоре».
2. **whoShined** (бэк): заменить `daily-digest.service.ts:785` `const whoShined = []` на сбор из `Recognition` / `HelpfulnessSpotlight` / kept-commitments (`commitmentStatus='fulfilled'`, атрибуция по `commitmentAuthorPersonId` только если поле есть в схеме — иначе причину пропустить). DTO не меняется. Дедуп по personId, `slice(0,8)`.
3. **Права «Перегенерировать»** (бэк): выровнять RBAC POST-эндпоинта regenerate под `owner | admin | super_admin` (фронт уже пускает owner, `DailyDigestClient.tsx:79`). Если решено оставить admin-only — убрать `owner` из `canRegenerate` на фронте.
4. **Русификация**: `conf {Math.round(b.confidence*100)}%` (`DailyDigestClient.tsx:320`) → `уверенность {…}%`; бэк urgent-бейдж `'high'` (`daily-digest.service.ts:777`) → `'важный сигнал'`.

**Что НЕ входит.** Слияние «Обзора» и «Сегодня»; изменение секций urgent/events/struggled; LLM-промпт digest.

**Точные файлы.**
- `OperationsDashboardClient.tsx:154`, `:516`, `:59`.
- `backend/.../operations/services/daily-digest.service.ts:785` (`whoShined`), `:777` (`badge: 'high'`), `:790` (окно, образец дедупа).
- `frontend/.../daily/DailyDigestClient.tsx:320` (`conf`), `:79` (`canRegenerate`), `:100` (`forbidden_role`).
- RBAC: `backend/src/modules/rbac/policies/policy.csv` + контроллер regenerate (найти по `forbidden_role` / `regenerate`).
- Тесты: `backend/.../operations/services/daily-digest.service.spec.ts` (или новый) — кейс whoShined.

**Зависимости.** Можно после Ф1 (дубль на «Обзоре»). Бэк-часть (2–4) независима.

**Acceptance.**
- `grep -n "YesterdayDigestCard" OperationsDashboardClient.tsx` → пусто.
- `grep -n "const whoShined" daily-digest.service.ts` → НЕ присваивается пустым массивом-литералом (`= []`); собирается из источников. Проверка: `grep -n "Recognition\|HelpfulnessSpotlight" daily-digest.service.ts` → ≥1 в методе whoShined.
- `grep -n "badge: 'high'" daily-digest.service.ts` → пусто; `grep -n "важный сигнал" daily-digest.service.ts` → ≥1.
- `grep -n "conf " DailyDigestClient.tsx` → пусто (только `уверенность`).
- Бэк: `bunx vitest run` для нового spec whoShined: при наличии 1 `Recognition.toUserId=A` в окне → `whoShined` содержит `{personId:A, reason:'recognition_received'}`; при 1 fulfilled-commitment без `commitmentAuthorPersonId` (если поля нет) → причина `commitments_kept` отсутствует, ошибки нет.
- Негативный: пустые источники → `whoShined=[]`, экран показывает существующий fallback «Вчера было спокойно».
- `cd backend && bun run typecheck && bun run lint` + `cd frontend && bun run typecheck && bun run build` — зелёные.
- Swagger smoke: `GET /api/v1/dashboard/operations/daily-digest?date=...` отдаёт `whoShined` непустым при наличии данных.

Закрывает: R5, R6, R8, R9.

---

### Ф5 — Недельная сводка: Markdown, SWR, русификация, кнопки + светофор

**Цель.** Связный текст показать через `ReactMarkdown`+`rehypeSanitize` (не `<pre>`), грузить через SWR, русифицировать `pts`/`pp`, к блокам проблем добавить кнопки действия и светофор срочности — БЕЗ разреза по людям (ТЗ-D).

**Что входит.**
1. `<pre>{data.bodyMarkdown}</pre>` (`WeeklyDigestClient.tsx:237`) → `<ReactMarkdown rehypePlugins={[rehypeSanitize]}>{data.bodyMarkdown}</ReactMarkdown>` в `prose`-обёртке (образец — `DailyDigestClient.tsx:265-268`).
2. Загрузка: `useEffect`/`useState` (`:32`, `:36`) → `useSWR(['weekly-digest', weekStart], …)` (как в daily).
3. Русификация: фронт `pts`→`балл.` (`:338`), бэк `pts`/`pp` в `detail` (`weekly-digest.service.ts:947`, `:973`).
4. **Кнопки действия + светофор срочности** к существующим блокам проблем:
   - «Повторяющиеся блокеры» (`:179`), «Висящие решения» (`:215`), «Главные сигналы» (`:196`): к каждому пункту — индикатор срочности (светофор: красный/жёлтый/серый, парные токены) по уже доступному полю (`count` блокеров, `ageDays` решений, `dynamicLabel` сигналов) и кнопку-ссылку «Открыть» на профильный экран (решения → `/decisions/:id`, блокеры/сигналы → существующие маршруты `/themes`/`/insights`, как в daily).
   - Пороги светофора — локальные UI-константы фазы (визуальные, не крутилки), напр.: висящее решение `ageDays≥14` → красный, `≥7` → жёлтый, иначе серый.

**Что НЕ входит.** **Разрез по людям** (топ-5 держат/риск), `commitmentAuthorPersonId`, новый агрегат по personId → **ТЗ-D**. Изменение KPI-дельт логики.

**Точные файлы.**
- `frontend/.../weekly/WeeklyDigestClient.tsx:237` (`<pre>`), `:36` (`useEffect`), `:32` (`useState data`), `:338` (`pts`), `:179`/`:196`/`:215` (блоки проблем).
- `backend/.../operations/services/weekly-digest.service.ts:947` (`pts`), `:973` (`pp`).
- Импорты на фронте: `ReactMarkdown`, `rehypeSanitize`, `useSWR` (паттерн из daily).

**Зависимости.** Независима (другой экран). Рекомендуется после Ф4.

**Acceptance.**
- `grep -n "<pre" WeeklyDigestClient.tsx` → пусто; `grep -n "ReactMarkdown" WeeklyDigestClient.tsx` → ≥1; `grep -n "rehypeSanitize" WeeklyDigestClient.tsx` → ≥1.
- `grep -n "useSWR" WeeklyDigestClient.tsx` → ≥1; `grep -n "useEffect" WeeklyDigestClient.tsx` — нет загрузки данных через useEffect.
- `grep -n "' pts'\|pts" WeeklyDigestClient.tsx` → нет англ. `pts` в подписи (есть `балл.`); `grep -n " pts\| pp" weekly-digest.service.ts` → пусто (заменены на `балл.`/`п.п.`).
- Светофор: у блока «Висящие решения» с `ageDays=20` пункт имеет `data-`/класс с тоном `danger` (парные токены); `ageDays=3` → нейтральный.
- Кнопка «Открыть» у каждого пункта проблем ведёт на существующий маршрут (нет битых `/`).
- `cd frontend && bun run typecheck && bun run lint && bun run build` + `cd backend && bun run typecheck` — зелёные.

Закрывает: R10, R11, R12, R13.

---

## Требования (EARS) + трассировка R→фаза

- **R1.** Когда владелец/COO открывает `/dashboard/operations`, система shall рендерить главные KPI компонентом `KpiHero` (не локальным плоским `Card`); локальная функция `Card` в `OperationsDashboardClient.tsx` shall отсутствовать. → Ф1
- **R2.** Когда грузится Панель операций, система shall запрашивать `overview` и `open-commitments` через `useSWR` (не императивный `useEffect`+`useState`). → Ф1
- **R3.** Когда рендерится зона «Исполнение», система shall показывать KPI «Открытые обещания» со значением `commitments.total` и НЕ показывать KPI «Средняя загрузка». При `commitments===null` значение shall быть `0` без падения экрана. → Ф2
- **R4.** Когда на Панели операций есть блок температуры, система shall показывать его как **один** блок с переключателем «Общая / По людям» (а не два отдельных блока подряд). → Ф3
- **R5.** Когда владелец открывает «Обзор» Панели операций, система shall НЕ показывать карточку `YesterdayDigestCard` (дубль ежедневного отчёта); ежедневный отчёт доступен только через таб «Сегодня». → Ф4
- **R6.** Когда за день есть ≥1 запись `Recognition` / `HelpfulnessSpotlight` / fulfilled-commitment с резолвимым Person, система shall вернуть непустой `whoShined` (до 8 человек, дедуп по personId). Когда таких данных нет — `whoShined` shall быть `[]`. → Ф4
- **R7.** Когда рендерится KPI «Конфликты в команде», подпись shall быть на русском (без строки `EntityLink relationType=conflicted_with`). → Ф1
- **R8.** Когда пользователь с ролью `owner` нажимает «Перегенерировать», система shall выполнить регенерацию (бэк НЕ shall вернуть `forbidden_role` для owner); ИЛИ кнопка shall быть скрыта для owner. → Ф4
- **R9.** Когда рендерится карточка нового блокера/urgent-бейдж, текст shall быть на русском (`уверенность N%` вместо `conf N%`; `важный сигнал` вместо `high`). → Ф4
- **R10.** Когда рендерится связный текст недельной сводки, система shall использовать `ReactMarkdown` с `rehypeSanitize` (не `<pre>`). → Ф5
- **R11.** Когда грузится недельная сводка, система shall запрашивать её через `useSWR`. → Ф5
- **R12.** Когда показываются единицы недельных дельт, подписи shall быть на русском (`балл.`, `п.п.`) — без `pts`/`pp`. → Ф5
- **R13.** Когда показывается блок проблем недельной сводки (повторяющиеся блокеры / висящие решения / главные сигналы), каждый пункт shall иметь индикатор срочности (светофор по `count`/`ageDays`/`dynamicLabel`, парные токены) и кнопку-ссылку «Открыть» на существующий маршрут. → Ф5

| R | Фаза |
|---|---|
| R1, R2, R7 | Ф1 |
| R3 | Ф2 |
| R4 | Ф3 |
| R5, R6, R8, R9 | Ф4 |
| R10, R11, R12, R13 | Ф5 |

---

## Совместимость с prompt caching

ТЗ-C **не трогает SYSTEM-промпты** daily/weekly digest. Текст уже генерируется существующими агентами; Ф4/Ф5 меняют только non-LLM строки (`badge`, единицы `pts`/`pp` в детерминированном `detail`) и фронт-рендер. Кэш LLM не затрагивается. Раздел применим как «гарантия неприкосновенности промптов»: при реализации НЕ редактировать prompt-registry digest-агентов.

---

## Pre-mortem / Риски + ревью-аспекты

- **Риск: `KpiHero href` на несуществующий маршрут** → битый drill-down. Митигация: `href` задавать только на проверенные маршруты; иначе карта без `href` (R1/R13 acceptance проверяет «нет битых `/`»).
- **Риск: `whoShined` утечёт негатив/ложно-позитив** (показать «молодца», который на деле нет). Митигация: только `fulfilled`/recognition/helpful, дедуп, пропуск без резолвимого Person; spec-кейс.
- **Риск: kept-commitment атрибуция по получателю вместо автора** (показали бы не того). Митигация: причину `commitments_kept` строить ТОЛЬКО по `commitmentAuthorPersonId` (если поле есть); иначе пропустить — НЕ использовать `commitmentRecipientPersonId` как автора.
- **Риск: рассинхрон прав regenerate фронт/бэк** → owner жмёт, бэк 403. Митигация: R8 (выровнять или скрыть).
- **Риск: удаление `capacityAvgPercent` из DTO сломает другой потребитель**. Митигация: поле в DTO НЕ удаляем (Ф2), только перестаём рендерить; grep-проверка иных потребителей.
- **Ревью (strict-production-review-gate)**: multi-tenancy — все новые запросы whoShined фильтруют `tenantId`; парные токены в светофоре/переключателе; нет `text-white`/hex; SWR-ключи стабильны; idempotent (фича без записи в БД — read-only).

---

## Idempotency / feature-flag / prod-deploy

- **Запись в БД**: нет. Все изменения — read-only агрегации + UI. Backfill/seed/patch не требуются → шаги prod-deploy 6/7/8 **не затронуты**.
- **Schema (Шаг 4)**: НЕ затронут (ТЗ-C не меняет `schema.prisma`).
- **ENV/AdminSetting (Шаг 1)**: НЕ затронут (визуальные пороги светофора/тонов — локальные UI-константы, не крутилки; новых ENV нет).
- **Feature-flag**: не требуется (нет рискового runtime-поведения; чистый UI/read-агрегация). Откат — git revert.
- **RBAC (Ф4)**: если правится `policy.csv` — это деплой-чувствительно: после деплоя проверить, что owner проходит regenerate (Swagger smoke, Шаг 12).
- **Smoke (Шаг 12)**: `GET /api/v1/dashboard/operations/daily-digest` отдаёт `whoShined`; `GET .../weekly-digest` отдаёт `detail` без `pts`/`pp`.

---

## DoD

- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- `cd backend && bun run typecheck && bun run lint` — зелёные; `bunx vitest run` для нового/обновлённого `daily-digest.service.spec.ts` (whoShined) — зелёный.
- Все grep-маркеры из Acceptance фаз выполняются.
- second-brain (таблица производных заметок): если правился `policy.csv` → `01_projects/admin.md` / RBAC-заметка; обновить `01_projects/operations-dashboards.md` (или профильную) с фактом «whoShined реализован, температура свёрнута, недельный на Markdown/SWR».
- `docs/operations/prod-deploy-log.md`: Шаг 12 (smoke whoShined / единицы); если правился `policy.csv` — отметить как RBAC-проверку. Иначе — «prod-операций нет, достаточно `docker compose up -d --build`».
- Рефлексия в `second-brain/05_история/` после push.

---

## Итог (заполнит оркестратор)

- [ ] Ф1 — Панель операций: KpiHero + 3 зоны + кликабельность + SWR
- [ ] Ф2 — KPI «Открытые обещания» вместо «Средней загрузки»
- [ ] Ф3 — Свернуть 2 блока температуры в один с переключателем
- [ ] Ф4 — Ежедневный: дубль / whoShined / права / русификация
- [ ] Ф5 — Недельный: Markdown / SWR / русификация / кнопки + светофор
