---
type: tz
status: ready-to-implement
feature: goal-vector-compass
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/tz/2026-05-30-pulse-full.md
---

> Анализ-карта: plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md (секция «ТЗ-B») · Спец «Вектор цели» в plans/analysis/2026-06-05-dashboards-prostym-yazykom.md · Решения владельца: 2026-06-05

# ТЗ-B — Вектор цели (компас движения)

## Цель

Заменить текущий список целей с числами `+12 / −4` на наглядный **компас-стрелку** наверху главной: один взгляд показывает, идёт ли работа команды «на север» (к цели), «вбок» (дрейф — делаем не те задачи) или «вниз» (против цели). Компас многоуровневый: общая стрелка по компании (по главной цели), мини-стрелки по отделам и людям, переключатель уровней «Вся компания / По целям / По спринту недели».

## Зачем (болезненное состояние по факту)

- Виджет `GoalVectorWidget.tsx:78-152` рисует **список** целей с агрегатом `netScore` и полосками — владелец вынужден читать числа и складывать их в голове. Направление движения мозгом не считывается.
- Виджет лежит **внизу** вкладки «Цели и встречи» (`DirectorDashboardClient.tsx:692`), а не на первом экране. Владелец открывает пульт ради ответа «идём ли мы туда, куда задумали» — но первым видит «Структуру компании» (справочник, который не меняется каждый день).
- Бэкенд (`pulse-patterns.service.ts:397-414`) отдаёт наружу **только `netScore`** (DTO `pulse-patterns.dto.ts:110-116`). Для угла компаса нужны `proScore` и `contraScore` отдельно — без них нельзя отличить «спокойно идём к цели» (мало активности, всё в плюс) от «бурная борьба» (много и за, и против).
- Нет понятия «главная цель компании» — `getGoalVector` берёт топ-5 по `netScore` (`:342-348`), стрелки «север = главная цель» построить не из чего.
- Нет разреза по отделам в выдаче, хотя связь человек→отдел есть (`Person.primaryDepartmentId:4350`).

---

## REALITY-CHECK

| Факт | Доказательство (path:line · символ) | Влияние на фазы |
|---|---|---|
| Данные `pro/contra/net` per person×goal×week **уже считаются** еженедельным cron'ом | `goal-vector-tracker.cron.ts:54` (`@Cron('0 5 * * 1')`), upsert `:186-218`; модель `PersonGoalContribution.proScore/contraScore/netScore` `schema.prisma:6622-6626` | Ф2 НЕ трогает cron — только читает уже накопленное |
| Cron upsert идемпотентен per неделю | `@@unique([tenantId, personId, goalId, weekStart])` `schema.prisma:6634` | Многоуровневость per-week (спринт) — данные готовы, новый сбор не нужен |
| Сервис отдаёт **только** `netScore`, `proScore/contraScore` теряются | `pulse-patterns.service.ts:397-414` (нет чтения `proScore/contraScore` в `select` `:367-372`) | Ф2: добавить `proScore/contraScore` в `select` + агрегат + DTO |
| DTO выдачи знает только `netScore` | `pulse-patterns.dto.ts:110-116` (`PulsePatternGoalVectorItemDto`), фронт-зеркало `frontend/src/domain/pulse-patterns.ts:76-85` | Ф2 (бэк-DTO) + Ф3 (фронт-зеркало) |
| Выбор топ-целей — по `netScore desc`, не по «главной» | `pulse-patterns.service.ts:342-348` (`orderBy: { _sum: { netScore: 'desc' } }`) | Ф2: при наличии `isPrimary` главная цель идёт первой |
| `Goal.isPrimary` НЕТ; есть `weight:3913` (занят alignment), `horizon:3916`, `parentGoalId:3918`, `createdById:3931` | `schema.prisma:3900-3985` | Ф1: добавить `isPrimary Boolean @default(false)` |
| Связь человек→отдел есть | `Person.primaryDepartmentId:4350`, `Department.name:4213` | Ф2: JOIN для разреза по отделам |
| Виджет — список с `MiniDonut`/`MiniStackedBar`, не стрелка | `GoalVectorWidget.tsx:78-152` | Ф3: компас-SVG (переиспользовать имя/файл или новый `CompassWidget`) |
| Виджет внизу вкладки, не наверху | `DirectorDashboardClient.tsx:692` (внутри `GoalsAndMeetingsTab`); Hero `:335-398`; sticky-полоса «Структура» `:401-418` | Ф4: разместить наверху, под Hero |
| Эндпоинт `GET /dashboard/pulse-patterns` отдаёт `goalVector` целиком, доступ owner/admin/super_admin | `director-dashboard.controller.ts:192-226`, `canViewDirectorDashboard` `:212` | Ф2-Ф4 используют существующий эндпоинт, новый не нужен |
| Prisma `@@unique` не поддерживает WHERE → partial unique только в `postgres-init.sql` | `postgres-init.sql:94-112` (паттерн `meeting_report_pending_unique`) | Ф1: «одна primary на tenant» через partial unique index в `postgres-init.sql`, не `@@unique` |

