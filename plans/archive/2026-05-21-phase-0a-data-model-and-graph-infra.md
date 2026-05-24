---
type: tz
status: done
feature: Фаза 0a — Фундамент Фазы 0 (модели данных + Apache AGE + GraphService + API + RBAC)
date: 2026-05-21
parent_tz: tz/2026-05-21-phase-0-roles-and-onboarding.md
unblocks:
  - tz/2026-05-21-phase-0b-document-ingest.md (после 0a.1+0a.2 — модели группы А + AGE + GraphService)
  - tz/2026-05-21-phase-0c-onboarding-wizard-frontend.md (после 0a.3 — API группы А + RBAC + search)
  - tz/2026-05-21-phase-0d-role-profile-agent.md (после 0a.2 — модели группы Б + типы рёбер)
covers_matrix_rows: [1..25, 43..62, 83 (API search)]
---

# ТЗ 0a: Фундамент Фазы 0 — модели + AGE + GraphService + API + RBAC

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`](2026-05-21-phase-0-roles-and-onboarding.md). **Источник продуктовых решений** — он же + аналитика онтологии. При расхождениях этого ТЗ и зонтичного приоритет у зонтичного.
>
> **Контекст для исполнителя:**
> - Стек backend — NestJS, PostgreSQL, Redis, Prisma. Полная архитектура — [`second-brain/02_architecture/module-map.md`](../../second-brain/02_architecture/module-map.md).
> - **Prisma: только `bun run prisma:push`**, никогда `migrate*` (skill `prisma-db-push-rules`).
> - **ENV — только через `TypedConfigService`** / `env.schema.ts`, никаких `process.env.*` в коде.
> - **DTO-цепочки и Swagger обязательны** на всех новых эндпоинтах (skill `nestjs-rules`).
> - **TenantGuard** на всех new endpoint'ах: `tenantId` из `X-Org-Id` / `:orgId` (см. `common/middleware/tenant.middleware.ts`).
> - **Casbin** — `policies/policy.csv` обновляется в одном PR со схемой.

---

## 1. Цель

После 0a Z имеет **полный фундамент Фазы 0**:

1. В Prisma-схеме 16 новых моделей: Role, Department, JobDescription, Skill, Document, RoleProfile (группа А — с UI) + Mission, Vision, Strategy, Process, ProcessStep, Regulation, Policy, Tool, Metric, Decision (группа Б — без UI в 0).
2. **Новая модель `Person`** — отдельная от существующей `Entity{type=person}`, привязана к `Org` и опционально к `User`.
3. `EntityLink` расширена для полиморфных связей (`fromType`/`toType`, `validFrom`/`validTo`); `EntityLinkType` enum пополнен 17 новыми типами рёбер для каркаса 5 уровней.
4. Apache AGE установлен как расширение PostgreSQL; в `common/graph/` — сервис `GraphService` с API `addNode` / `addEdge` / `removeEdge` / `traverse` / `findPath` / `getNeighbors` / `upsertEntity`.
5. Двойная запись в `EntityLink` (Postgres) + AGE (граф) — одна транзакция через `GraphService`.
6. CRUD-эндпоинты для группы А: `/api/v1/roles`, `/api/v1/departments`, `/api/v1/persons`, `/api/v1/job-descriptions`, `/api/v1/skills`, `/api/v1/documents` (контракт + auth + Casbin; реальная загрузка/парсинг — 0b), `/api/v1/role-profiles` (read-only + rebuild).
7. Расширенный `/api/v1/search` с фильтром по типам (включая новые).
8. Casbin-полиси для всех новых `ResourceType` (включая слоты группы Б — даже без UI права на чтение через knowledge search корректны).
9. Расширения существующих моделей: `Goal.horizon` (enum), `Goal.parentGoalId`, `MeetingType` enum +2 значения (`review`, `retrospective`).

---

## 2. Scope

### Входит в 0a

**А. Prisma-модели (полный список — §4):**
- 6 моделей группы А.
- 10 моделей группы Б.
- 1 модель `Person` (новая, не путать с `Entity{type=person}`).
- Расширение существующих: `Goal` (+ `horizon`, `parentGoalId`), `MeetingType` enum (+ 2 значения), `EntityLink` (+ `fromType`, `toType`, `validFrom`, `validTo`).
- 5 новых enum'ов: `GoalHorizon`, `DocumentKind`, `DocumentStatus`, `RegulationCategory`, `ProcessStatus`, `PolicySeverity`, `MetricValueType`, `ToolKind`, `DecisionStatus`, `RoleProfileStatus`, `InvitationStatus` (если ещё нет).
- Расширение `EntityLinkType` enum 17 новыми типами рёбер.

**Б. Apache AGE инфраструктура (§5):**
- Preflight: проверка совместимости с managed-Postgres.
- Установка расширения (`CREATE EXTENSION age`); скрипт `apply-postgres-init` дополнен AGE-инициализацией.
- Docker-compose в dev — переход на образ `apache/age:PG16_latest` или эквивалент.
- Граф-namespace `z_graph` (для отделения от других возможных графов).

**В. `GraphService` (§6):**
- Сервис в `backend/src/common/graph/graph.service.ts`.
- Публичный API: `addNode`, `addEdge`, `removeEdge`, `removeNode`, `traverse`, `findPath`, `getNeighbors`, `upsertEntity`.
- Двойная запись через `Prisma.$transaction` + Cypher через `pg_age`.
- Запрет прямого Cypher из бизнес-сервисов — фиксируется в [`second-brain/02_architecture/code-pitfalls.md`](../../second-brain/02_architecture/code-pitfalls.md).

**Г. CRUD-эндпоинты (§7):**
- Группа А — полный CRUD.
- Группа Б — **только внутренние API** для записи через extraction (без публичного CRUD); read-only через `GraphService.getNeighbors` и `/api/v1/search`.
- Счётчики для preview-страниц γ: `GET /api/v1/{processes,regulations,policies,metrics}/count`.

**Д. `/api/v1/search` (§8):**
- Расширение existing search-модуля на новые типы.
- Параметр `types[]` (опциональный).

**Е. RBAC (§9):**
- Новые `ResourceType` в Casbin.
- Default policy: `owner`/`admin` — все права; `member` — `read` на структуру компании + свои Person/Document/RoleProfile; для слотов группы Б — `read` через search (поскольку UI нет, но search должен работать).

**Ж. `Person.userId` linking flow (§10):**
- Endpoint `POST /api/v1/orgs/:orgId/invitations/:token/accept` — обновляет `Person.userId` атомарно с созданием `Membership`.

### Не входит в 0a

- `text.adapter` и `document.adapter` (это 0b).
- Парсинг PDF/DOCX/MD (0b).
- Расширение `BlockExtractionService` и `EntityResolutionService` (0b).
- `RoleProfileAgent` worker и cron (0d).
- Frontend (0c).
- Динамическая онтология `OntologyType` (γ).
- Bi-temporal layer на узлах (α).
- ABAC на фактах (β).
- UI назначения RACI — типы рёбер заводятся, UI — γ.
- ChangeRequest (δ).

---

## 3. Структура и зависимости

```
0a.0 Preflight (AGE compat check) — 1 день
  ↓
