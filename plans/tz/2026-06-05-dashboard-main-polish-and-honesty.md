---
type: tz
status: ready-to-implement
feature: dashboard-main-polish-and-honesty
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/tz/2026-06-01-dashboard-main-tabs-restructure.md
---

> Анализ-карта: plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md (секция «ТЗ-A») · Решения владельца: 2026-06-05

# ТЗ-A — Главная: честность данных + полировка Hero

## Цель

Сделать главный экран владельца (`/dashboard`, директорский вид) честным и аккуратным: убрать `undefined формируется`, явно помечать выдуманные («образец») данные у пустой компании, починить обрезку главных цифр, убрать двойной заголовок AI-сводки, показать дату данных и вычистить мёртвый код. Это чисто UI + один контракт-фикс backend (переименование поля). Без новых таблиц, без `prisma db push`, без LLM-изменений.

## Зачем (болезненное состояние по факту)

Главная — «лицо» продукта, первый экран после входа. Сейчас на ней:
- надпись `undefined формируется` в «Структуре компании» (backend отдаёт `building`, фронт ждёт `forming`);
- у новой компании рисуются красивые цифры-образец (Настроение 42, Обещания 82%, и т.п.) **без пометки «образец»** — владелец верит, жмёт «Решения», а там пусто → теряет доверие к пульту (болячка №1 из языкового документа);
- главная цифра KPI обрезается (`82%` не влезает из-за `overflow-hidden` + `text-6xl`);
- у AI-сводки двойной заголовок (внешний «AI-сводка» в Hero + собственный «AI-сводка за неделю» внутри компонента);
- не видно даты данных, хотя backend её уже отдаёт (`generatedAt`);
- в репозитории лежат два мёртвых файла (`DashboardClient.tsx`, `CurationPendingWidget.tsx`) и устаревший комментарий «TODO Б.4».

---

## REALITY-CHECK

| Факт | Доказательство (path:line + символ) | Влияние на фазы |
|---|---|---|
| Backend отдаёт `roleProfiles.building`, фронт-тип и виджет ждут `forming` → `swr.data.roleProfiles.forming` = `undefined` | `backend/src/modules/structure/structure.service.ts:5-17` (`interface StructureSummaryDto` с `building`), `:74` (`building: grouped.forming ?? 0`); `frontend/src/api/structure.api.ts:155-165` (`StructureSummaryApi` с `forming`); `frontend/app/(authenticated)/dashboard/widgets/StructureSummaryWidget.tsx:86` (`${swr.data.roleProfiles.forming} формируется`) | Ф1 — переименовать backend `building`→`forming` |
| `SampleStoryBanner` существует, нигде не рендерится (нет импортов) | `frontend/src/ui/components/dashboard/SampleStoryBanner.tsx:17` (`export function SampleStoryBanner`); grep по имени — только определение | Ф2 — подключить баннер |
| `isEmpty` уже доходит до домена фронта, но не используется в Hero | `frontend/src/domain/director-dashboard.ts:409` (`isEmpty: boolean`), `:582` (`isEmpty: api.isEmpty ?? false`); backend `director-dashboard.service.ts:219` (`isEmpty: true` в sample-ветке) | Ф2 — есть флаг для пометки «образец» |
| KPI-цифра обрезается: `overflow-hidden` на карточке + `text-5xl md:text-6xl leading-none` на числе | `frontend/src/ui/components/shared/KpiHero.tsx:136` (`...overflow-hidden rounded-xl...`), `:154-161` (`text-5xl ... md:text-6xl`); 3 KPI в `lg:col-span-1` с `md:grid-cols-3` → узкая колонка `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:336-367` | Ф3 — снять обрезку у числа + адаптив |
| Двойной заголовок AI-сводки: внешний «AI-сводка» в Hero + внутренний «AI-сводка за {period}» в компоненте + своя рамка/отступ | `DirectorDashboardClient.tsx:369-380` (зона 2, `<span>AI-сводка</span>` + `<AiNarrativeWithSources .../>`); `AiNarrativeWithSources.tsx:30-39` (внешний `<div className="mb-6 rounded-xl border... p-4">` + «AI-сводка за {periodLabel}») | Ф4 — проп `bare` у `AiNarrativeWithSources` |
| `generatedAt` уже есть в DTO/домене, на главной не выводится; в operations выводится | DTO `backend/src/modules/dashboard/dto/director-dashboard.dto.ts:201` (`generatedAt: string`); service `director-dashboard.service.ts:189,238`; домен `frontend/src/domain/director-dashboard.ts:385` (`generatedAt: Date`), `:555` (`generatedAt: new Date(api.generatedAt)`); пример вывода `OperationsDashboardClient.tsx:142` (`Обновлено {data.generatedAt.toLocaleString('ru-RU')}`) | Ф5 — только фронт, backend трогать НЕ нужно |
| `DashboardClient.tsx` — мёртвый: роутер импортирует только `DirectorDashboardClient` | `frontend/app/(authenticated)/dashboard/DashboardRouter.tsx:10,45` (импорт+рендер `DirectorDashboardClient`); grep `DashboardClient` по фронту — `DashboardClient.tsx:70` только собственное определение | Ф6 — удалить файл |
| `CurationPendingWidget.tsx` — мёртвый: нигде не импортируется | `frontend/app/(authenticated)/dashboard/widgets/CurationPendingWidget.tsx:17` — единственное вхождение по grep | Ф6 — удалить файл |
| Устаревший комментарий «TODO Б.4» у работающей кнопки «Спросите Кору» (кнопка работает через `assistant-sidebar:open-ask`) | `DirectorDashboardClient.tsx:408` (`// TODO Б.4: открыть AssistantSidebar...`), `:411` (`window.dispatchEvent(new CustomEvent('assistant-sidebar:open-ask'))`) | Ф6 — убрать стале-комментарий |
| Парные токены `chip-info-bg`/`chip-info-fg` существуют (нужны баннеру) | `frontend/tailwind.config.ts:67-68`; `SampleStoryBanner.tsx:23` уже использует `bg-chip-info-bg` | Ф2 — токены готовы |