**Вывод:** фундамент готов на ~60%. Не хватает: (1) флаг `Goal.isPrimary` + его «1-на-tenant» гарантия, (2) проброс `proScore/contraScore` и разреза по отделам в DTO, (3) SVG-компас вместо списка, (4) размещение наверху + переключатель уровней.

---

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р1 | Якорь «главной цели» для Вектора = **новый флаг `Goal.isPrimary`** (одна главная на tenant), НЕ агрегат по `weight` | `weight` занят расчётом «Согласованность стратегии» (`schema.prisma:3913`) — перегрузка смысла даст конфликт | 2026-06-05 |
| B-1 | «Одна primary на tenant» реализуется **partial unique index** в `postgres-init.sql` (`WHERE "isPrimary" = true`), НЕ через `@@unique` | Prisma `@@unique` не умеет WHERE; проектный паттерн уже есть (`postgres-init.sql:94-112`) | 2026-06-05 |
| B-2 | Если ни одна цель не помечена `isPrimary` — компания-стрелка строится по **fallback: цель с максимальным `weight`, при равенстве — самая ранняя по `createdAt`** | Не блокировать виджет для tenant'ов без явной главной цели; детерминированный выбор | 2026-06-05 |
| B-3 | Угол компаса: `focus = netScore / (proScore + contraScore)`; `angle = (1 − focus) · 90°` (полукруг, **север = к цели**); длина стрелки = объём активности (`proScore + contraScore`, нормированный к максимуму в выборке) | Запрос владельца: «вверх к цели, вбок дрейф, вниз против»; формула из карты ТЗ-B | 2026-06-05 |
| B-4 | Переключение `isPrimary` из UID-целей (`/goals`) — **вне scope этого ТЗ** (ставится в ТЗ-F). Здесь только колонка + чтение + ручной способ выставить (seed/админ-скрипт нет; flag правится в ТЗ-F или вручную через БД) | Не плодить UI-двойников; ТЗ-F владеет экраном целей | 2026-06-05 |

## Доказательство выбора (компас vs список / угол-формула)

Развилок две, обе закрыты владельцем:
1. **Список vs стрелка** — владелец явно требует стрелку-компас («не оставлять список», карта ТЗ-B стр.59 + спец стр.165-170). Список как fallback внутри tooltip допустим, но первичный вид — стрелка.
2. **Якорь «севера»** — выбран `isPrimary` (Р1), а не агрегат по `weight`, т.к. `weight` уже несёт смысл вклада в общую «Согласованность». Это решение владельца, не пересматривается.

---

## Scope

### Входит
- Ф1: колонка `Goal.isPrimary` (`prisma db push`) + partial unique index «1 primary на tenant» в `postgres-init.sql`.
- Ф2: расширение `getGoalVector` — отдавать `proScore`/`contraScore` (и сохранить `netScore`); выбор главной цели (`isPrimary` → fallback B-2); разрез по отделам (JOIN `Person.primaryDepartmentId`); расширение DTO `PulsePatternGoalVectorItemDto` + контрибьютора.
- Ф3: компас-виджет (SVG-стрелка) — общая по компании + мини-стрелки по отделам/людям; угол + длина по B-3; русский UI; парные токены.
- Ф4: размещение наверху главной (под Hero) + переключатель уровней «Вся компания / По целям / По спринту недели» (данные per-goal и per-week уже есть).

