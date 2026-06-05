---
type: tz
status: ready-to-implement
feature: goals-improvements
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/analysis/2026-06-04-dashboards-po-kartochkam-razbor.md
  - plans/tz/2026-06-05-goal-vector-compass.md
  - plans/tz/2026-06-05-weekly-per-person-plan-fact.md
---

> Анализ-карта: plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md (секция «ТЗ-F») · Решения владельца: 2026-06-05 · Язык владельца: plans/analysis/2026-06-05-dashboards-prostym-yazykom.md §5 «Цели и стратегия»

# ТЗ-F — Цели и стратегия: улучшения

## Цель

Сделать экран «Цели компании» (`/goals`) и карточку цели (`/goals/[id]`) понятными владельцу-нетехнарю и привязать каждую цель к ответственному человеку. Пять болей из разбора §5:

1. У цели нет **ответственного человека** — продукт весь «про людей», а цель обезличена (только `createdById` — кто завёл, не кто отвечает).
2. **Светофор уверенности считается фактически (`themesCount`/`blocksCount`), но не показан** — балл «45» опасен: владелец принимает «мало данных» за «всё плохо» и зря дёргает команду.
3. **Два разных индикатора движения** (`cachedAlignment` 0–100 и `progressStatus`) стоят рядом и могут противоречить — владельцу нужен один ответ «идём или нет».
4. **Жаргон и `₽` в интерфейсе**: `cron`, `snapshot`, `timeline`, английские подписи, символ рубля в placeholder единицы измерения — выглядит как недоделка и нарушает «Кора не про деньги».
5. (Опц.) Завести цель — 4 ручных шага, поэтому цели и не заводят; **голосовая постановка** снимает порог входа.

## Зачем (болезненное состояние по факту)

- `GoalCard` рисует «Согласованность 45» без всякого указания, на скольких данных это посчитано (`GoalsClient.tsx:335-378`). При `themesCount=1, blocksCount=3` балл недостоверен, но владелец этого не видит.
- `progressStatus` («В движении» / «Под риском») в `GoalsTreeView` живёт отдельно от `cachedAlignment` в `GoalsClient` — два экрана, две оси, ноль связи между ними в UI.
- В `GoalDetailClient.tsx` подсказки буквально содержат «Дождитесь cron'а 04:00», «История snapshots», «Timeline согласованности», placeholder «встреч, %, ₽».
- У `Goal` нет `ownerPersonId` (только `createdById:3931`), хотя у соседних карточек графа (`Process.ownerPersonId:5063`, `Regulation.ownerPersonId:5363`, `Policy.ownerPersonId:5408`) это first-class поле — паттерн готов к копированию.

## REALITY-CHECK

| Факт | Доказательство (path:line + символ) | Влияние на фазы |
|---|---|---|
| `Goal` НЕ имеет `ownerPersonId` — только `createdById` (кто завёл) | `backend/prisma/schema.prisma:3931` `createdById String` | Ф1: добавить поле + relation |
| Образец `ownerPersonId` готов у Process/Regulation/Policy (nullable + relation `onDelete: SetNull` + `@@index([tenantId, ownerPersonId])`) | `schema.prisma:5063` `ownerPersonId` / `:5103` `@relation("ProcessOwnerPerson"…)`; `:5391`/`:5427` `@@index([tenantId, ownerPersonId])`; обратные связи `Person.ownedProcesses:4410`, `ownedRegulations:4412` | Ф1: дословная калька |
| `GoalAlignmentSnapshot` имеет `themesCount`/`blocksCount`, но НЕ `confidence` | `schema.prisma:4022` `themesCount Int` / `:4024` `blocksCount Int` | Ф2: derive светофор без новой колонки |
| Воркер пишет `themesCount`/`blocksCount` в каждый snapshot и в кэш цели | `strategic-alignment.worker.ts:300-326` `tx.goalAlignmentSnapshot.create({…themesCount, blocksCount…})` + `tx.goal.update({cachedAlignment…})` | Ф2: значения уже доступны через `latestSnapshot` детальки |
| DTO детальки уже отдаёт `latestSnapshot.themesCount/blocksCount` + `confidence` | `goals.dto.ts:160-164` `themesCount`/`blocksCount`; `:213` `confidence: number | null`; маппер `goals.service.ts:170` `confidence: this.decimalOrNull(goal.confidence)` | Ф2: на детальке данные есть; в списке `cachedAlignment` есть, `themesCount` есть (`GoalListItemDto.themesCount:196`), `blocksCount` НЕТ |
| Список (`GoalListItemDto`) отдаёт `themesCount`, но НЕ `blocksCount` | `goals.dto.ts:196` `themesCount: number` (нет `blocksCount`); сервис `goals.service.ts:112` `_count: { select: { themes: true } }` | Ф2: для светофора в списке нужен ещё `cachedBlocksCount` ИЛИ derive только по `themesCount` (решение C-3) |
| Два индикатора движения существуют параллельно | `GoalsClient.tsx:345` `formatAlignment(alignmentClamped)` (0–100) vs `GoalsTreeView.tsx:74` `GOAL_PROGRESS_STATUS_LABELS[node.progressStatus]` | Ф3: склейка в один UI-вид |
| Жаргон в детальке | `GoalDetailClient.tsx:440` «Дождитесь cron'а 04:00»; `:479` «Timeline согласованности»; `:485` «нужно ≥3 snapshots»; `:492` «История snapshots»; `:1201` title «…предыдущего snapshot»; `:834` placeholder «встреч, %, ₽» | Ф4: русификация + убрать `₽` |
| Карточка списка тоже содержит «cron» | `GoalsClient.tsx:374` «дождитесь cron'а» | Ф4 |
| Готовый пикер людей переиспользуем | `frontend/src/hooks/usePersons.ts:17` `usePersons(orgId, query)` → `GET /api/v1/persons`; `PersonDomainApi.id` = `Person.id` (`structure.api.ts:89`) | Ф1: пикер ответственного без нового эндпоинта |