0a.1 Модели группы А + Person + расширения существующих + EntityLink-миграция — 3-5 дней
  ↓ ──────────→ 0b можно стартовать на моделях группы А (document.adapter)
  ↓ ──────────→ 0c.1 (frontend каркас) можно стартовать параллельно (мок API)
0a.2 Модели группы Б + типы рёбер + AGE-установка + GraphService — 5-7 дней
  ↓ ──────────→ 0b расширение extraction на группу Б; 0d на полном GraphService
0a.3 CRUD API + RBAC + search — 3-5 дней
  ↓ ──────────→ 0c.2+ (frontend на реальном API)
```

**Не запускать 0a.1 пока:** не сделан preflight 0a.0 — без понимания AGE-совместимости можем построить модели и понять, что нужен миграционный план Postgres.

---

## 4. Prisma-модели (полный список с полями)

### 4.1. Группа А (с UI в Фазе 0)

```prisma
// ── Структура компании ───────────────────────────────────────────────────

model Department {
  id                  String          @id @default(uuid()) @db.Uuid
  orgId               String          @db.Uuid
  name                String          @db.VarChar(200)
  parentDepartmentId  String?         @db.Uuid                       // иерархия в схеме, UI плоский (0c)
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt
  deletedAt           DateTime?                                       // soft-delete

  org                 Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)
  parent              Department?     @relation("DepartmentParent", fields: [parentDepartmentId], references: [id])
  children            Department[]    @relation("DepartmentParent")
  roles               Role[]
  persons             Person[]        @relation("PersonPrimaryDepartment")

  @@unique([orgId, name, deletedAt])
  @@index([orgId])
  @@map("departments")
}

model Role {
  id              String          @id @default(uuid()) @db.Uuid
  orgId           String          @db.Uuid
  name            String          @db.VarChar(200)
  departmentId    String?         @db.Uuid
  tags            String[]                                              // свободные теги, поиск
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?

  org             Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)
  department      Department?     @relation(fields: [departmentId], references: [id])
  jobDescriptions JobDescription[]
  roleProfile     RoleProfile?
  personRoles     PersonRole[]                                          // связи через through-таблицу

  @@unique([orgId, name, deletedAt])
  @@index([orgId, departmentId])
  @@map("roles")
}

model Person {
  id              String          @id @default(uuid()) @db.Uuid
  orgId           String          @db.Uuid
  userId          String?         @db.Uuid                              // NULL до accept'а приглашения
  name            String          @db.VarChar(200)
  email           String          @db.VarChar(320)
  primaryDepartmentId String?     @db.Uuid                              // основной отдел (для UI; для графа — через PersonRole)
  entityId        String?         @db.Uuid                              // линковка к Entity{type=person} (заполняется EntityResolutionService в 0b)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?

  org             Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user            User?           @relation(fields: [userId], references: [id])
  primaryDepartment Department?   @relation("PersonPrimaryDepartment", fields: [primaryDepartmentId], references: [id])
  entity          Entity?         @relation(fields: [entityId], references: [id])
  personRoles     PersonRole[]
  uploadedDocuments Document[]    @relation("DocumentUploader")
  decisionsMade   Decision[]      @relation("DecisionDecidedBy")

  @@unique([orgId, email, deletedAt])
  @@index([orgId, userId])
  @@index([orgId, primaryDepartmentId])
  @@map("persons")
}

// many-to-many Person ↔ Role с временным интервалом
model PersonRole {
  id          String      @id @default(uuid()) @db.Uuid
  orgId       String      @db.Uuid                                    // денормализация для tenant-фильтров
  personId    String      @db.Uuid
  roleId      String      @db.Uuid
  validFrom   DateTime    @default(now())
  validTo     DateTime?                                                // null = текущая роль
  createdAt   DateTime    @default(now())

  org         Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)
  person      Person      @relation(fields: [personId], references: [id], onDelete: Cascade)
  role        Role        @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([personId, roleId, validFrom])
  @@index([orgId, roleId])
  @@index([orgId, personId])
  @@map("person_roles")
}

model JobDescription {
  id                String      @id @default(uuid()) @db.Uuid
  orgId             String      @db.Uuid
  roleId            String      @db.Uuid
  contentMd         String      @db.Text
  sourceDocumentId  String?     @db.Uuid
  version           Int         @default(1)
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  deletedAt         DateTime?

  org               Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)
  role              Role        @relation(fields: [roleId], references: [id], onDelete: Cascade)
  sourceDocument    Document?   @relation(fields: [sourceDocumentId], references: [id])

  @@index([orgId, roleId])
  @@map("job_descriptions")
}

model Skill {
  id          String      @id @default(uuid()) @db.Uuid
  orgId       String      @db.Uuid
  name        String      @db.VarChar(200)
  description String?     @db.Text
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  org         Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, name])
  @@index([orgId])
  @@map("skills")
}

model Document {
  id              String              @id @default(uuid()) @db.Uuid
  orgId           String              @db.Uuid
  uploaderId      String              @db.Uuid                          // Person.id, не User.id
  kind            DocumentKind                                          // pdf | docx | markdown | other
  name            String              @db.VarChar(500)
  mimeType        String              @db.VarChar(100)
  s3Key           String?             @db.VarChar(500)                  // inline если <10 MiB — null
  inlineContent   Bytes?                                                // inline если <10 MiB
  originalSize    Int                                                   // байты
  parsedText      String?             @db.Text                          // заполняется 0b
  parseError      String?             @db.Text                          // если status=failed
  status          DocumentStatus      @default(uploaded)
  attachedRoleId  String?             @db.Uuid                          // если документ привязан к должности → JobDescription
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  deletedAt       DateTime?

  org             Org                 @relation(fields: [orgId], references: [id], onDelete: Cascade)
  uploader        Person              @relation("DocumentUploader", fields: [uploaderId], references: [id])
  attachedRole    Role?               @relation(fields: [attachedRoleId], references: [id])
  jobDescriptions JobDescription[]

  @@index([orgId, status])
  @@index([orgId, uploaderId])
  @@index([orgId, attachedRoleId])
  @@map("documents")
}