---

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р1 | Якорь вектора цели = `Goal.isPrimary` | (Это ТЗ-B; здесь НЕ затрагивается — указано для контекста, что схему трогают B/D/F, не A) | 2026-06-05 |
| Р2 | owner/admin видят настроение всегда | (Это ТЗ-G; здесь не затрагивается) | 2026-06-05 |
| Р3 | Кабинет «Я» (вкладки + редиректы) | (Это ТЗ-E; здесь не затрагивается) | 2026-06-05 |
| Р4 | `Goal.ownerPersonId` + `commitmentAuthorPersonId` (db push) | (Это ТЗ-F/ТЗ-D; здесь не затрагивается — ТЗ-A БЕЗ `prisma db push`) | 2026-06-05 |
| A-1 | Фикс `undefined формируется` = переименовать backend `building`→`forming` (фронт-нейминг честнее, фронт-контракт уже на `forming`) | Минимальный фикс: одно поле в одном interface + один маппинг; фронт менять не нужно. Альтернатива (правка фронта на `building`) хуже — «формируется» по смыслу = `forming`-статус | 2026-06-05 |
| A-2 | У пустой компании показывать `SampleStoryBanner` **и** пометку «образец» на KPI (не показывать «честные нули») | Картинка-образец полезна для понимания «как будет», но обязана быть подписана. Нули у новой компании менее наглядны и тоже требуют пометки — лишняя ветка без выигрыша | 2026-06-05 |
| A-3 | KPI: снять `overflow-hidden` с обёртки числа + дать числу `break-words`/адаптивный размер, зону KPI оставить в текущей сетке | Обрезку даёт именно `overflow-hidden` на карточке вместе с `leading-none`; точечно снять достаточно, переразложение всей сетки — риск регресса Hero без явной нужды | 2026-06-05 |
| A-4 | AI-сводка: добавить `AiNarrativeWithSources` проп `bare` (скрывает внутреннюю рамку+заголовок), внешний заголовок «AI-сводка» в Hero оставить | Внешний заголовок — часть верстки Hero-зоны; убирать дублирование лучше у переиспользуемого компонента через проп, чтобы не сломать другие места его использования | 2026-06-05 |
| A-5 | Дата данных на главной: вывести `data.generatedAt` в шапке тем же паттерном, что в operations («Обновлено …») | Поле уже в домене, backend не трогаем; единый текст с operations | 2026-06-05 |

## Доказательство выбора

Развилка только в A-1 (где чинить контракт `building`/`forming`) и A-4 (где убирать дубль заголовка). Обоснования — в таблице решений выше. Остальное — однозначные фиксы без альтернатив.

---

## Scope