## Принятые решения владельца

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р4 | Добавить `Goal.ownerPersonId` (`prisma db push`, не migrate) | Продукт «про людей», цель обезличена; паттерн `ownerPersonId` уже отлажен на Process/Regulation/Policy | 2026-06-05 |
| C-1 | Светофор уверенности — **derive на лету** из `themesCount`/`blocksCount`, БЕЗ новой колонки на первом этапе | Данные уже пишутся воркером в каждый snapshot; новая колонка `confidence`-снимок — лишний db push и backfill ради того, что считается за одно сравнение | 2026-06-05 |
| C-2 | Два индикатора движения **склеиваются на domain/UI**, поля БД НЕ трогаем (`cachedAlignment` и `progressStatus` остаются) | Оба поля питаются разными воркерами (`strategic-alignment` и `goals-pulse`); ломать схему ради UI — риск; склейка в одном helper'е обратима и дешева | 2026-06-05 |
| C-3 | Светофор в **списке** целей считаем только по `themesCount` (отдаём `blocksCount` в `GoalListItemDto` через `cachedBlocksCount`-кэш-поле); на **детальке** — по `themesCount`+`blocksCount` из `latestSnapshot` | В списке `findMany` без JOIN на snapshots — тянуть последний snapshot на каждую цель дорого; кэш-поле в `Goal` дешевле и идёт тем же `tx.goal.update`, что и `cachedAlignment` | 2026-06-05 |
| C-4 | Голосовая постановка цели — **Фаза 5, опциональная**, вынести vNext-заглушкой если по объёму крупно | Снижает порог входа, но это самостоятельная фича (ASR + LLM extraction + UI-форма) — не блокирует Р4/светофор/русификацию | 2026-06-05 |

## Доказательство выбора (светофор: новая колонка vs derive)

Развилка из карты: «вычислять confidence в `strategic-alignment.worker.ts` ИЛИ derive светофор на лету». Выбран derive (C-1):

- Воркер уже кладёт `themesCount`/`blocksCount` в `GoalAlignmentSnapshot` (`worker:311`) — данные есть бесплатно.
- «Светофор» владельцу нужен как 3 состояния (серый/жёлтый/зелёный), а не дробный `confidence` 0..1 — порогов достаточно, точная цифра не нужна и в UI не показывается («без процентов» — требование владельца).
- Новая колонка `confidence`-снимок потребовала бы db push + backfill старых snapshot'ов + правку воркера (ломает prompt-нейтральный путь). Derive — чистый helper в `domain/goal.ts`, нулевой риск миграции.
- Для списка (где snapshot не джойнится) добавляем дешёвое кэш-поле `cachedBlocksCount` тем же `tx.goal.update` (C-3) — это НЕ снимок confidence, а денормализация двух чисел.

## Scope

### Входит
- Ф1: `Goal.ownerPersonId` (Prisma + db push) + relation + индекс; UI выбора ответственного в Create/Edit-диалогах; DTO/маппер/домен/api протягивают `ownerPersonId` + `ownerPersonName`; опц. авто-резолв из участников встреч.
- Ф2: helper «светофор уверенности» (3 состояния, русские подписи, без процентов) + вывод рядом с баллом в `GoalsClient` (карточка) и `GoalDetailClient` (шапка движения); кэш-поле `cachedBlocksCount` для списка.
- Ф3: helper склейки `cachedAlignment` + `progressStatus` в один понятный UI-вид (одна строка-вердикт + балл), вывод в `GoalsClient` и `GoalDetailClient`; поля БД не трогаем.
- Ф4: русификация жаргона `cron`/`snapshot`/`timeline` в `GoalsClient`/`GoalDetailClient`; убрать `₽` из placeholder единицы; согласовать формулировки времени обновления.
- Ф5 (опц.): постановка цели голосом — ASR-ввод → LLM предлагает формулировку + темы + ключевой результат → форма Create; либо vNext-заглушка.

### Не входит (→ ссылка)
- Компас-виджет «Вектор движения к цели», разрез по отделам/спринтам, `Goal.isPrimary` → **ТЗ-B** `plans/tz/2026-06-05-goal-vector-compass.md`.
- `commitmentAuthorPersonId`, недельный план-факт по людям → **ТЗ-D** `plans/tz/2026-06-05-weekly-per-person-plan-fact.md`.
- Изменение формулы alignment / логики `strategic-alignment.worker.ts` LLM-вызова (только чтение `themesCount`/`blocksCount`, при C-3 — добавление записи `cachedBlocksCount`).
- Изменение логики `goals-pulse.cron.ts` (источник `progressStatus`) — склейка только в UI.
- Новые AdminSetting-крутилки порогов светофора — на первом этапе пороги константой-fallback в коде; вынос в AdminSetting → vNext (см. «Idempotency / feature-flag»).

## Граничные контракты с другими ТЗ (что НЕ трогать)