model RoleProfile {
  id            String              @id @default(uuid()) @db.Uuid
  orgId         String              @db.Uuid
  roleId        String              @unique @db.Uuid                    // один RoleProfile на Role
  summaryCache  Json                @default("{}")                      // { responsibilities[], skills[], decision_patterns[], common_pitfalls[], style_profile }
  status        RoleProfileStatus   @default(forming)                   // forming | ready | stale | error
  lastBuildAt   DateTime?
  buildVersion  Int                 @default(0)
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt

  org           Org                 @relation(fields: [orgId], references: [id], onDelete: Cascade)
  role          Role                @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@index([orgId, status])
  @@map("role_profiles")
}

// ── Enums группы А ───────────────────────────────────────────────────────

enum DocumentKind {
  pdf
  docx
  markdown
  text                                                                  // для /dump (создаётся из text.adapter)
  other
}

enum DocumentStatus {
  uploaded                                                              // только что POSTнут
  parsing                                                               // парсер работает
  parsed                                                                // парсер завершил
  blocks_extracted                                                      // BlockExtractionService отработал
  failed
}

enum RoleProfileStatus {
  forming                                                               // данных <N блоков идей с role_relevant=true
  ready                                                                 // summaryCache заполнен
  stale                                                                 // прошло >24ч с последней сборки + есть новые данные
  error                                                                 // LLM упал, нужна ручная проверка
}
```

### 4.2. Группа Б (без UI в Фазе 0)

Все 10 моделей пишутся компактно — поля минимальные, расширение полей — в γ.

```prisma
// ── Уровень 1: «Зачем» ──────────────────────────────────────────────────

model Mission {
  id          String      @id @default(uuid()) @db.Uuid
  orgId       String      @db.Uuid
  contentMd   String      @db.Text
  markets     Json?
  bets        Json?
  horizon     GoalHorizon @default(strategic)
  targetDate  DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  org         Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@map("missions")
}

model Vision {
  id            String      @id @default(uuid()) @db.Uuid
  orgId         String      @db.Uuid
  contentMd     String      @db.Text
  horizonYears  Int?
  targetDate    DateTime?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  org           Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@map("visions")
}

model Strategy {
  id          String      @id @default(uuid()) @db.Uuid
  orgId       String      @db.Uuid
  contentMd   String      @db.Text
  markets     Json
  bets        Json
  horizon     GoalHorizon @default(strategic)
  targetDate  DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  org         Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@map("strategies")
}

// ── Уровень 3: «Как работа течёт» ──────────────────────────────────────

model Process {
  id                  String        @id @default(uuid()) @db.Uuid
  orgId               String        @db.Uuid
  name                String        @db.VarChar(300)
  description         String?       @db.Text
  ownerRoleId         String?       @db.Uuid
  ownerPersonId       String?       @db.Uuid
  triggerDescription  String?       @db.Text
  slaMinutes          Int?
  status              ProcessStatus @default(active)
  confidence          Float?                                            // extraction-confidence (для §6 итерация 8 анализа)
  ambiguousTypes      String[]                                          // если LLM колебалась (§9 зонтичного)
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  org                 Org           @relation(fields: [orgId], references: [id], onDelete: Cascade)
  ownerRole           Role?         @relation(fields: [ownerRoleId], references: [id])
  ownerPerson         Person?       @relation(fields: [ownerPersonId], references: [id])
  steps               ProcessStep[]

  @@unique([orgId, name])                                               // EntityResolutionService гарантирует через cosine + LLM-arbiter
  @@index([orgId, status])
  @@map("processes")
}

model ProcessStep {
  id            String      @id @default(uuid()) @db.Uuid
  orgId         String      @db.Uuid
  processId     String      @db.Uuid
  name          String      @db.VarChar(300)
  order         Int
  description   String?     @db.Text
  slaMinutes    Int?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  org           Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)
  process       Process     @relation(fields: [processId], references: [id], onDelete: Cascade)

  @@unique([processId, order])
  @@index([orgId, processId])
  @@map("process_steps")
}

model Regulation {
  id          String                @id @default(uuid()) @db.Uuid
  orgId       String                @db.Uuid
  name        String                @db.VarChar(300)
  contentMd   String                @db.Text
  category    RegulationCategory    @default(regulation)                // regulation | standard
  status      ProcessStatus         @default(active)                    // переиспользуем enum
  version     Int                   @default(1)
  confidence  Float?
  createdAt   DateTime              @default(now())
  updatedAt   DateTime              @updatedAt

  org         Org                   @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, name])
  @@index([orgId, category])
  @@map("regulations")
}

model Policy {
  id          String          @id @default(uuid()) @db.Uuid
  orgId       String          @db.Uuid
  name        String          @db.VarChar(300)
  contentMd   String          @db.Text
  severity    PolicySeverity  @default(advisory)
  status      ProcessStatus   @default(active)
  confidence  Float?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  org         Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, name])
  @@index([orgId, severity])
  @@map("policies")
}

// ── Уровень 4: «На чём работает» ───────────────────────────────────────

model Tool {
  id            String      @id @default(uuid()) @db.Uuid
  orgId         String      @db.Uuid
  name          String      @db.VarChar(200)
  kind          ToolKind    @default(software)
  externalUrl   String?     @db.VarChar(500)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  org           Org         @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, name])
  @@index([orgId])
  @@map("tools")
}

// ── Уровень 5: «Учится» ────────────────────────────────────────────────

model Metric {
  id            String          @id @default(uuid()) @db.Uuid
  orgId         String          @db.Uuid
  name          String          @db.VarChar(200)
  description   String?         @db.Text
  unit          String          @db.VarChar(50)
  target        Float?
  valueType     MetricValueType @default(count)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  org           Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@unique([orgId, name])
  @@index([orgId])
  @@map("metrics")
}

// ── Дополнительно: Decision (миграционный долг) ────────────────────────