### Входит
- Ф1: backend-переименование `roleProfiles.building` → `roleProfiles.forming` (interface + маппинг); синхронизация с уже существующим фронт-типом.
- Ф2: подключение `SampleStoryBanner` при `data.isEmpty === true` + визуальная пометка «образец» на KPI-зоне и AI-сводке.
- Ф3: устранение обрезки KPI-числа в `KpiHero`.
- Ф4: проп `bare` у `AiNarrativeWithSources` + его применение в Hero, чтобы убрать двойной заголовок/рамку.
- Ф5: вывод даты/свежести данных (`generatedAt`) в шапке главной.
- Ф6: удаление мёртвых файлов `DashboardClient.tsx`, `CurationPendingWidget.tsx`; чистка устаревшего комментария «TODO Б.4».
- Ф7 (низкий приоритет): `TopRiskCard` при `risk=null` — пересмотр `h-full` (косметика пустого состояния).

### Не входит
- Вектор цели / компас наверх главной → **ТЗ-B** (`plans/tz/2026-06-05-goal-vector-compass.md`). ТЗ-A только чинит текущую главную, не меняет состав/порядок виджетов (структуру вниз — в ТЗ-B).
- Любые изменения схемы Prisma (`isPrimary`/`ownerPersonId`/`commitmentAuthorPersonId`) → ТЗ-B/F/D.
- Операционные дашборды (Hero, группировка 11 блоков) → **ТЗ-C** (`plans/tz/2026-06-05-operations-dashboards-redesign.md`).
- Пульс/«Сотрудники под риском», `PeopleAtRiskWidget items={null}` → **ТЗ-G** (`plans/tz/2026-06-05-employee-pulse-and-people-at-risk.md`). В ТЗ-A `PeopleAtRiskWidget` НЕ трогаем.
- Изменения LLM-промпта narrative-сводки → не требуется (SYSTEM не трогаем).

---

## Граничные контракты с другими ТЗ (что НЕ трогать)

- **Схему `schema.prisma`** трогают только ТЗ-B/D/F. ТЗ-A в `schema.prisma` НЕ пишет ни строки.
- **`PeopleAtRiskWidget` и `items={null}`** (`DirectorDashboardClient.tsx:586`) — scope ТЗ-G. ТЗ-A не подключает реальный fetch.
- **Состав/порядок виджетов главной** (поднять «Вектор», опустить «Структуру») — scope ТЗ-B. ТЗ-A оставляет `StructureSummaryWidget` на месте (`DirectorDashboardClient.tsx:401-419`), только чинит его текст через Ф1.
- **`OperationsDashboardClient.tsx`** — scope ТЗ-C. ТЗ-A читает его лишь как образец вывода `generatedAt`, не редактирует.
- **`GoalVectorWidget` / `goalVector`** — scope ТЗ-B. ТЗ-A не трогает.

---

## Контракт-first (единый источник правды фронт↔бэк)

### Ф1 — контракт `structure/summary`

Backend `StructureSummaryDto` ДО (фрагмент `structure.service.ts:5-17`):
```ts
export interface StructureSummaryDto {
  departments: number;
  roles: number;
  persons: number;
  documents: number;
  roleProfiles: {
    total: number;
    building: number;   // ← переименовать
    ready: number;
    stale: number;
    error: number;
  };
}
```
Backend ПОСЛЕ:
```ts
export interface StructureSummaryDto {
  departments: number;
  roles: number;
  persons: number;
  documents: number;
  roleProfiles: {
    total: number;
    /** Кол-во карт должностей в статусе `forming` (формируются). */
    forming: number;
    ready: number;
    stale: number;
    error: number;
  };
}
```
Маппинг `structure.service.ts:73-79` ДО → ПОСЛЕ:
```ts
// ДО
roleProfiles: {
  total: roleProfilesTotal,
  building: grouped.forming ?? 0,
  ready: grouped.ready ?? 0,
  stale: grouped.stale ?? 0,
  error: grouped.error ?? 0,
},
// ПОСЛЕ
roleProfiles: {
  total: roleProfilesTotal,
  forming: grouped.forming ?? 0,
  ready: grouped.ready ?? 0,
  stale: grouped.stale ?? 0,
  error: grouped.error ?? 0,
},
```
Фронт-тип `StructureSummaryApi` (`structure.api.ts:155-165`) **уже на `forming`** — не менять. Виджет `StructureSummaryWidget.tsx:86` (`${swr.data.roleProfiles.forming} формируется`) **уже корректен** — не менять.

> Примечание: фронт-тип `StructureSummaryApi.roleProfiles` содержит только `{ total, ready, forming }` — это законно (фронт читает подмножество). `stale`/`error` backend по-прежнему отдаёт, фронт их игнорирует. Не добавлять их во фронт-тип в рамках ТЗ-A.