- **`schema.prisma` model `Goal` трогают последовательно ТЗ-B (`isPrimary`), ТЗ-D (`commitmentAuthorPersonId` — это поле в `IdeaBlock`, не в `Goal`), ТЗ-F (`ownerPersonId`).** Перед правкой схемы — **re-Read** блока `model Goal { … }` (`schema.prisma:3900-3985`) и добавление СВОЕГО поля `ownerPersonId` рядом с `createdById:3931`, не перезатирая чужие добавления. ТЗ-B добавляет `isPrimary` Boolean в тот же блок — если он уже там, оставить.
- **Person back-relation:** добавить `ownedGoals Goal[] @relation("GoalOwnerPerson")` в блок `model Person` рядом с `ownedProcesses:4410`. Не трогать существующие `owned*`-связи.
- **`GoalListItemDto`/`GoalDetailDto` (`goals.dto.ts`)** — общий контракт с фронтом; добавлять поля только в конец (`ownerPersonId`, `ownerPersonName`, `confidenceLevel` — нет, светофор считается на фронте; `blocksCount` для списка). Не менять существующие поля.
- **`progressStatus`** — пишется `goals-pulse.cron.ts`; склейка C-2 только читает его в UI, логику cron не трогать.

## Контракт-first

### Prisma — `model Goal` (добавить, дословная калька с `Process.ownerPersonId`)

Образец из `schema.prisma` (НЕ трогать, привожу как эталон):
```prisma
// model Process (schema.prisma:5062-5103)
  ownerPersonId      String?
  ownerPerson        Person?  @relation("ProcessOwnerPerson", fields: [ownerPersonId], references: [id], onDelete: SetNull)
// Regulation (schema.prisma:5391) / Policy (schema.prisma:5427):
  @@index([tenantId, ownerPersonId])
```

Добавить в `model Goal` (рядом с `createdById String` на `:3931`):
```prisma
  /// ТЗ-F (2026-06-05) — назначенный ответственный за цель (Person).
  /// nullable: цель может быть без ответственного. Паттерн как Process/Regulation/
  /// Policy.ownerPersonId. onDelete:SetNull — удаление Person не роняет цель.
  ownerPersonId           String?
  ownerPerson             Person?     @relation("GoalOwnerPerson", fields: [ownerPersonId], references: [id], onDelete: SetNull)
  /// ТЗ-F Ф2/C-3 (2026-06-05) — кэш числа блоков последнего snapshot для
  /// «светофора уверенности» в СПИСКЕ целей (без JOIN на snapshots).
  /// Обновляется тем же tx.goal.update, что и cachedAlignment. NULL = ещё не считалось.
  cachedBlocksCount       Int?
```

Добавить индекс в конец блока индексов `model Goal` (после `@@index([tenantId, validUntil]):3984`):
```prisma
  @@index([tenantId, ownerPersonId])
```

Добавить back-relation в `model Person` (рядом с `ownedProcesses Process[] @relation("ProcessOwnerPerson"):4410`):
```prisma
  /// ТЗ-F (2026-06-05) — Person как ответственный за цель (Goal.ownerPersonId).
  ownedGoals            Goal[]             @relation("GoalOwnerPerson")
```

После правки: `bun run prisma:push` затем `bun run prisma:generate`. **Никогда `prisma migrate*`.**

### Zod-DTO — `goals.dto.ts`

В `CreateGoalSchema` (`:51`) и `UpdateGoalSchema` (`:62`) добавить:
```ts
  /** ТЗ-F — ответственный за цель (Person.id). null = снять ответственного. */
  ownerPersonId: z.string().min(1).nullable().optional(),
```

В `GoalListItemDto` (`:186`) и (унаследованно) `GoalDetailDto` добавить в конец интерфейса:
```ts
  // ── ТЗ-F (2026-06-05) ──
  ownerPersonId: string | null;
  ownerPersonName: string | null;
  /** Число блоков последнего snapshot (для светофора в списке). null = не считалось. */
  blocksCount: number | null;
```

Машинные коды ошибок (переиспользуем существующие из сервиса):
- `owner_person_not_found` (404) — `ownerPersonId` указан, но Person не найден в этом tenant. Пример: `PATCH /api/v1/goals/:id { ownerPersonId: "ckXXX" }` где Person другого tenant → `{ ok:false, error:{ code:"owner_person_not_found", message:"Ответственный не найден" } }`.
- Существующие: `goal_not_found` (404), `tenant_required` (400), `forbidden` (403) — не менять.

### Маппер `goals.service.ts`

- `create`/`update`: при `body.ownerPersonId !== undefined` — если truthy, `assertOwnerPersonExists(tenantId, ownerPersonId)` (новый guard по образцу `assertParentExists:558`); затем `data.ownerPerson = ownerPersonId ? { connect: { id } } : { disconnect: true }`. `disconnect: true` на nullable — безопасно (как `parent` на `:264`).
- `list`/`get` include: добавить `ownerPerson: { select: { id: true, name: true } }`. В `mapList` отдать `ownerPersonId: g.ownerPersonId ?? null`, `ownerPersonName: g.ownerPerson?.name ?? null`, `blocksCount: g.cachedBlocksCount ?? null`.
- `get`: `blocksCount` отдавать из `latestSnapshot?.blocksCount ?? goal.cachedBlocksCount ?? null` (детальный snapshot точнее кэша).

### Воркер `strategic-alignment.worker.ts` (C-3, только запись кэша)