### Не входит (→ другое ТЗ / vNext)
- UI выбора/смены «главной цели» на экране `/goals` → **ТЗ-F** (`plans/tz/2026-06-05-goals-improvements.md`). Здесь только колонка и чтение.
- `Goal.ownerPersonId`, светофор уверенности, русификация экрана целей → **ТЗ-F** (Р4).
- Изменение алгоритма cron'а сбора `PersonGoalContribution` (логика pro/contra) → vNext; этот ТЗ только читает.
- Новый эндпоинт под компас — НЕ нужен, используем `GET /dashboard/pulse-patterns`.
- Финансовые метрики любого рода (инвариант продукта) — запрещены.

---

## Граничные контракты с другими ТЗ

- **schema.prisma трогают последовательно ТЗ-B (isPrimary) → ТЗ-D (commitmentAuthorPersonId) → ТЗ-F (ownerPersonId).** Re-Read `model Goal` перед правкой; **добавлять ТОЛЬКО `isPrimary`**, не перезатирая чужие поля. (Карта, раздел «Координация».)
- **`postgres-init.sql` трогает и ТЗ-G** (если добавит partial-индексы) — добавлять свой блок отдельным `DO $$ ... END $$;`, не переписывать чужие.
- **`PulsePatternsService` / `pulse-patterns.dto.ts` / `frontend/src/domain/pulse-patterns.ts`** — этот ТЗ редактирует ТОЛЬКО `GoalVector`-секцию (§6.6). Не трогать BusFactor/Bottleneck/KnowledgeVelocity/IrreversibleDecisions.
- **`DirectorDashboardClient.tsx`** — этот ТЗ добавляет блок-компас под Hero (`:398`) и убирает старый `GoalVectorWidget` из `GoalsAndMeetingsTab` (`:692`). НЕ трогать Hero (`:335-398`), sticky-полосу «Структура» (`:401-418` — ТЗ-A её опускает вниз, согласовать порядок: компас выше «Структуры»).
- **`goal-vector-tracker.cron.ts`** и его prompt — НЕ трогать (prompt-cache, см. раздел caching).

---

## Контракт-first

### 1. Prisma — добавление поля (Ф1)

В `backend/prisma/schema.prisma`, `model Goal` (после `horizon` `:3916`, до `parentGoalId`):

```prisma
  /// ТЗ-B (2026-06-05) — флаг «главная цель компании» = «север» компаса Вектора.
  /// Одна primary на tenant гарантируется PARTIAL UNIQUE index в
  /// postgres-init.sql (`goal_primary_unique` WHERE "isPrimary" = true) —
  /// Prisma `@@unique` не поддерживает WHERE. Снятие/выставление флага —
  /// в UI целей (ТЗ-F). Default false. Якорь Вектора цели (решение Р1).
  isPrimary               Boolean     @default(false)
```

И индекс в блоке `@@index` модели `Goal` (для дешёвого `findFirst(where isPrimary)`):

```prisma
  @@index([tenantId, isPrimary])
```

> ⚠️ `@@index([tenantId, isPrimary])` НЕ заменяет уникальность — это только для быстрого чтения. Уникальность даёт partial index ниже.

### 2. Partial unique index (Ф1) — `backend/scripts/postgres-init.sql`

Добавить отдельным блоком (паттерн `meeting_report_pending_unique:107`):

```sql
-- ТЗ-B (2026-06-05) — одна "главная цель" (isPrimary) на tenant.
--   Prisma `@@unique` не поддерживает WHERE-условие, поэтому partial
--   unique создаётся вручную. Идемпотентно через `IF NOT EXISTS`.
--   См. plans/tz/2026-06-05-goal-vector-compass.md §Контракт-first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Goal'
  ) THEN
    EXECUTE $sql$
      CREATE UNIQUE INDEX IF NOT EXISTS goal_primary_unique
      ON "Goal" ("tenantId")
      WHERE "isPrimary" = true
    $sql$;
  END IF;
END $$;
```

> Применяется командой `bun run apply-postgres-init` (prod: через `docker compose exec backend`). Шаг 5 prod-deploy-log.

### 3. DTO выдачи (Ф2) — `backend/src/modules/dashboard/dto/pulse-patterns.dto.ts`

Заменить секцию §6.6 (`:103-120`) на:

```ts
// ─── §6.6 — Goal Vector (компас) ─────────────────────────────────────────────

export interface PulsePatternGoalContributorDto {
  /** personId — для drill-down и мини-стрелки человека на фронте. */
  personId: string;
  personName: string;
  proScore: number;
  contraScore: number;
  netScore: number;
}

/** Разрез одной цели по отделу (для мини-стрелок «по отделам»). */
export interface PulsePatternGoalDepartmentDto {
  /** NULL = «Без отдела» (Person.primaryDepartmentId IS NULL). */
  departmentId: string | null;
  departmentName: string;
  proScore: number;
  contraScore: number;
  netScore: number;
}

export interface PulsePatternGoalVectorItemDto {
  goalId: string;
  goalTitle: string;
  /** Главная цель компании (Goal.isPrimary) — «север» общего компаса. */
  isPrimary: boolean;
  proScore: number;
  contraScore: number;
  /** = proScore - contraScore (для обратной совместимости фронта). */
  netScore: number;
  topContributors: PulsePatternGoalContributorDto[];
  /** Разрез по отделам (агрегат по Person.primaryDepartmentId). */
  byDepartment: PulsePatternGoalDepartmentDto[];
}

export interface PulsePatternGoalVectorDto {
  goals: PulsePatternGoalVectorItemDto[];
  /**
   * goalId главной цели компании: Goal.isPrimary=true, иначе fallback
   * (max weight → min createdAt). NULL если целей нет. Фронт строит по
   * нему общую стрелку компании.
   */
  primaryGoalId: string | null;
}
```

> Существующее поле `netScore` СОХРАНЯЕТСЯ во всех структурах — фронт-зеркало и `GoalVectorWidget` не падают на переходный период. `personName` сохранён, `personId` добавлен.

### 4. Зеркало на фронте (Ф3) — `frontend/src/domain/pulse-patterns.ts`

Расширить `PulsePatternGoalContributorApi:71-74`, `PulsePatternGoalVectorItemApi:76-81`, `PulsePatternGoalVectorApi:83-85` ровно теми же полями (`personId`, `proScore`, `contraScore`, `isPrimary`, `byDepartment`, `primaryGoalId`). Mapper `pulsePatternsFromApi:177` (`goalVector: api.goalVector`) — pass-through, новых преобразований нет (числа/строки).

### 5. Формула угла/длины (Ф3, единый источник правды фронт)

```
focus  = (pro + contra) > 0 ? net / (pro + contra) : 0        // ∈ [−1, 1]
angle  = (1 − focus) · 90°                                     // 0° = север (вверх), 90° = вбок (восток), 180° = вниз (юг)
                                                              // focus=1 → 0° (всё к цели); focus=0 → 90°; focus=−1 → 180°
lengthRatio = maxVolume > 0 ? (pro + contra) / maxVolume : 0   // ∈ [0,1], maxVolume — макс. (pro+contra) в текущем наборе стрелок
```

Цвет стрелки по `focus`: `focus ≥ 0.34` → `success`, `−0.34 < focus < 0.34` → `warning` (дрейф), `focus ≤ −0.34` → `danger`. Пороги (0.34) — константы компонента (UI-эвристика отображения, не бизнес-крутилка; в AdminSetting НЕ выносить).

### 6. ASCII-поток (read-path)

```
@Cron weekly ──upsert──> PersonGoalContribution (pro/contra/net per person×goal×week)   [НЕ трогаем]
                                   │
GET /dashboard/pulse-patterns ─────┤
   PulsePatternsService.getGoalVector(tenantId, periodDays, now)
     ├─ groupBy goalId (sum pro/contra/net)  [+ proScore/contraScore в _sum]
     ├─ goal.findMany(select id,name,isPrimary,weight,createdAt)  → primaryGoalId
     ├─ contributions.findMany(select goalId,personId,pro,contra,net, person.name, person.primaryDepartmentId)
     ├─ department.findMany(select id,name) для маппинга имён
     └─ build PulsePatternGoalVectorDto{ goals[ {isPrimary,pro,contra,net,topContributors[],byDepartment[]} ], primaryGoalId }
                                   │
DirectorDashboardClient ──pulse.goalVector──> CompassWidget (SVG-стрелка наверху + уровни)
```

---

## Границы автономии

✅ **Always:** добавить `isPrimary` строго после re-Read `model Goal`; расширять только §6.6 DTO/сервиса/зеркала; SVG в парных токенах; русский UI; re-Read файла после каждого Edit.
⚠️ **Ask first:** менять выбор главной цели (B-2 fallback) на другой; добавлять новый эндпоинт; трогать prompt cron'а; менять пороги цвета компаса на бизнес-крутилки.
🚫 **Never:** `prisma migrate`; `new PrismaClient()` в скриптах; трогать `goal-vector-tracker.cron.ts` логику/prompt; добавлять финансовые поля; `@@unique` вместо partial-index для «1 primary»; перезатирать чужие поля в `model Goal`; `text-white`/hex/slate-классы в компасе.