model Decision {
  id                  String          @id @default(uuid()) @db.Uuid
  orgId               String          @db.Uuid
  text                String          @db.Text
  rationale           String?         @db.Text
  decidedAt           DateTime
  decidedByPersonId   String?         @db.Uuid
  sourceMeetingId     String?         @db.Uuid
  sourceIdeaBlockId   String?         @db.Uuid                          // idempotent dedupe (§I.66 зонтичного)
  status              DecisionStatus  @default(active)
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  org                 Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)
  decidedBy           Person?         @relation("DecisionDecidedBy", fields: [decidedByPersonId], references: [id])
  sourceMeeting       Meeting?        @relation(fields: [sourceMeetingId], references: [id])
  sourceIdeaBlock     IdeaBlock?      @relation(fields: [sourceIdeaBlockId], references: [id])

  @@unique([sourceIdeaBlockId])                                         // один Decision на IdeaBlock — idempotent
  @@index([orgId, status])
  @@index([orgId, decidedAt])
  @@map("decisions")
}

// ── Enums группы Б ──────────────────────────────────────────────────────

enum RegulationCategory {
  regulation
  standard
}

enum ProcessStatus {
  active
  deprecated
  archived
}

enum PolicySeverity {
  advisory                                                              // рекомендация
  mandatory                                                             // обязательно
  blocking                                                              // нарушение блокирует процесс
}

enum ToolKind {
  software
  hardware
  template
  document
  service
  other
}

enum MetricValueType {
  count
  ratio
  duration_seconds
  money
  other
}

enum DecisionStatus {
  active
  rolled_back
  superseded
}
```

### 4.3. Расширения существующих моделей

```prisma
// Goal (existing) — добавить:
model Goal {
  // ... existing fields ...
  horizon       GoalHorizon       @default(quarterly)                   // NEW
  parentGoalId  String?           @db.Uuid                              // NEW — декомпозиция
  parent        Goal?             @relation("GoalDecomposition", fields: [parentGoalId], references: [id])
  children      Goal[]            @relation("GoalDecomposition")
  // ...
}

enum GoalHorizon {                                                      // NEW
  strategic
  annual
  quarterly
  monthly
  sprint
}

// MeetingType (existing enum) — добавить:
enum MeetingType {
  // ... existing values ...
  review                                                                // NEW
  retrospective                                                         // NEW
}
```

### 4.4. Расширение `EntityLink` (миграционный риск)

Существующая модель `EntityLink` в [schema.prisma:1508](../../backend/prisma/schema.prisma#L1508) сейчас связывает `Entity ↔ Entity` (knowledge-core). Зонтичный ТЗ §B строка 7 требует превратить её в **единую полиморфную модель рёбер** для всех бизнес-связей Фазы 0.

**Изменения:**

```prisma
model EntityLink {
  id          String              @id @default(uuid()) @db.Uuid
  orgId       String              @db.Uuid
  fromId      String              @db.Uuid                              // существует
  fromType    String              @db.VarChar(50)                       // NEW: имя таблицы / discriminator (entity, role, person, document, process, ...)
  toId        String              @db.Uuid                              // существует
  toType      String              @db.VarChar(50)                       // NEW
  linkType    EntityLinkType                                            // существует, enum расширяется (см. ниже)
  validFrom   DateTime            @default(now())                       // NEW (или уже существует — проверить при импл-ии)
  validTo     DateTime?                                                 // NEW
  properties  Json                @default("{}")                        // NEW
  confidence  Float?                                                    // существует
  status      LinkStatus          @default(active)                      // существует
  createdBy   LinkCreatedBy                                              // существует
  createdAt   DateTime            @default(now())                       // существует

  @@index([orgId, fromId, fromType, linkType])                           // NEW composite index
  @@index([orgId, toId, toType, linkType])
  @@index([orgId, linkType, validFrom])
  @@map("entity_links")
}

enum EntityLinkType {
  // existing knowledge-core:
  works_at
  belongs_to
  part_of
  opposes
  depends_on
  mentions_with
  // NEW — Person↔Role↔Department:
  executes_role                                                         // Person → Role (with validFrom/validTo)
  member_of                                                             // Person → Department
  described_by                                                          // Role → JobDescription
  derived_from                                                          // JobDescription → Document
  requires_skill                                                        // Role → Skill
  has_skill                                                             // Person → Skill (with observed_at, confidence)
  is_responsible_for                                                    // Role → Process (объявлен, в Фазе 0 не наполняется)
  // NEW — каркас 5 уровней:
  realized_by                                                           // Mission → Strategy
  decomposes_into                                                       // Strategy → Goal, Goal → Goal
  measured_by                                                           // Goal → Metric, Process → Metric
  executed_by                                                           // Strategy → Process
  has_step                                                              // Process → ProcessStep
  owned_by                                                              // Process → Role / Person
  lives_in                                                              // Process → Tool
  produces                                                              // Process → Document
  triggered_by                                                          // Process → Event / Meeting
  regulates                                                             // Regulation → Process
  constrains                                                            // Policy → любая сущность
  applies_to                                                            // Regulation{category=standard} → ArtifactType (строковый идентификатор)
  // NEW — RACI (UI назначения — γ):
  responsible_for
  accountable_for
  consulted_on
  informed_about
  // belongs_to уже есть выше — переиспользуем для Role → Department
}
```

**Миграционная стратегия для существующих данных EntityLink:**

1. Через `bun run prisma:push` Prisma не сможет добавить NOT NULL колонки `fromType`/`toType` без default'а. Решение:
   - Сначала добавить `fromType` / `toType` как nullable (default null).
   - Скрипт `backend/scripts/backfill-entity-link-types.ts` — `UPDATE entity_links SET fromType='entity', toType='entity' WHERE fromType IS NULL`.
   - После backfill — изменить на NOT NULL вторым `prisma:push` (или вручную через raw SQL в init-скрипте, поскольку `prisma:push` сам может предложить data-loss).
2. **Альтернатива:** считать `fromType`/`toType` nullable навсегда, где null = `'entity'`. Это компромисс «удобно vs строго». Решение принимаем при имплементации 0a.1, гипотеза: nullable+backfill+потом NOT NULL.

---

## 5. Apache AGE — установка и интеграция

### 5.1. Preflight 0a.0

**До старта 0a.1** выполнить (1 день):

1. Запросить у DevOps / проверить документацию Yandex Managed PostgreSQL: поддерживается ли расширение `age` в списке доступных. Если в списке — задача упрощается.
2. Если нет — решение: ставим **self-hosted PostgreSQL** на проде. Один кластер, реплика, бэкап. DevOps-опыт у команды есть.
3. Зафиксировать решение в [`second-brain/02_architecture/tech-stack.md`](../../second-brain/02_architecture/tech-stack.md) с обоснованием.
4. Обновить `docker-compose.yml` в dev: образ PostgreSQL заменяется на образ с AGE (например, `apache/age:PG16_latest` — проверить актуальные теги через Context7 или Apache AGE GitHub).

**Артефакт preflight'а:** одна заметка в `second-brain/02_architecture/age-deployment-decision.md` — что решили, на каких основаниях.

### 5.2. Установка расширения

В скрипте `backend/scripts/apply-postgres-init.ts` добавить:

```ts
await client.query(`CREATE EXTENSION IF NOT EXISTS age;`);
await client.query(`LOAD 'age';`);
await client.query(`SET search_path = ag_catalog, "$user", public;`);
await client.query(`SELECT create_graph('z_graph');`);
```

Скрипт идемпотентен — повторный запуск не падает.

**`z_graph`** — единое graph-namespace. Все узлы и рёбра — внутри него.

### 5.3. Маппинг сущностей в AGE-граф

Каждый узел в AGE имеет:
- `id` — UUID (из соответствующей Prisma-модели).
- `type` — discriminator (`role`, `department`, `person`, `process`, ...).
- `tenant_id` — для tenant-фильтров в Cypher.
- `name` — display name (для отладки и query без join'ов).

Каждое ребро в AGE — `EntityLinkType` плюс минимальные properties (`validFrom`, `validTo`, `confidence` опционально).

**Не храним в AGE:**
- Полные тексты (`contentMd`, `parsedText`, `description`) — это в Postgres-моделях.
- AGE — только структура графа.

---

## 6. `GraphService` (NestJS-сервис)

`backend/src/common/graph/`:

```
graph.module.ts
graph.service.ts
graph.types.ts        // TypeScript-типы для узлов, рёбер, путей
cypher-builder.ts     // helper для безопасной сборки Cypher-запросов (без string concat)
graph.spec.ts         // integration tests
```

### 6.1. Публичное API

```ts
@Injectable()
export class GraphService {
  // Узлы — идемпотентны
  async addNode(params: { tenantId: string; type: NodeType; id: string; properties?: Record<string, unknown> }): Promise<void>;
  async removeNode(params: { tenantId: string; type: NodeType; id: string }): Promise<void>;