В `tx.goal.update({ data: {…} })` (`:316-323`) добавить ОДНУ строку рядом с `cachedAlignment`:
```ts
          cachedBlocksCount: blocks.length,
```
SYSTEM-промпт и LLM-вызов НЕ трогаем (см. «Совместимость с prompt caching»).

### Frontend domain — `frontend/src/domain/goal.ts`

```ts
// ── Светофор уверенности (Ф2) ──
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  low: 'Мало данных',
  medium: 'Достаточно данных',
  high: 'Много данных',
};
/** Пороги derive (C-1). themesCount/blocksCount → уровень. blocksCount=null → по темам. */
export function confidenceLevel(themesCount: number, blocksCount: number | null): ConfidenceLevel {
  // мало: 0 тем ИЛИ <5 блоков; средне: 1-2 темы и <20 блоков; много: ≥3 тем и ≥20 блоков
  if (themesCount === 0) return 'low';
  const blocks = blocksCount ?? themesCount * 5; // оценка по списку, где blocksCount нет
  if (themesCount >= 3 && blocks >= 20) return 'high';
  if (blocks < 5) return 'low';
  return 'medium';
}
/** Парные токены чипа светофора (правило bg-{c}+text-{c}-fg). */
export function confidenceChipClasses(level: ConfidenceLevel): { bg: string; fg: string } {
  switch (level) {
    case 'low':    return { bg: 'bg-chip-danger-bg',  fg: 'text-chip-danger-fg' };
    case 'medium': return { bg: 'bg-chip-warning-bg', fg: 'text-chip-warning-fg' };
    case 'high':   return { bg: 'bg-chip-success-bg', fg: 'text-chip-success-fg' };
  }
}

// ── Склейка движения (Ф3) ──
export type MovementVerdict = { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };
/** Один вердикт из cachedAlignment(0-100) + progressStatus. Поля БД не меняем. */
export function movementVerdict(
  alignment: number | null,
  progress: GoalProgressStatus,
): MovementVerdict { /* см. Ф3 */ }
```

Пороги `confidenceLevel` — единственное «настраиваемое». На первом этапе константы в коде (code-fallback). Вынос в AdminSetting → vNext (см. ниже).

### ASCII-поток (Ф1 — выбор ответственного)

```
Owner открывает Create/Edit цели
        │
        ▼
usePersons(orgId) ── GET /api/v1/persons ──► [PersonDomainApi{id,fullName,...}]
        │
        ▼ (Select ответственного, опц. «Не назначен»)
POST/PATCH /api/v1/goals { ownerPersonId: Person.id | null }
        │
        ▼ assertOwnerPersonExists(tenantId, ownerPersonId)  ──fail──► 404 owner_person_not_found
        │ ok
        ▼
Goal.ownerPerson connect/disconnect ─► GoalListItemDto{ownerPersonId, ownerPersonName}
        │
        ▼
GoalCard / GoalDetail показывают «Ответственный: {ownerPersonName}»
```

## Границы автономии

- ✅ **Always:** добавлять `ownerPersonId`/`cachedBlocksCount` строго калькой с эталона; русифицировать строки UI; derive-хелперы в `domain/goal.ts`; переиспользовать `usePersons`/`personsDomainApi`; re-Read `model Goal` перед каждой правкой схемы.
- ⚠️ **Ask first:** менять пороги `confidenceLevel`; вводить новую колонку `confidence`-снимок (решено НЕ вводить — C-1); расширять Ф5 за пределы заглушки; трогать формулу alignment.
- 🚫 **Never:** `prisma migrate*`; `new PrismaClient()` в скриптах; `process.env.*`; `text-white`/hex/slate в UI; английские слова в пользовательском UI; правка SYSTEM-промпта `goal-alignment.prompt.ts`; перезапись чужих полей `Goal` (ТЗ-B `isPrimary`).

## Фазы

Граф зависимостей:
```
Ф1 (schema + ownerPersonId) ──► Ф2 (светофор, нужен cachedBlocksCount из Ф1-схемы)
                              └► Ф3 (склейка движения, независима от Ф1, но в тех же файлах)
Ф4 (русификация) — независима, но идёт последней (касается тех же файлов, минимизируем конфликты)
Ф5 (голос, опц.) — после Ф1 (использует Create-форму)
```
| Фаза | Зависит от |
|---|---|
| Ф1 | — |
| Ф2 | Ф1 (поле `cachedBlocksCount`) |
| Ф3 | — (рекоменд. после Ф2 — те же файлы) |
| Ф4 | — (рекоменд. последней) |
| Ф5 | Ф1 |

### [ ] Ф1 — `Goal.ownerPersonId` + UI выбора ответственного

**Цель:** у цели появляется ответственный человек; владелец выбирает его в Create/Edit; список и деталька показывают имя.

