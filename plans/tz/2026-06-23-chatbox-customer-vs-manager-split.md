---
type: tz
status: ready-to-implement
feature: chatbox-customer-vs-manager-split
date: 2026-06-23
owner: Tozix
relates_to:
  - plans/tz/2026-06-11-chatbox-customer-link.md
  - backend/src/modules/chatbox/chatbox-customers.service.ts
  - backend/src/modules/knowledge-core/services/entity-resolution.service.ts
supersedes:
---
> Статус согласования: 2026-06-23 (владелец выбрал: доменная модель `Customer` (зеркало `Vendor`) · два уровня account+контакты · следующий шаг — ТЗ).
> Тяжёлый разбор — встроен ниже в «Доказательство выбора»; отдельный analysis-файл не заводился (решение владельца уже принято).

# Разделение клиентов и менеджеров источника ChatBox → сущности Коры

## Принцип

**Клиент компании — это не сотрудник.** Менеджер из ChatBox — это `Person` (сущность сотрудника/оргструктуры). Клиент из ChatBox — это **`Customer`** (новая доменная модель 1:1 над `Entity{type=customer}`, по образцу `Vendor`). Сейчас клиент ошибочно заводится как `Person{relationship=external}` — это лечим в корне: клиент уезжает из таблицы `persons` в собственный класс сущности.

«Расплывчатое ТЗ → расплывчатый код»: каждая развилка ниже закрыта, контракты даны дословными сниппетами, файлы — по `path:line` + якорь-символ.

---

## Цель и зачем

**Цель:** при синхронизации ChatBox клиенты (`ChatboxCustomer`, `ChatboxChannelClient`) перестают создаваться/привязываться как `Person`, а становятся `Customer` (account) + контакт-сущностями `Entity{type=person}`, сгруппированными под account через `EntityLink`. Менеджеры (`ChatboxMember`) остаются на рельсе `Person` без изменений.