---

## Фазы

Граф зависимостей: **Ф1 → Ф2 → Ф3 → Ф4** (строго линейно: схема → бэк → виджет → размещение).

### Ф1 — Prisma `Goal.isPrimary` + partial unique [ ]
**Цель:** колонка-флаг главной цели + гарантия «одна на tenant».
**Что входит:**
- В `backend/prisma/schema.prisma` `model Goal` (re-Read перед правкой, символ `horizon` `:3916`): добавить `isPrimary Boolean @default(false)` + `@@index([tenantId, isPrimary])`.
- В `backend/scripts/postgres-init.sql`: блок `goal_primary_unique` (partial unique, см. Контракт-first §2).
- `bun run prisma:push` затем `bun run prisma:generate`.

**Что НЕ входит:** UI выставления флага (ТЗ-F); seed (флаг не выставляется автоматически — default false корректен для всех существующих целей).
**Точные файлы:** `backend/prisma/schema.prisma` (`model Goal`, символ `isPrimary`); `backend/scripts/postgres-init.sql` (символ `goal_primary_unique`).
**Зависимости:** нет.
**Acceptance:**
- `grep "isPrimary" backend/prisma/schema.prisma` → строка с `Boolean @default(false)`.
- `grep "tenantId, isPrimary" backend/prisma/schema.prisma` → `@@index`.
- `grep "goal_primary_unique" backend/scripts/postgres-init.sql` → блок присутствует, `WHERE "isPrimary" = true`.
- `cd backend && bun run prisma:generate` зелёный; `bun run typecheck` зелёный.
- Негатив: повторный `apply-postgres-init` не падает (idempotent `IF NOT EXISTS`).

**Закрывает: R1, R2.**

### Ф2 — backend `getGoalVector` (pro/contra + главная цель + отделы) [ ]
**Цель:** отдавать наружу `proScore`/`contraScore`, `isPrimary`/`primaryGoalId`, разрез по отделам.
**Что входит:**
- `pulse-patterns.dto.ts` §6.6 (`:103-120`) → новый контракт (Контракт-first §3).
- `pulse-patterns.service.ts` `getGoalVector` (`:333-417`):
  - `groupBy` (`:342-348`): `_sum: { netScore: true, proScore: true, contraScore: true }`.
  - `goal.findMany` (`:357-360`): добавить в `select` `isPrimary, weight, createdAt`.
  - вычислить `primaryGoalId`: `goal.findFirst(where tenantId, isPrimary=true)`; иначе fallback B-2 `orderBy [{weight: desc},{createdAt: asc}]` среди целей выборки.
  - `contributions.findMany` (`:361-373`): в `select` добавить `proScore, contraScore` и `person: { select: { name, primaryDepartmentId } }`.
  - агрегировать `byDepartment` (Map по `primaryDepartmentId`, NULL → ключ `__none__`); подтянуть имена через `department.findMany(where tenantId, id in [...])`, NULL → «Без отдела».
  - в `topContributors` добавить `personId, proScore, contraScore` (сохранить `netScore`).
  - в каждый goal-item: `isPrimary`, `proScore`, `contraScore`.

**Что НЕ входит:** SVG/фронт (Ф3); изменение порядка топ-целей (по-прежнему top-5 по netScore desc, но главная цель помечается флагом — фронт сам ставит её первой).
**Точные файлы:** `backend/src/modules/dashboard/dto/pulse-patterns.dto.ts` (символ `byDepartment`, `primaryGoalId`); `backend/src/modules/dashboard/services/pulse-patterns.service.ts` (`getGoalVector`, символ `primaryGoalId`).
**Зависимости:** Ф1 (поле `isPrimary` в Prisma Client).
**Acceptance:**
- `grep "proScore" backend/src/modules/dashboard/dto/pulse-patterns.dto.ts` и `grep "byDepartment"` → присутствуют.
- `grep "primaryGoalId" backend/src/modules/dashboard/services/pulse-patterns.service.ts` → присутствует.
- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные.
- Unit-тест `bunx vitest run backend/src/modules/dashboard/services/pulse-patterns.service.spec.ts` (создать/дополнить): мок Prisma с двумя целями (одна `isPrimary=true`) и людьми из 2 отделов; ожидаем `primaryGoalId === <главная>`, `goals[*].byDepartment.length === 2`, `proScore/contraScore` проброшены, `netScore === proScore − contraScore` (с точностью round3).
- Негатив: пустой набор → `{ goals: [], primaryGoalId: null }` (не бросает).
- Негатив: нет `isPrimary` ни у одной → `primaryGoalId` = цель с max weight (а при равном weight — min createdAt).
- Swagger smoke: `GET /api/v1/dashboard/pulse-patterns?period=week` отдаёт `goalVector.primaryGoalId` и `goalVector.goals[].byDepartment` (через Swagger `/api/docs` или curl с токеном owner).