**Что входит:**
- Prisma: `Goal.ownerPersonId` + `ownerPerson` relation + `@@index([tenantId, ownerPersonId])` + `Goal.cachedBlocksCount`; `Person.ownedGoals` back-relation. `prisma:push` + `prisma:generate`.
- DTO: `CreateGoalSchema`/`UpdateGoalSchema` + `ownerPersonId`; `GoalListItemDto` + `ownerPersonId`/`ownerPersonName`/`blocksCount`.
- Сервис: `assertOwnerPersonExists`; connect/disconnect в `create`/`update`; include `ownerPerson` + маппинг в `mapList`/`get`.
- Frontend domain `goal.ts`: `GoalListItemApi`/`GoalDomain` + `ownerPersonId`/`ownerPersonName`/`blocksCount`; маппер `goalFromApi`.
- API `goals.api.ts`: `CreateGoalRequest`/`UpdateGoalRequest` + `ownerPersonId?: string | null`.
- UI `GoalsClient.tsx`: Select ответственного (через `usePersons(currentOrgId)`) в `CreateGoalDialog` и `EditGoalDialog`, опция «Не назначен»; вывод «Ответственный: {имя}» в `GoalCard` (рядом с `themesCount` на `:380-389`).
- Опц. авто-резолв: при создании, если `ownerPersonId` пуст, предложить (не проставить молча) самого частого участника связанных встреч — **на первом этапе достаточно пустого значения**; авто-резолв → vNext-заглушка с TODO, если по объёму выходит за фазу.

**Что НЕ входит:** `commitmentAuthorPersonId` (ТЗ-D), `isPrimary` (ТЗ-B), компас (ТЗ-B).

**Точные файлы:**
- `backend/prisma/schema.prisma:3931` (рядом с `createdById`), `:3984` (после индексов), `:4410` (Person `ownedProcesses` → добавить `ownedGoals`).
- `backend/src/modules/goals/dto/goals.dto.ts:51` `CreateGoalSchema`, `:62` `UpdateGoalSchema`, `:186` `GoalListItemDto`.
- `backend/src/modules/goals/services/goals.service.ts:193` `create`, `:239` `update` data-builder, `:558` `assertParentExists` (рядом — `assertOwnerPersonExists`), `:108`/`:127` include, `:643` `mapList`.
- `frontend/src/domain/goal.ts:265` `GoalListItemApi`, `:341` `GoalDomain`, `:429` `goalFromApi`.
- `frontend/src/api/goals.api.ts:26` `CreateGoalRequest`, `:33` `UpdateGoalRequest`.
- `frontend/app/(authenticated)/goals/GoalsClient.tsx:430` `CreateGoalDialog`, `:570` `EditGoalDialog`, `:380-389` `GoalCard` footer.

**Зависимости:** —

**Acceptance:**
- `grep -n "ownerPersonId" backend/prisma/schema.prisma` → ≥3 совпадения в `model Goal`/`model Person` (поле, relation, индекс) + back-relation.
- `grep -n "cachedBlocksCount" backend/prisma/schema.prisma` → 1.
- `grep -n "assertOwnerPersonExists" backend/src/modules/goals/services/goals.service.ts` → определение + вызовы в create/update.
- `grep -n "ownerPersonName" backend/src/modules/goals/dto/goals.dto.ts frontend/src/domain/goal.ts` → есть в обоих.
- `grep -n "usePersons" frontend/app/(authenticated)/goals/GoalsClient.tsx` → импорт + вызов.
- Команды: `cd backend && bun run typecheck && bun run lint && bun run build`; `cd frontend && bun run typecheck && bun run lint && bun run build`.
- Тесты: `bunx vitest run src/modules/goals/services/goals.service.spec.ts` — добавить кейсы: (а) create с валидным `ownerPersonId` → `ownerPersonName` в ответе; (б) update с `ownerPersonId` чужого tenant → throws `owner_person_not_found`; (в) update `{ ownerPersonId: null }` → disconnect, ответ `ownerPersonId:null`.
- Swagger smoke: `GET /api/docs` — в `GoalListItemDto` есть `ownerPersonId`, `ownerPersonName`, `blocksCount`.
- Вход→выход: `POST /api/v1/goals { name:"X", description:"Y", ownerPersonId:"<valid Person.id>" }` → 201 `{ ownerPersonId:"<id>", ownerPersonName:"<имя>" }`. Негатив: тот же с `ownerPersonId:"non-existent"` → 404 `{ ok:false, error:{ code:"owner_person_not_found" } }`.

**Закрывает: R1, R2, R8**

### [ ] Ф2 — Светофор уверенности рядом с баллом

**Цель:** рядом с баллом «Согласованность» владелец видит простыми словами, на скольких данных он посчитан (3 состояния, без процентов).

**Что входит:**
- `domain/goal.ts`: `ConfidenceLevel`, `CONFIDENCE_LEVEL_LABELS`, `confidenceLevel(themesCount, blocksCount)`, `confidenceChipClasses(level)` (парные токены).
- Воркер `strategic-alignment.worker.ts:316` — добавить `cachedBlocksCount: blocks.length` в `tx.goal.update`.
- `GoalsClient.tsx` `GoalCard`: под баллом «Согласованность» — чип светофора `confidenceLevel(goal.themesCount, goal.blocksCount)` с подписью из `CONFIDENCE_LEVEL_LABELS`. Если `cachedAlignment === null` — светофор всё равно показываем («Мало данных»), это и есть причина пустого балла.
- `GoalDetailClient.tsx` шапка движения (`:420-436`): чип светофора `confidenceLevel(goal.latestSnapshot?.themesCount ?? 0, goal.latestSnapshot?.blocksCount ?? goal.blocksCount)`; заменить голую подпись «точность ±10 пунктов» на «{уровень} · точность ±10».

**Что НЕ входит:** проценты/числовой confidence в UI; новая колонка `confidence`-снимок.