Машинные коды ошибок: эндпоинт не меняет статусы; контракт ответа — JSON `StructureSummaryDto`. Никаких новых ошибок не вводится.

### Ф4 — проп `bare` у `AiNarrativeWithSources`

`AiNarrativeWithSources.tsx` `type Props` ДО (`:13-17`):
```ts
type Props = {
  data: NarrativeSummaryDomain;
  periodLabel: string;
  className?: string;
};
```
ПОСЛЕ:
```ts
type Props = {
  data: NarrativeSummaryDomain;
  periodLabel: string;
  className?: string;
  /**
   * bare=true — без внешней рамки, фоновой подложки и собственного заголовка
   * «AI-сводка за …». Используется, когда компонент вкладывается в зону Hero,
   * у которой уже есть свой заголовок (избегаем двойного заголовка).
   */
  bare?: boolean;
};
```
Поведение при `bare`:
- скрыть блок заголовка `:36-39` (`<div ...><Sparkles/>AI-сводка за {periodLabel}</div>`);
- убрать внешние chrome-классы у корневого `<div>` `:30-35` (`mb-6 rounded-xl border border-accent/25 bg-accent/5 p-4 shadow-card-soft`) — при `bare` оставить только `className` родителя (контейнер Hero-зоны уже даёт рамку/фон);
- дисклеймер `:65-67` («AI-сводка, может содержать ошибки.») и список «Источники» `:43-64` — **оставить** в обоих режимах.

Применение в Hero (`DirectorDashboardClient.tsx:375-379`):
```tsx
{data?.narrativeSummary ? (
  <AiNarrativeWithSources data={data.narrativeSummary} periodLabel={periodLabel} bare />
) : (
  ...
)}
```

### Ф2 — пометка «образец» (контракт фронта)

Источник флага: `data?.isEmpty === true` (`DirectorDashboardDomain.isEmpty`, `director-dashboard.ts:409`). Рендер `SampleStoryBanner` — над Hero-зоной (перед блоком `:333` STICKY HERO), внутри `max-w-6xl` контейнера. Пометка «образец» на KPI-зоне и AI-сводке — текстовый бейдж (русский, не «sample»): «образец». Никаких новых API.

### Ф5 — дата на главной (контракт фронта)

`data.generatedAt` — тип `Date` (`director-dashboard.ts:385`). Вывод тем же паттерном, что operations (`OperationsDashboardClient.tsx:142`):
```tsx
<p className="mt-1 text-sm text-fg-secondary">
  Обновлено {data.generatedAt.toLocaleString('ru-RU')}
</p>
```
Размещение — в `<header>` главной (`DirectorDashboardClient.tsx:281-316`), рядом с подзаголовком «Срез знаний компании за {periodLabel}».

---

## Границы автономии

- ✅ Always: переименование `building`→`forming` в Ф1; добавление пропа `bare`; рендер `SampleStoryBanner`/даты/бейджа; удаление мёртвых файлов и стале-комментариев; правки классов Tailwind на парные токены.
- ⚠️ Ask first: любое изменение состава/порядка виджетов главной (это scope ТЗ-B); любое изменение backend-логики `director-dashboard.service.ts` кроме чтения; изменение текста sample-narrative/SYSTEM-промпта.
- 🚫 Never: `prisma db push`/правка `schema.prisma`; трогать `PeopleAtRiskWidget items={null}`; добавлять английские слова в UI; использовать `text-white`/hex/slate; править `OperationsDashboardClient`.

---

## Фазы

Граф зависимостей:
```
Ф1 (backend контракт)  ─ независима
Ф3 (KpiHero обрезка)   ─ независима
Ф4 (bare AI-сводка)    ─ независима  ─┐
Ф2 (sample честность)   зависит от ───┘ Ф4 (бейдж рядом с AI-сводкой ставится после bare)
Ф5 (дата)              ─ независима
Ф6 (мёртвый код)       ─ независима
Ф7 (TopRiskCard h-full, низкий)  ─ независима
```
Рекомендуемый порядок: **Ф1 → Ф3 → Ф4 → Ф2 → Ф5 → Ф6 → (Ф7)**. Ф2 после Ф4, остальные параллелизуемы.

| Фаза | Зависит от |
|---|---|
| Ф1 | — |
| Ф3 | — |
| Ф4 | — |
| Ф2 | Ф4 |
| Ф5 | — |
| Ф6 | — |
| Ф7 | — |