**Закрывает: R3, R4, R5.**

### Ф3 — фронт компас-виджет (SVG-стрелка) [ ]
**Цель:** стрелка-компас вместо списка; общая по компании + мини по отделам/людям.
**Что входит:**
- Расширить зеркало `frontend/src/domain/pulse-patterns.ts` (`:71-85`) полями `personId/proScore/contraScore/isPrimary/byDepartment/primaryGoalId` (Контракт-first §4).
- Новый компонент `frontend/src/ui/components/dashboard/CompassWidget.tsx`:
  - Большая SVG-стрелка компании (по `primaryGoalId`-цели; если её нет в `goals` — по первой с `isPrimary`, иначе первой в списке).
  - Полукруглый циферблат (север сверху), стрелка под углом `angle` (формула §5), длина = `lengthRatio`.
  - Подпись: название цели, словесный статус («Идём к цели» / «Дрейф в сторону» / «Движение против цели»), числа `+pro / −contra` мелко рядом.
  - Ряд мини-стрелок: по отделам (`byDepartment`) на уровне «Вся компания»; при клике по отделу — стрелки по людям (`topContributors`) этой цели.
  - Состояния: `loading` (Skeleton как в `GoalVectorWidget.tsx:59-65`), `error` (`text-chip-danger-fg`), empty (`goals.length === 0` → текст «Цель ещё не задана или не собран первый вектор»).
  - Парные токены: `text-chip-success-fg`/`bg-chip-success-bg` и т.д.; стрелка через `stroke="currentColor"` + класс `text-chip-{tone}-fg`. Без `text-white`/hex/slate.
- Старый `GoalVectorWidget.tsx` — оставить как fallback-список внутри раскрывающегося блока «Показать списком» ИЛИ удалить (решение: оставить как deprecated и не рендерить; удаление импорта в Ф4). Владелец требует именно стрелку → список НЕ первичен.

**Что НЕ входит:** размещение наверху и переключатель уровней (Ф4); реальный drill-down на страницу человека.
**Точные файлы:** `frontend/src/domain/pulse-patterns.ts` (символ `byDepartment`); `frontend/src/ui/components/dashboard/CompassWidget.tsx` (новый, символ `CompassWidget`, `angle`, `lengthRatio`).
**Зависимости:** Ф2 (поля в API).
**Acceptance:**
- `grep "byDepartment" frontend/src/domain/pulse-patterns.ts` → присутствует.
- `grep "CompassWidget" frontend/src/ui/components/dashboard/CompassWidget.tsx` → экспорт функции.
- `grep -n "text-white\|#[0-9a-fA-F]\{3,6\}\|slate-" frontend/src/ui/components/dashboard/CompassWidget.tsx` → ПУСТО (инвариант токенов).
- В компоненте нет англ. слов в видимом тексте (`grep "north\|drift\|against"` пусто; подписи русские).
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
- Vitest `bunx vitest run frontend/src/ui/components/dashboard/CompassWidget.spec.tsx` (создать): focus=1 → angle≈0°; focus=0 → angle≈90°; focus=−1 → angle≈180°; пустые goals → empty-state.

**Закрывает: R6, R7, R8.**