**Точные файлы:**
- `frontend/src/domain/goal.ts:467` (секция UI helpers — добавить рядом с `alignmentBarColor`).
- `backend/src/modules/goals/workers/.../strategic-alignment.worker.ts:316-323` (см. путь в REALITY-CHECK: `backend/src/modules/knowledge-core/workers/strategic-alignment.worker.ts`).
- `frontend/app/(authenticated)/goals/GoalsClient.tsx:335-378` (блок «Согласованность»).
- `frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx:433-435` (подпись под баром).

**Зависимости:** Ф1 (поле `cachedBlocksCount` + `blocksCount` в DTO/домене).

**Acceptance:**
- `grep -n "confidenceLevel\|confidenceChipClasses\|CONFIDENCE_LEVEL_LABELS" frontend/src/domain/goal.ts` → 3 символа определены.
- `grep -n "Мало данных\|Достаточно данных\|Много данных" frontend/src/domain/goal.ts` → 3 русские подписи.
- `grep -n "cachedBlocksCount" backend/src/modules/knowledge-core/workers/strategic-alignment.worker.ts` → 1.
- `grep -n "confidenceLevel" frontend/app/(authenticated)/goals/GoalsClient.tsx frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx` → есть в обоих.
- Юнит-тест (новый `frontend/src/domain/goal.spec.ts` или дополнение): `confidenceLevel(0, null) === 'low'`; `confidenceLevel(1, 3) === 'low'`; `confidenceLevel(2, 12) === 'medium'`; `confidenceLevel(4, 25) === 'high'`. Команда: `bunx vitest run src/domain/goal.spec.ts` (frontend).
- `cd frontend && bun run typecheck && bun run lint`.
- Глаз НЕ требуется: проверяется чипом-подписью через grep + юнит.

**Закрывает: R3, R4**

### [ ] Ф3 — Один понятный индикатор движения

**Цель:** вместо двух осей (балл 0–100 и статус «В движении») — один вердикт-строка + балл; владелец читает «идём / тормозим / отклоняемся».

**Что входит:**
- `domain/goal.ts`: `MovementVerdict` + `movementVerdict(alignment, progressStatus)`. Правило склейки (приоритет `progressStatus` как явного состояния, балл — нюанс):
  - `progressStatus='achieved'` → `{label:'Достигнута', tone:'success'}`.
  - `progressStatus='dropped'` → `{label:'Выпала из работы', tone:'neutral'}`.
  - `progressStatus='stalled'` → `{label:'Застряла', tone:'danger'}`.
  - `progressStatus='at_risk'` → `{label:'Под риском', tone:'warning'}`.
  - `progressStatus='on_track'` + `alignment>=70` → `{label:'Уверенно движемся', tone:'success'}`.
  - `progressStatus='on_track'` + `alignment` в [40,70) → `{label:'Движемся', tone:'success'}`.
  - `progressStatus='on_track'` + `alignment<40` (или null) → `{label:'Движемся, но согласованность низкая', tone:'warning'}`.
- `GoalsClient.tsx` `GoalCard`: над баром «Согласованность» — строка-вердикт из `movementVerdict`; убрать отдельный показ `progressStatus`-чипа на карточке списка, если он был (на `/goals` карточки `progressStatus` не показывали — он в дереве; оставить дерево как есть, склейка только в плоской карточке и детальке).
- `GoalDetailClient.tsx` шапка: строка-вердикт + балл вместе.

**Что НЕ входит:** изменение `progressStatus` в БД/cron; правка `GoalsTreeView` (дерево остаётся со своим чипом — это другой контекст, иерархия).

**Точные файлы:**
- `frontend/src/domain/goal.ts:467` (UI helpers).
- `frontend/app/(authenticated)/goals/GoalsClient.tsx:334-378`.
- `frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx:414-436`.

**Зависимости:** — (рекоменд. после Ф2: общие файлы).

**Acceptance:**
- `grep -n "movementVerdict\|MovementVerdict" frontend/src/domain/goal.ts` → определение.
- `grep -n "Уверенно движемся\|Застряла\|Под риском\|согласованность низкая" frontend/src/domain/goal.ts` → русские вердикты.
- `grep -n "movementVerdict" frontend/app/(authenticated)/goals/GoalsClient.tsx frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx` → оба.
- Юнит (`goal.spec.ts`): `movementVerdict(80,'on_track').label==='Уверенно движемся'`; `movementVerdict(30,'on_track').tone==='warning'`; `movementVerdict(90,'stalled').label==='Застряла'` (статус важнее балла); `movementVerdict(null,'achieved').label==='Достигнута'`. Команда: `bunx vitest run src/domain/goal.spec.ts`.
- `cd frontend && bun run typecheck && bun run lint`.

**Закрывает: R5**

### [ ] Ф4 — Русификация жаргона и удаление `₽`

**Цель:** в UI целей нет `cron`/`snapshot`/`timeline`/английских слов и символа `₽`.

**Что входит:** заменить дословно:
- `GoalsClient.tsx:374`: «Не считалось — дождитесь cron'а или нажмите «Пересчитать» внутри цели.» → «Пока не рассчитано. Кора обновляет оценку каждую ночь, либо нажмите «Пересчитать» внутри цели.»
- `GoalDetailClient.tsx:440-442`: «Дождитесь cron'а 04:00…» → «Кора рассчитывает оценку каждую ночь. Можно нажать «Пересчитать сейчас».»
- `GoalDetailClient.tsx:479`: «Timeline согласованности» → «История движения к цели».
- `GoalDetailClient.tsx:485`: «нужно ≥3 snapshots» → «нужно хотя бы 3 замера».
- `GoalDetailClient.tsx:492`: «История snapshots (N)» → «Замеры ({N})».
- `GoalDetailClient.tsx:1201`: title «Изменение относительно предыдущего snapshot» → «Изменение по сравнению с прошлым замером».
- `GoalDetailClient.tsx:834`: placeholder «встреч, %, ₽» → «встреч, задач, %».
- `GoalDetailClient.tsx:1300/1302` имя компонента `TimelineChart` оставить (код, не UI), но заголовок/подписи внутри — русские; комментарии-код не считаются UI.