### Ф1 — контракт «Структура компании»: `building` → `forming`
- **Цель:** убрать `undefined формируется` в виджете «Структура компании».
- **Что входит:** переименовать поле `building`→`forming` в `StructureSummaryDto` и в объекте ответа `summary()`.
- **Что НЕ входит:** правки фронта (тип уже `forming`), удаление `stale`/`error`, изменение запросов БД.
- **Файлы:** `backend/src/modules/structure/structure.service.ts:13` (поле `building` в interface), `:74` (`building: grouped.forming ?? 0`).
- **Зависимости:** нет.
- **Acceptance:**
  - grep `building` по `backend/src/modules/structure/structure.service.ts` → 0 вхождений.
  - grep `forming:` по тому же файлу → ≥1 вхождение (в interface и в маппинге).
  - `cd backend && bun run typecheck` зелёный.
  - Swagger smoke / ручной запрос `GET /api/v1/structure/summary` (X-Org-Id) → в `roleProfiles` ключ `forming` (число), ключа `building` нет.
  - Вход→выход: для tenant с 1 RoleProfile в статусе `forming` ответ `roleProfiles: { total:1, forming:1, ready:0, stale:0, error:0 }`. Негативный: tenant без RoleProfile → `roleProfiles.forming === 0` (не `undefined`).
- **Тесты:** `bunx vitest run backend/src/modules/structure/structure.service.spec.ts` (если spec отсутствует — добавить минимальный: мок prisma.roleProfile.groupBy → `[{status:'forming',_count:{_all:1}}]`, проверить `result.roleProfiles.forming === 1` и `('building' in result.roleProfiles) === false`).
- Закрывает: R1.

### Ф3 — KpiHero без обрезки числа
- **Цель:** главная цифра KPI (например «82%») не обрезается ни на каком экране.
- **Что входит:** в `KpiHero` снять причину обрезки у контейнера числа (либо убрать `overflow-hidden` с корневой карточки `:136` и оставить его только для sparkline/акцент-бара при необходимости, либо обернуть число в контейнер без `overflow-hidden`); числу `:154-161` дать `break-words` и адаптивный размер (`text-4xl sm:text-5xl md:text-6xl` или аналог через clamp), сохранив `tabular-nums`.
- **Что НЕ входит:** переразложение всей Hero-сетки `DirectorDashboardClient.tsx:336-367`; изменение порогов/цветов/тонов; изменение sparkline.
- **Файлы:** `frontend/src/ui/components/shared/KpiHero.tsx:136` (`overflow-hidden`), `:154-161` (`text-5xl ... md:text-6xl leading-none`).
- **Зависимости:** нет.
- **Acceptance:**
  - grep `overflow-hidden` в `KpiHero.tsx`: если оставлен на корневой карточке — число обёрнуто в собственный контейнер без `overflow-hidden` (проверяется визуально + наличие нового обёрточного `<div>` вокруг `{renderedValue}`); если снят — grep по `overflow-hidden` в файле = 0 на корневом контейнере числа.
  - grep `tabular-nums` в `KpiHero.tsx` → присутствует (не потеряли).
  - Нет `text-white`, hex-цветов, slate-классов в добавленных строках (grep `text-white\|#[0-9a-fA-F]\{3,6\}\|slate-` по diff = 0).
  - `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
  - Вход→выход: KPI «Обещания» с value `82%` на ширине Hero-колонки (`lg:col-span-1`, `md:grid-cols-3`) — цифра видна целиком (визуальная проверка через `frontend && bun run dev` или скриншот; описать в DoD). Негативный: трёхзначный inverted-KPI «Висящие решения» = `100` — тоже не обрезается.
- **Тесты:** unit на рендер не обязателен (чистая верстка); добавить/обновить, если есть `KpiHero.spec.tsx` — проверить, что число рендерится в DOM целиком (`getByText('82%')`).
- Закрывает: R3.

### Ф4 — единый заголовок AI-сводки (проп `bare`)
- **Цель:** в Hero у AI-сводки один заголовок, не два, и нет «рамки в рамке».
- **Что входит:** добавить проп `bare?: boolean` в `AiNarrativeWithSources`; при `bare` скрыть внутренний заголовок `:36-39` и внешние chrome-классы `:30-35`; применить `bare` в Hero (`DirectorDashboardClient.tsx:376`).
- **Что НЕ входит:** удаление дисклеймера/источников; изменение рендера inline-цитат; изменение зоны 2 Hero `:370-374` (внешний заголовок остаётся).
- **Файлы:** `frontend/src/ui/components/dashboard/AiNarrativeWithSources.tsx:13-17` (Props), `:25-39` (корневой div + заголовок); `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:376` (вызов).
- **Зависимости:** нет (но Ф2 опирается на него).
- **Acceptance:**
  - grep `bare` в `AiNarrativeWithSources.tsx` → ≥2 (в Props и в условном рендере).
  - grep `bare` в `DirectorDashboardClient.tsx` → ≥1 (передан в Hero).
  - При `bare` в DOM нет второго текста «AI-сводка за» внутри Hero-зоны 2 (визуальная проверка: в зоне остаётся только внешний `<span>AI-сводка</span>`).
  - Дисклеймер «AI-сводка, может содержать ошибки.» присутствует и при `bare`.
  - `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
  - Вход→выход: `<AiNarrativeWithSources data=... periodLabel="неделю" bare />` рендерит текст без внешней рамки `border-accent/25 bg-accent/5`. Негативный: без `bare` (другие использования, если есть) — рамка и заголовок на месте (обратная совместимость).