### Ф4 — размещение наверху + переключатель уровней [ ]
**Цель:** компас на первом экране (под Hero, выше «Структуры»); переключатель «Вся компания / По целям / По спринту недели».
**Что входит:**
- В `DirectorDashboardClient.tsx`: вставить `<CompassWidget …>` блоком сразу после Hero (`:398`), ПЕРЕД sticky-полосой «Структура» (`:401`). Передавать `data={pulse?.goalVector ?? null}`, `loading={pulseLoading}`, `error={pulseError}`.
- Переключатель уровней (segmented control, русские подписи): «Вся компания» (главная цель + отделы), «По целям» (стрелка на каждую цель из `goals`), «По спринту недели» (period=week уже задаёт окно — на уровне «спринт» показываем те же `goals`, но подпись «за неделю»; данные per-week приходят через `period`). Состояние уровня — локальный `useState`, без нового запроса (всё уже в `goalVector`).
- Убрать старый `GoalVectorWidget` из `GoalsAndMeetingsTab` (`:692`): заменить на ссылку «Полный вектор целей — на главной» или удалить блок (оставить `LowRoiMeetingsWidget`). Удалить неиспользуемый импорт `GoalVectorWidget` (`:67`) если больше нигде.
- Координация с ТЗ-A: компас выше «Структуры». ТЗ-A опускает «Структуру» вниз — если ТЗ-A уже влит, разместить компас на освободившемся месте; если нет — компас всё равно выше строки `:401`.

**Что НЕ входит:** изменение Hero; правки «Структуры» (scope ТЗ-A).
**Точные файлы:** `frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx` (символы: вставка после `:398`; удаление `GoalVectorWidget` `:692`; импорт `:67`).
**Зависимости:** Ф3 (`CompassWidget`).
**Acceptance:**
- `grep "CompassWidget" "frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx"` → импорт + рендер.
- `grep "GoalVectorWidget" "frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx"` → ПУСТО (удалён) ИЛИ только осознанный fallback (зафиксировать в отчёте).
- Переключатель: `grep "Вся компания\|По целям\|По спринту"` → 3 подписи присутствуют.
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
- Ручная (по запросу): на пустом tenant компас не ломает главную (empty-state); на tenant с данными — стрелка под Hero выше «Структуры».

**Закрывает: R9, R10.**

---

## Требования (R1..R10) + трассировка

| R | Формулировка (EARS) | Фаза |
|---|---|---|
| R1 | Когда применяется схема, система shall иметь колонку `Goal.isPrimary` типа Boolean со значением по умолчанию `false`. | Ф1 |
| R2 | Когда две цели одного `tenantId` имеют `isPrimary = true`, система shall отклонить вторую вставку/обновление ошибкой уникальности БД (`goal_primary_unique`). | Ф1 |
| R3 | Когда вызывается `getGoalVector`, для каждой цели система shall вернуть `proScore`, `contraScore` и `netScore` (где `netScore = proScore − contraScore` с округлением до 3 знаков). | Ф2 |
| R4 | Когда у tenant есть ровно одна цель с `isPrimary = true`, система shall вернуть её `goalId` в `primaryGoalId`; когда таких нет, система shall вернуть `goalId` цели с максимальным `weight`, а при равном `weight` — с минимальным `createdAt`; когда целей в выборке нет, `primaryGoalId = null`. | Ф2 |
| R5 | Когда вызывается `getGoalVector`, для каждой цели система shall вернуть `byDepartment` — агрегат `pro/contra/net` по `Person.primaryDepartmentId`, где `primaryDepartmentId IS NULL` отображается как «Без отдела». | Ф2 |
| R6 | Когда `(proScore + contraScore) > 0`, компас shall вычислять `angle = (1 − netScore/(proScore+contraScore)) · 90°`; когда сумма = 0, `angle = 90°`. | Ф3 |
| R7 | Когда `goalVector.goals` пуст, `CompassWidget` shall показать русский empty-state и не выбросить ошибку рендера. | Ф3 |
| R8 | Когда `CompassWidget` рендерится, в его исходнике shall отсутствовать `text-white`, hex-цвета и `slate-` классы, а видимые подписи shall быть на русском. | Ф3 |
| R9 | Когда открыта главная, `CompassWidget` shall находиться в DOM ниже Hero и выше блока «Структура компании». | Ф4 |
| R10 | Когда пользователь переключает уровень, система shall перерисовать компас из уже загруженного `goalVector` без нового сетевого запроса (3 уровня: «Вся компания», «По целям», «По спринту недели»). | Ф4 |

---

## Совместимость с prompt caching