**Что НЕ входит:** переименование переменных/типов в коде (`snapshot`, `timeline` как имена полей API — это контракт, не UI-текст).

**Точные файлы:** `GoalsClient.tsx:374`; `GoalDetailClient.tsx:440,479,485,492,834,1201` (+ подписи внутри `TimelineChart` если есть видимый текст).

**Зависимости:** — (последней — общие файлы).

**Acceptance:**
- `grep -ni "cron\|snapshot\|timeline\|₽" frontend/app/(authenticated)/goals/GoalsClient.tsx frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx` → совпадения ТОЛЬКО в комментариях/именах-полях/типах, НЕ в видимых строках JSX (ручная классификация при ревью; машинно — отдельный grep ниже).
- `grep -n "История движения к цели\|нужно хотя бы 3 замера\|Замеры (\|прошлым замером\|каждую ночь" frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx` → новые русские строки на месте.
- `grep -n "встреч, задач, %" frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx` → 1; `grep -n "₽" …GoalDetailClient.tsx` → 0 в JSX-строках.
- `cd frontend && bun run typecheck && bun run lint && bun run build`.

**Закрывает: R6, R7**

### [ ] Ф5 (опц.) — Постановка цели голосом

**Цель:** владелец надиктовывает цель словами → Кора предлагает формулировку (name+description) + список тем-кандидатов + 1 ключевой результат → форма Create предзаполнена; владелец правит и сохраняет.

**Что входит (если делаем):** ASR-ввод (микрофон → текст, переиспользовать существующий ASR-путь Concierge — ТОЛЬКО ввод, без голосового вывода) → LLM-extraction `taskType` (новый или reuse) возвращает `{name, description, suggestedThemeIds[], keyResult{name,unit,target}}` → предзаполнение `CreateGoalDialog`. Атрибуция (`ownerPersonId`) — НЕ часть этой фазы.

**Что НЕ входит / vNext-заглушка:** если объём ASR+LLM+форма выходит за рамки одной фазы — оформить заглушку: кнопка «Сказать голосом» с тостом «Скоро» + TODO-ссылка на отдельное ТЗ `plans/tz/2026-06-XX-goal-voice-capture.md` (создать пустой). Решение объёма — ⚠️ Ask first перед стартом фазы.

**Точные файлы (если делаем):** `frontend/app/(authenticated)/goals/GoalsClient.tsx:430` `CreateGoalDialog`; новый `backend/src/modules/goals/prompts/goal-voice-extract.prompt.ts`; маршрут LLM через `llm-router`.

**Зависимости:** Ф1.

**Acceptance:** при заглушке — `grep -n "Сказать голосом" frontend/app/(authenticated)/goals/GoalsClient.tsx` + существование файла-заглушки ТЗ. При полной реализации — отдельный набор acceptance в момент решения (Ask first).

**Закрывает: R9 (опц.)**

## Требования R1..Rn (EARS) + трассировка

| R | Формулировка | Фаза |
|---|---|---|
| R1 | Когда owner создаёт/редактирует цель и выбирает ответственного, система shall сохранить `Goal.ownerPersonId` и вернуть `ownerPersonName` в ответе. | Ф1 |
| R2 | Когда в `ownerPersonId` передан Person, не принадлежащий tenant'у запроса, система shall вернуть 404 с `error.code='owner_person_not_found'` и не изменить цель. | Ф1 |
| R3 | Когда у цели `themesCount=0`, система shall показать светофор уверенности в состоянии «Мало данных» (`low`). | Ф2 |
| R4 | Когда `themesCount≥3` и `blocksCount≥20`, система shall показать светофор «Много данных» (`high`); в диапазонах между — «Достаточно данных» (`medium`). | Ф2 |
| R5 | Когда отображается движение цели, система shall показать ровно один текстовый вердикт, выведенный из `cachedAlignment` и `progressStatus`, при этом `progressStatus∈{achieved,dropped,stalled}` shall иметь приоритет над числом балла. | Ф3 |
| R6 | Когда отображается любой пользовательский текст на `/goals` и `/goals/[id]`, он shall не содержать строк `cron`, `snapshot`, `timeline` в видимом JSX. | Ф4 |
| R7 | Когда отображается placeholder единицы измерения ключевого результата, он shall не содержать символ `₽`. | Ф4 |
| R8 | Когда owner снимает ответственного (`ownerPersonId=null`), система shall отвязать Person (`disconnect`) и вернуть `ownerPersonId=null, ownerPersonName=null`. | Ф1 |
| R9 (опц.) | Когда owner надиктовывает цель голосом, система shall предложить заполненные `name`, `description`, темы-кандидаты и один ключевой результат для подтверждения; либо (заглушка) показать «Скоро» и не падать. | Ф5 |

## Совместимость с prompt caching