- **Тесты:** если есть `AiNarrativeWithSources.spec.tsx` — кейс `bare` (нет внутреннего заголовка) и без `bare` (есть). Иначе ручная проверка.
- Закрывает: R4.

### Ф2 — честность данных-образца
- **Цель:** при пустой компании владелец видит явную пометку «образец», а не верит выдуманным цифрам.
- **Что входит:** при `data?.isEmpty === true` рендерить `SampleStoryBanner` над Hero; добавить компактный текстовый бейдж «образец» на KPI-зону и на AI-сводку.
- **Что НЕ входит:** ветка «честные нули» (решение A-2 — не делаем); изменение sample-датасета на backend; изменение `MainEmptyState` (он показывается раньше, в ветке `isPageEmpty`, для своей Org+DEMO — другой кейс).
- **Файлы:** `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` — импорт `SampleStoryBanner` (рядом с `:62` импортом `MainEmptyState`), рендер баннера перед блоком STICKY HERO `:333`; бейдж в зоне KPI `:337-367` и в зоне AI-сводки `:370-374`; `frontend/src/ui/components/dashboard/SampleStoryBanner.tsx` — без правок (готов).
- **Зависимости:** Ф4 (бейдж рядом с AI-сводкой ставим после унификации заголовка).
- **Acceptance:**
  - grep `SampleStoryBanner` в `DirectorDashboardClient.tsx` → ≥2 (импорт + рендер).
  - grep `isEmpty` в `DirectorDashboardClient.tsx` → ≥1 (условие рендера баннера/бейджа). Условие именно `data?.isEmpty === true` (а не `data === null`), чтобы не показывать баннер во время загрузки.
  - Бейдж «образец» — строго русское слово, парные токены (`bg-chip-info-bg text-chip-info-fg` или аналог), без `text-white`/hex/slate (grep по diff = 0).
  - `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
  - Вход→выход: `data.isEmpty === true` → виден `SampleStoryBanner` («Это пример того, как выглядит дашборд») + бейдж «образец» у KPI. Негативный: `data.isEmpty === false` (есть реальные данные) → ни баннера, ни бейджа. Загрузка (`data === null`) → ни баннера, ни бейджа.
- **Тесты:** ручная проверка через демо-tenant с пустыми данными (`isEmpty:true` из backend sample-ветки) или unit-рендер `DirectorDashboardClient` с замоканным `data.isEmpty`.
- Закрывает: R2.

### Ф5 — дата/свежесть данных в шапке главной
- **Цель:** владелец видит, на какое время данные.
- **Что входит:** вывод `data.generatedAt` в `<header>` главной строкой «Обновлено …» (паттерн operations).
- **Что НЕ входит:** backend-правки (поле уже есть); per-block даты («минуту назад» / «сегодня утром» — vNext, см. язык владельца); изменение operations.
- **Файлы:** `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:281-316` (header), вставка после `:288` (подзаголовок «Срез знаний…»). Образец: `OperationsDashboardClient.tsx:142`.
- **Зависимости:** нет.
- **Acceptance:**
  - grep `generatedAt` в `DirectorDashboardClient.tsx` → ≥1.
  - grep `Обновлено` в `DirectorDashboardClient.tsx` → ≥1.
  - Дата выводится только когда `data` загружена (`data?.generatedAt` с guard; при `data === null` строка не рендерится или показывает прочерк, без падения).
  - `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
  - Вход→выход: `data.generatedAt = 2026-06-05T09:00:00Z` → «Обновлено 05.06.2026, 12:00:00» (формат `ru-RU`, зависит от TZ браузера). Негативный: `data === null` → строки «Обновлено» нет, ошибки нет.
