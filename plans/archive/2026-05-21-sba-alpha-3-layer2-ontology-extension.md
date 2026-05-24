---
type: tz
status: superseded
supersededBy: plans/tz/2026-05-23-sba-alpha-3-wave3-axis-classifier-full.md
feature: SBA α-3 — Layer 2 Ontology Extension (онтология 7→12 + новые модели категории A + RouterService)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: alpha
unblocks:
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (Card.kind='vendor')
  - tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md (Regulation specialist использует RouterService)
  - tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md (Person.knowledgeProfile + relationship)
  - tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md
  - tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md (Person.relationship='employee')
covers_matrix_rows: [B1, B2, B3, B4, B5, B6, K1, K2, K3]
---

# ТЗ α-3: Layer 2 — Ontology Extension

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Архитектурное решение:** [§3.2 онтология — три категории классов](2026-05-21-second-brain-agents-umbrella.md#32-%D0%BE%D0%BD%D1%82%D0%BE%D0%BB%D0%BE%D0%B3%D0%B8%D1%8F--%D1%82%D1%80%D0%B8-%D0%BA%D0%B0%D1%82%D0%B5%D0%B3%D0%BE%D1%80%D0%B8%D0%B8-%D0%BA%D0%BB%D0%B0%D1%81%D1%81%D0%BE%D0%B2). Источник классов — [company-ontology.md](../../second-brain/06_marketing/company-ontology.md).
>
> **Контекст для исполнителя:**
> - Текущий Слой 2: [entity-resolution.service.ts](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts) + [entity-merge.service.ts](../../backend/src/modules/knowledge-core/services/entity-merge.service.ts) + воркеры/cron.
> - Существующий паттерн связки модель ↔ Entity: [`Card.entityId`](../../backend/prisma/schema.prisma) (Фаза 4 knowledge-core).
> - `client → customer` rename — это **семантический рефакторинг**, требует patch-script на существующих данных.

---

## 1. Цель

После α-3:
- `Entity.type` enum — 12 значений (`person | customer | vendor | project | product | document | goal | event | topic | location | technology | metric`), `custom` удалён.
- Все существующие `Entity{type='client'}` переименованы в `customer` (patch-script).
- Новые модели категории A: `Vendor`, `Event` (с `entityId` для графа).
- Существующие модели категории A получают поле `entityId?`: `Person`, `Goal`, `Document`, `Product` (если есть отдельная модель).
- `Person.relationship` enum добавлен (нужен для γ-1).
- `Card.kind` расширен `vendor` (для 3.4).
- `RouterService` — диспатчер атомов к специалистам Слоя 3 по `signalType`.
- `EntityResolutionService` расширен на дедуп новых типов.

---

## 2. Зависимости

**Зависит от:** α-2 (новые signalType для RouterService правил).

**Разблокирует:** α-6, α-7, β-2, β-3, γ-1.

---

## 3. Scope

### Входит

- Расширение enum `Entity.type` (см. §4).
- Patch-script `backend/scripts/patch-rename-client-to-customer.ts` (skill `safe-seed-rules`).
- 2 новые модели категории A: `Vendor`, `Event`.
- Расширение существующих моделей категории A полем `entityId?` + миграционный patch-script для бэкфила существующих записей.
- Расширение `Person`: добавление `relationship` enum (`employee` | `external` | `candidate` | `former`).
- Расширение `Card.kind` enum значением `vendor`.
- Расширение `EntityResolutionService` на новые типы.
- Новый модуль `router-service/` в `backend/src/modules/knowledge-core/` (или в knowledge-core как сервис) — `RouterService.dispatch(block)` + BullMQ-очередь `core.specialist-routing`.
- API расширение для новых сущностей: `/api/v1/vendors`, `/api/v1/events` (минимальный CRUD).
- HNSW-индексы для embedding'ов новых моделей (через `apply-postgres-init.sql`).
- RBAC: `vendor`, `event` ResourceType (read — все member'ы; write/delete — owner/admin).

### Не входит

- Carbon-copy для всех 13 классов онтологии — категория C (Decision/Regulation/Risk/Metric) идёт в свои sub-TZ Слоя 3 (α-7, β-3, β-4).
- UI для новых моделей (`/vendors`, `/events`) — задел в навигации, минимальная страница списка (не master-detail).

---

## 4. Модели данных

### 4.1. Расширение enum `Entity.type`

```prisma
enum EntityType {
  person        // было
  customer      // переименовано из 'client'
  vendor        // НОВОЕ
  project       // было
  product       // было
  document      // НОВОЕ
  goal          // НОВОЕ
  event         // НОВОЕ
  topic         // было
  location      // было
  technology    // НОВОЕ
  metric        // НОВОЕ
  // custom УДАЛЕНО
}
```

### 4.2. Новые модели категории A

```prisma
model Vendor {
  id           String   @id @default(uuid())
  tenantId     String
  entityId     String   @unique  // связка с графом
  name         String
  inn          String?
  segment      VendorSegment?    // 'software' | 'hardware' | 'consulting' | 'logistics' | 'other'
  status       VendorStatus      // 'active' | 'evaluating' | 'churned' | 'banned'
  responsibleUserId String?      // кто ведёт со стороны компании
  contractIds  String[]          // ссылки на Document'ы договоров (опц.)
  metadata     Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([tenantId])
}

model Event {
  id           String   @id @default(uuid())
  tenantId     String
  entityId     String   @unique
  kind         EventKind  // 'meeting' | 'incident' | 'release' | 'transition' | 'milestone' | 'other'
  title        String
  startAt      DateTime
  endAt        DateTime?
  durationMin  Int?
  location     String?
  participantsPersonIds String[]  // Person IDs
  relatedMeetingId String?         // ссылка на существующий Meeting если применимо
  outcomeSummary Text?
  metadata     Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([tenantId, startAt])
}
```

### 4.3. Расширение `Person`

```prisma
model Person {
  // ... существующие поля
  entityId         String?   @unique   // ДОБАВИТЬ — связка с графом
  relationship     PersonRelationship  // ДОБАВИТЬ — 'employee' | 'external' | 'candidate' | 'former'
  // knowledgeProfile Json?              — поле уйдёт в β-2 (Knowledge Clone), не в α-3
}

enum PersonRelationship {
  employee
  external
  candidate
  former
}
```

### 4.4. Расширения категории A на entityId

```prisma
model Goal {
  // ... существующие поля
  entityId String? @unique  // ДОБАВИТЬ
}

model Document {
  // ... существующие поля
  entityId String? @unique  // ДОБАВИТЬ
}

// Product (если есть отдельная модель, иначе только Card.kind='product')
```

### 4.5. Card.kind расширение

```prisma
enum CardKind {
  client    // (остаётся, но в UI отображается как 'customer' — alias)
  deal
  project
  topic
  custom
  vendor    // ДОБАВИТЬ
}
```

---

## 5. RouterService

```ts
// backend/src/modules/knowledge-core/services/router.service.ts
@Injectable()
export class RouterService {
  async dispatch(block: IdeaBlock): Promise<DispatchResult> {
    const targets = this.matchSpecialists(block);
    for (const target of targets) {
      await this.specialistRoutingQueue.add(target.specialistName, {
        blockId: block.id,
        tenantId: block.tenantId,
        signalType: block.signalType,
      }, { jobId: `${target.specialistName}_${block.id}` });
    }
    return { dispatched: targets };
  }

  private matchSpecialists(block: IdeaBlock): SpecialistTarget[] {
    // Static mapping signalType → specialist name(s)
    // signalType='decision' | 'rationale' | 'decision_basis' → ['3-3-decisions', '3-7-skill' if reasoning]
    // signalType='regulation' | 'process_step' → ['3-1-regulations']
    // signalType='problem' | 'risk' | 'blocker' → ['3-5-insights']
    // signalType='idea' | 'suggestion' | 'client-request' → ['3-6-ideas']
    // signalType='expertise' | 'fact' | 'experience' → ['3-2-knowledge-clone']
    // signalType='reasoning' (и subject is employee) → ['3-7-skill']
    // ВСЕГДА → ['3-4-project-customer'] если есть привязка к Project/Customer entity
  }
}
```

Открытый вопрос §11.2 зонтичного: статический mapping vs LLM-routing. Рекомендация — статический (быстрее, дешевле, прозрачнее).

Очередь `core.specialist-routing` — multi-consumer (каждый специалист подписывается на свой `jobName`).

---

## 6. ENV

```
ROUTER_DISPATCH_CONCURRENCY=4
ROUTER_MAX_SPECIALISTS_PER_BLOCK=4  # анти-fan-out защита
```

---

## 7. RBAC

- `vendor` ResourceType — read: member, write/delete: owner/admin.
- `event` ResourceType — read: member, write/delete: owner/admin.
- `Person.relationship` — поле доступно при чтении Person (отдельных прав не нужно).

---

## 8. Метрики

- `core_router_dispatched_total{specialist, signalType}` (counter)
- `core_router_fan_out{block}` (histogram — сколько специалистов на блок)
- `core_entity_resolution_new_total{type}` (counter, для новых типов)

---

## 9. LLM

Сам по себе RouterService LLM не использует (статический mapping). Расширения `EntityResolutionService` на новые типы могут потребовать обновления `entity-merge-arbiter` промпта.

---

## 10. Фазы реализации

- [x] **α-3.0** Решить открытый вопрос §11.2 зонтичного: статический vs LLM RouterService. Рекомендация — статический.
- [x] **α-3.1** Расширение enum `Entity.type` (+5, удаление `custom`) + новые enum'ы `VendorSegment`, `VendorStatus`, `EventKind`, `PersonRelationship` + `bun run prisma:push`.
- [x] **α-3.2** Patch-script `patch-rename-client-to-customer.ts`:
  - Update `Entity` WHERE type='client' → type='customer'.
  - Update `IdeaBlockEntity.role` ссылки — без изменений (id не меняются).
  - Логирование счётчиков.
- [x] **α-3.3** Bun-команда `bun run patch:rename-client-to-customer` — добавить в `package.json` scripts.
- [x] **α-3.4** Новые модели `Vendor`, `Event` + `bun run prisma:push`.
- [x] **α-3.5** Расширение существующих моделей категории A полем `entityId?` + patch-script бэкфила (создать Entity для тех Person/Goal/Document где её нет).
- [x] **α-3.6** Расширение `Person.relationship` enum + дефолт `external` для существующих + patch-script для проставления `employee` тем, кто связан с `Membership` в Org (=сотрудник).
- [x] **α-3.7** Расширение `Card.kind` enum `vendor`.
- [x] **α-3.8** Расширение `EntityResolutionService.findOrCreate` на новые типы (доменные правила: Vendor — дедуп по `inn` + name; Event — дедуп по `startAt + title`).
- [x] **α-3.9** Расширение `EntityMergeService` (KNN cosine + LLM-арбитр) — новые типы автоматически работают, но обновить промпт `entity-merge-arbiter` для новых metadata-полей.
- [x] **α-3.10** `RouterService` + BullMQ-очередь `core.specialist-routing` (consumer'ы — в каждом sub-TZ специалиста).
- [x] **α-3.11** Hook в `block-ingest.worker.ts` после создания блока → `routerService.dispatch(block)`.
- [x] **α-3.12** Минимальные CRUD-API `/api/v1/vendors`, `/api/v1/events` (просто список + GET by ID; full CRUD — потом).
- [x] **α-3.13** Минимальные UI-страницы `/vendors`, `/events` (list-only).
- [x] **α-3.14** HNSW-индексы для embedding'ов Vendor + Event через `apply-postgres-init.sql`.
- [x] **α-3.15** RBAC: `vendor`, `event` в `policy.csv`.
- [x] **α-3.16** Метрики + glossary + second-brain.

---

## 11. Открытые вопросы

1. **Product как отдельная модель vs только Card.kind='product'?** Проверить, есть ли уже модель Product в коде. Если нет — оставить Card.kind, не плодить.
2. **Patch-script для `entityId` бэкфила — батчинг по сколько?** Рекомендация — 1000 записей за раз, idempotent (skip если `entityId IS NOT NULL`).
3. **Что если у Person уже есть `Entity{type='person'}` с `id != personId`?** Нужна логика поиска и связки через name+org. Решить на старте.

---

## 12. DoD

- enum `Entity.type` расширен, `custom` удалён, `bun run prisma:push` зелёный.
- Patch-script `rename-client-to-customer` выполнен в dev, в БД нет `Entity{type='client'}`.
- Новые модели Vendor, Event в схеме + минимальные CRUD-API + HNSW индексы.
- Все модели категории A имеют `entityId` (после бэкфила).
- `Person.relationship` enum заполнен (default `external`, сотрудники → `employee`).
- `RouterService.dispatch()` вызывается из block-ingest.worker, заполняет `core.specialist-routing` очередь.
- `EntityResolutionService` дедуплицирует новые типы (smoke на тестовых данных).
- RBAC + UI заделы + metrics + glossary + second-brain.

---

## 13. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** граф знаний получает полную типизированную онтологию, специалисты Слоя 3 получают свой routing.

## Ревизия от 2026-05-24

**Статус:** superseded

**Реализовано (фактически):**
- `EntityType` enum расширен до 14 значений: person, customer, vendor, project, product, document, goal, event, topic, location, technology, metric, market, org_unit (+ deprecated client/custom). См. `backend/prisma/schema.prisma`.
- 4 новые модели категории A: `Vendor`, `Event`, `Market`, `OrgUnit` — все с `entityId @unique`.
- `Person.relationship` enum (employee/external/candidate/former) добавлен.
- `Card.kind='vendor'` + остальные расширения.
- `RouterService` (`backend/src/modules/knowledge-core/services/router.service.ts`) — статический mapping + fan-out + per-block priority trim. BullMQ-очередь `core.specialist-routing` работает.
- `AxisClassifierService` (`backend/src/modules/knowledge-core/services/axis-classifier.service.ts`) — fan-out по 4 осям (WHO × FUNCTIONAL × CONTEXTUAL × TEMPORAL) + модель `IdeaBlockAxisLabel`.
- LLM-fallback router за feature-flag `ROUTER_LLM_FALLBACK_ENABLED`.
- HNSW индексы pgvector через `apply-postgres-init`.
- Patch-script `patch-rename-client-to-customer.ts` (deprecated значения остались для совместимости).

**Заменён на:** `plans/tz/2026-05-23-sba-alpha-3-wave3-axis-classifier-full.md` — wave 3 закрыл оставшиеся 25% (AxisClassifierService + LLM-fallback). Wave 1 (Vendor/Event) и Wave 2 (Market/OrgUnit + signalType static routing) уже в коде.