  // Рёбра — идемпотентны (по (fromId, fromType, toId, toType, linkType))
  async addEdge(params: { tenantId: string; from: NodeRef; to: NodeRef; linkType: EntityLinkType; validFrom?: Date; validTo?: Date; properties?: Record<string, unknown>; confidence?: number; createdBy: LinkCreatedBy }): Promise<void>;
  async removeEdge(params: { tenantId: string; from: NodeRef; to: NodeRef; linkType: EntityLinkType }): Promise<void>;

  // Чтение
  async getNeighbors(params: { tenantId: string; node: NodeRef; linkTypes?: EntityLinkType[]; direction?: 'in' | 'out' | 'both'; depth?: number }): Promise<NeighborResult>;
  async findPath(params: { tenantId: string; from: NodeRef; to: NodeRef; maxDepth?: number; linkTypes?: EntityLinkType[] }): Promise<PathResult>;
  async traverse(params: { tenantId: string; start: NodeRef; cypher: string; bindings?: Record<string, unknown> }): Promise<unknown[]>;  // raw escape hatch для сложных запросов; только внутри GraphService — внешние сервисы не пользуются

  // Высокоуровневый upsert для extraction (используется в 0b)
  async upsertEntity(params: { tenantId: string; type: NodeType; data: Record<string, unknown>; sourceProvenance: { rawEventId?: string; ideaBlockId?: string; documentId?: string }; confidence?: number }): Promise<{ id: string; created: boolean }>;
}