- **Тесты:** ручная проверка/скриншот.
- Закрывает: R5.

### Ф6 — удаление мёртвого кода и стале-комментариев
- **Цель:** в репозитории нет неиспользуемых файлов главной и устаревших TODO.
- **Что входит:** удалить `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` и `frontend/app/(authenticated)/dashboard/widgets/CurationPendingWidget.tsx`; убрать стале-комментарий «TODO Б.4» у кнопки «Спросите Кору» (`DirectorDashboardClient.tsx:408`), заменив пояснением, что кнопка работает через событие `assistant-sidebar:open-ask`.
- **Что НЕ входит:** удаление `MyDashboardClient`/`/me/dashboard` (scope ТЗ-E); удаление `curationApi`/`curation`-страницы (используются в `/curation`); правка docstring `:100` (это корректная ссылка на историю Б.4, не TODO).
- **Файлы:** удалить 2 файла выше; `DirectorDashboardClient.tsx:408` (комментарий).
- **Зависимости:** нет.
- **Acceptance:**
  - Файлы `DashboardClient.tsx` и `widgets/CurationPendingWidget.tsx` отсутствуют (grep пути → нет файла).
  - grep `DashboardClient` по `frontend/` → нет вхождений `from './DashboardClient'` и определения `export function DashboardClient` (другие `*DashboardClient` — AdminDashboardClient/OperationsDashboardClient/DirectorDashboardClient — остаются).
  - grep `CurationPendingWidget` по `frontend/` → 0 вхождений.
  - grep `TODO Б.4` по `frontend/` → 0 вхождений.
  - `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные (нет битых импортов).
- **Тесты:** прохождение build = доказательство отсутствия зависимостей.
- Закрывает: R6.

### Ф7 — TopRiskCard при пустом риске (низкий приоритет)
- **Цель:** карточка «Самое острое» при `risk=null` не растягивается на всю высоту зоны, занимая треть экрана.
- **Что входит:** в ветке `if (!risk)` `TopRiskCard.tsx:46-60` пересмотреть `h-full` (например убрать `h-full` или дать компактную высоту), сохранив парные токены `chip-success-*`.
- **Что НЕ входит:** изменение ветки с риском `:65-116`; изменение источника риска в Hero.
- **Файлы:** `frontend/src/ui/components/dashboard/TopRiskCard.tsx:46-60`.
- **Зависимости:** нет.
- **Acceptance:**
  - Визуальная проверка: при `risk=null` карточка не выше зоны KPI/AI-сводки в одну строку (скриншот в DoD).
  - Токены остались парными (grep `text-white`/hex/slate по diff = 0).
  - `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
- **Тесты:** ручная проверка.
- Закрывает: R7.

---

## Требования (EARS) и трассировка R→фаза

- **R1.** Когда фронт запрашивает `GET /api/v1/structure/summary` и у tenant есть RoleProfile в статусе `forming`, система shall вернуть `roleProfiles.forming` как число этих профилей и НЕ возвращать ключ `building`; виджет «Структура компании» shall отображать `«N формируется»` без слова `undefined`. → **Ф1**
- **R2.** Когда `DirectorDashboardDomain.isEmpty === true`, система shall отрисовать `SampleStoryBanner` над Hero и пометку «образец» у KPI-зоны и AI-сводки; когда `isEmpty === false` или данные ещё грузятся (`data === null`), баннер и пометка shall отсутствовать. → **Ф2**
- **R3.** Когда KPI-значение содержит до 4 видимых символов (например `100`, `82%`) в Hero-колонке `lg:col-span-1`, система shall отображать значение целиком без визуальной обрезки. → **Ф3**
- **R4.** Когда `AiNarrativeWithSources` отрисован с `bare`, система shall не показывать собственный заголовок «AI-сводка за …» и собственную внешнюю рамку, но shall сохранить дисклеймер «AI-сводка, может содержать ошибки.» и список источников. → **Ф4**
- **R5.** Когда дашборд директора загружен (`data` не null), система shall отображать в шапке строку «Обновлено {generatedAt в формате ru-RU}». → **Ф5**
- **R6.** Когда выполнен `bun run build` фронта, в кодовой базе shall отсутствовать файлы `DashboardClient.tsx` и `widgets/CurationPendingWidget.tsx`, и shall отсутствовать комментарий `TODO Б.4`. → **Ф6**
- **R7.** Когда `TopRiskCard` отрисован с `risk=null`, карточка shall не занимать полную высоту Hero-зоны (компактное пустое состояние). → **Ф7**