**Болезненное состояние (по факту кода):**
- [chatbox-customers.service.ts:15](backend/src/modules/chatbox/chatbox-customers.service.ts#L15) `createPersonAndLink` создаёт `Person` с `relationship: 'external'` и привязывает к нему клиента — клиент попадает в таблицу сотрудников `persons`.
- [schema.prisma:11831](backend/prisma/schema.prisma#L11831) — комментарий у `ChatboxCustomer.linkedPersonId`: «связка клиента с Person Коры (как у ChatboxMember)» — клиент моделируется как менеджер.
- `Person` ([schema.prisma:4864](backend/prisma/schema.prisma#L4864)) — employee-сущность: `userId`→`User`, `Membership`, `primaryDepartment`, `appointments`/`personRoles`, `knowledgeProfile` (Employee Clone), `engagementScore`, HR-аналитика, `invitations`. Клиент ничем из этого не обладает и засоряет: справочник сотрудников, дедуп, Employee Clones, дашборд команды, knowledge-clone reasoning (фильтр «только сотрудники» по `relationship`, см. [PersonRelationship:543](backend/prisma/schema.prisma#L543)).
- **Двойное представление прямо сейчас:** при ингесте чат-сессии в граф клиент извлекается LLM как `Entity{type=customer}` (его обрабатывает [specialist-3-4-project-customer.worker.ts:14](backend/src/modules/knowledge-core/workers/specialist-3-4-project-customer.worker.ts#L14)), а ручная привязка из UI плодит ещё `Person{external}`. Один клиент в двух местах.

**Чем целевое состояние лучше:** клиент живёт в одном правильном классе (`Customer` + `Entity{type=customer}`), переиспользует существующий граф-дедуп (strong-IDs inn/ogrn/email/phone/domain), уже подключён к `CustomerRiskSnapshot.customerEntityId` ([schema.prisma:7252](backend/prisma/schema.prisma#L7252)), и даёт типизованного ответственного менеджера + статус. `persons` снова содержит только людей компании.

Документы second-brain к прочтению на старте: `second-brain/index.md`, `second-brain/02_architecture/knowledge-core.md`, `second-brain/02_architecture/module-map.md`, `second-brain/01_projects/` (chatbox / persons, если есть).

---

## REALITY-CHECK (фактическое состояние кода на 2026-06-23)

| Что | Статус по факту | Вывод для ТЗ |
|---|---|---|
| `EntityType.customer` (first-class, `client`→deprecated алиас) | ✅ есть [schema.prisma:509](backend/prisma/schema.prisma#L509) | Целевой тип сущности уже есть, не создаём enum |
| `Entity` strong-IDs `inn/ogrn/email/phone/domain` + partial-unique | ✅ есть [schema.prisma:3573](backend/prisma/schema.prisma#L3573) | Дедуп клиента — на готовом механизме |
| `EntityResolutionService.findOrCreateEntity` со strong-IDs | ✅ есть [entity-resolution.service.ts:107](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L107) | Базис для `findOrCreateCustomerEntity` |
| `findOrCreateVendorEntity` (паттерн домен-модель 1:1 над Entity) | ✅ есть [entity-resolution.service.ts:1194](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L1194) | Точный образец для customer-варианта |
| Доменная модель `Customer` | ❌ НЕТ (есть только `CustomerRiskSnapshot`, ссылается на `Entity{customer}`) | Создаём новую модель `Customer` |
| `ChatboxCustomer.linkedPersonId` / `ChatboxChannelClient.linkedPersonId` | ✅ есть, привязка к `Person` [schema.prisma:11832](backend/prisma/schema.prisma#L11832), [schema.prisma:11863](backend/prisma/schema.prisma#L11863) | Заменяем на привязку к `Customer`/`Entity{person}`; старые колонки — deprecated→drop в vNext |
| `ChatboxCustomersService.createPersonAndLink` / `linkCustomer` | ✅ есть [chatbox-customers.service.ts:15](backend/src/modules/chatbox/chatbox-customers.service.ts#L15) | Переписываем на Customer |
| FE: страница `chatbox/customers` (пикер по `persons{relationship:external}`) | ✅ есть [ChatboxCustomersClient.tsx:106](frontend/app/(authenticated)/chats/integrations/chatbox/customers/ChatboxCustomersClient.tsx#L106) | Меняем пикер на список `Customer` |
| FE: страница `chatbox/managers` | ✅ есть, на `Person` | НЕ трогаем |
| `patch-rename-client-to-customer.ts` (миграция Entity типа) | ✅ есть [scripts/patch-rename-client-to-customer.ts](backend/scripts/patch-rename-client-to-customer.ts) | Образец идемпотентного patch |
| `apply-prod-deploy.ts` STEPS + `Step` интерфейс | ✅ есть [scripts/apply-prod-deploy.ts:11](backend/scripts/apply-prod-deploy.ts#L11) | Регистрируем backfill |
| Bitrix: `BitrixContact/Company/Deal/Lead` — сырые зеркала, НЕ привязаны к `Customer`/`Entity{customer}` | ✅ есть [schema.prisma:12140](backend/prisma/schema.prisma#L12140) | Унификация Bitrix→Customer — вне scope (vNext-заглушка) |

**Вывод:** фича ~50% обеспечена готовыми механизмами (Entity, strong-id дедуп, Vendor-паттерн, precedent-скрипты). Остаток — новая модель `Customer`, метод резолва, переключение chatbox, FE-пикер, backfill. Висящих контрактов фронт↔бэк нет (FE и BE согласованы на `linkedPerson`).

---

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| В1 | Клиент = **новая доменная модель `Customer` 1:1 над `Entity{type=customer}`** (зеркало `Vendor`), а не прямая привязка к `Entity` | Нужны типизованные поля: ответственный менеджер, статус, CRM-id (под `CustomerRiskSnapshot` и будущую унификацию с Bitrix); консистентность с `Vendor`. Выбор владельца 2026-06-23. |
| В2 | **Два уровня:** account (компания-клиент) = `Customer`/`Entity{customer}`; контакты-физлица = `Entity{type=person}`, привязаны к account через `EntityLink` | B2B: один клиент-аккаунт ↔ много контактов в разных мессенджерах. Выбор владельца 2026-06-23. |
| В3 | **Менеджеры остаются `Person`** — рельс `ChatboxMember`→`Person` не трогаем | Менеджер реально сотрудник компании; [chatbox-members.service.ts:147](backend/src/modules/chatbox/chatbox-members.service.ts#L147) поднимает `relationship→employee` — корректно. |

### Проектные решения автора ТЗ (закрытые развилки, не угадывать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | **Контакт = `Entity{type=person}` БЕЗ строки `Person`.** `Person.entityId` опционален и `Entity.persons[]` может быть пустым ([schema.prisma:4877](backend/prisma/schema.prisma#L4877), [schema.prisma:3595](backend/prisma/schema.prisma#L3595)) — контакт живёт только как граф-узел. НЕ заводим `Person`-строку и НЕ заводим новую реляционную таблицу `CustomerContact`. | Жёсткое требование: контакт клиента не должен попадать в `persons` (employee-таблица). Граф-узел `Entity{person}` уже умеет дедуп по email/phone и участвует в knowledge-графе. Отдельная таблица контактов = код ради кода (нет полей сверх Entity). |
| Б2 | Связь контакт→account: `EntityLink{ fromType:'entity', toType:'entity', relationType: works_at, fromEntityId: <contactEntityId>, toEntityId: <accountEntityId> }` | `works_at` ([EntityLinkType:721](backend/prisma/schema.prisma#L721)) семантически = «контакт работает в компании-клиенте»; полиморфный `EntityLink` уже так используется ([persons.service.ts:825](backend/src/modules/persons/services/persons.service.ts#L825) `upsertActiveLink`). |
| Б3 | **`ChatboxCustomer` → account** (`linkedCustomerId`→`Customer`). **`ChatboxChannelClient` → контакт** (`linkedContactEntityId`→`Entity{person}`), связь с account — авто во время sync (через уже существующий `ChatboxChannelClient.customerId`). Явное ручное связывание в UI остаётся на уровне account (как сейчас). | Минимизирует churn UI (текущая страница оперирует `ChatboxCustomer`). Контакты группируются автоматически — нет новой ручной операции. |
| Б4 | Старые колонки `linkedPersonId` (на `ChatboxCustomer` и `ChatboxChannelClient`) — **не удаляем в этом релизе**: помечаем deprecated, перестаём писать, backfill переносит данные. **DROP — отдельной миграцией vNext** после подтверждения backfill на проде. | Безопасный rollback: миграция-схемы прогоняется ДО STEPS (`migrate deploy` в `--with-schema`), backfill читает `linkedPersonId` уже ПОСЛЕ. Drop в том же релизе сломал бы backfill. Образец отложенного drop — deprecated-значение `client` в [EntityType:514](backend/prisma/schema.prisma#L514). |
| Б5 | **Без feature-flag.** Это корректность-фикс, выкатываем включённым (Ship-On, CLAUDE.md принцип 8). Старое поведение (`createPersonAndLink`) удаляется, не остаётся переключаемым. | Не плодим склад выключенного; фикс не имеет «решения владельца» и не тратит деньги. |
| Б6 | **Новых ENV/AdminSetting-крутилок не добавляем.** Дедуп-пороги — внутри `EntityResolutionService` (свои knobs). Авто-подсказка по email — FE-эвристика, не серверный порог. | Нет нового порога/лимита/часа/веса (CLAUDE.md принцип 9). Если на ревью всплывёт порог — выносить в `AdminSetting`, не хардкодить. |
| Б7 | **Раздел «Клиенты» — справочная страница `/customers`, зеркало `/vendors`**, пункт навигации в подгруппе «Справочник» рядом с «Поставщики» ([nav-config.ts:252](frontend/src/ui/components/app-shell/nav-config.ts#L252) `REFERENCE_SUBGROUP`). НЕ кладём в `/structure` («Команда»). | Клиент и поставщик симметричны (внешние контрагенты графа, обе — категория A над `Entity`); «Команда» — это сотрудники (`Person`), туда клиент не относится (тот же корень, что и фикс). Переиспользуем готовый паттерн Vendors-страницы → минимум нового кода. |
| Б8 | Read API клиентов — **только `list`+`get`** в этом релизе (как Vendors на α-3). RBAC-объект чтения — существующий `'entity'` (`rbac.canRead(userId, tenantId, 'entity')`), без правки `policy.csv`. | PATCH/create/delete `Customer` из UI — vNext (как у Vendors). `'entity'` уже выдаёт чтение графа (используется `/persons`, `/knowledge/entities`) — гранулярный `'customer'`-объект не нужен, не трогаем Casbin. |

---

## Доказательство выбора (два прохода + challenge-loop)

**Проход A (под текущий код, выбран):** новая `Customer` 1:1 над `Entity{customer}` (зеркало `Vendor`); chatbox привязывается к `Customer`; контакты — `Entity{person}` через `EntityLink`.

**Проход B (иная ось — модель данных):** без новой реляционной модели — `ChatboxCustomer.linkedCustomerEntityId` напрямую на `Entity{customer}`, поля менеджера/статуса в `Entity.metadata`.

| Критерий (ограничение фичи) | A (Customer-модель) | B (только Entity) |
|---|---|---|
| Типизованный ответственный менеджер (responsiblePersonId) | ✓ колонка+FK | ✗ только в metadata json |
| Статус/жизненный цикл клиента | ✓ enum-колонка | ✗ metadata |
| CRM-id для унификации с Bitrix (индексируемый) | ✓ колонка+index | ~ metadata, без индекса |
| Группировка контактов под account через EntityLink | ✓ | ✓ |
| Переиспользование графа/дедупа strong-id | ✓ | ✓ |
| Консистентность с `Vendor`-паттерном | ✓ | ✗ расходится |
| Объём работ / миграция | больше | меньше |

Сошлись на A по всем продуктовым критериям; B выигрывает только по объёму. Владелец выбрал A (В1). **Challenge-loop по A:** (1) корень — да, лечим весь класс «клиент в employee-таблице», а не только chatbox-кейс (модель готова и для Bitrix-унификации); (2) эффективнее — не B, т.к. responsibleManager уже требуется `CustomerRiskSnapshot`; не преждевременно; (3) код ради кода — нет: контакты переиспользуют `Entity{person}`+`EntityLink`, отдельную таблицу контактов и contact-CRUD UI не строим (Б1, Б3).

---

## Scope

### Входит
- Новая Prisma-модель `Customer` (1:1 над `Entity{type=customer}`) + relation на `Entity` + версионируемая миграция.
- Новые колонки `ChatboxCustomer.linkedCustomerId`, `ChatboxChannelClient.linkedContactEntityId` (старые `linkedPersonId` — deprecated, не пишем).
- `EntityResolutionService.findOrCreateCustomerEntity` (зеркало vendor, strong-ids email/phone/inn/ogrn/domain) + хелпер связи контакт→account.
- Переписать `ChatboxCustomersService` (Person→Customer), контроллер-эндпоинт `create-person`→`create-customer`, DTO `ChatboxCustomerDto`.
- Sync/ingest: маппинг клиента на `Customer`/`Entity{customer}`; контакт-сущности из channel-clients; assignee в task-extraction остаётся менеджер-`Person`, `customerName` берётся из `Customer`/`Entity`.
- **Backend read API `CustomersController`/`CustomersService`** (list + get по модели `Customer`) — зеркало `VendorsController`.
- **FE раздел «Клиенты»** — отдельная справочная страница `/customers` (зеркало `/vendors`) + `customers.api.ts` + пункт навигации «Клиенты» в подгруппе «Справочник» рядом с «Поставщики». Это и есть запрошенное владельцем отображение клиентов «как Команда, только клиенты».
- FE: страница `chatbox/customers` — пикер по списку `Customer` вместо `persons{relationship:external}`; `chatbox/managers` НЕ трогаем.
- `backfill-chatbox-customers-from-person.ts`: существующие `Person{external}` из chatbox → `Customer`/`Entity{customer}`, переброс ссылок, деактивация осиротевших `Person`; регистрация в `apply-prod-deploy.ts` STEPS + `prod-deploy-log.md`.

### Не входит (с судьбой)
- **DROP колонок `linkedPersonId`** → vNext-миграция после подтверждения backfill на проде (Б4). Заглушка: `plans/tz/` — создать при выкате этого ТЗ.
- **Унификация Bitrix (`BitrixContact/Company/Deal/Lead`) на `Customer`/`Entity{customer}`** → vNext-ТЗ `plans/tz/2026-06-23-bitrix-customer-unify.md` (заглушка). Здесь только архитектурно закладываем `Customer.externalCrmId` + `source`, чтобы Bitrix мог переиспользовать модель без её переделки.
- **Ручное связывание контактов (channel-client) в UI** → не в этом релизе; контакты авто-группируются (Б3). vNext при запросе.
- **Объединение/merge клиента и его `Entity{customer}`, извлечённого LLM из переписки** → дедуп уже делает `EntityResolutionService` по strong-id; отдельная UI-операция merge вне scope.
- **PATCH `Customer` (статус/менеджер) из UI** → как у `Vendor` (read-only на этом этапе), vNext.

### Граничные контракты с другими сущностями
- `CustomerRiskSnapshot.customerEntityId` уже ждёт `Entity{type=customer}` — наш `Customer.entityId` его и наполнит; НЕ меняем `CustomerRiskSnapshot`.
- `specialist-3-4-project-customer.worker` уже создаёт `Entity{type=customer}` из контента — наш `findOrCreateCustomerEntity` использует тот же `findOrCreateEntity`, поэтому LLM-извлечённый и chatbox-привязанный клиент **дедупятся в один Entity** (по name/strong-id). Это и есть устранение двойного представления.

---

## Контракты (canon для копипасты)

### Prisma — новая модель `Customer` (вставить рядом с `Vendor`, после [schema.prisma:3652](backend/prisma/schema.prisma#L3652))

```prisma
/// Customer — клиент компании (account). Категория A онтологии, зеркало Vendor.
/// 1:1 над Entity{type=customer}. Источник клиентов из ChatBox/Bitrix и графа.
/// Дедуп Entity: приоритет strong-id (inn/email/domain), fallback на name —
/// EntityResolutionService.findOrCreateCustomerEntity.
model Customer {
  id                String         @id @default(cuid())
  tenantId          String
  /// Связка с Entity{type=customer}. Уникальна (1:1).
  entityId          String         @unique
  entity            Entity         @relation("CustomerEntity", fields: [entityId], references: [id], onDelete: Cascade)
  org               Org            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name              String         @db.VarChar(300)
  inn               String?        @db.VarChar(20)
  email             String?        @db.VarChar(320)
  phone             String?        @db.VarChar(40)
  /// Источник, откуда заведён клиент: 'chatbox' | 'bitrix' | 'graph' | 'manual'.
  source            String?        @db.VarChar(40)
  /// Внешний CRM-id (для унификации с Bitrix; vNext). NULL — нет.
  externalCrmId     String?        @db.VarChar(120)
  /// Ответственный менеджер со стороны компании (Person той же Org). NULL — не назначен.
  responsiblePersonId String?
  status            CustomerStatus @default(active)
  metadata          Json?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  deletedAt         DateTime?

  responsible       Person?        @relation("CustomerResponsible", fields: [responsiblePersonId], references: [id], onDelete: SetNull)

  @@index([tenantId, status])
  @@index([tenantId, externalCrmId])
  @@index([tenantId, responsiblePersonId])
  @@index([tenantId, deletedAt])
}

enum CustomerStatus {
  active
  inactive
  churned
}
```

Добавить обратные relations:
- В `Entity` ([schema.prisma:3598](backend/prisma/schema.prisma#L3598), рядом с `vendor Vendor?`): `customer Customer? @relation("CustomerEntity")`.
- В `Person` ([schema.prisma:4995](backend/prisma/schema.prisma#L4995), рядом с `customerRiskSnapshots`): `responsibleCustomers Customer[] @relation("CustomerResponsible")`.

### Prisma — chatbox-колонки

```prisma
// В ChatboxCustomer (schema.prisma:11823): добавить, linkedPersonId оставить deprecated.
linkedCustomerId String?
// + relation:
customerRef Customer? @relation(fields: [linkedCustomerId], references: [id], onDelete: SetNull)
// + index:
@@index([tenantId, linkedCustomerId])

// В ChatboxChannelClient (schema.prisma:11848): добавить.
linkedContactEntityId String?
@@index([tenantId, linkedContactEntityId])
```
> `linkedCustomerId` НЕ обязателен сразу делать NOT NULL — привязка может отсутствовать. Relation `Customer` ← добавить обратное поле `chatboxCustomers ChatboxCustomer[]` в модель `Customer`.

Команда генерации миграции (CLAUDE.md, версионируемые миграции — НЕ `db push`):
```
bun run prisma:migrate -- --name chatbox_customer_model
bun run prisma:generate
```
postgres-init.sql: новые HNSW/GIN не требуются (strong-id partial-unique уже на `Entity`). Если на ревью решат добавить trigram по `Customer.name` — в `postgres-init.sql`, не в schema.

### EntityResolutionService.findOrCreateCustomerEntity (зеркало [findOrCreateVendorEntity:1194](backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L1194))

```ts
async findOrCreateCustomerEntity(args: {
  tenantId: string;
  name: string;
  inn?: string | null;
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
  ogrn?: string | null;
  source?: string | null;
  externalCrmId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<{ entity: Entity; customerId: string; created: boolean }>
```
Контракт: (1) если есть `Customer` по `externalCrmId` (в рамках tenant, `deletedAt: null`) — переиспользуем; (2) иначе `findOrCreateEntity({ type: 'customer', name, inn, ogrn, email, phone, domain, metadata })` (он сам дедупит по strong-id→name→KNN); (3) `Customer` ищем по `entityId @unique`, нет — создаём с `source`/`externalCrmId`/`status: 'active'`. Имя — `name.trim().slice(0,300)`, пустое имя → `throw new Error('EntityResolution: пустое имя customer')`.

Хелпер связи контакт→account (можно внутри `ChatboxCustomersService` через `EntityLink`, как [persons.service.ts:825](backend/src/modules/persons/services/persons.service.ts#L825) `upsertActiveLink`): upsert `EntityLink{ fromEntityId: contactEntityId, fromType:'entity', toEntityId: accountEntityId, toType:'entity', relationType: 'works_at', createdBy:'manual', status:'active', confidence: 1.000, explanation:'Контакт ChatBox привязан к клиенту' }`.

### Backend chatbox service/controller/DTO

- `ChatboxCustomersService`: `createPersonAndLink` → `createCustomerAndLink(tenantId, userId, customerId)`: грузит `ChatboxCustomer`, идемпотентность — если `linkedCustomerId` уже задан → 400 `chatbox_customer_already_linked`; иначе `findOrCreateCustomerEntity({ name: customer.name||email||'Без имени', email, phone, source:'chatbox', externalCrmId: customer.externalCrmId })` → `linkCustomer(tenantId, customerId, customer.id)`. `linkCustomer(tenantId, chatboxCustomerId, customerId|null)` пишет `linkedCustomerId`+`linkMode`('manual'|'none'). Удалить весь код, создающий `Person`. `PersonsService` из `ChatboxCustomersService` — убрать инъекцию (менеджеры её сохраняют).
- Контроллер [chatbox-customers.controller.ts:65](backend/src/modules/chatbox/chatbox-customers.controller.ts#L65): `@Post(':id/create-person')` → `@Post(':id/create-customer')`, `summary` «Создать клиента Коры из клиента ChatBox и связать». `@Put(':id/link')` body — `{ customerId: string | null }` (см. DTO ниже).
- DTO [chatbox-customers.dto.ts](backend/src/modules/chatbox/dto/chatbox-customers.dto.ts):
```ts
export const ChatboxCustomerLinkSchema = z.object({
  customerId: z.string().trim().min(1).nullable(),
});
export interface ChatboxLinkedCustomerDto { id: string; name: string | null; }
export interface ChatboxCustomerDto {
  id: string; externalId: string; email: string | null; phone: string | null;
  name: string | null; linkMode: ChatboxMemberLinkMode;
  linkedCustomer: ChatboxLinkedCustomerDto | null;
}
```
- Машинные коды ошибок: `chatbox_customer_not_found`, `chatbox_customer_already_linked`, `customer_not_found`, `tenant_required`, `forbidden` (RBAC obj=`chatbox`, act `read`/`manage` — без изменений).

### Ingest / analyze

- [chatbox-ingest.service.ts:249](backend/src/modules/chatbox/chatbox-ingest.service.ts#L249) `ingestSession`: `customer` в payload берём из `ChatboxCustomer` (name) + при наличии резолвим/прикрепляем `Entity{customer}` (вызов `findOrCreateCustomerEntity`); поле `responsible` (менеджер) и `authorPersonId` — без изменений (остаются `Person`).
- [chatbox-analyze.worker.ts:255](backend/src/modules/chatbox/chatbox-analyze.worker.ts#L255) `extractTasks`: `customerName` — из `ChatboxCustomer`/`Customer` (как сейчас, имя); `assigneeUserId`/`responsiblePersonId` — остаются из `ChatboxMember.linkedPersonId`→`Person`. Менеджерский путь не трогаем.

### Frontend

- [ChatboxCustomersClient.tsx:106](frontend/app/(authenticated)/chats/integrations/chatbox/customers/ChatboxCustomersClient.tsx#L106): источник опций — список `Customer` (новый `chatboxApi.listCustomerAccounts()` или существующий customers-домен), НЕ `personsDomainApi.list({relationship:'external'})`. `chatboxApi.createCustomerPerson` → `createCustomer`; `linkCustomer(id, customerId|null)`. Тип `PersonOption`→`CustomerOption{id,name,email}`. Маппер `domain/chatbox.ts`: `linkedPerson`→`linkedCustomer`. UI-копирайт уже «Создать нового клиента» — оставить. Управляющий слой ApiDto→DomainModel→UiModel (frontend-rules).
- `chatbox/managers/*` — не трогаем.

### Backfill-скрипт (образец [patch-rename-client-to-customer.ts](backend/scripts/patch-rename-client-to-customer.ts), idempotent + `--dry-run`)

`backend/scripts/backfill-chatbox-customers-from-person.ts`:
- `createPrismaClient()` из `./_lib/prisma` (НИКОГДА `new PrismaClient()`).
- Идемпотентность (acceptance): повторный прогон = no-op. Гард: брать только `ChatboxCustomer`/`ChatboxChannelClient`, у которых `linkedPersonId IS NOT NULL AND linkedCustomerId IS NULL` (для customer) / `linkedContactEntityId IS NULL` (для channel-client).
- Для каждого: по `Person` (имя/email/phone) → `findOrCreateCustomerEntity` → проставить `linkedCustomerId`; channel-clients той же `ChatboxCustomer` → контакт `Entity{person}` + `EntityLink(works_at)` на account.
- **Осиротевшие `Person`**: если `Person.relationship='external'`, не привязан ни к чему кроме chatbox (нет `userId`, нет `Membership`, не `responsiblePersonId` нигде, не автор IdeaBlock и т.п.) → `softDelete` (выставить `deletedAt`), НЕ хард-делит. Лог сколько перенесено/деактивировано.
- Регистрация: в `apply-prod-deploy.ts` STEPS `{ phase: 'backfill', script: 'scripts/backfill-chatbox-customers-from-person.ts', skipBootstrap: true, hint: '...' }`.

---

## Границы фичи

- ✅ **Always:** клиента заводить как `Customer`/`Entity{customer}`; менеджера — как `Person`; дедуп через `EntityResolutionService`; tenant-scope на каждом запросе (`@@index([tenantId, …])`, `TenantGuard`); Zod-DTO+Swagger на эндпоинтах; FE слои ApiDto→DomainModel→UiModel; русский UI.
- ⚠️ **Ask first:** удаление колонок `linkedPersonId` (только vNext-миграцией); любой новый порог/лимит (в `AdminSetting`, не хардкод); изменение контракта `CustomerRiskSnapshot`.
- 🚫 **Never:** создавать `Person` для клиента; писать `relationship:'external'` из chatbox-пути; `new PrismaClient()` в скриптах; `process.env.*` мимо `env.schema.ts`; `prisma migrate`/`db push` вместо `prisma:migrate`; нарративные комментарии в коде (CLAUDE.md); хард-делит `Person`.

---

## Фазы (dependency-ordered)

Граф зависимостей: **Ф1 → {Ф2, Ф3Б} ; Ф2 → Ф3 → {Ф4, Ф5} ; Ф3Б → Ф5Б ; всё → Ф6**.
- Ф1 (схема) строго первая (всё опирается на модель `Customer`).
- Ф2 (резолв) до Ф3 (сервис вызывает резолв). **Ф3Б** (Customers read API) зависит только от Ф1 — параллельна Ф2/Ф3.
- Ф4 (ingest/analyze) и Ф5 (FE chatbox-пикер) — после Ф3 (общий контракт Customer/DTO). **Ф5Б** (FE раздел «Клиенты») — после Ф3Б (read API).
- Ф6 (backfill) последняя — нужен боевой контракт колонок.
- Согласованный мёрж: Ф3+Ф5 (DTO-контракт chatbox); Ф3Б+Ф5Б (контракт `/api/v1/customers`).

### Фаза 1 — Prisma-модель `Customer` + chatbox-колонки + миграция `[ ]`
**Цель:** модель данных существует, клиент Prisma сгенерирован.
**Входит:** модель `Customer` + enum `CustomerStatus` (сниппет выше); relations в `Entity`/`Person`/`Customer`/`ChatboxCustomer`; колонки `ChatboxCustomer.linkedCustomerId`, `ChatboxChannelClient.linkedContactEntityId` (+indexes); `bun run prisma:migrate -- --name chatbox_customer_model`; `bun run prisma:generate`.
**Не входит:** любой сервисный/FE-код; запись в новые колонки; drop старых.
**Файлы:** [backend/prisma/schema.prisma](backend/prisma/schema.prisma) (якоря: `model Vendor`, `model Entity`, `model Person`, `model ChatboxCustomer`, `model ChatboxChannelClient` — номера строк перечитать перед правкой, дрейфуют).
**Acceptance:** `grep -n "model Customer" backend/prisma/schema.prisma` → 1; `grep -n "enum CustomerStatus" …` → 1; `grep -n "linkedCustomerId" …` → ≥1; новый файл в `backend/prisma/migrations/*chatbox_customer_model/migration.sql` существует и содержит `CREATE TABLE "Customer"`; `bun run prisma:generate` без ошибок; `bun run typecheck` зелёный (Prisma-типы `prisma.customer` доступны).
**Закрывает:** R1, R2.

### Фаза 2 — `findOrCreateCustomerEntity` + contact-link хелпер `[ ]`
**Цель:** резолв `Entity{customer}`+`Customer` 1:1 со strong-id дедупом; связь контакт→account.
**Входит:** метод `findOrCreateCustomerEntity` (контракт выше) в [entity-resolution.service.ts](backend/src/modules/knowledge-core/services/entity-resolution.service.ts) (рядом с `findOrCreateVendorEntity:1194`); unit-spec в `entity-resolution.service.spec.ts` (дедуп по email, дедуп по externalCrmId, повторный вызов → `created:false`, пустое имя → throw).
**Не входит:** вызовы из chatbox (Ф3); UI.
**Файлы:** `backend/src/modules/knowledge-core/services/entity-resolution.service.ts`, `…/entity-resolution.service.spec.ts`.
**Acceptance:** `bunx vitest run backend/src/modules/knowledge-core/services/entity-resolution.service.spec.ts` зелёный; негативный кейс: пустое `name` → `Error('EntityResolution: пустое имя customer')`; повтор с тем же email → тот же `entity.id`, `created:false`, `Customer` не дублируется.
**Закрывает:** R3, R4.

### Фаза 3 — `ChatboxCustomersService`/controller/DTO на `Customer` `[ ]`
**Цель:** ручная привязка/создание клиента работает через `Customer`, не `Person`.
**Входит:** переписать сервис ([chatbox-customers.service.ts](backend/src/modules/chatbox/chatbox-customers.service.ts)) — `createCustomerAndLink`, `linkCustomer`, `listCustomers` (резолв `linkedCustomer`); убрать инъекцию `PersonsService`; контроллер ([chatbox-customers.controller.ts:65](backend/src/modules/chatbox/chatbox-customers.controller.ts#L65)) `create-person`→`create-customer`, `link` body `{customerId}`; DTO (сниппет выше); обновить `chatbox-customers.service.spec.ts`; в [chatbox.module.ts:24](backend/src/modules/chatbox/chatbox.module.ts#L24) подключить `EntityResolutionService` (импорт модуля knowledge-core/entity-resolution) к chatbox-провайдерам.
**Не входит:** ingest/analyze (Ф4); FE (Ф5).
**Файлы:** `chatbox-customers.service.ts`, `chatbox-customers.controller.ts`, `dto/chatbox-customers.dto.ts`, `chatbox-customers.service.spec.ts`, `chatbox.module.ts`.
**Acceptance:** `grep -n "createPersonAndLink\|relationship: 'external'\|PersonsService" backend/src/modules/chatbox/chatbox-customers.service.ts` → 0; `grep -n "create-customer" chatbox-customers.controller.ts` → 1; `bunx vitest run backend/src/modules/chatbox/chatbox-customers.service.spec.ts` зелёный; `bun run typecheck` зелёный; Swagger-smoke: `POST /api/v1/chatbox/customers/:id/create-customer` присутствует.
**Закрывает:** R5, R6.

### Фаза 3Б — Backend read API клиентов (`CustomersController`/`CustomersService`) `[ ]`
**Цель:** REST `GET /api/v1/customers` (list+filter+пагинация) и `GET /api/v1/customers/:id` по модели `Customer`.
**Входит:** новый модуль `backend/src/modules/customers/` — зеркало `backend/src/modules/vendors/`: `customers.controller.ts` (только `@Get()` list + `@Get(':id')`; guards `CookieAuthGuard, TenantGuard`; RBAC `rbac.canRead(user.id, t, 'entity')`, Б8), `services/customers.service.ts` (`list`/`getById` по `prisma.customer`, фильтры `q`/`status`, `deletedAt: null`, `orderBy name`), `dto/customers.dto.ts` (Zod `ListCustomersQuerySchema`, `CustomerDto`, `ListCustomersResponse` — поля `id,entityId,name,inn,email,phone,status,responsiblePersonId,source,externalCrmId,createdAt,updatedAt`), регистрация модуля в `app.module.ts`.
**Не входит:** create/update/delete (vNext, Б8); FE (Ф5Б); привязка из chatbox (Ф3).
**Файлы (образец):** [backend/src/modules/vendors/vendors.controller.ts](backend/src/modules/vendors/vendors.controller.ts), `backend/src/modules/vendors/services/vendors.service.ts`, `backend/src/modules/vendors/dto/vendors.dto.ts`, `backend/src/app.module.ts` (якорь: регистрация `VendorsModule`).
**Acceptance:** `bun run typecheck` зелёный; Swagger-smoke: `GET /api/v1/customers` и `GET /api/v1/customers/:id` присутствуют под тегом `customers`; unit-spec `customers.service.spec.ts` — list возвращает только `deletedAt:null`, фильтр `q` по `name` (ILIKE), tenant-scope (чужой tenant не виден); `grep -n "rbac.canRead" customers.controller.ts` → ≥1.
**Закрывает:** R11.

### Фаза 4 — ingest/analyze: клиент из `Customer`, менеджер из `Person` `[ ]`
**Цель:** в графе/задачах клиент = `Entity{customer}`, исполнитель = менеджер-`Person`.
**Входит:** [chatbox-ingest.service.ts:249](backend/src/modules/chatbox/chatbox-ingest.service.ts#L249) — резолв/прикрепление `Entity{customer}` для `customer` в payload; [chatbox-analyze.worker.ts:255](backend/src/modules/chatbox/chatbox-analyze.worker.ts#L255) — `customerName` из `Customer`/`ChatboxCustomer`, assignee остаётся менеджер-`Person`; обновить spec'и воркера/ingest.
**Не входит:** изменение менеджерского пути; FE.
**Файлы:** `chatbox-ingest.service.ts`, `chatbox-analyze.worker.ts`, их `.spec.ts`.
**Acceptance:** `bunx vitest run backend/src/modules/chatbox/chatbox-analyze.worker.spec.ts backend/src/modules/chatbox/chatbox-ingest.service.spec.ts` зелёный; assignee в извлечённой задаче по-прежнему резолвится из `ChatboxMember.linkedPersonId`; ни в одном новом пути нет создания `Person` для клиента (`grep` 0).
**Закрывает:** R7.

### Фаза 5 — FE `chatbox/customers` на список `Customer` `[ ]`
**Цель:** пикер привязки оперирует клиентами (`Customer`), не сотрудниками-external.
**Входит:** [ChatboxCustomersClient.tsx](frontend/app/(authenticated)/chats/integrations/chatbox/customers/ChatboxCustomersClient.tsx) — источник опций `Customer`; `chatbox.api.ts` (`createCustomer`, `linkCustomer({customerId})`, `listCustomerAccounts` при необходимости); `domain/chatbox.ts` (`linkedPerson`→`linkedCustomer`); типы `CustomerOption`.
**Не входит:** `chatbox/managers/*`; новые страницы.
**Файлы:** `frontend/app/(authenticated)/chats/integrations/chatbox/customers/ChatboxCustomersClient.tsx`, `frontend/src/api/chatbox.api.ts`, `frontend/src/domain/chatbox.ts`.
**Acceptance:** `grep -n "relationship.*external\|personsDomainApi" ChatboxCustomersClient.tsx` → 0; `cd frontend && bun run typecheck && bun run lint` зелёные; UI-копирайт только русский; пары токенов `bg-*`/`text-*-fg` (без `text-white`/hex).
**Закрывает:** R8.

### Фаза 5Б — FE раздел «Клиенты» (справочная страница + навигация) `[ ]`
**Цель:** в кабинете появляется раздел «Клиенты» рядом с «Поставщики» — список клиентов компании.
**Входит:**
- `frontend/src/api/customers.api.ts` — зеркало [vendors.api.ts](frontend/src/api/vendors.api.ts): `customersApi.list(filters?)`, `customersApi.get(id)` на `/api/v1/customers`; типы `CustomerListItemApi`/`CustomersListResponseApi`/`CustomerStatusApi` (`active|inactive|churned`).
- `frontend/app/(authenticated)/customers/page.tsx` + `CustomersListClient.tsx` — зеркало [VendorsListClient.tsx](frontend/app/(authenticated)/vendors/VendorsListClient.tsx): заголовок «Клиенты», поиск по имени/ИНН/email, список (имя, контакт email/phone, статус, ответственный менеджер если задан), состояния loading/forbidden/error/empty через `AdminLoading/AdminForbidden/AdminError` + `EmptyState`.
- Навигация: пункт `{ href: "/customers", label: "Клиенты", icon: <Lucide>, matchPrefix: "/customers" }` в `REFERENCE_SUBGROUP.items` [nav-config.ts:252](frontend/src/ui/components/app-shell/nav-config.ts#L252), сразу после «Поставщики» (`/vendors`). Иконка — из уже импортированных в nav-config (например `Contact` — добавить в import-список lucide, либо переиспользовать `Users`/`UserRound`). `nav-subset.spec.ts` обновить, если он перечисляет hrefs.
**Не входит:** карточка/детальная страница клиента `/customers/:id` (vNext); редактирование; `chatbox/managers` и `/structure`.
**Файлы:** `frontend/src/api/customers.api.ts`, `frontend/app/(authenticated)/customers/page.tsx`, `frontend/app/(authenticated)/customers/CustomersListClient.tsx`, `frontend/src/ui/components/app-shell/nav-config.ts`, опц. `frontend/src/ui/components/app-shell/nav-subset.spec.ts`.
**Acceptance:** `cd frontend && bun run typecheck && bun run lint && bun run build` зелёные; `grep -n '"/customers"' frontend/src/ui/components/app-shell/nav-config.ts` → 1; страница `/customers` рендерит список из `customersApi.list` (не из persons/vendors); UI только русский; токены `bg-*`/`text-*-fg`, без `text-white`/hex; пустое состояние — текст про «клиенты появятся после синхронизации/первых переписок».
**Закрывает:** R12.

### Фаза 6 — backfill существующих `Person{external}` из chatbox `[ ]`
**Цель:** боевые данные перенесены; `persons` очищен от осиротевших клиентов.
**Входит:** `backend/scripts/backfill-chatbox-customers-from-person.ts` (контракт выше); регистрация в `apply-prod-deploy.ts` STEPS; запись в `docs/operations/prod-deploy-log.md` Шаг 8 (backfill) + Шаг 4 (схема); опц. `.spec.ts`.
**Не входит:** drop колонок `linkedPersonId` (vNext).
**Файлы:** `backend/scripts/backfill-chatbox-customers-from-person.ts`, `backend/scripts/apply-prod-deploy.ts`, `docs/operations/prod-deploy-log.md`.
**Acceptance:** `--dry-run` ничего не пишет и печатает план; повторный реальный прогон = no-op (0 перенесено); после прогона на тестовых данных: каждый `ChatboxCustomer` с бывшим `linkedPersonId` имеет `linkedCustomerId`; осиротевшие `Person{external}` имеют `deletedAt`; `grep -n "backfill-chatbox-customers-from-person" backend/scripts/apply-prod-deploy.ts` → 1; `grep` `new PrismaClient(` в скрипте → 0.
**Закрывает:** R9, R10.

---

## Требования (трассировка)

- **R1** Когда применяется миграция, система shall иметь таблицу `Customer` (1:1 `entityId @unique`→Entity) и enum `CustomerStatus`.
- **R2** Если у `ChatboxCustomer`/`ChatboxChannelClient` появляются новые колонки привязки, then старые `linkedPersonId` остаются, но в новом коде не пишутся.
- **R3** Когда вызывается `findOrCreateCustomerEntity` с тем же email/inn/externalCrmId повторно, система shall вернуть тот же `Entity`/`Customer` (`created:false`), без дублей.
- **R4** Если `name` пустой, then `findOrCreateCustomerEntity` бросает ошибку (не создаёт мусорную сущность).
- **R5** Когда пользователь привязывает/создаёт клиента из ChatBox, система shall создать/привязать `Customer` (+`Entity{customer}`), а не `Person`.
- **R6** Если клиент уже привязан (`linkedCustomerId` задан), then повторная привязка возвращает `chatbox_customer_already_linked`.
- **R7** Когда чат-сессия анализируется, система shall брать клиента как `Entity{customer}`/`Customer`, а исполнителя задачи — как менеджера-`Person`.
- **R8** Когда открыта страница `chatbox/customers`, система shall предлагать к привязке клиентов (`Customer`), не сотрудников-external.
- **R9** Когда прогоняется backfill, система shall перенести существующие chatbox-`Person{external}` в `Customer`/`Entity{customer}` и переставить ссылки идемпотентно.
- **R10** Если осиротевший `Person{external}` не связан ни с чем кроме chatbox, then backfill его soft-delete (не хард-делит).
- **R11** Когда запрашивается `GET /api/v1/customers`, система shall вернуть клиентов (`Customer`) текущего tenant (`deletedAt:null`), с фильтром `q` по имени и пагинацией; `GET /api/v1/customers/:id` — одного клиента или 404.
- **R12** Когда пользователь открывает раздел «Клиенты» (`/customers`, пункт навигации в «Справочник»), система shall показать список клиентов компании (имя/контакт/статус), не сотрудников и не поставщиков.

---

## Pre-mortem / Риски и ревью-аспекты (для strict-production-review-gate)

- **Потеря данных при backfill:** soft-delete `Person` только при строгой проверке «нет иных ссылок»; всё под `--dry-run` сначала; idempotency как acceptance. Ревью: проверить, что гард «осиротевший» не задевает менеджеров (`relationship='employee'`) и клиентов с `userId`/`Membership`.
- **Дедуп-коллапс:** `findOrCreateCustomerEntity` может слить двух разных клиентов с одинаковым именем без strong-id. Митигировать приоритетом email/externalCrmId; ревью kNN/name-fallback на ложные merge.
- **Порядок деплоя:** миграция (`migrate deploy`) идёт ДО backfill — поэтому НЕ дропаем `linkedPersonId` в этом релизе (Б4). Ревью: backfill читает старую колонку.
- **Tenant-leak:** все запросы `Customer`/`Entity`/`EntityLink` — с `tenantId`. Ревью: `@@index([tenantId,…])`, нет cross-tenant выборок.
- **Висящий контракт FE↔BE:** DTO меняется (`linkedPerson`→`linkedCustomer`, `personId`→`customerId`) — Ф3 и Ф5 должны мёржиться вместе либо FE толерантен к старому полю на время выката (Ship-On: выкатываем согласованно).
- **prompt caching:** LLM-путь (`generateSummary`, task-extraction) не меняется по структуре промпта — стабильный system, переменные данные в конце user (без регресса). Раздел «совместимость с prompt caching»: не релевантно (промпты не трогаем).

## Идемпотентность / flag / prod-deploy

- Flag: нет (Б5, Ship-On).
- Idempotency: backfill — повторный прогон no-op (acceptance Ф6); `findOrCreateCustomerEntity` — дедуп-safe.
- prod-deploy-log: Шаг 4 (новая модель `Customer`+enum+колонки), Шаг 8 (новый backfill в STEPS). Новых ENV нет → Шаг 1 без изменений. Новых очередей/cron нет → Шаг 12 без изменений.

## DoD

- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные (backend и frontend).
- vitest по затронутым spec — зелёные.
- second-brain обновлён: `02_architecture/data-model.md` (новая модель `Customer`), `02_architecture/module-map.md` (новый модуль `customers` + связь chatbox↔knowledge-core), `01_projects/frontend-pages.md` (раздел/страница «Клиенты» `/customers`), `01_projects/api-layer.md` (`/api/v1/customers`), профильная `01_projects/<chatbox>.md`; реестр `second-brain/04_не-сделано/README.md` — строки про отложенный DROP `linkedPersonId`, Bitrix-унификацию, карточку `/customers/:id` (vNext).
- `docs/operations/prod-deploy-log.md` — Шаги 4 и 8 обновлены; backfill в `apply-prod-deploy.ts` STEPS.
- Рефлексия в `second-brain/05_история/`.

## Итог
(Заполнит tz-orchestrator: реализовано целиком/частично, что осталось, ссылки на коммиты.)