- Ф1–Ф4 **не трогают LLM-промпты**. Воркер `strategic-alignment.worker.ts` правится только в части `tx.goal.update` (запись `cachedBlocksCount`) — SYSTEM/user-сообщения `goal-alignment.prompt.ts` остаются байт-в-байт прежними, кэш не ломается.
- Ф5 (если делаем): новый `taskType` для extraction — стабильный SYSTEM, переменная (надиктованный текст) в конце user; раздел кэша оформить в момент реализации фазы. До тех пор — не релевантно.

## Pre-mortem / Риски + ревью-аспекты

- **Гонка схемы (ТЗ-B/D/F общий `model Goal`).** Митигейт: re-Read `model Goal` перед `prisma:push`; добавлять ТОЛЬКО свои поля; после push — `grep` `isPrimary`/`commitmentAuthorPersonId` НЕ удалены.
- **`onDelete: SetNull` уже требует nullable.** `ownerPersonId String?` — соблюдено (как Process). Удаление Person не каскадит цель.
- **Светофор vs balance:** при `cachedAlignment=null` балл «—», но светофор «Мало данных» — это согласованный сигнал, не противоречие (объясняет, почему балла нет). Ревью: проверить, что null-балл не прячет светофор.
- **Склейка движения может скрыть число.** Митигейт: вердикт показывается РЯДОМ с баллом, не вместо (требование владельца — связать, не убрать одно).
- **`blocksCount` в списке отсутствует без кэш-поля.** Решено C-3 (`cachedBlocksCount`). Ревью: воркер пишет его в той же транзакции, что и `cachedAlignment` — иначе рассинхрон.
- **Strict-production-review-gate аспекты:** tenant-изоляция в `assertOwnerPersonExists` (Person того же tenant); идемпотентность не применима (нет seed/patch); миграция через db push безопасна (только добавление nullable-колонок + индекс).

## Idempotency / feature-flag / prod-deploy

- **Feature-flag:** Ф1–Ф4 — UI/контрактные улучшения без рискового поведения, флаг не требуется (нет нового автономного агента/воркера). Ф5 (если полная) — за флагом `GOALS_VOICE_CAPTURE_ENABLED` (OFF по умолчанию) + kill-switch; пороги светофора — code-fallback, вынос в AdminSetting (`super_admin`, history+audit) → vNext.
- **Idempotency:** новых seed/patch/backfill скриптов НЕТ → регистрация в `apply-prod-deploy.ts` STEPS не нужна.
- **prod-deploy-log затронутые Шаги:**
  - **Шаг 4 (schema):** `Goal.ownerPersonId` + relation + `@@index([tenantId, ownerPersonId])` + `Goal.cachedBlocksCount` + `Person.ownedGoals` — применяется `bun run prisma:push` (в проде через `docker compose exec backend bun run prisma:push`). Безопасно: только добавление nullable-колонок и индекса.
  - **Шаг 12 (smoke):** Swagger — `GoalListItemDto` содержит `ownerPersonId`/`ownerPersonName`/`blocksCount`; ручной POST/PATCH цели с `ownerPersonId`.
  - Шаги 1/5/6/7/8/9/10 — НЕ затронуты (нет ENV*, postgres-init, patch/seed/backfill/migrate/setup). *Если Ф5 полная — Шаг 1 (новый feature-flag в `env.schema.ts`).

## DoD

- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные (вкл. `goals.service.spec.ts`).
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные (вкл. `goal.spec.ts`).
- `bunx vitest run src/modules/goals/services/goals.service.spec.ts` (backend) и `bunx vitest run src/domain/goal.spec.ts` (frontend) — зелёные.
- Все grep-маркеры из Acceptance каждой реализованной фазы присутствуют.
- second-brain по таблице производных заметок: новая колонка/таблица → `02_architecture/data-model.md` + `prod-deploy-log.md` Шаг 4; профильная `01_projects/<goals>.md` обновлена (ownerPersonId, светофор, склейка движения).
- `docs/operations/prod-deploy-log.md` Шаг 4 + Шаг 12 обновлены; блок «Prod-инструкция» в чате (diff: только `prisma:push`).
- Рефлексия в `second-brain/05_история/`.

## Итог

- [x] Ф1 — `Goal.ownerPersonId` + UI выбора ответственного
- [x] Ф2 — Светофор уверенности рядом с баллом
- [x] Ф3 — Один понятный индикатор движения
- [x] Ф4 — Русификация жаргона и удаление `₽`
- [ ] Ф5 (опц.) — Постановка цели голосом — **НЕ начата** (по ТЗ «Ask first»: полная = ASR+LLM+форма; ждёт решения владельца: полная / toast-заглушка / отдельное ТЗ vNext)

Реализовано: **Ф1–Ф4 целиком (R1–R8); Ф5 (R9) не начата (Ask-first).** Ветка `feature/goals-improvements` (от `origin/dev`). Коммиты: Ф1 `afe344b2` (backend) + `2701cff2` (frontend) · Ф2 `62febeec` · Ф3 `158ac9df` · Ф4 `184bce07`. Верификация: backend typecheck+lint+build + `goals.service.spec` 8/8; frontend typecheck+lint+production build + `goal.test.ts` 25/25 (golden confidenceLevel/movementVerdict). Схема применена `prisma:generate` (dev-БД выключена); реальный `prisma db push` — **prod Шаг 4** (`docs/operations/prod-deploy-log.md`). Пороги светофора — code-fallback; вынос в AdminSetting → vNext.
