---
title: "ТЗ: Раздел «Память компании» — 6 UI-задач"
status: [x] реализовано 2026-05-26
created: 2026-05-26
area: frontend, backend (entitlements)
backend-ready: true
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 95%.**
> Реализовано полностью отдельным коммитом 8c35614c: все 6 задач (regulations/ideas/entities/skills-table/sidebar-subgroup/access-control) подтверждены в коде frontend+backend. Сознательные отклонения (нет отдельных guards
> ⚠️ Хвосты (см. реестр приоритетов): Роль member отсутствует в Z — entitlement-флаги заложены «на будущее», фактической member-роли нет
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


## Итог реализации (2026-05-26)

**Все 3 волны выполнены.** `bun run typecheck` и `bun run lint` чистые
в обоих стеках (один warning в `telegram-proxy-health.cron.ts` — не от
этих изменений).

### Затронутые файлы

**Backend:**
- [tier-config.ts](../../backend/src/modules/entitlements/tier-config.ts) — 2 новых feature-ключа.
- [policy.csv](../../backend/src/modules/rbac/policies/policy.csv) — manager read на regulation/process/policy.
- [org-admin-memory-access.controller.ts](../../backend/src/modules/admin/controllers/org-admin-memory-access.controller.ts) — новый.
- [admin.module.ts](../../backend/src/modules/admin/admin.module.ts) — регистрация контроллера.

**Frontend:**
- [Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx) — подгруппа «Память компании» (localStorage-collapse + useMemoryAccess).
- [SkillsTable.tsx](../../frontend/src/ui/components/knowledge-profile/SkillsTable.tsx) — новый shared-компонент.
- [KnowledgeProfileClient.tsx](../../frontend/app/(authenticated)/me/knowledge-profile/KnowledgeProfileClient.tsx) — переработан на SkillsTable.
- [PersonKnowledgeProfileClient.tsx](../../frontend/app/(authenticated)/persons/[id]/knowledge-profile/PersonKnowledgeProfileClient.tsx) — переработан на SkillsTable.
- [RegulationsListClient.tsx](../../frontend/app/(authenticated)/regulations/RegulationsListClient.tsx) — chips/history/supersede/toast.
- [IdeasListClient.tsx](../../frontend/app/(authenticated)/ideas/IdeasListClient.tsx) — tabs/clusters/EmptyState/IDEA_STATUS_TRANSITIONS/ConfirmDialog.
- [idea.ts](../../frontend/src/domain/idea.ts) — domain types + transitions.
- [entity.ts](../../frontend/src/domain/entity.ts), [entities.api.ts](../../frontend/src/api/entities.api.ts) — новые.
- [entities/page.tsx](../../frontend/app/(authenticated)/entities/page.tsx), [EntitiesListClient.tsx](../../frontend/app/(authenticated)/entities/EntitiesListClient.tsx) — новая master-detail страница.
- [useMemoryAccess.ts](../../frontend/src/hooks/useMemoryAccess.ts) — новый hook.
- [admin-memory-access.api.ts](../../frontend/src/api/admin-memory-access.api.ts) — новый.
- [settings/admin/memory-access/](../../frontend/app/(authenticated)/settings/admin/memory-access/) — новая страница (page.tsx + MemoryAccessClient.tsx).
- [SettingsSidebar.tsx](../../frontend/app/(authenticated)/settings/SettingsSidebar.tsx) — пункт «Доступ к памяти».
- [entitlement.ts](../../frontend/src/domain/entitlement.ts) — 2 новых feature-ключа.

### Решения по ходу реализации

1. **«member» роли в Z нет** — реализовали через `useMemoryAccess`:
   manager+ всегда видят, на будущий `member` — entitlement-флаги.
2. **policy.csv обновлён** — manager получил read на regulation/process/policy.
3. **Без новых guards** — `OrgAdminGuard` + существующий RBAC достаточны.
4. **Sidebar subgroups** — `collapsibleSubgroup?` → `collapsibleSubgroups?: NavSubgroup[]`
   с поддержкой `storageKey` для localStorage-персистентности.
5. **PolicySeverity** — реальный API использует `advisory/mandatory/blocking`
   (не `critical/high/medium/low` из ТЗ).
6. **`/persons/[id]/knowledge-profile`** — переведён на SkillsTable read-only.
7. **`/me/clone` → `/clones`** — исправлена битая ссылка.
8. **Hooks rules** — `useMemo` для `allLinks` перенесён до раннего return.

---

# ТЗ: Раздел «Память компании» — 6 UI-задач

## Реальное состояние на 2026-05-26 (доработка плана)

После аудита кодовой базы выяснено следующее — **корректирует scope ТЗ**:

### Что уже есть (черновые версии — нужно довести до ТЗ)

| Маршрут | Файл | Состояние |
|---|---|---|
| `/regulations` | [RegulationsListClient.tsx](../../frontend/app/(authenticated)/regulations/RegulationsListClient.tsx) | Базовый master-detail. Нет: pill-кнопки kind, severity-chip для policy, секция «Шаги процесса» по ТЗ, история версий, supersede-кнопка, "Подтвердить" toast через sonner |
| `/ideas` | [IdeasListClient.tsx](../../frontend/app/(authenticated)/ideas/IdeasListClient.tsx) | Базовый master-detail. Нет: вкладка «По кластерам», поддерживающие с person/customer, IDEA_STATUS_TRANSITIONS (показывает все статусы), ConfirmDialog для status, EmptyState компонент |
| `/entities/[id]/graph` | Существует | Граф для **одной** сущности |
| `/me/knowledge-profile` | [KnowledgeProfileClient.tsx](../../frontend/app/(authenticated)/me/knowledge-profile/KnowledgeProfileClient.tsx) | Список карточек, нужна **таблица** |
| `/persons/[id]/knowledge-profile` | Существует | Тоже карточки |

### Что отсутствует полностью

- **`/entities`** — нет index-страницы (список + детали). Только `[id]/graph`.
- **Подгруппа «Память» в Sidebar** — пункты разбросаны в COMPANY_GROUP.
- **`useMemoryAccess`, `/settings/admin/memory-access`** — не существует.

### RBAC-модель Z vs термин «member» из ТЗ

В Z есть **4 роли:** `owner`, `admin`, `manager`, `coo`. Роли **`member`** не существует (см. [schema.prisma:174](../../backend/prisma/schema.prisma#L174)).

**Маппинг ТЗ → Z:**
- ТЗ «member» (Teamly-роль рядового сотрудника) → нет аналога в Z. Будущий нижний уровень.
- ТЗ «manager» → текущий `manager` в Z.
- ТЗ «admin/owner/coo» → текущий `owner/admin/coo` в Z.

**Текущий policy.csv** для `regulation`/`policy`/`process`:
- read разрешён только `owner`/`admin`/`coo`. **`manager` не имеет read.**

**Что меняем в RBAC:**
- Добавить `manager` read для `regulation`/`policy`/`process` (соответствует ТЗ-матрице «manager ✅ видит правила»).
- Для `entity` — `manager` уже имеет read (ничего не меняем).
- Для `idea` — `manager` уже имеет read+write (write остаётся, ТЗ говорит status-change только owner/admin — но это работа сервиса; ради простоты не сужаем).

**Что НЕ меняем в RBAC:**
- Не добавляем новые guards `MemoryRegulationsGuard`/`MemoryEntitiesGuard` — лишний слой. Существующего RBAC достаточно. Entitlement-ключи добавляем для будущего `member` (когда появится).
- Не сужаем существующие права (никто не теряет доступ).

### Adjusted backend-scope для Задачи 6

1. ✅ Добавить `feature.memory_regulations_for_members` и `feature.memory_entities_for_members` в `FeatureKey` (default `false`).
2. ✅ Создать org-admin endpoint `GET/PATCH /api/v1/admin/org/memory-access` — UI-обвязка над `setOverride`.
3. ✅ Обновить policy.csv: `manager` read для `regulation` / `process` / `policy`.
4. ❌ Не добавляем `MemoryRegulationsGuard` / `MemoryEntitiesGuard`. RBAC достаточен.
5. Frontend хук `useMemoryAccess`:
   - Если `currentOrgRole ∈ {owner, admin, manager, coo}` → доступ есть.
   - Иначе (будущий `member`) → проверить entitlement (через существующий `useEntitlement`).

### Adjusted порядок реализации (волны)

#### Волна 1 (видимое сразу)
1.1. Sidebar: подгруппа «Память компании».
1.2. SkillsTable + перевод `/me/knowledge-profile` и `/persons/[id]/knowledge-profile`.
1.3. `/regulations` — довести до ТЗ (chips, история, supersede-dialog, toast).

#### Волна 2 (фичи и backend)
2.1. `/ideas` — вкладка «По кластерам», EmptyState, IDEA_STATUS_TRANSITIONS-логика, ConfirmDialog.
2.2. Backend: 2 entitlement-ключа + admin endpoint + policy.csv (manager read regulation/process/policy).

#### Волна 3
3.1. `useMemoryAccess` hook, sidebar-guard, страница `/settings/admin/memory-access`.
3.2. `/entities` index — list + detail + links (master-detail).
3.3. Финальная проверка: `bun run typecheck`, `bun run lint`.

---

## Контекст

Конкурент Teamly предлагает пользователям wiki-интерфейс с деревом «Пространство → Раздел → Статья». Их «статья» — это человеко-написанный текст. У нас аналоги создаёт AI автоматически (Specialist 3.1 → Регламенты, Specialist 3.3 → Решения, Specialist 3.5 → Инсайты, Specialist 3.6 → Идеи) — но пользователь не видит результата.

**Цель:** сделать базу знаний Z видимой — как у Teamly, но без ручного труда.

**Ключевой факт:** весь backend для всех 5 задач уже готов. Это чисто frontend-работа.

---

## Scope — что делаем

| # | Задача | Маршрут | Приоритет |
|---|---|---|---|
| 1 | Страница «Правила, процессы и политики» | `/regulations` | P0 |
| 2 | Страница «Идеи» | `/ideas` | P0 |
| 3 | Страница «Сущности» (Entity browser) | `/entities` | P1 |
| 4 | Переработка «Профиль знаний» → таблица скиллов | `/me/knowledge-profile` | P0 |
| 5 | Подгруппа «Память» в сайдбаре | `Sidebar.tsx` | P0 |
| 6 | Разграничение доступа к разделам «Памяти» | `/settings/admin` + backend | P0 |

## Что не делаем

- Не делаем редактор статей (ручной ввод) — это отдельное ТЗ
- Не делаем граф-визуализацию (только список + detail на `/entities`)
- Не делаем страницу `/processes/templates` в этом ТЗ (только интеграция процессов в `/regulations`)
- Не трогаем `/decisions`, `/insights`, `/themes` — они работают, доступ к ним остаётся текущим (все роли видят)

---

## Общие соглашения

**Архитектура (frontend-rules):**
- `src/api/*.api.ts` — вызовы через `apiClient`, возвращают ApiDto
- `src/domain/*.ts` — маппер `mapX(dto) → DomainModel`
- Компоненты получают DomainModel, не ApiDto
- Данные через SWR (`useSWR`)

**Компоненты-переиспользуемые (уже есть):**
- `<QueryGate>` — оборачивает loading/error/empty/content
- `<EmptyState>` — пустой список
- `<Chip>` — цветной статусный пилюль
- `<ConfirmDialog>` — модалка подтверждения
- `AdminLoading`, `AdminError`, `AdminForbidden` — заглушки состояний

**UX-паттерн master-detail (как у `/decisions`):**
- Desktop: два столбца (`grid-cols-2 md:grid-cols-[320px_1fr]`)
- Mobile: список → клик → detail (используем `useIsMobile()`)
- Фильтры — pill-кнопки + `<Input>` поиск сверху

**Язык:** только русский. Ни одного английского слова в UI.

---

## Задача 1: `/regulations` — Правила, процессы и политики

### Что показываем

Единая страница с тремя типами содержимого (`kind`). Названия в UI намеренно широкие — чтобы любая компания узнала свои документы вне зависимости от того, как она их называет:

| `kind` в API | Название в UI | Что сюда попадает |
|---|---|---|
| `regulation` | **Правила и стандарты** | регламент, стандарт, норма, методика, требование, правило |
| `process` | **Процессы и инструкции** | SOP, инструкция, процедура, технологическая карта, руководство |
| `policy` | **Политики и положения** | политика, положение, ЛНА, кодекс, порядок |

Аналог «статьи» Teamly типа «Правило/Инструкция». Классификацию определяет AI (Specialist 3.1) из контекста — пользователь не выбирает тип вручную.

### API контракт

```
GET  /api/v1/regulations
     ?q=string
     &kind=regulation|process|policy
     &status=active|deprecated|archived
     &scope=string
     &page=1&limit=50

GET  /api/v1/regulations/:id
GET  /api/v1/regulations/:id/history
POST /api/v1/regulations/:id/confirm      body: { kind }
POST /api/v1/regulations/:id/supersede   body: { kind, supersededByRegulationId }
```

**Ответ списка (`RegulationListItemDto`):**
```ts
{
  id, kind, name, statement, scope, status,
  severity,          // только policy: 'critical' | 'high' | 'medium' | 'low'
  ownerPersonId,
  confidence,
  lastConfirmedAt,
  updatedAt, createdAt
}
```

**Ответ детали (`RegulationDetailDto`):**
```ts
{
  ...ListItem,
  contentMd,         // markdown-текст регламента/политики
  sourceBlockIds,    // ID блоков-источников (встречи, из которых извлечён)
  personSubjectIds,
  currentVersionId,
  steps?,            // только для kind='process': ProcessStepDto[]
  supersedesId?
}

ProcessStepDto: { id, order, name, description, slaMinutes }
```

### Файловая структура

```
frontend/app/(authenticated)/regulations/
  page.tsx                          ← Server Component (metadata)
  RegulationsClient.tsx             ← главный Client Component

frontend/src/api/
  regulations.api.ts                ← вызовы API

frontend/src/domain/
  regulation.ts                     ← mapper + типы DomainModel

frontend/src/hooks/
  useRegulations.ts                 ← SWR-хуки
```

### Domain-типы

```ts
// src/domain/regulation.ts

export type RegulationKind = 'regulation' | 'process' | 'policy';
export type RegulationStatus = 'active' | 'deprecated' | 'archived';
export type PolicySeverity = 'critical' | 'high' | 'medium' | 'low';

export const REGULATION_KIND_LABEL: Record<RegulationKind, string> = {
  regulation: 'Правила и стандарты',
  process: 'Процессы и инструкции',
  policy: 'Политики и положения',
};

export const REGULATION_STATUS_LABEL: Record<RegulationStatus, string> = {
  active: 'Действует',
  deprecated: 'Устарел',
  archived: 'Архив',
};

export const REGULATION_STATUS_CHIP: Record<RegulationStatus, ChipVariant> = {
  active: 'success',
  deprecated: 'warning',
  archived: 'sand',
};

export const POLICY_SEVERITY_LABEL: Record<PolicySeverity, string> = {
  critical: 'Критическая',
  high: 'Высокая',
  medium: 'Средняя',
  low: 'Низкая',
};

export const POLICY_SEVERITY_CHIP: Record<PolicySeverity, ChipVariant> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'success',
};

export interface RegulationListItem {
  id: string;
  kind: RegulationKind;
  name: string;
  statement: string | null;
  scope: string | null;
  status: RegulationStatus;
  severity: PolicySeverity | null;
  ownerPersonId: string | null;
  confidence: number | null;
  lastConfirmedAt: Date | null;
  updatedAt: Date;
}

export interface RegulationDetail extends RegulationListItem {
  contentMd: string;
  sourceBlockCount: number;
  steps: ProcessStep[];
  supersedesId: string | null;
  currentVersionId: string | null;
}

export interface ProcessStep {
  id: string;
  order: number;
  name: string;
  description: string | null;
  slaMinutes: number | null;
}

export function mapRegulationListItem(dto: RegulationListItemDto): RegulationListItem { ... }
export function mapRegulationDetail(dto: RegulationDetailDto): RegulationDetail { ... }
```

### UI-компоненты `RegulationsClient.tsx`

**Фильтры (над списком):**
```
[Поиск ____________________] [Все виды ▾] [Все статусы ▾]
```
- `<Input>` debounce 300ms → `q`
- `<Select>` kind: «Все виды», «Правила и стандарты», «Процессы и инструкции», «Политики и положения»
- `<Select>` status: «Действующие», «Устаревшие», «Архив»

**Левая колонка — список:**
```
┌─────────────────────────────────┐
│ [Правила и стандарты][Действует]│
│ Порядок проведения встреч       │
│ Область: Вся компания           │
│ Обновлён: 20.05.2026            │
├─────────────────────────────────┤
│ [Процессы и инструкции][Действ.]│
│ Онбординг нового сотрудника     │
│ 5 шагов · ≈ 3 часа              │
│ Обновлён: 15.05.2026            │
├─────────────────────────────────┤
│ [Политики и положения][Критич.] │
│ Работа с персональными данными  │
│ Область: Все отделы             │
└─────────────────────────────────┘
```
- Chip вида (из `REGULATION_KIND_LABEL`) — нейтральный цвет `info`
- Chip статуса — по `REGULATION_STATUS_CHIP`
- Для policy дополнительный chip severity по `POLICY_SEVERITY_CHIP`
- Для process — подпись «N шагов · ≈ X ч» из `steps.length` и `sum(slaMinutes)/60`

**Правая колонка — деталь:**

```
[Регламент] [Действует]              Подтвердить актуальность ▸
─────────────────────────────────────────────────────────────
Порядок проведения корпоративных встреч
─────────────────────────────────────────────────────────────
Область: Вся компания
Владелец: —  (если ownerPersonId = null)
Последнее подтверждение: 20.05.2026

─── Содержание ───────────────────────────────────────────────

  (рендер contentMd через ReactMarkdown или whitespace-pre-wrap
   если markdown не нужен — просто pre-wrap текст statement)

─── Источники ────────────────────────────────────────────────
  Извлечено из 3 блоков знаний

─── Действия ─────────────────────────────────────────────────
  [Подтвердить актуальность]   [Заменить на новую версию]
```

**Для kind='process' — дополнительная секция «Шаги»:**
```
─── Шаги процесса ────────────────────────────────────────────
  1. Отправить приглашение               (≈ 15 мин)
  2. Подготовить рабочее место           (≈ 2 ч)
  3. Провести вводный инструктаж         (≈ 1 ч)
  4. Выдать доступы                      (≈ 30 мин)
  5. Назначить ментора                   (≈ 15 мин)
```

**Для kind='policy' — секция «Важность»:**
```
─── Важность ─────────────────────────────────────────────────
  [Критическая] — несоблюдение влечёт серьёзные последствия
```

**История версий** — коллапсибл «История изменений» под деталью:
- Загружается по клику `GET /api/v1/regulations/:id/history`
- Список `RegulationVersionItemDto[]` — дата + кем + причина

**Действия:**
- «Подтвердить актуальность» → `POST /api/v1/regulations/:id/confirm { kind }` → toast «Актуальность подтверждена»
- «Заменить на новую версию» → `<ConfirmDialog>` с полем ввода ID нового регламента → `POST /api/v1/regulations/:id/supersede`

**Пустое состояние:**
```
<EmptyState
  title="Регламентов пока нет"
  description="Кора автоматически создаёт регламенты и процессы
               из ваших встреч. Накопится первые обсуждения —
               они появятся здесь."
/>
```

### SWR-хуки (`useRegulations.ts`)

```ts
export function useRegulations(filters: RegulationsFilters) {
  return useSWR(['regulations', filters], () =>
    regulationsApi.list(filters).then(r => ({
      items: r.items.map(mapRegulationListItem),
      total: r.total,
    }))
  );
}

export function useRegulationDetail(id: string | null) {
  return useSWR(id ? ['regulation', id] : null, () =>
    regulationsApi.get(id!).then(mapRegulationDetail)
  );
}

export function useRegulationHistory(id: string | null, open: boolean) {
  return useSWR(id && open ? ['regulation-history', id] : null, () =>
    regulationsApi.history(id!)
  );
}
```

---

## Задача 2: `/ideas` — Идеи и кластеры

### Что показываем

Реестр идей сотрудников и запросов клиентов, сгруппированных в кластеры. Аналог «Идей» в Teamly — только у нас они извлечены из встреч, а не введены вручную.

### API контракт

```
GET  /api/v1/ideas
     ?kind=internal|client_request
     &status=captured|in_discussion|accepted|in_progress|shipped|rejected|archived
     &q=string
     &clusterId=string
     &page=1&limit=50

GET  /api/v1/ideas/:id
GET  /api/v1/me/ideas?role=author|supporter&page=1&limit=50

GET  /api/v1/idea-clusters?page=1&limit=50
GET  /api/v1/idea-clusters/:id

POST /api/v1/ideas/:id/status   body: { newStatus, reason? }
POST /api/v1/ideas/:id/support
```

**Ответ `IdeaListItemDto`:**
```ts
{
  id, kind, status, statement, rationale,
  weight,          // float: вес идеи (поддержки + свежесть + специфичность)
  supporterCount,
  clusterId,
  firstProposedAt, lastDiscussedAt,
  createdByUserId
}
```

**Ответ `IdeaDetailDto`:**
```ts
{
  ...ListItem,
  supporters: IdeaSupporterDto[],  // { kind, entityId, firstSupportedAt }
  sourceBlockIds,
  personSubjectIds,
  statusChangedAt, statusChangedByUserId, statusReason,
  confidence, dataClass
}
```

**Ответ `IdeaClusterDto`:**
```ts
{
  id, name, description,
  ideaIds,        // string[]
  clusterWeight,
  createdAt, updatedAt
}
```

### Файловая структура

```
frontend/app/(authenticated)/ideas/
  page.tsx
  IdeasClient.tsx               ← главный компонент с табами

frontend/src/api/
  ideas.api.ts

frontend/src/domain/
  idea.ts

frontend/src/hooks/
  useIdeas.ts
```

### Domain-типы

```ts
// src/domain/idea.ts

export type IdeaKind = 'internal' | 'client_request';
export type IdeaStatus =
  | 'captured' | 'in_discussion' | 'accepted'
  | 'in_progress' | 'shipped' | 'rejected' | 'archived';

export const IDEA_KIND_LABEL: Record<IdeaKind, string> = {
  internal: 'Внутренняя',
  client_request: 'Запрос клиента',
};

export const IDEA_STATUS_LABEL: Record<IdeaStatus, string> = {
  captured: 'Зафиксирована',
  in_discussion: 'Обсуждается',
  accepted: 'Принята',
  in_progress: 'В работе',
  shipped: 'Выпущена',
  rejected: 'Отклонена',
  archived: 'В архиве',
};

export const IDEA_STATUS_CHIP: Record<IdeaStatus, ChipVariant> = {
  captured: 'sand',
  in_discussion: 'info',
  accepted: 'lavender',
  in_progress: 'warning',
  shipped: 'success',
  rejected: 'danger',
  archived: 'sand',
};

// Статусы, в которые можно перевести из текущего
export const IDEA_STATUS_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  captured: ['in_discussion', 'accepted', 'rejected'],
  in_discussion: ['accepted', 'rejected'],
  accepted: ['in_progress', 'rejected'],
  in_progress: ['shipped', 'rejected'],
  shipped: [],
  rejected: ['archived'],
  archived: [],
};

export interface IdeaListItem {
  id: string;
  kind: IdeaKind;
  status: IdeaStatus;
  statement: string;
  rationale: string | null;
  weight: number;
  supporterCount: number;
  clusterId: string | null;
  firstProposedAt: Date;
  lastDiscussedAt: Date;
}

export interface IdeaDetail extends IdeaListItem {
  supporters: IdeaSupporter[];
  sourceBlockCount: number;
  statusReason: string | null;
  statusChangedAt: Date | null;
  confidence: number;
}

export interface IdeaSupporter {
  kind: 'person' | 'customer';
  entityId: string;
  firstSupportedAt: Date;
}

export interface IdeaCluster {
  id: string;
  name: string;
  description: string | null;
  ideaCount: number;
  clusterWeight: number;
}
```

### UI-компоненты `IdeasClient.tsx`

**Вкладки (tabs) сверху:**
```
[Все идеи]   [По кластерам]   [Мои идеи]
```

**Вкладка «Все идеи» — master-detail:**

Фильтры:
```
[Поиск ___________] [Все виды ▾] [Все статусы ▾]
```
- kind: «Все», «Внутренние», «Запросы клиентов»
- status: все 7 статусов + «Все»

Список (левая колонка):
```
┌────────────────────────────────────────┐
│ [Внутренняя]  [В работе]   ↑↑ 12 ★    │
│ Добавить видео-инструкцию              │
│  к онбордингу нового клиента           │
│ Впервые: 01.05 · Последнее: 20.05      │
├────────────────────────────────────────┤
│ [Запрос клиента]  [Зафиксирована] ↑ 3  │
│ Интеграция с 1С через API              │
│ Впервые: 15.05 · Последнее: 25.05      │
└────────────────────────────────────────┘
```
- `↑↑ 12 ★` — weight из `weight` поля (иконка огня/стрелки по значению)
- `12 ★` = количество поддержавших (`supporterCount`)
- Сортировка по умолчанию: `weight DESC`

Деталь (правая колонка):
```
[Внутренняя]  [В работе]                Поддержать ▸
────────────────────────────────────────────────────
Добавить видео-инструкцию к онбордингу нового клиента
────────────────────────────────────────────────────
Обоснование:
  «Клиенты часто путаются на шаге настройки — нужен
   наглядный материал»

Поддерживают (3):
  · Сотрудник из 3 встреч
  · Клиент «ООО Альфа»

Источники: извлечено из 5 блоков знаний
Уверенность AI: 87%

─── Изменить статус ──────────────────────────────
[В обсуждение]  [Принять]  [Отклонить]

─── Причина последнего изменения ─────────────────
  —
```

**Кнопка «Поддержать»:**
- Только для авторизованного пользователя
- `POST /api/v1/ideas/:id/support`
- После поддержки: кнопка меняется на «Вы поддержали», `supporterCount++`

**Изменение статуса:**
- Показываем только доступные переходы из `IDEA_STATUS_TRANSITIONS[current]`
- Клик → `<ConfirmDialog>` с textarea «Причина» (опц.) → `POST /api/v1/ideas/:id/status`

**Вкладка «По кластерам»:**
```
┌─────────────────────────────────────────────────────┐
│ 🔵 Онбординг клиентов                   вес: 8.4   │
│ 5 идей · «Улучшить процесс знакомства...»           │
│                                          [Раскрыть] │
├─────────────────────────────────────────────────────┤
│ 🟠 Интеграции и API                     вес: 5.1   │
│ 3 идеи · «Клиенты запрашивают подключение...»       │
│                                          [Раскрыть] │
└─────────────────────────────────────────────────────┘
```
- Карточки кластеров `IdeaCluster`
- «Раскрыть» → показывает список `IdeaListItem[]` из кластера под ним (фильтруем весь список по `clusterId`)
- Клик на идею внутри → открывает деталь в правой панели

**Вкладка «Мои идеи»:**
- Переключатель: «Я автор» / «Я поддержал»
- `GET /api/v1/me/ideas?role=author|supporter`
- Тот же master-detail

**Пустое состояние:**
```
<EmptyState
  title="Идей пока нет"
  description="Кора фиксирует идеи и запросы из ваших встреч
               и разговоров. Поговорите о новых функциях или
               улучшениях — они появятся здесь."
/>
```

---

## Задача 3: `/entities` — Сущности (второй мозг)

### Что показываем

Реестр всех сущностей, которые AI выделил из встреч и разговоров: компании, люди, проекты, продукты, поставщики, технологии, темы. Аналог «Записей о людях / компаниях» в Teamly.

### API контракт

```
GET  /api/v1/knowledge/entities
     ?type=person|customer|vendor|project|product|topic|technology|location|metric|event
     &q=string
     &includeMerged=false
     &limit=20&offset=0

GET  /api/v1/knowledge/entities/:id
     → { entity: EntityItemDto, blocks: BlockSearchItemDto[] }

GET  /api/v1/knowledge/entities/:id/links
     → { outgoing: EntityLinkItemDto[], incoming: EntityLinkItemDto[] }
```

**`EntityItemDto`:**
```ts
{
  id, type, canonicalName,
  aliases: string[],
  mentionsCount,
  metadata: Record<string, unknown> | null
}
```

**`EntityDetailDto`:**
```ts
{
  entity: EntityItemDto,
  blocks: BlockSearchItemDto[]   // top-20 канонических блоков
}
```

**`BlockSearchItemDto`:**
```ts
{
  id, name, criticalQuestion, trustedAnswer,
  signalType, tags, confidence,
  evidenceCount, status, createdAt
}
```

**`EntityLinkItemDto`:**
```ts
{
  id, fromEntityId, toEntityId,
  relationType,   // works_at | belongs_to | part_of | opposes | depends_on | mentions_with
  confidence, explanation, status, createdBy,
  other: { entityId, type, canonicalName }
}
```

### Файловая структура

```
frontend/app/(authenticated)/entities/
  page.tsx
  EntitiesClient.tsx

frontend/src/api/
  entities.api.ts

frontend/src/domain/
  entity.ts

frontend/src/hooks/
  useEntities.ts
```

### Domain-типы

```ts
// src/domain/entity.ts

export type EntityType =
  | 'person' | 'customer' | 'vendor' | 'project'
  | 'product' | 'topic' | 'technology' | 'location'
  | 'metric' | 'event';

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  person: 'Человек',
  customer: 'Клиент',
  vendor: 'Поставщик',
  project: 'Проект',
  product: 'Продукт',
  topic: 'Тема',
  technology: 'Технология',
  location: 'Локация',
  metric: 'Метрика',
  event: 'Событие',
};

export const ENTITY_TYPE_ICON: Record<EntityType, string> = {
  person: '👤',
  customer: '🏢',
  vendor: '🤝',
  project: '📁',
  product: '📦',
  topic: '💡',
  technology: '⚙️',
  location: '📍',
  metric: '📊',
  event: '📅',
};

export const ENTITY_LINK_RELATION_LABEL: Record<string, string> = {
  works_at: 'работает в',
  belongs_to: 'относится к',
  part_of: 'часть',
  opposes: 'противоречит',
  depends_on: 'зависит от',
  mentions_with: 'упоминается вместе с',
};

export const SIGNAL_TYPE_LABEL: Record<string, string> = {
  fact: 'Факт',
  decision: 'Решение',
  regulation: 'Регламент',
  process_step: 'Шаг процесса',
  pain: 'Боль',
  risk: 'Риск',
  churn_risk: 'Риск оттока',
  objection: 'Возражение',
  idea: 'Идея',
  feature_request: 'Запрос функции',
  reasoning: 'Обоснование',
  rationale: 'Мотивация',
  decision_basis: 'Основание',
  knowledge_gap: 'Пробел знаний',
};

export interface EntityListItem {
  id: string;
  type: EntityType;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
}

export interface EntityDetail extends EntityListItem {
  metadata: Record<string, unknown> | null;
  blocks: KnowledgeBlock[];
  links: EntityLinks;
}

export interface KnowledgeBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  confidence: number;
  evidenceCount: number;
  createdAt: Date;
}

export interface EntityLinks {
  outgoing: EntityLink[];
  incoming: EntityLink[];
}

export interface EntityLink {
  id: string;
  relationType: string;
  confidence: number;
  explanation: string;
  other: { entityId: string; type: EntityType; canonicalName: string };
  direction: 'outgoing' | 'incoming';
}
```

### UI-компоненты `EntitiesClient.tsx`

**Фильтры (горизонтальные tabs по типу):**
```
[Все]  [Люди]  [Клиенты]  [Проекты]  [Продукты]  [Поставщики]  [Темы]  [Технологии]
```
- На mobile: горизонтальный скролл `overflow-x-auto scrollbar-none snap-x`
- Выбранный tab: `border-accent bg-accent/10`

Плюс строка поиска:
```
[🔍 Поиск по названию и псевдонимам _____________]
```

**Список (левая колонка):**
```
┌────────────────────────────────────┐
│ 👤 Иванов Алексей                  │
│    Упоминаний: 34 · Человек        │
├────────────────────────────────────┤
│ 🏢 ООО Альфа                       │
│    Упоминаний: 23 · Клиент         │
│    alias: Альфа, Alpha LLC         │
├────────────────────────────────────┤
│ 📁 Проект Кора                     │
│    Упоминаний: 18 · Проект         │
└────────────────────────────────────┘
```
- Сортировка по `mentionsCount DESC`
- Пагинация offset-based: «Показать ещё» внизу (increment offset на 20)

**Деталь (правая колонка):**
```
👤 Человек                          [Пометить неверным]
────────────────────────────────────────────────────────
Иванов Алексей

Псевдонимы: Алексей, Алексей И., A. Ivanov

Упоминания в базе знаний: 34

─── Связи ──────────────────────────────────────────────
  ⟶ работает в  «ООО Альфа»     (уверенность 94%)
  ⟶ зависит от  «Проект Кора»   (уверенность 78%)
  ← упоминается вместе с «Иванова Мария» (82%)

─── Блоки знаний (последние 5) ─────────────────────────
  [Факт]     «Алексей провёл демо для клиента»
             «Вопрос: что обсудил? Ответ: возможности интеграции»
             3 источника · 25.05.2026

  [Решение]  «Алексей назначен владельцем проекта»
             «Вопрос: кто отвечает? Ответ: Алексей И.»
             1 источник · 20.05.2026

  [Показать все 34 →]    ← ведёт на /me/knowledge-profile или поиск
```

**Блок «Связи»:**
- Исходящие + входящие из `EntityLinksResultDto`
- `relationType` переводим через `ENTITY_LINK_RELATION_LABEL`
- Confidence показываем только если `>= 0.85` (иначе не показываем)
- Клик на имя связанной сущности → `setSelectedId(other.entityId)` (переход к ней в списке)

**Блок «Блоки знаний»:**
- Первые 5 из `EntityDetailDto.blocks`
- Каждый блок: chip `signalType`, `name`, `trustedAnswer` (обрезан до 120 символов), `evidenceCount`, `createdAt`
- «Показать все N →» — раскрывает полный список прямо в деталях (аккордеон)

**Пустое состояние:**
```
<EmptyState
  title="Сущностей пока нет"
  description="Кора выделяет компании, людей, проекты и продукты
               из ваших встреч. Они появятся здесь после первых
               обработанных материалов."
/>
```

---

## Задача 4: `/me/knowledge-profile` — Таблица скиллов

### Текущее состояние

Файл: [frontend/app/(authenticated)/me/knowledge-profile/KnowledgeProfileClient.tsx](../../frontend/app/(authenticated)/me/knowledge-profile/KnowledgeProfileClient.tsx)

Сейчас: карточки `<Card>` на каждую категорию, вертикальный скролл, blockquote-цитаты под каждой карточкой. Неудобно для быстрого обзора 10+ компетенций.

API: `GET /api/v1/me/knowledge-profile` (существует), `POST /api/v1/me/knowledge-profile/mark-wrong` (существует).

### Что меняем

Заменяем список карточек на **таблицу** с коллапсибл строками. Никаких изменений API.

Данные `KnowledgeProfileCategory`:
```ts
{
  name: string;               // компетенция
  confidence: 'high' | 'medium' | 'low';
  observationCount: number;
  lastObservedAt: Date;
  sampleStatements: Array<{ blockId: string; quote: string }>;
}
```

### Новый UI

**Заголовок и мета (без изменений):**
```
Что Кора знает обо мне
Обновлён: 25.05.2026 · Версия: 7 · Областей: 12
```

**Таблица компетенций:**

```
┌────────────────────────┬──────────┬────────┬───────────────┬───────────────┐
│ Компетенция            │ Уровень  │ Набл.  │ Последнее     │               │
├────────────────────────┼──────────┼────────┼───────────────┼───────────────┤
│ ▶ Продажи B2B          │ ●●● Выс. │   12   │ 3 дня назад   │ [Неверно]    │
│ ▶ NestJS / TypeScript  │ ●●○ Сред.│    4   │ 2 нед назад   │ [Неверно]    │
│ ▶ Переговоры           │ ●○○ Низ. │    2   │ 1 мес назад   │ [Неверно]    │
└────────────────────────┴──────────┴────────┴───────────────┴───────────────┘
```

- **▶** — раскрывает/сворачивает строку (аккордеон)
- **Уровень** — кружочки: high = `●●●`, medium = `●●○`, low = `●○○` + текст
- **Набл.** — `observationCount`
- **Последнее** — relative time: «3 дня назад», «2 нед назад»
- **[Неверно]** — кнопка-ссылка `variant="ghost" size="sm"` открывает `MarkWrongDialog`

**Раскрытая строка (accordion):**
```
┌────────────────────────────────────────────────────────┐
│ ▼ Продажи B2B          │ ●●● Выс. │ 12 │ 3 дня │ [Неверно] │
│   ─────────────────────────────────────────────────────│
│   «Алексей провёл демо-встречу и закрыл сделку»        │
│   «В переговорах с ООО Альфа применил SPIN-методику»   │
│   «Рассказал о том, как делать follow-up после встречи»│
└────────────────────────────────────────────────────────┘
```
- Цитаты (`sampleStatements[].quote`) под основной строкой
- Каждая цитата — `border-l-2 border-accent/30 pl-3 text-sm text-fg-secondary`
- Раскрытие через `useState<string | null>(expandedCategory)`

**Сортировка по умолчанию:** `high → medium → low`, внутри уровня — `observationCount DESC`

**Секция «Значимый опыт»** (под таблицей, без изменений):
```
Значимый опыт
• Провёл более 20 встреч с enterprise-клиентами
• Участвовал в запуске продукта Кора
```

**«Попробовать клона»** — блок внизу (без изменений, исправить ссылку: `/me/clone` → `/clones`)

**Та же логика для `/persons/[id]/knowledge-profile`:**
- Та же таблица, но `read-only` (без кнопок «Неверно»)
- `visibility` фильтр: member видит только публичные скиллы

### Компонент `SkillsTable.tsx`

Новый shared-компонент `frontend/src/ui/knowledge/SkillsTable.tsx`:

```tsx
interface SkillsTableProps {
  categories: KnowledgeProfileCategory[];
  onMarkWrong?: (cat: KnowledgeProfileCategory) => void; // undefined = read-only
}
```

Используется в обоих компонентах: `KnowledgeProfileClient` (с onMarkWrong) и `PersonKnowledgeProfileClient` (без onMarkWrong).

---

## Задача 5: Подгруппа «Память» в сайдбаре

### Текущее состояние

Файл: `frontend/src/ui/components/app-shell/Sidebar.tsx`

Текущий COMPANY_GROUP содержит 20+ пунктов подряд без разбивки. Пункты `/regulations`, `/decisions`, `/insights`, `/ideas`, `/themes` там уже есть, но теряются среди `/structure`, `/company`, `/departments`, `/domains` и т.д.

### Что меняем

Добавляем коллапсибл-подгруппу «Память» внутри COMPANY_GROUP. Остальные пункты группы не трогаем.

**Структура подгруппы «Память»:**
```
▼ Память компании
    ◦ Темы                   /themes         (gateFeature: 'feature.theme')
    ◦ Регламенты             /regulations
    ◦ Решения                /decisions
    ◦ Сигналы                /insights
    ◦ Идеи                   /ideas
    ◦ Сущности               /entities       (новый пункт)
```

**Визуально:**
- Заголовок подгруппы: `text-xs font-medium text-fg-tertiary uppercase tracking-wider px-3 py-2`
- Треугольник `▼ / ▶` — collapsible (по умолчанию раскрыт)
- Состояние раскрытия: `localStorage('sidebar.memory.open')` — сохраняется между сессиями

**Изменения в сайдбаре:**
1. Убрать `/regulations`, `/decisions`, `/insights`, `/ideas`, `/themes` из основного COMPANY_GROUP
2. Добавить коллапсибл-блок `MemorySubGroup` с этими 6 пунктами
3. Вставить `MemorySubGroup` на место первого удалённого пункта (после `/events`)
4. Добавить новый пункт `/entities` — «Сущности», иконка `Network` из lucide-react

**Убрать `comingSoon: true`** с `/processes` — страница processes будет как отдельное ТЗ позже.

---

## Задача 6: Разграничение доступа к разделам «Памяти»

### Принцип

Не все сотрудники должны видеть все разделы. «Правила и стандарты» — это внутренние документы с нормами: их лучше открывать менеджерам и выше. Идеи — наоборот, ценны тем, что их видят и поддерживают все. Сущности — граф знаний, чувствительный для обычных участников.

**Правило проектирования:** admin может только расширять доступ (дать member доступ к закрытому разделу), но не сужать (нельзя закрыть ideas от менеджера).

### Матрица доступа по умолчанию

| Раздел | `member` | `manager` | `admin` / `owner` / `coo` |
|---|---|---|---|
| Правила и стандарты — просмотр | ❌ | ✅ | ✅ |
| Правила и стандарты — подтвердить / заменить | ❌ | ❌ | ✅ |
| Идеи — просмотр + поддержать | ✅ | ✅ | ✅ |
| Идеи — изменить статус | ❌ | ✅ | ✅ |
| Сущности — просмотр | ❌ | ✅ | ✅ |
| Профиль знаний (свой) | ✅ | ✅ | ✅ |
| Профиль знаний (коллеги) | ❌ | ✅ (только подчинённые) | ✅ |

> `/decisions`, `/insights`, `/themes` — без изменений, текущий доступ (все роли).

### Что может настроить admin Org

Два переключателя в настройках орга: открыть ли раздел для роли `member`. Действия (подтвердить, заменить статус) остаются только для manager+ вне зависимости от настроек.

| Настройка | Ключ entitlement | Default |
|---|---|---|
| «Правила и стандарты» видят все | `feature.memory_regulations_for_members` | `false` |
| «Сущности» видят все | `feature.memory_entities_for_members` | `false` |

### Backend — что добавить

> ⚠️ Это единственная задача этого ТЗ, где нужен новый backend-код.

**1. Новые entitlement-ключи** — добавить в `EntitlementKey` enum
(`backend/src/modules/entitlements/entitlement-key.enum.ts` или аналог):
```ts
'feature.memory_regulations_for_members'
'feature.memory_entities_for_members'
```

**2. Два новых guard'а** (или расширение существующего `RbacGuard`):

`MemoryRegulationsGuard`:
```ts
// Пропускает если role >= manager
// Если role = member → проверяет entitlementsService.hasFeature(orgId,
//   'feature.memory_regulations_for_members')
// Иначе → 403
```

`MemoryEntitiesGuard`:
```ts
// Та же логика для feature.memory_entities_for_members
```

**3. Применить guard'ы к контроллерам:**
- `RegulationsController` — `@UseGuards(MemoryRegulationsGuard)` на весь контроллер
- `EntitiesController` (`/api/v1/knowledge/entities`) — `@UseGuards(MemoryEntitiesGuard)`
- `IdeasController` — без нового guard'а, `member` уже имеет `read`
  - Только `POST /api/v1/ideas/:id/status` — дополнительно `@Roles('manager', 'admin', 'owner', 'coo')`

**4. Новый org-admin endpoint** для настройки из UI:
```
GET   /api/v1/admin/org/memory-access
      → { regulationsForMembers: boolean, entitiesForMembers: boolean }

PATCH /api/v1/admin/org/memory-access
      body: { regulationsForMembers?: boolean, entitiesForMembers?: boolean }
      guard: OrgAdminGuard (owner + admin)
```
Реализация: читает/пишет entitlement через существующий `EntitlementsService`.

### Frontend — что добавить

**1. API + hook `useMemoryAccess`**

`frontend/src/hooks/useMemoryAccess.ts`:
```ts
// Возвращает { canReadRegulations, canReadEntities }
// Рассчитывается из useAuth():
//   если role >= manager → оба true
//   если role = member → запрашивает GET /api/v1/me/entitlements
//     и проверяет feature.memory_regulations_for_members / feature.memory_entities_for_members
```

**2. Сайдбар** — скрывать пункты недоступных разделов:
```tsx
// В MemorySubGroup:
{canReadRegulations && <NavItem href="/regulations" label="Правила и стандарты" />}
<NavItem href="/ideas" label="Идеи" />         // всегда
{canReadEntities && <NavItem href="/entities" label="Сущности" />}
```

**3. Страницы** — если пользователь прямым URL попадает на закрытый раздел:
- API вернёт 403 → показать `<AdminForbidden title="Раздел недоступен" description="Обратитесь к администратору компании." />`

**4. Страница настроек** — `/settings/admin` → новая вкладка или секция «Доступ к памяти»:

```
Доступ к разделам «Памяти компании»
────────────────────────────────────────────────────────────────
Раздел «Правила и стандарты»
Кто видит: [Менеджеры и выше ▾ / Все участники ▾]  [Сохранить]

По умолчанию видят только менеджеры и выше. Можно открыть всем —
тогда любой сотрудник прочитает правила компании, но изменить их
сможет только менеджер.

────────────────────────────────────────────────────────────────
Раздел «Сущности»
Кто видит: [Менеджеры и выше ▾ / Все участники ▾]  [Сохранить]

Клиенты, проекты, связи между ними. Открывайте всем только если
уверены, что участникам нужна эта информация.

────────────────────────────────────────────────────────────────
Раздел «Идеи»
Все участники (изменить нельзя)
Идеи ценны тем, что их поддерживает вся команда.
```

**Файлы frontend:**
```
frontend/src/hooks/useMemoryAccess.ts               ← новый
frontend/src/api/admin-memory-access.api.ts         ← новый
frontend/app/(authenticated)/settings/admin/
  memory-access/
    page.tsx                                        ← новый
    MemoryAccessClient.tsx                          ← новый
```

### Критерии готовности (Задача 6)

**Backend:**
- [ ] `bun run typecheck` в `backend/` — 0 ошибок
- [ ] 403 при прямом запросе к `/api/v1/regulations` от member без entitlement
- [ ] 200 при запросе от member с entitlement `feature.memory_regulations_for_members=true`
- [ ] `PATCH /api/v1/admin/org/memory-access` меняет entitlement и вступает в силу сразу
- [ ] `POST /api/v1/ideas/:id/status` от member → 403

**Frontend:**
- [ ] Сайдбар не показывает «Правила и стандарты» member-пользователю без entitlement
- [ ] После включения entitlement в настройках — пункт появляется в сайдбаре (SWR revalidate)
- [ ] Прямой URL `/regulations` для member без доступа → страница «Раздел недоступен»
- [ ] Страница `/settings/admin/memory-access` доступна только owner/admin
- [ ] Переключатель сохраняется, toast «Настройки сохранены»

---

## Файловая структура итого

```
frontend/
  app/(authenticated)/
    regulations/
      page.tsx
      RegulationsClient.tsx
    ideas/
      page.tsx
      IdeasClient.tsx
    entities/
      page.tsx
      EntitiesClient.tsx
    me/
      knowledge-profile/
        KnowledgeProfileClient.tsx           ← переработать
    persons/
      [id]/
        knowledge-profile/
          PersonKnowledgeProfileClient.tsx   ← переработать (та же таблица)
    settings/
      admin/
        memory-access/
          page.tsx                           ← новый (Задача 6)
          MemoryAccessClient.tsx             ← новый (Задача 6)

  src/
    api/
      regulations.api.ts             ← новый
      ideas.api.ts                   ← новый
      entities.api.ts                ← новый
      admin-memory-access.api.ts     ← новый (Задача 6)
    domain/
      regulation.ts                  ← новый
      idea.ts                        ← новый
      entity.ts                      ← новый
    hooks/
      useRegulations.ts              ← новый
      useIdeas.ts                    ← новый
      useEntities.ts                 ← новый
      useMemoryAccess.ts             ← новый (Задача 6)
    ui/
      knowledge/
        SkillsTable.tsx              ← новый shared-компонент
    components/
      app-shell/
        Sidebar.tsx                  ← добавить MemorySubGroup + access guard

backend/
  src/modules/
    regulations/
      guards/
        memory-regulations.guard.ts  ← новый (Задача 6)
    knowledge-core/
      guards/
        memory-entities.guard.ts     ← новый (Задача 6)
    admin/
      org/
        memory-access.controller.ts  ← новый (Задача 6)
        memory-access.service.ts     ← новый (Задача 6)
```

---

## Порядок реализации (волны)

### Волна 1 — P0, самое видимое
1. `Sidebar.tsx` — подгруппа «Память» (30 мин)
2. `/me/knowledge-profile` → `SkillsTable` (2–3 ч)
3. `/regulations` — полный master-detail (4–5 ч)

### Волна 2 — P0
4. `/ideas` — tabs + master-detail + support (4–5 ч)
5. Backend: guard'ы + entitlement-ключи + admin endpoint (3–4 ч) — **делать параллельно с волной 2**

### Волна 3 — P0 (доделка доступов) + P1
6. Frontend доступов: `useMemoryAccess` + sidebar guard + страница `/settings/admin/memory-access` (3–4 ч)
7. `/entities` — list + detail + links (4–5 ч)

---

## Критерии готовности (Definition of Done)

### Для каждой страницы:
- [ ] `bun run typecheck` — 0 ошибок
- [ ] `bun run lint` — 0 ошибок
- [ ] Страница открывается без белого экрана
- [ ] Пустое состояние отображается корректно
- [ ] Master-detail работает на desktop (2 колонки)
- [ ] На mobile: список → клик → detail (push-навигация через `useIsMobile`)
- [ ] Фильтры работают и сбрасываются через URL/state
- [ ] Все тексты на русском, ни одного английского слова в UI
- [ ] Loading state — `AdminLoading` или `<Skeleton>`
- [ ] Error state — `AdminError` с кнопкой «Повторить»
- [ ] Toast при успешных действиях (confirm, status change, support)

### Для `/me/knowledge-profile`:
- [ ] Таблица отображает все категории
- [ ] Аккордеон раскрывает цитаты по клику
- [ ] Кнопка «Неверно» открывает модалку
- [ ] Модалка отправляет запрос и показывает toast

### Для Sidebar:
- [ ] Подгруппа «Память» отображается
- [ ] Состояние collapse сохраняется в localStorage
- [ ] Активный пункт подсвечивается корректно
- [ ] Пункт «Сущности» появился и ведёт на `/entities`
- [ ] Member без доступа не видит «Правила и стандарты» и «Сущности»
- [ ] После выдачи entitlement — пункты появляются без перезагрузки страницы

### Для Задачи 6 (доступы):
- [ ] Backend: 403 для member на `/api/v1/regulations` без entitlement
- [ ] Backend: 200 для member с `feature.memory_regulations_for_members=true`
- [ ] Backend: `POST /ideas/:id/status` от member → 403
- [ ] Backend: `PATCH /api/v1/admin/org/memory-access` меняет entitlement немедленно
- [ ] Frontend: `/settings/admin/memory-access` доступна только owner/admin
- [ ] Frontend: переключатель сохраняется + toast «Настройки сохранены»
- [ ] Frontend: `/regulations` напрямую для member без доступа → «Раздел недоступен»

---

## Примечания

**Связанные ТЗ:**
- Ручной ввод текста → pipeline (улучшение `/dump`) — отдельное ТЗ
- Загрузка аудио/видео файлов — отдельное ТЗ
- Граф-визуализация сущностей — отдельное ТЗ
- Страница `/processes/templates` — отдельное ТЗ

**Решения, оставленные на реализацию:**
- `ReactMarkdown` или `whitespace-pre-wrap` для `contentMd` регламентов — по вкусу исполнителя, главное не тащить новую зависимость если `pre-wrap` достаточно
- Infinite scroll vs «Показать ещё» для сущностей — «Показать ещё» проще, достаточно для MVP

[[../../second-brain/index|← index]] · [[../README|← plans]]