LLM-промпт затрагивается только косвенно: cron `goal-vector-tracker.cron.ts` (SYSTEM `GOAL_VECTOR_TRACKER_SYSTEM_PROMPT`) **НЕ трогаем** — ни SYSTEM, ни user-builder. Read-path (Ф2-Ф4) — чистый SQL+маппинг, LLM не вызывает. Кэш SYSTEM-промпта cron'а остаётся горячим (правок 0). **Раздел релевантен формально: изменений в LLM-промптах нет — кэш не ломается.**

---

## Pre-mortem / Риски + ревью-аспекты

| Риск | Митигизация |
|---|---|
| Partial unique конфликтует с уже существующими «двумя primary» при включении (на dev/prod кто-то выставил вручную) | На момент Ф1 `isPrimary` ещё не существует → дублей быть не может. Создание индекса безопасно. После — выставление флага только через ТЗ-F UI (single-set). |
| `byDepartment` раздувает payload при многих отделах | Ограничено: top-5 целей × число отделов tenant (MVP ≤ 10 человек → ≤ единицы отделов). Не пагинируем. |
| Угол при `pro+contra=0` (нет активности) | Явно `angle=90°` (нейтраль/дрейф) + lengthRatio=0 (короткая стрелка) — стрелка «вялая», читается как «активности нет». |
| Деление `net/(pro+contra)` — `net` может быть > суммы из-за округления round3 | `focus` клампить в `[−1, 1]` перед формулой угла (защита в компоненте). |
| `getGoalVector` делает доп. `department.findMany` и `findFirst(isPrimary)` — +2 запроса | Приемлемо: дашборд читается owner'ом редко; `@@index([tenantId, isPrimary])` делает findFirst дешёвым. |
| Фронт-зеркало рассинхронизировано с бэк-DTO | Acceptance Ф3 грепает `byDepartment` в обоих; типы строгие — `tsc` поймает. |

Ревью-аспекты для strict-production-review-gate: multi-tenancy (все запросы с `tenantId`), отсутствие финансов, идемпотентность postgres-init, отсутствие `@@unique`-обхода, отсутствие правок prompt-cache, токены/русский UI.

---

## Idempotency / feature-flag / prod-deploy

- **Feature-flag:** не требуется — это read-only расширение существующего дашборда + одна nullable-семантика колонки (default false, поведение без флага = текущее). Риск-поведение отсутствует. (Если оркестратор решит перестраховаться — обернуть рендер `CompassWidget` в AdminSetting `dashboard.compass.enabled` default true; НЕ обязательно.)
- **Idempotency:** partial-index через `IF NOT EXISTS`; `isPrimary` через `prisma db push` (аддитивно, безопасно). Seed/patch/backfill — НЕ требуются (default false корректен).
- **Затронутые шаги prod-deploy-log.md:**
  - **Шаг 4** (schema): `Goal.isPrimary` + `@@index([tenantId, isPrimary])` — `bun run prisma:push` (через `docker compose exec backend`).
  - **Шаг 5** (postgres-init): новый partial unique `goal_primary_unique` — `bun run apply-postgres-init`.
  - **Шаг 12** (smoke): `GET /api/v1/dashboard/pulse-patterns?period=week` отдаёт `goalVector.primaryGoalId` и `goals[].byDepartment`.
- **apply-prod-deploy.ts STEPS:** новых seed/patch/backfill/migrate НЕТ → массив `STEPS` не меняется. (postgres-init применяется отдельной командой, не через STEPS.)

---

## DoD

- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные (вкл. `.spec`).
- `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные.
- `bunx vitest run backend/src/modules/dashboard/services/pulse-patterns.service.spec.ts` и `bunx vitest run frontend/src/ui/components/dashboard/CompassWidget.spec.tsx` зелёные.
- second-brain по таблице производных заметок: `02_architecture/data-model.md` (новая колонка `Goal.isPrimary`), `01_projects/<dashboards/goals>.md` (компас вместо списка). Эндпоинт НЕ новый — `api-layer.md` правка опц. (расширение DTO существующего).
- `docs/operations/prod-deploy-log.md` обновлён (Шаги 4, 5, 12).
- Рефлексия в `second-brain/05_история/`.

---

## Итог

- [ ] Ф1 — Prisma `Goal.isPrimary` + partial unique
- [ ] Ф2 — backend `getGoalVector` (pro/contra + главная цель + отделы)
- [ ] Ф3 — фронт компас-виджет (SVG-стрелка)
- [ ] Ф4 — размещение наверху + переключатель уровней