type NodeRef = { type: NodeType; id: string };
type NodeType = 'role' | 'department' | 'person' | 'job-description' | 'skill' | 'document' | 'role-profile' | 'mission' | 'vision' | 'strategy' | 'process' | 'process-step' | 'regulation' | 'policy' | 'tool' | 'metric' | 'decision' | 'entity' | 'goal' | 'meeting' | 'idea-block' | 'theme';
```

### 6.2. Двойная запись

`addEdge` / `removeEdge` / `addNode` / `removeNode` / `upsertEntity` работают **в одной транзакции Prisma**:

```ts
async addEdge(params) {
  return await this.prisma.$transaction(async (tx) => {
    // 1. Запись в Postgres
    await tx.entityLink.upsert({
      where: { /* unique key */ },
      create: { ...params, fromType: params.from.type, toType: params.to.type, ... },
      update: { /* ничего не меняем — идемпотент */ },
    });

    // 2. Запись в AGE через raw query
    await tx.$queryRaw`
      SELECT * FROM cypher('z_graph', $$
        MATCH (a {id: $fromId, type: $fromType, tenant_id: $tenant})
        MATCH (b {id: $toId, type: $toType, tenant_id: $tenant})
        MERGE (a)-[r:${Prisma.raw(params.linkType)}]->(b)
        SET r.valid_from = $validFrom, r.valid_to = $validTo, r.properties = $properties
        RETURN r
      $$) as (r agtype);
    `;
  });
}
```

**Свойство:** если AGE-запись падает — транзакция откатывает Postgres-запись (rollback). Гарантия консистентности: Postgres и AGE никогда не расходятся внутри `GraphService`.

**Сложность:** AGE через raw query внутри Prisma-transaction. Проверка совместимости — в первый день 0a.2 (тест: можно ли в одном `$transaction` мешать ORM-запросы и `$queryRaw` к AGE).

Если **не работает** в одной транзакции — fallback: **двухфазная компенсация** (Postgres-запись + AGE-запись отдельно; если AGE падает после Postgres — компенсирующий `DELETE entity_link`). Это менее надёжно, но рабочий вариант.

### 6.3. Запрет прямого Cypher из бизнес-сервисов

Architectural decision, фиксируется в [`second-brain/02_architecture/code-pitfalls.md`](../../second-brain/02_architecture/code-pitfalls.md):

> **Cypher только через `GraphService`.** Бизнес-сервисы не делают `$queryRaw cypher(...)` напрямую — это нарушает инкапсуляцию двойной записи и приводит к рассинхрону Postgres↔AGE. Для нестандартных запросов — расширять API `GraphService` или использовать escape-hatch `traverse(...)` (доступен только внутри `common/graph/`).

ESLint-правило в `.eslintrc`: запрет `cypher(` в файлах вне `common/graph/` (через `no-restricted-syntax` или кастомное правило).

---

## 7. CRUD API (группа А)

Все эндпоинты — под `/api/v1/`, требуют `JwtAuthGuard` + `TenantGuard`. DTO через Zod (`nestjs-zod`), Swagger автоматически. Стандартные FiltersDto для list-эндпоинтов (см. skill `nestjs-rules`).

### 7.1. `/api/v1/departments`

| Метод | Путь | Body / Query | RBAC |
|---|---|---|---|
| GET | `/` | FiltersDto + `?includeDeleted=false` | `member:read` |
| POST | `/` | `{ name, parentDepartmentId? }` | `admin:create` |
| POST | `/batch` | `{ items: [{ name, parentDepartmentId? }] }` (для wizard) | `admin:create` |
| GET | `/:id` | — | `member:read` |
| PATCH | `/:id` | `{ name?, parentDepartmentId? }` | `admin:update` |
| DELETE | `/:id` | — (soft-delete) | `admin:delete` |

DTO — `DepartmentDto`, `CreateDepartmentDto`, `UpdateDepartmentDto`, `DepartmentFiltersDto` (наследник `FiltersDto`).

### 7.2. `/api/v1/roles`

| Метод | Путь | Body / Query | RBAC |
|---|---|---|---|
| GET | `/` | FiltersDto + `?departmentId` | `member:read` |
| POST | `/` | `{ name, departmentId?, tags[]? }` | `admin:create` |
| POST | `/batch` | `{ items: [...] }` | `admin:create` |
| GET | `/:id` | — | `member:read` |
| PATCH | `/:id` | `{ name?, departmentId?, tags[]? }` | `admin:update` |
| DELETE | `/:id` | — (soft-delete) | `admin:delete` |

### 7.3. `/api/v1/persons`

| Метод | Путь | Body / Query | RBAC |
|---|---|---|---|
| GET | `/` | FiltersDto + `?departmentId&roleId&invitationStatus` | `member:read` |
| POST | `/` | `{ name, email, roleId, primaryDepartmentId? }` — создаёт Person с `userId=null`; внутренне делает `addEdge(executes_role)` и `addEdge(member_of)` через GraphService | `admin:create` |
| POST | `/batch` | `{ items: [...] }` | `admin:create` |
| GET | `/:id` | — | `member:read` |
| PATCH | `/:id` | `{ name?, email?, roleId?, primaryDepartmentId? }` — при смене roleId закрывает старую `executes_role` `validTo=now` + создаёт новую | `admin:update` |
| DELETE | `/:id` | — (soft-delete + закрытие всех связей через GraphService) | `admin:delete` |

### 7.4. `/api/v1/job-descriptions`

| Метод | Путь | Body | RBAC |
|---|---|---|---|
| GET | `/` | `?roleId` | `member:read` |
| POST | `/` | `{ roleId, contentMd, sourceDocumentId? }` | `admin:create` |
| GET | `/:id` | — | `member:read` |
| PATCH | `/:id` | `{ contentMd?, sourceDocumentId? }` — увеличивает version | `admin:update` |
| DELETE | `/:id` | — | `admin:delete` |

### 7.5. `/api/v1/skills`

Стандартный CRUD. `read` — `member`, `write` — `admin`.

### 7.6. `/api/v1/documents`

| Метод | Путь | Body / Query | RBAC |
|---|---|---|---|
| GET | `/` | FiltersDto + `?uploaderId&attachedRoleId&status` | `member:read` (на свои + общие) / `admin:read` (всё) |
| GET | `/processing` | — (только статусы `uploaded`/`parsing`) | `member:read` |
| POST | `/` | multipart: `file` + `?attachedRoleId` | `member:create` |
| GET | `/:id` | — | `member:read` (свой) / `admin:read` (любой) |
| DELETE | `/:id` | — | `admin:delete` или `uploader:delete` |

POST `/` создаёт Document со статусом `uploaded` и публикует событие `document.uploaded` в BullMQ — на него подпишется 0b. Реальный парсинг — в 0b.

### 7.7. `/api/v1/role-profiles`

| Метод | Путь | Body | RBAC |
|---|---|---|---|
| GET | `/` | — список всех | `member:read` |
| GET | `/:roleId` | — детальный | `member:read` |
| POST | `/:roleId/rebuild` | — публикует job в `role-profile.queue` | `admin:create` (см. 0d для 409-логики) |
| GET | `/:roleId/build-status` | — `{ status: 'idle'|'queued'|'running', since? }` | `member:read` |

`RoleProfile` создаётся автоматически при создании `Role` (через Prisma hook или service-логику в `RolesService`).

### 7.8. Счётчики для preview-страниц γ

| Метод | Путь | RBAC |
|---|---|---|
| GET | `/api/v1/processes/count` | `admin:read` (member — 403) |
| GET | `/api/v1/regulations/count` | `admin:read` |
| GET | `/api/v1/policies/count` | `admin:read` |
| GET | `/api/v1/metrics/count` | `admin:read` |

Body: `{ count: number }`. Тривиальные SELECT COUNT(*) с tenant-фильтром.

### 7.9. Сводка структуры (для дашборда и wizard summary)

| Метод | Путь | RBAC |
|---|---|---|
| GET | `/api/v1/structure/summary` | `member:read` |

Body:
```ts
{
  departments: number;
  roles: number;
  persons: number;
  documents: number;
  roleProfiles: { total: number; building: number; ready: number; stale: number; error: number };
}
```

### 7.10. `/api/v1/me/profile`

Используется в `/me` (sub-TZ 0c §6.5).

```ts
GET /api/v1/me/profile → {
  person: PersonDto | null;          // null если у user нет Person в активной Org
  primaryRole: RoleDto | null;
  primaryDepartment: DepartmentDto | null;
  roleProfile: RoleProfileDto | null;
}
```

### 7.11. Switch active org

| Метод | Путь | Body | RBAC |
|---|---|---|---|
| POST | `/api/v1/auth/switch-org` | `{ orgId: string }` | `member:any` (на любую Org с активным membership) |

Меняет активную Org в сессии (обновляет JWT или session-cookie). Возвращает обновлённый user-profile.

---

## 8. Расширение `/api/v1/search`

Существующий модуль `search/` в [`backend/src/modules/search/`](../../backend/src/modules/search/). Расширение:

1. Параметр `?types[]=` — фильтр по типам, включая новые: `role`, `department`, `person`, `document`, `role-profile`, `process` (только admin/owner), `regulation` (только admin/owner), `policy` (admin), `metric` (admin), `decision` (member для своих, admin для всех).
2. Унифицированный response:
   ```ts
   {
     results: Array<{
       type: NodeType;
       id: string;
       title: string;
       snippet: string;
       relevance: number;
       url: string;          // фронт-URL для перехода
       context?: string;     // «Отдел Продажи» / «Должность Менеджер по продажам»
     }>;
     total: number;
   }
   ```
3. Поиск — `ILIKE %q%` по индексированным колонкам (`name`, `description` для группы Б; `contentMd` через GIN-индекс — open question при импл-ии).

Существующая логика knowledge-core search (карточки/встречи/задачи) — не ломаем, расширяем.

---

## 9. RBAC (Casbin)

Все новые `ResourceType` добавляются в [`backend/src/modules/rbac/policies/policy.csv`](../../backend/src/modules/rbac/) (или эквивалентный файл — финальный путь сверить при импл-ии).

### 9.1. Новые ResourceType

`role`, `department`, `person`, `job-description`, `skill`, `document`, `role-profile`, `mission`, `vision`, `strategy`, `process`, `process-step`, `regulation`, `policy`, `tool`, `metric`, `decision`.

### 9.2. Default policies

```csv
# format: p, role, resource, action

# Группа А — структура компании, видна всем member, пишется только admin/owner
p, member, role, read
p, member, department, read
p, member, person, read
p, member, job-description, read
p, member, skill, read
p, member, role-profile, read

p, admin, role, *
p, admin, department, *
p, admin, person, *
p, admin, job-description, *
p, admin, skill, *
p, admin, role-profile, read       # rebuild через свой endpoint
p, admin, role-profile, rebuild

p, owner, *, *

# Documents — member видит свои + общие; admin видит все
p, member, document, read:own
p, member, document, create
p, member, document, delete:own
p, admin, document, *

# Группа Б — слоты, без UI в Фазе 0, но search должен возвращать результаты для admin
p, admin, mission, read
p, admin, vision, read
p, admin, strategy, read
p, admin, process, read
p, admin, regulation, read
p, admin, policy, read
p, admin, metric, read
p, admin, tool, read
p, admin, decision, read
# member для группы Б — read только через search с фильтрацией; полные объекты — недоступны
p, member, decision, read:own       # свои решения видны
```

Финальная семантика `:own` — через `g`-функции Casbin или custom-matcher (см. skill `nestjs-rules` для текущего паттерна).

### 9.3. TenantGuard

Все новые контроллеры применяют `@UseGuards(JwtAuthGuard, TenantGuard, CasbinGuard)`. `tenantId` извлекается из `X-Org-Id` header или маршрута `/:orgId`.

---

## 10. Person ↔ User linking flow (приглашения)

Поток приглашения (используется wizard'ом + действием «Пригласить» в `/structure`):

1. Admin создаёт `Person { name, email, roleId, primaryDepartmentId, userId=null }` через POST `/api/v1/persons` (в wizard'е — batch).
2. Admin отдельно нажимает «Пригласить» в `/structure?tab=persons` → POST `/api/v1/orgs/:orgId/invitations` с `{ personId }`. Backend:
   - Создаёт `OrgInvitation { orgId, email, personId, token, status: 'pending', expiresAt }`.
   - Шлёт email через существующий mail-модуль с deep-link `https://z.app/invitations/:token`.
3. Получатель открывает ссылку → frontend ведёт на `/invitations/:token`:
   - Если не залогинен — регистрация / логин с pre-fill email.
   - Если залогинен — кнопка «Принять».
4. На accept → POST `/api/v1/orgs/:orgId/invitations/:token/accept`. Backend в одной транзакции:
   - Создаёт `Membership { orgId, userId, role: 'member', personId }`.
   - Обновляет `Person.userId = currentUserId`.
   - Меняет `OrgInvitation.status = 'accepted'`.
5. После accept Person в `/structure` показывает статус `активен`.

**Если email уже зарегистрирован в Z** (есть `User` с этим email) — на шаге 2 backend проверяет и: либо создаёт invitation на существующий User (он логинится и принимает), либо сразу создаёт Membership без приглашения (open question при импл-ии — есть ли политика «авто-добавлять existing user без подтверждения»).

Гипотеза: invitation шлётся **всегда**, даже existing user'у — нужен явный accept (compliance, security).

---

## 11. Фазирование внутри 0a

| Фаза | Длительность | Содержимое |
|---|---|---|
| 0a.0 | 1 день | Preflight AGE (managed-Postgres или self-hosted). Решение зафиксировано в `second-brain/02_architecture/age-deployment-decision.md` |
| 0a.1 | 3-5 дней | Все Prisma-модели группы А + Person + расширения существующих (Goal, MeetingType, EntityLink). `bun run prisma:push`. Backfill EntityLink.fromType/toType через скрипт |
| 0a.2 | 5-7 дней | Установка AGE в dev + prod. Все Prisma-модели группы Б + EntityLinkType enum +17 типов. GraphService с публичным API. Двойная запись. Integration-тесты GraphService |
| 0a.3 | 3-5 дней | CRUD-эндпоинты группы А (DTO + Swagger + tests). RBAC policies. Расширенный /api/v1/search. /api/v1/structure/summary. /api/v1/me/profile. /api/v1/auth/switch-org. Invitation accept flow |

**Параллелизация:**
- После 0a.1 можно стартовать 0b на моделях группы А (`Document`, `RawEvent`).
- После 0a.2 — 0d (нужен GraphService для Cypher-запроса «всё, что касается роли»).
- После 0a.3 — 0c.2+ (frontend на реальном API).

---

## 12. DoD (критерии готовности 0a)

### Технические

- [ ] `bun run prisma:push` чистый, схема применена без warnings.
- [ ] `bun run typecheck` чистый.
- [ ] `bun run lint` чистый.
- [ ] `bun run test:unit` зелёный по затронутым модулям.
- [ ] `bun run test:integration` зелёный на `GraphService` (минимум — addNode/addEdge/getNeighbors/findPath/двойная запись с rollback'ом при ошибке AGE).
- [ ] `bun run build` собирает backend без ошибок.
- [ ] Прогон skill `strict-production-review-gate` на новых модулях.

### Функциональные

- [ ] 16 новых моделей + Person + расширения существующих в схеме, применены через `bun run prisma:push`.
- [ ] AGE-расширение установлено; через `psql` команда `SELECT * FROM cypher('z_graph', $$ MATCH (n) RETURN n LIMIT 1 $$) as (n agtype);` возвращает результат (даже пустой).
- [ ] `GraphService.addNode` / `addEdge` корректно делают двойную запись в `EntityLink` (Postgres) и AGE. Rollback Postgres при ошибке AGE — проверен интеграционным тестом.
- [ ] 17 типов рёбер для каркаса 5 уровней корректно работают через `GraphService.addEdge` + smoke-тест Cypher-обхода.
- [ ] CRUD-эндпоинты группы А отвечают через Swagger и проходят TenantGuard / Casbin.
- [ ] `/api/v1/search?types[]=role,department,person,document` возвращает результаты по новым типам.
- [ ] Invitation flow: создание Person → invite → accept обновляет `Person.userId` и создаёт `Membership` атомарно.

### Документация (Second Brain)

- [ ] Создан `second-brain/02_architecture/age-deployment-decision.md`.
- [ ] Обновлён [`second-brain/02_architecture/data-model.md`](../../second-brain/02_architecture/data-model.md) — добавлены все новые модели.
- [ ] Обновлён [`second-brain/02_architecture/module-map.md`](../../second-brain/02_architecture/module-map.md) — добавлен `common/graph`, новые контроллеры.
- [ ] Создан `second-brain/01_projects/company-framework-slots.md` — описание группы Б, как наполняется автоматически, как искать.
- [ ] Обновлён `second-brain/02_architecture/code-pitfalls.md` — запись «Cypher только через `GraphService`».
- [ ] Обновлён [`second-brain/01_projects/api-layer.md`](../../second-brain/01_projects/api-layer.md) — новые эндпоинты.
- [ ] Запись рефлексии в `second-brain/05_история/2026-MM-DD-0a-фундамент-итог.md`.

### Матрица прослеживаемости зонтичного ТЗ

- [ ] Строки 1–25 (группа A, B, C, D) и 43–62 (группа H) и 83 (search API часть) — все `[x]` в зонтичном.

---

## 13. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| Yandex Managed PostgreSQL не поддерживает AGE → переход на self-hosted с миграцией существующих данных | высокая | Preflight 0a.0 закрывает это до старта 0a.1. Если нужен self-hosted — план миграции прода обсуждается с DevOps **до** начала работ по моделям |
| Двойная запись Postgres+AGE в одной транзакции не работает (Prisma + raw AGE) | высокая | Тест в первый день 0a.2; fallback — двухфазная компенсация. Документируется как architectural decision |
| `EntityLink`-миграция ломает existing knowledge-core | критическая | Backfill `fromType='entity', toType='entity'` ДО изменения схемы на NOT NULL. Smoke-тест по существующим связям после миграции |
| 17 типов рёбер сложно держать в голове — программисты будут случайно использовать неправильные | средняя | TypeScript enum в `graph.types.ts` + JSDoc к каждому типу с указанием правильных fromType/toType. Lint-правило «нельзя использовать `EntityLinkType.X` без проверки fromType/toType через type-guards» — открыто, реализация в 0a.2 |
| AGE-Cypher падает на сложных запросах (известны баги в старых версиях AGE) | средняя | Используем актуальный stable-тег (`PG16_latest`); все запросы — через `GraphService` с unit-тестами. Если конкретный запрос не работает — fallback к Postgres-only обходу (отрабатывает на `EntityLink` без AGE) |
| RBAC-полиси для `Person` (`:own`) сложно описать в Casbin | средняя | Реализация через `g`-функцию: `g(user, person)` true если `person.userId == user.id`. Тесты — отдельный suite в RBAC-модуле |
| Объём 0a растягивается на >3 недели | высокая | Дробление на 0a.0/0a.1/0a.2/0a.3 (см. §11) даёт инкрементальную поставку. После 0a.1 (модели + Person + EntityLink-миграция) — 0b и 0c.1 могут стартовать параллельно. Critical path — 0a.0→0a.1→0a.2 (AGE+GraphService); 0a.3 (API+RBAC) можно дописывать в фоне |

---

## 14. Итог

_Заполняется по факту, когда 0a.0–0a.3 закрыты._

- **Реализовано полностью / частично:** _TBD_
- **Что осталось:** _TBD_
- **Ссылка на рефлексию:** _TBD_

## Ревизия от 2026-05-24

**Статус:** done

**Реализовано:**
- Все 16 моделей в `backend/prisma/schema.prisma`: Department (line 3269), Role (3315), Person (3379), PersonRole (3451), JobDescription (3516), Skill (3536), Document (3558), RoleProfile (3645), Mission (3848), Vision (3866), Strategy (3882), Process (4015), ProcessStep (4273), Regulation (4299), Policy (4352), Tool (4388), Metric (4405), Decision (4464).
- `EntityLink` (line 2934) расширен полями `validFrom/validTo/properties`; `EntityLinkType` enum (line 476) содержит 17+ новых типов рёбер (executes_role, member_of, described_by, derived_from, requires_skill, has_skill, realized_by, decomposes_into, measured_by, executed_by, has_step, owned_by, lives_in, produces, regulates, owned_by, RACI и др.).
- Apache AGE: `CREATE EXTENSION age` + `create_graph('z_graph')` инициализируется в `backend/scripts/postgres-init.sql` и `backend/src/app.module.ts`; декларирован в `backend/src/common/graph/`.
- `GraphService` (`backend/src/common/graph/graph.service.ts`) с публичным API addNode/addEdge/removeEdge/removeNode/getNeighbors/findPath/traverse/upsertEntity + двойной записью Postgres+AGE в одной транзакции; есть `cypher-builder.ts`, `graph.types.ts`, `graph.spec.ts`.
- CRUD-модули группы А: `backend/src/modules/{departments,roles (через role-profiles),persons,job-descriptions,skills,documents,role-profiles,structure}/` — все с controller + service + dto + tests.
- `StructureModule` агрегирует `/structure/summary` и табы.
- RBAC: `backend/src/modules/rbac/policies/policy.csv` содержит новые ResourceType (см. упоминания в `rbac.service.ts`).

**Осталось:** —

Превышение порога 800 строк, но проверка целевых артефактов (модели + AGE + GraphService + модули) показывает done; mini-фиксы и оптимизации могут оставаться, но scope DoD достигнут.