Запрещённых прилагательных («быстро/удобно/корректно/оптимально») в требованиях нет — каждый предикат проверяем grep’ом/рендером.

---

## Совместимость с prompt caching

Не релевантно. ТЗ-A не трогает ни одного LLM-промпта (SYSTEM/USER), ни LLM-роутинг. Sample-narrative и narrative-сводка остаются как есть; их генерация не входит в scope. Кэш промптов не затрагивается.

---

## Pre-mortem / Риски + ревью-аспекты

| Риск | Митигация |
|---|---|
| Ф1: где-то ещё (вне `structure.service.ts`) фронт/бэк читает `roleProfiles.building` | Перед правкой grep `roleProfiles.building`/`\.building` по `backend/src` и `frontend/src` — подтвердить единственное место; фронт-тип уже `forming` |
| Ф3: снятие `overflow-hidden` ломает скругление/акцент-бар/sparkline (которые опираются на clip) | Сохранить `rounded-xl`; акцент-бар `absolute :143-149` — при снятии `overflow-hidden` проверить, что полоса не выходит за скругление (при необходимости оставить `overflow-hidden` на карточке, а число обернуть в отдельный контейнер без clip) |
| Ф2: баннер показывается во время загрузки (мелькание) | Условие строго `data?.isEmpty === true`, не `!data` |
| Ф2/Ф4 порядок: бейдж у AI-сводки до унификации заголовка → визуальный конфликт | Ф2 после Ф4 (зафиксировано в графе) |
| Ф6: удаляемый файл всё же где-то импортируется (битый билд) | grep до удаления + `bun run build` после |
| Регресс Hero-верстки (sticky, z-index) | Не менять структуру `:333-419`; правки только внутри `KpiHero`, добавление баннера/бейджа/даты без перестройки сетки |

Ревью-аспекты (для `strict-production-review-gate`): отсутствие английских слов в новом UI; парные токены; отсутствие изменений схемы/LLM; обратная совместимость `AiNarrativeWithSources` без `bare`; multi-tenancy не затронут (только presentation).

---

## Idempotency / feature-flag / prod-deploy

- **Feature-flag:** не требуется. Все изменения — детерминированные UI-фиксы и переименование поля контракта; рискового поведения за флагом нет.
- **Idempotency:** нет seed/patch/backfill/migrate-скриптов. `apply-prod-deploy.ts` STEPS не затрагиваются.
- **Затронутые Шаги prod-deploy-log:** **никакие.** Нет ENV/AdminSetting (Шаг 1), нет schema (Шаг 4), нет patch/seed/backfill (Шаги 6/7/8). Ф1 — переименование поля в TS-DTO ответа (не Prisma), деплоится обычным `docker compose up -d --build`.
- **Prod-инструкция (для блока в чате):** prod-операций нет — достаточно `docker compose up -d --build backend` (Ф1) и пересборки фронта; миграций/seed/ENV не требуется.

---

## DoD (Definition of Done)

- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные; `bunx vitest run` для `structure.service.spec.ts` зелёный.
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные; `bun run test:unit` зелёный (если затронуты spec).
- Все grep-маркеры Acceptance подтверждены.
- Ручная проверка: пустой tenant → баннер «образец» + бейдж; KPI `82%`/`100` не обрезаны; один заголовок AI-сводки; «Обновлено …» в шапке; «N формируется» без `undefined`.
- Second-brain (таблица производных заметок): обновить `second-brain/01_projects/frontend-pages.md` (если фиксирует состав главной — удаление мёртвых компонентов/пометка «образец»); `second-brain/01_projects/api-layer.md` (переименование поля `structure/summary`); при необходимости `02_architecture/module-map.md` не трогать (модуль `structure` не меняет состав).
- `docs/operations/prod-deploy-log.md`: правок нет (prod-операций нет) — отметить в чате блоком «Prod-инструкция» вариант B.
- Рефлексия в `second-brain/05_история/` после push.

---

## Итог

- [ ] Ф1 — контракт `building`→`forming` (R1)
- [ ] Ф3 — KpiHero без обрезки (R3)
- [ ] Ф4 — единый заголовок AI-сводки `bare` (R4)
- [ ] Ф2 — честность данных-образца (R2)
- [ ] Ф5 — дата/свежесть в шапке (R5)
- [ ] Ф6 — удаление мёртвого кода + TODO (R6)
- [ ] Ф7 — TopRiskCard h-full (низкий приоритет) (R7)

Реализовано: _(заполнит оркестратор)_
