---
type: tz
status: ready-to-implement
feature: knowledge-access-groups-and-provenance
date: 2026-06-06
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-06-knowledge-access-levels-and-provenance.md
  - second-brain/01_projects/rbac-access-control.md
  - second-brain/02_architecture/security-and-152fz.md
  - second-brain/02_architecture/knowledge-core.md
---
> Анализ: `plans/analysis/2026-06-06-knowledge-access-levels-and-provenance.md` (§14 — решения владельца) · Статус согласования: 2026-06-06 (4 HIGH-развилки закрыты).
> Принцип: НЕ ломаем дефолт «знание видно всей компании» (ценность памяти), добавляем измерение групп доступа поверх. Выкат через флаг off→shadow→enforce, дефолт off; пользователей в проде ещё нет.

# ТЗ: Доступ к знаниям через группы + фундамент-провенанс

## Цель

Дать Коре управление видимостью знаний ВНУТРИ компании («менеджер низшего звена не видит знания совета директоров») и расширить провенанс-привязку «кто сказал / из какого источника» на все типы знания и все источники. Сейчас граф знаний фильтруется только по `tenantId` — любой сотрудник через AI-чат/поиск/клон видит весь граф компании.

## Зачем (болезненное состояние)

1. **Утечка по вертикали (главное).** AI-чат компании, поиск и клоны отдают любому члену Org знание любого уровня секретности. Подтверждено в коде: retrieval фильтрует только `tenantId + status='canonical'` ([chat-v2-retrieval.service.ts:200,411](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts#L200); [search.service.ts:164](../../backend/src/modules/knowledge-core/api/search.service.ts#L164)). Это блокер корп-продаж: Teamly AI уже permission-aware (анализ §4.2).
2. **Узкий провенанс ломает клонов.** Привязка автора (`role='subject'`) пишется только для 6 reasoning-типов ([block-ingest.worker.ts:991](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L991)); обычные факты — без автора, who-ось пуста для них ([axis-classifier.service.ts:236](../../backend/src/modules/knowledge-core/services/axis-classifier.service.ts#L236)). Клон собирается только из «рассуждений», «что Иван говорил по факту» не работает.
3. **Дыра клонов.** Право спросить клон гейтится грантом, но контекст ответа НЕ фильтруется по правам спрашивающего ([clones.service.ts:2173,2281](../../backend/src/modules/clones/services/clones.service.ts#L2173)) — канал утечки закрытого знания.

Метрика «решено»: при `enforce` — 0 случаев, когда блок из закрытой группы попадает в ответ/выдачу/контекст-клона пользователю не из этой группы (проверяется тестом-предикатом, см. R-блок).

## REALITY-CHECK (что уже есть — расширяем, не строим заново)

| Существует (path:line) | Что даёт | Как используем |
|---|---|---|
| `DataClassPolicyService.derive()` + `DATACLASS_RANK` + режимы off/shadow/enforce ([dataclass-policy.service.ts:42,181](../../backend/src/modules/knowledge-core/services/dataclass-policy.service.ts#L42)) | Готовый движок «наследовать самую строгую метку» + аудит + поэтапный выкат | Расширяем `derive()` группой; копируем паттерн enforcement-флага для доступа |
| `attributeSubject` / `attributeCommitmentAuthor` ([block-ingest.worker.ts:1038,1112](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L1038)) | Типонезависимый детерминированный резолв автора (segment→identity) | Снимаем узкий гейт на :991 → провенанс на все типы |
| `resolveSubjectEntityId/PersonId` 3 ветки ([entity-resolution.service.ts:908,981](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L908)) | identity: authorUserId→participant→fuzzy-name | Переиспользуем + добавляем per-adapter identity для не-встреч |
| `AxisClassifier` functional-ось + `DepartmentDomainLink` ([axis-classifier.service.ts:288](../../backend/src/modules/knowledge-core/services/axis-classifier.service.ts#L288); [schema.prisma:5131](../../backend/prisma/schema.prisma#L5131)) | Связка блок→домен→отдел (существует, при ingest НЕ используется) | Источник «отдела» блока при ingest |
| `canViewEmployeeFullCard` / `canAccessPersonClone` ([rbac.service.ts:355,483](../../backend/src/modules/rbac/rbac.service.ts#L355)) | Образец ABAC-метода ПОВЕРХ policy.csv (Casbin у нас самописный — [rbac.service.ts:675](../../backend/src/modules/rbac/rbac.service.ts#L675), не node-casbin) | Новый `canAccessKnowledgeGroup` тем же приёмом |
| `TenantGuard` ([tenant.guard.ts:40,86](../../backend/src/modules/rbac/guards/tenant.guard.ts#L40)) | Единая точка с user+tenant, кладёт `req.rbacContext` | Резолв групп пользователя → `req.rbacContext.groups` |
| `CloneAccessGrant` + `DepartmentDomainLink` ([schema.prisma:2626,5131](../../backend/prisma/schema.prisma#L2626)) | Образцы grant-таблицы (soft-revoke/expiresAt) и направленной m:n | Прообразы `GroupVisibilityPolicy` и членства |
| chat-v2 retrieval двухфазный (pool→`id=ANY`→ORDER BY) | pre-filter в pool безопасен (не роняет HNSW-recall) | Главный приём фильтра; для `/search` (одношаговый HNSW) — отдельно (iterative_scan/overfetch) |

**Вывод REALITY-CHECK:** новое = только (а) сущность «группа» + связи, (б) резолв групп пользователя, (в) обвязка pre-filter по ~9 поверхностям + фикс кэша, (г) направленная матрица, (д) расширение провенанса. Наследование, выкат-флаги, identity-резолв, домен→отдел — переиспользуются.

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В1 | Доступ через **группы** (не «уровни»): отделы (горизонталь) + закрытые «Руководство/Совет» + «личный сейф (человек+HR+владелец)». Доступ = «видишь знание своих групп». | §14 анализа; одна ментальная модель, простая владельцу |
| В2 | **Вертикаль главнее, горизонталь — мягкий фильтр** (не вторая стена). Закрытая группа на блоке → видят только её члены; иначе доступ по отделу через **направленную** матрицу. | §14 П-1; не превращать память в силос |
| В3 | Метка у знания — **из источника-события** (дефолт открыто; тип/ручной флаг/подсказка закрывает; участники видят всегда); у человека — **из должности** (auto + override). | §14 |
| В4 | **Группы отдельно от `dataClass`** (новая лёгкая сущность). `dataClass` остаётся только LLM-routing + egress. | Развилка-1 (2026-06-06); §3.2 анализа, red-team |
| В5 | Привязка блока к группе — **детерминированно при ingest + бэкфилл** существующих в «открыто» (m:n связь блок↔группа). | Развилка-2 |
| В6 | Закрытые встречи — **ручной флаг** (Руководство/Совет/Личное) + **авто `interview`→личное**; новых типов встреч НЕ вводим. | Развилка-3 (в 15 типах нет board) |
| В7 | Провенанс — **все типы знания + все источники** (per-adapter identity). | Развилка-4 |
| В8 | AI-чат и клоны отвечают **в группах СПРАШИВАЮЩЕГО**; авто-классификатор секретности — **только advisory-подсказка**, не замок. | §14; red-team (F1 ненадёжен) |
| В9 | Выкат через новый флаг **`KNOWLEDGE_ACCESS_ENFORCEMENT` (off/shadow/enforce), дефолт off**; owner/admin/super — bypass. | Инвариант Z (риск-фича за флагом); §11 анализа |

## Доказательство выбора

Полная матрица вариантов и состязательная перепроверка — в анализе (§7, §8, §10). Краткий ADR: **Проход A (группы как новая подсистема, dataClass отдельно)** против **Прохода B (перегрузить dataClass под вертикаль)**. Различие по оси «модель данных». B отвергнут: перегружает поле, управляющее выбором LLM-провайдера и egress (и сейчас в shadow-выкате — [env.schema.ts:1648](../../backend/src/common/config/env.schema.ts#L1648)), и противоречит В1/В4. Challenge-loop убрал лишнее: **метку на `Theme`/`IdeaBlockLink` НЕ добавляем** — безопасность обеспечивает фильтр финального набора блоков на «выходном шлюзе» `loadContextBlocks` ([chat-v2.service.ts:423](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L423)); Theme/Link — лишь обход графа, их резолвленные блоки всё равно перефильтровываются. Полный Casbin-движок НЕ вводим (самописный evaluator достаточен; ABAC — отдельным методом как `canViewEmployeeFullCard`).

## Scope

**Входит:** новые модели групп/связей/матрицы; резолв групп пользователя; ingest-вывод группы блока + бэкфилл; расширение провенанс-привязки на все типы + per-adapter identity; pre-filter доступа во ВСЕХ поверхностях retrieval + фикс RetrievalCache; фильтр контекста клонов; наследование группы на проекции; sensitivity/closed по типу встречи + ручной флаг; admin-UI матрицы и членства; флаг выката + метрики + бэкфилл.

**Не входит (vNext, с судьбой):**
- Реальный ingest **групповых чатов сотрудников** — такого источника СЕЙЧАС НЕТ (chatbox = клиент↔менеджер, [chatbox-ingest.service.ts:272](../../backend/src/modules/chatbox/chatbox-ingest.service.ts#L272)). Модель аудитории проектируется generic (multi-participant text → как встреча), но коннектор employee-group-chat — отдельное будущее ТЗ. → `relates_to` будущего.
- Лемматизация/транслитерация fuzzy-имён спикеров и LLM-arbiter атрибуции — оставляем приоритет детерминированному `speakerParticipantId`, fuzzy не усиливаем (Ф1 §«Что НЕ входит»); добавляем только метрику доли атрибуций.
- Миграция самописного RBAC на node-casbin — не нужна.
- Авто-классификатор секретности как enforcement — только advisory-подсказка (отдельная мелкая под-задача UI, см. Ф7), не часть гейта.

## Граничные контракты

- **`dataClass` не трогаем по смыслу** — он остаётся для LLM-routing/egress. Группы — параллельная ось.
- **Параллельная сессия:** ветка `sergdev` и chatBox-сессия (Tozix/Nikita) активны — НЕ трогать файлы chatbox-интеграции кроме добавления identity-хелпера в адаптер (Ф1), согласовать перед коммитом.
- **enforcement по умолчанию off** — на каждом шаге поведение системы при off ИДЕНТИЧНО текущему (regression-guard).

## Контракт-first

### Новые Prisma-модели ([schema.prisma](../../backend/prisma/schema.prisma), добавить рядом с RBAC-моделями ~2594)

```prisma
/// Группа доступа к знаниям. kind=department ССЫЛАЕТСЯ на существующий Department
/// (refId=departmentId — оргдерево НЕ дублируем); leadership/council — закрытые
/// «верхние» группы (синглтоны на Org, refId=null); personal — личный сейф (refId=personId).
enum KnowledgeGroupKind {
  department
  leadership
  council
  personal
}

model KnowledgeGroup {
  id        String                 @id @default(cuid())
  tenantId  String
  kind      KnowledgeGroupKind
  refId     String?                /// departmentId | personId | null
  name      String                 @db.VarChar(200)
  /// Закрытая группа: видна ТОЛЬКО прямым членам, НЕ через матрицу отделов (вертикаль).
  isClosed  Boolean                @default(false)
  createdAt DateTime               @default(now())
  org        Org                   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  members    KnowledgeGroupMember[]
  blockLinks IdeaBlockAccess[]
  @@unique([tenantId, kind, refId])
  @@index([tenantId, kind])
}

model KnowledgeGroupMember {
  groupId   String
  personId  String
  source    String   @db.VarChar(10) /// 'auto' (из должности) | 'manual' (override)
  createdAt DateTime @default(now())
  group     KnowledgeGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([groupId, personId])
  @@index([personId])
}

/// M:N блок ↔ группа. Блок может быть и «логистика», и «совет» одновременно.
model IdeaBlockAccess {
  blockId   String
  groupId   String
  via       String   @db.VarChar(12) /// 'department' (горизонталь) | 'closed' (вертикаль)
  createdAt DateTime @default(now())
  block     IdeaBlock      @relation(fields: [blockId], references: [id], onDelete: Cascade)
  group     KnowledgeGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@id([blockId, groupId])
  @@index([groupId])
}

/// Направленная матрица «отдел-субъект видит отдел-объект». Образец — DepartmentDomainLink.
model GroupVisibilityPolicy {
  id             String   @id @default(cuid())
  tenantId       String
  subjectGroupId String
  visibleGroupId String
  createdAt      DateTime @default(now())
  org            Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([subjectGroupId, visibleGroupId])
  @@index([tenantId, subjectGroupId])
}
```
+ обратная связь `blockAccess IdeaBlockAccess[]` в модель `IdeaBlock`. Поле закрытости встречи: `Meeting.closedGroupKind String?` (null | 'leadership' | 'council' | 'personal') + `MeetingTypeConfig.defaultClosedGroupKind String?` (admin-editable дефолт по типу; `interview`→'personal').

### Правило доступа (каноничное — реализовать в `KnowledgeAccessResolver`)

```
visible(user, block):
  if user.isOwnerAdminSuper: return true                       # bypass (В9)
  closedOnBlock = block.groups where group.isClosed
  if closedOnBlock not empty:
     return EVERY g in closedOnBlock has user ∈ g.members       # вертикаль главнее (В2)
  deptOnBlock = block.groups where group.kind='department'
  if deptOnBlock empty: return true                             # нет скоупа → открыто всем (дефолт памяти)
  return ∃ g in deptOnBlock: g ∈ user.accessibleDeptGroupIds    # горизонталь (членство ∪ матрица)
```
где `user.accessibleDeptGroupIds` = свои department-группы ∪ {visibleGroupId | policy.subjectGroupId ∈ свои группы}; `user.closedGroupIds` = closed-группы, где user — член.

### SQL-предикат pre-filter (для raw-SQL поверхностей; параметры через существующий `pushParam`)

```sql
-- блок проходит, если: не нарушает закрытость И (нет dept-группы ИЛИ dept-группа доступна)
AND NOT EXISTS (
  SELECT 1 FROM "IdeaBlockAccess" a JOIN "KnowledgeGroup" g ON a."groupId"=g.id
  WHERE a."blockId"=b.id AND g."isClosed" AND a."groupId" <> ALL(${pUserClosed}::text[])
)
AND (
  NOT EXISTS (SELECT 1 FROM "IdeaBlockAccess" a2 JOIN "KnowledgeGroup" g2 ON a2."groupId"=g2.id
             WHERE a2."blockId"=b.id AND g2.kind='department')
  OR EXISTS (SELECT 1 FROM "IdeaBlockAccess" a3
             WHERE a3."blockId"=b.id AND a3."groupId" = ANY(${pUserDept}::text[]))
)
```
Для Prisma-`findMany` — эквивалентный вложенный `blockAccess: { none/some }` фильтр в хелпере `buildAccessWhere(ctx)`.

### Флаги/коды ошибок/ENV (через `TypedConfigService`/`env.schema.ts`; крутилки → `AdminSetting`)

- `KNOWLEDGE_ACCESS_ENFORCEMENT: z.enum(['off','shadow','enforce']).default('off')` — режим гейта.
- `knowledge.subjectAttributionAllTypes` (AdminSetting, code-fallback true) — расширенная привязка автора; master-выключатель `knowledge.subjectAttributionEnabled` сохраняется.
- `MeetingTypeConfig.defaultClosedGroupKind` — крутилка дефолта закрытости по типу.
- Метрики: `kc_access_shadow_diff_total{surface}` (в shadow — сколько блоков было бы отфильтровано), `kc_access_denied_total{surface}`, `kc_subject_attribution_total{via=participant|userId|name|none}`.
- Коды ошибок (machine-readable): none нового на отказе доступа — отфильтрованные блоки просто не попадают в выдачу (не 403); admin-эндпоинты матрицы — стандартные Zod-ошибки.

## Границы фичи
- ✅ Always: фильтр доступа применять ТОЛЬКО при `enforcement='enforce'`; в `off` — поведение байт-в-байт текущее; owner/admin/super — bypass; любой knowledge-запрос tenant-scoped.
- ⚠️ Ask first: менять смысл `dataClass`; трогать файлы chatbox-сессии (параллельная ветка); вводить новые типы встреч.
- 🚫 Never: авто-классификатор как замок доступа; per-user силосование дефолта (дефолт = открыто всей Org); хардкод порогов/дефолтов в код вместо AdminSetting; `new PrismaClient()` в скриптах; `process.env.*`.

---

## Фазы

Граф зависимостей: **Ф1 ∥ Ф2 → Ф3 → Ф4 → Ф5 ∥ Ф6 → Ф7 → Ф8**. (Ф1 и Ф2 независимы; Ф5 и Ф6 после Ф4 параллельны.)

### Фаза 1 — Фундамент-провенанс: привязка автора на все типы + per-adapter identity ✅ РЕАЛИЗОВАНО
**Цель:** «кто сказал / из какого источника» проставляется для всех типов знания и всех источников.
**Входит:**
- Снять узкий гейт: вызывать `attributeSubject` для всех `signalType`, а не только 6 reasoning ([block-ingest.worker.ts:991](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L991); Set на :53). Новый AdminSetting `knowledge.subjectAttributionAllTypes` (code-fallback true); master `knowledge.subjectAttributionEnabled` сохранить.
- Per-adapter identity в payload (нормализовать в `IngestService` или per-adapter): tracker — `actor.userId`/`assignee.personId` ([tracker.adapter.ts:326](../../backend/src/modules/ingest/adapters/tracker/tracker.adapter.ts#L326)); email — `from`→Person по email (strong-ID); chatbox — `sender`→`ChatboxMember.linkedPersonId` ([chatbox-ingest.service.ts:272](../../backend/src/modules/chatbox/chatbox-ingest.service.ts#L272)); free_note — `payload.userId` (уже есть). Добавить хелперы `tryGetParticipants`/`tryGetActorIdentity` рядом с `tryGetAuthorUserId` ([block-ingest.worker.ts:750](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L750)).
- Метрика `kc_subject_attribution_total{via}`.
- Backfill `backfill-subject-attribution-all-types.ts` (идемпотентный; реюз существующего `backfill-subject-attribution.ts` как образца) — добить `role='subject'` для исторических блоков.
**Что НЕ входит:** усиление fuzzy-имён, LLM-arbiter (out-of-scope); группы доступа (Ф2+).
**Файлы:** block-ingest.worker.ts (:53,:750,:991,:1038), entity-resolution.service.ts (:908,:981), адаптеры tracker/chatbox/conversational/email, backend/scripts/backfill-*.
**Acceptance:** греп — `attributeSubject` вызывается без сужения на REASONING-Set (или Set расширен/обойдён флагом); юнит: блок `signalType='fact'` со `speakerParticipantId` → создаётся `IdeaBlockEntity{role='subject'}`; who-ось непуста для не-reasoning ([axis-classifier.service.ts:236](../../backend/src/modules/knowledge-core/services/axis-classifier.service.ts#L236)); backfill повторно = no-op; `bun run typecheck/lint/test:unit` зелёные.
**Закрывает:** R1, R2.

### Фаза 2 — Модель групп + резолв групп пользователя (схема + RBAC) ✅ РЕАЛИЗОВАНО
**Цель:** появились сущности групп и метод «какие группы у пользователя / доступен ли блок».
**Входит:**
- Prisma-модели из «Контракт-first» (`KnowledgeGroup`, `KnowledgeGroupMember`, `IdeaBlockAccess`, `GroupVisibilityPolicy`, enum `KnowledgeGroupKind`; обратная связь в `IdeaBlock`). Миграция (`prisma:migrate -- --name knowledge-access-groups`), `prisma:generate`. Индексы заданы в моделях (обычные btree; pgvector не затрагивается).
- Сид синглтон-групп на Org: «Руководство» (leadership, isClosed), «Совет» (council, isClosed); department-группы создаются лениво из существующих `Department` (kind=department, refId=departmentId); personal — лениво per-Person при первом закрытом личном знании.
- `KnowledgeAccessResolver` (новый сервис в `rbac` или `knowledge-core/services`): `resolveAccessibleGroups({tenantId,userId})` → `{deptGroupIds[], closedGroupIds[], isBypass}` (через `Person`→`primaryDepartmentId`+`PersonRole/Appointment.departmentId`+`headOfDepartments`+`Membership.role` owner/admin→leadership). Кэш рядом с `membershipCache` (TTL 60с, инвалидация — [rbac.service.ts:417](../../backend/src/modules/rbac/rbac.service.ts#L417)).
- `buildAccessWhere(ctx)` (Prisma-фрагмент) и `RbacService.canAccessKnowledgeGroup()` по образцу `canViewEmployeeFullCard` ([rbac.service.ts:355](../../backend/src/modules/rbac/rbac.service.ts#L355)).
- `KNOWLEDGE_ACCESS_ENFORCEMENT` в env.schema (default off).
- `TenantGuard` кладёт `req.rbacContext.groups` лениво ([tenant.guard.ts:86](../../backend/src/modules/rbac/guards/tenant.guard.ts#L86)).
**Что НЕ входит:** проставление групп блокам (Ф3); применение фильтра в retrieval (Ф4) — здесь только модель+резолвер+флаг (при off ничего не меняется).
**Файлы:** schema.prisma (~2594), rbac.service.ts, tenant.guard.ts, env.schema.ts, backend/scripts/seed-knowledge-groups.ts, postgres-init.sql (если нужны спец-индексы — обычные btree через @@index достаточно).
**Acceptance:** `prisma:generate` ок; `resolveAccessibleGroups` юнит (member отдела → его dept-группа; owner → isBypass=true); `buildAccessWhere` для bypass = пустой фильтр; миграция повторно = no-op (Prisma migrate deploy идемпотентен); типы/линт/билд зелёные.
**Закрывает:** R3, R4, R9.

### Фаза 3 — Ingest-вывод группы блока + бэкфилл (детерминированно) ✅ РЕАЛИЗОВАНО
**Цель:** каждый новый блок получает свои группы; старое знание = «открыто».
**Входит:**
- После `AxisClassifier.classify` ([block-ingest.worker.ts:683](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L683)) — шаг `deriveBlockAccess`: department-группа из (а) functional-метки → `FunctionalDomain`→`DepartmentDomainLink`→Department ([schema.prisma:5131](../../backend/prisma/schema.prisma#L5131)) И (б) отделов участников (`payload.participants[].userId/personId`→`Person.primaryDepartmentId`). closed-группа из источника: `Meeting.closedGroupKind` / `MeetingTypeConfig.defaultClosedGroupKind` (interview→personal) / null. Запись в `IdeaBlockAccess` (via='department'|'closed').
- Хелперы `tryGetParticipants`/`tryGetMeetingType` ([block-ingest.worker.ts:264](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L264)); `Meeting.closedGroupKind` проставляется хостом (Ф7 UI) — на ingest читается из payload.
- Backfill `backfill-block-access.ts` (идемпотентный): историческим блокам без `IdeaBlockAccess` — ничего (=открыто) ИЛИ department-группа из существующих axisLabels, по флагу; closed не назначаем задним числом.
**Что НЕ входит:** применение в выдаче (Ф4); проекции (Ф6).
**Файлы:** block-ingest.worker.ts (:264,:683,:877), meeting.adapter.ts (:120,:147), schema.prisma (Meeting/MeetingTypeConfig поля), backend/scripts/backfill-block-access.ts, apply-prod-deploy.ts (STEPS).
**Acceptance:** встреча отдела «Логистика» → блок получает `IdeaBlockAccess{department=Логистика}`; встреча с `closedGroupKind='council'` → блок получает `{closed=Совет}`; `interview` → personal; блок без домена/участников → без access-строк (открыт); backfill повторно = no-op; тесты зелёные.
**Закрывает:** R5, R6.

### Фаза 4 — Pre-filter доступа во всех поверхностях retrieval + фикс кэша (security-гейт) ✅ РЕАЛИЗОВАНО
**Цель:** при `enforce` пользователь получает только доступные ему блоки во всех каналах выдачи.
> **Реализация (4 части):** A — chat-v2 (выходной шлюз loadContextBlocks/loadContradictingBlocks + pool pre-filter + reasoning-chain) + хелперы резолвера (buildAccessSqlPredicate/loadBlockAccessGroups/partitionBlockIdsByAccess) + метрики kc_access_shadow_diff_total/kc_access_denied_total. B — /search (SQL-предикат, recall ок: full-scan), /snapshot (Prisma where), orchestrator base-retrieval-strategy. C — entities/themes/graph контроллеры (найдены адверсариальной проверкой покрытия). D — blocks.controller (GET /blocks/:id + /links + /reasoning-chain, найдено адверсариально). Кэш RetrievalCache закрыт выходным шлюзом (R10, без правок кэша). block-fetch (машинный путь) — без гейта (dataClass-floor). Полный DB-e2e «логист≠совет» — прод-смоук Ф8.
**Входит (каждая точка — `...buildAccessWhere(ctx)` при enforce; при off/shadow — без изменения выдачи, shadow считает метрику):**
- chat-v2 pool org/meeting/card/theme/entity ([chat-v2-retrieval.service.ts:203,242,273,339,359](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts#L203)); cosine raw-SQL + recency (:411,:430) — SQL-предикат; graph 1-hop (:533).
- **Обязательный выходной шлюз** `loadContextBlocks` + `loadContradictingBlocks` ([chat-v2.service.ts:423,808](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L423)) — defense-in-depth, ловит и precomputed-путь.
- `/search` filters[] ([search.service.ts:164](../../backend/src/modules/knowledge-core/api/search.service.ts#L164)) + проброс групп из контроллера ([search.controller.ts:66](../../backend/src/modules/knowledge-core/api/search.controller.ts#L66)); pgvector recall: для одношагового HNSW — `SET LOCAL hnsw.iterative_scan='relaxed_order'` + overfetch (доказано в анализе §4.3); chat-v2 pool — pre-filter безопасен.
- `/snapshot` ([snapshot.service.ts:114,145](../../backend/src/modules/knowledge-core/api/snapshot.service.ts#L114)); reasoning-chain соседи ([reasoning-chain.service.ts:186](../../backend/src/modules/knowledge-core/services/reasoning-chain.service.ts#L186)).
- Расширить `RetrievalInput` ([chat-v2-retrieval.service.ts:25](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts#L25)) полем `accessCtx`; прокинуть из `chat.service`/`synthesis.service` (userId уже есть).
- **RetrievalCache:** включить отпечаток групп в ключ ([retrieval-cache.service.ts:48](../../backend/src/modules/dialog-layer/services/retrieval-cache.service.ts#L48)) ИЛИ не кэшировать при enforce + всегда фильтровать в `loadContextBlocks` (рекомендуется второе — проще и безопаснее).
- Машинные пути (`BlockFetchService` фоновой генерации отчётов, [block-fetch.service.ts:58](../../backend/src/modules/knowledge-core/services/block-fetch.service.ts#L58)) — НЕ применять групповой доступ спрашивающего (нет интерактивного requester), оставить `dataClass`-floor как есть.
**Что НЕ входит:** клоны (Ф5); проекции-наследование (Ф6).
**Файлы:** перечисленные выше.
**Acceptance (ключевой e2e-предикат метрики «решено»):** при `enforce` запрос члена «Логистики» НЕ возвращает блок с `IdeaBlockAccess{closed=Совет}` ни в одной поверхности (chat/search/snapshot/graph); owner — возвращает; при `off` выдача идентична baseline (golden-тест на наборе блоков); cache-hit не отдаёт чужой доступ; `kc_access_denied_total` растёт при enforce. Тесты per-поверхность.
**Закрывает:** R7, R10, R11.

### Фаза 5 — Контекст клонов в правах спрашивающего ✅ РЕАЛИЗОВАНО
**Цель:** клон не цитирует знание вне групп спрашивающего.
> Реализация: `loadPersonSubgraph`/`loadRoleSubgraph` фильтруют reasoning-блоки по accessCtx спрашивающего (DB-фильтр buildAccessWhere в mentions + defense-in-depth post-filter `applyAccessToReasoningBlocks`); accessCtx резолвится из `requesterUserId` во всех 4 respond-путях. assertTopicDensity естественно считает по доступным (корректный topic_starved). off=байт-в-байт. decisions в контексте клона — фильтр перенесён в Ф6 (проекционный доступ), помечено TODO.
**Входит:**
- Прокинуть `accessCtx` спрашивающего в `loadPersonSubgraph`/`loadRoleSubgraph` ([clones.service.ts:234,453,710,908](../../backend/src/modules/clones/services/clones.service.ts#L234)); фильтр `where` блоков (:2173,:2227,:2281) `...buildAccessWhere(ctx)`; defense-in-depth — отбросить недоступное перед `callCloneRespond` (:2515).
- Учесть `assertTopicDensity` (:2363): фильтр ДО density-guard → корректный отказ `topic_starved`, если после фильтра контекста мало.
**Что НЕ входит:** изменение права СПРОСИТЬ клон (остаётся `CloneAccessGrant`); build-фаза персоны (строится по floor-доступу — persona одна на всех; фильтр — на этапе ОТВЕТА per-requester).
**Файлы:** clones.service.ts.
**Acceptance:** при enforce клон роли, запрошенный членом «Логистики», не отдаёт reasoning-блок с `closed=Совет`; при off — контекст идентичен; тест на оба scope (person/role).
**Закрывает:** R8.

### Фаза 6 — Наследование группы на проекции (показываются пользователю напрямую) ✅ РЕАЛИЗОВАНО
**Цель:** проекции (Decision/Insight/Idea/Regulation/Process/Policy/Card) несут группу источников и фильтруются на своих листингах.
> Реализация (ON-READ, без новой модели/миграции): группы проекции выводятся из её `sourceBlockIds` (IdeaBlockAccess блоков-источников, материализован Ф3). Новый метод `KnowledgeAccessResolver.partitionProjectionsByAccess(ctx, items[{id,sourceBlockIds}])` — union групп блоков-источников, строжайшее (любой council-source → проекция council); один DB-запрос на страницу. Гейт `gateProjections()` (off=байт-в-байт, shadow=метрика, enforce=фильтр) применён ПОСЛЕ выборки страницы в листингах: decisions (`list` + `getSupersedeChain` ancestors/descendants, surface='decisions'), insights (`list` + `getTop`, surface='insights'), ideas (`list` + `listMine`, surface='ideas'), regulations/processes/policies (`list` merged + `listRegulations`/`listProcesses`/`listPolicies`, surface='regulations'). `userId` прокинут из контроллеров. Закрыт TODO Ф6 в `clones.loadPersonSubgraph` (decisions клона фильтруются по `partitionProjectionsByAccess`, surface='clone'). DI — `@Optional()` (KnowledgeAccessResolver+TypedConfigService+BusinessMetricsService), spec-и конструируют позиционно. Пагинация: при enforce страница может стать короче, total — over-count (приемлемо для on-read). Theme/IdeaBlockLink/dashboard/cards НЕ трогаем (вне Ф6).
**Входит:**
- Расширить `DataClassPolicyService.derive()` ([dataclass-policy.service.ts:181](../../backend/src/modules/knowledge-core/services/dataclass-policy.service.ts#L181)) результатом `groups`: closed = union(source closed) (строжайшее — любой source council → проекция council), dept = union(source dept). Все ~5 callers уже зовут derive ([specialist-3-5-insights.service.ts:762](../../backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts#L762), 3-1/3-3/3-6, card-rollup-v2:450) — писать в новую связь (проекция↔группа) тем же enforcement-флагом.
- Листинг-эндпоинты проекций — `buildAccessWhere(ctx)`.
- Theme/IdeaBlockLink — НЕ трогаем (challenge-loop): безопасность на block-gateway Ф4.
**Что НЕ входит:** retrieval-чат (закрыт Ф4 на уровне блоков).
**Файлы:** dataclass-policy.service.ts, specialist-3-*, card-rollup-v2.service.ts, листинг-контроллеры проекций.
**Acceptance:** проекция из блока `closed=Совет` → помечена council, не видна не-члену при enforce; при off — без изменений; derive юнит на union-правило.
**Закрывает:** R12.

### Фаза 7 — Frontend admin: матрица отделов, флаг встречи, членство, advisory-подсказка ✅ РЕАЛИЗОВАНО
**Цель:** админ настраивает «кто что видит»; хост помечает закрытые встречи.
> Реализация: **7a (backend)** — `KnowledgeAccessAdminController` (/api/v1/knowledge-access): GET /groups, GET+PUT /matrix (направленно), GET/POST/DELETE members (членство + clearance-override), PATCH /meeting-types/:id/closed-default; Meeting.closedGroupKind в create + PATCH /meetings/:id/closed-group; все мутации → resolver.invalidateAll(). **7b (frontend)** — `src/api/knowledge-access.api.ts` + `src/domain/knowledge-access.ts` + `company-admin/access-groups` (матрица + членство) + сайдбар + селектор закрытости в форме встречи + advisory-баннер (эвристик, не замок). Упрощения (honest): UI крутилки defaultClosedGroupKind по типу встречи — контракт готов, отдельной org-admin поверхности списка типов нет (вне scope); post-factum селектор write-only (meeting-detail DTO не отдаёт closedGroupKind). interview→personal дефолт — засидить в Ф8.
**Входит (слои `ApiDto→DomainModel→UiModel`, App Router `(admin)`, только русский, парные токены):**
- UI направленной матрицы `GroupVisibilityPolicy` («отдел → видит отделы», несимметрично) — образец взаимодействия `DepartmentDomainLink`.
- Селектор закрытой группы на встрече (`Meeting.closedGroupKind`: нет/Руководство/Совет/Личное), при создании и постфактум.
- Управление членством `KnowledgeGroupMember` (override) + clearance-override (поднять человека в leadership без должности).
- Advisory-подсказка «похоже, конфиденциально — закрыть?» (баннер на встрече/блоке; источник — дешёвый эвристик/LLM, НЕ замок; правит человек).
**Что НЕ входит:** backend-логика (Ф2–Ф6).
**Файлы:** frontend `src/api/*`, `src/domain/*`, `app/(admin)/*`, новые эндпоинты NestJS (Zod-DTO+Swagger) для CRUD матрицы/членства.
**Acceptance:** админ задаёт «продажи→[логистика,продажи,маркетинг]» направленно; хост ставит закрытость встречи; UI без английских слов; SWR-загрузка; `bun run typecheck/lint/build` (frontend) зелёные.
**Закрывает:** R13, R14.

### Фаза 8 — Выкат: shadow→enforce, метрики, прод-операции ✅ РЕАЛИЗОВАНО (код+доки; сам перевод флага на проде — за владельцем)
**Цель:** включить безопасно и наблюдаемо.
> Реализация: все seed/backfill/patch зарегистрированы в `apply-prod-deploy.ts` STEPS (seed-knowledge-groups · backfill-subject-attribution-all-types · backfill-block-access --departments · patch-meeting-type-closed-defaults). interview→personal дефолт засижен (bootstrap MeetingTypeConfig + patch). `prod-deploy-log.md` обновлён (ENV-флаг, миграция, seed, backfill, patch, smoke off→shadow→enforce). second-brain обновлён (rbac-access-control / security-and-152fz / knowledge-core / data-model / module-map / api-layer). Рефлексия — `second-brain/05_история/2026-06-06-knowledge-access-groups-and-provenance.md`. **Открыто (за владельцем):** сам прогон backfill + перевод `KNOWLEDGE_ACCESS_ENFORCEMENT` off→shadow→enforce на проде; строка в реестр `04_не-сделано` (не тронут — правился параллельной сессией).
**Входит:** регистрация всех seed/backfill в `apply-prod-deploy.ts` STEPS; прогон бэкфилла; перевод `KNOWLEDGE_ACCESS_ENFORCEMENT` off→shadow (сверка `kc_access_shadow_diff_total`)→enforce; обновление `prod-deploy-log.md` (Шаги 1/4/7/8/12); обновление second-brain (`rbac-access-control.md`, `security-and-152fz.md`, `company-memory-overview.md`).
**Acceptance:** в shadow метрики идут, выдача не меняется; после enforce — e2e-предикат Ф4 зелёный на проде-смоук; прод-лог обновлён.
**Закрывает:** R15.

---

## Требования (EARS, трассируемые)

- **R1.** Когда block-ingest создаёт блок ЛЮБОГО `signalType` и identity спикера/автора резолвится, система shall записать `IdeaBlockEntity{role='subject'}` (при `knowledge.subjectAttributionAllTypes`≠false).
- **R2.** Для источников tracker/email/chatbox/free_note система shall определять автора по per-adapter identity (actor/from-email/sender-link/userId).
- **R3.** Система shall хранить группы (`KnowledgeGroup`), членство, связь блок↔группа и направленную матрицу отдельными моделями, не меняя смысл `dataClass`.
- **R4.** Система shall резолвить группы пользователя из должности (`Person`/`PersonRole`/`Department`/`Membership`) с owner/admin/super = bypass.
- **R5.** Когда блок создаётся, система shall вывести его department-группу из домена/участников.
- **R6.** Если встреча помечена `closedGroupKind` (или тип=interview→personal), система shall привязать блоки к соответствующей закрытой группе.
- **R7.** Если `enforcement='enforce'`, то при выдаче знания пользователю система shall исключать блок, нарушающий правило `visible(user,block)`, во ВСЕХ поверхностях retrieval.
- **R8.** Если `enforce`, клон shall собирать контекст ответа только из блоков, доступных СПРАШИВАЮЩЕМУ.
- **R9.** Если `enforcement='off'`, система shall вести себя идентично текущему поведению (no-op гейт).
- **R10.** Система shall не отдавать через кэш retrieval блоки, отфильтрованные под другого пользователя.
- **R11.** Если `enforce`, граф-расширение/reasoning-chain shall не протаскивать недоступный соседний блок.
- **R12.** Проекция shall наследовать строжайшую закрытую группу источников (любой council source → проекция council).
- **R13.** Админ shall задавать направленную матрицу «отдел→видимые отделы».
- **R14.** Хост/админ shall помечать закрытость встречи вручную; найм — авто-personal.
- **R15.** Выкат shall идти off→shadow→enforce с метриками расхождения.

## Pre-mortem / Риски (ревью-аспекты для `strict-production-review-gate`)
- **Утечка через незакрытую поверхность** — проверить, что ВСЕ 9 точек Ф4 покрыты + обязательный шлюз `loadContextBlocks`; ревью: греп всех `status: 'canonical'` findMany в knowledge-core на наличие `buildAccessWhere`.
- **Recall-просадка** на `/search` при жёстком фильтре поверх HNSW — проверить iterative_scan/overfetch (анализ §4.3); golden-тест recall.
- **Кэш-байпас** — ключ RetrievalCache или отказ от кэша при enforce.
- **Over-restriction спускаемых решений** — closed только из явного флага/interview, не из «старшего состава»; дефолт открыто (В2/В3).
- **Идемпотентность** бэкфиллов/сидов — повторный прогон no-op (acceptance).
- **Параллельная ветка chatbox** — согласовать identity-хелпер.

## Idempotency / feature-flag / prod-deploy
- Все скрипты идемпотентны, зарегистрированы в `apply-prod-deploy.ts` STEPS (seed-knowledge-groups: bootstrap; backfill-*: update/skipBootstrap).
- Гейт за `KNOWLEDGE_ACCESS_ENFORCEMENT` (off→shadow→enforce), привязка-флаг `knowledge.subjectAttributionAllTypes`.
- `prod-deploy-log.md`: Шаг 1 (ENV+флаги), Шаг 4 (новые модели/поле Meeting), Шаг 7 (seed-knowledge-groups), Шаг 8 (backfill-subject/​block-access), Шаг 12 (smoke retrieval+метрики).
- В скриптах — `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты из `../src`.

## DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend и frontend); vitest unit+integration по затронутым.
- Provenance: who-ось непуста для не-reasoning; клоны собираются шире (smoke).
- Доступ: e2e-предикат «логист ≠ совет» зелёный при enforce; `off` = baseline.
- second-brain обновлён (rbac-access-control / security-and-152fz / company-memory-overview / knowledge-core) + `prod-deploy-log.md` + рефлексия.
- Реестр не-сделанного: строка про доступ закрыта/обновлена; группов­ые чаты сотрудников — отдельной строкой как vNext.

## Итог

**Реализовано целиком (Ф1–Ф8), ветка `feature/knowledge-access-groups`, 9 коммитов:**

| Фаза | Коммит | Закрывает |
|---|---|---|
| Ф1 — провенанс автора на все типы + per-adapter identity | `e253dd19` | R1, R2 |
| Ф2 — модель групп + KnowledgeAccessResolver + флаг | `cbb1c444` | R3, R4, R9 |
| Ф3 — ingest-вывод группы блока (BlockAccessDeriver) + бэкфилл | `0609d381` | R5, R6 |
| Ф4 — security-гейт во ВСЕХ поверхностях retrieval (4 части A-D) | `d4aa1b3e` | R7, R10, R11 |
| Ф5 — контекст клонов в правах спрашивающего | `b08b9ade` | R8 |
| Ф6 — наследование группы на проекции (on-read из sourceBlockIds) | `3f055e80` | R12 |
| Ф7a/Ф7b — backend CRUD + frontend admin UI | `2ade7365`, `a16157ef` | R13, R14 |
| Ф8a — interview→personal дефолт + документация | `a5803ec4` | R15 (код+доки) |

**Ключевые архитектурные решения оркестратора (отступления от буквы ТЗ, с обоснованием):**
- **Ф4 расширен адверсариальной проверкой покрытия** — помимо перечисленных в ТЗ поверхностей, гейт добавлен на `entities`/`themes`/`graph`/`blocks` контроллеры (GET /blocks/:id и др. отдавали контент блоков без гейта; найдено грепом всех canonical-выдач из Pre-mortem). Это и есть «9 точек + проверь все».
- **Ф6 — без новой модели/миграции:** группы проекции выводятся ON-READ из её `sourceBlockIds` (IdeaBlockAccess уже материализован Ф3). Проще, нет рассинхрона, нет риска пропустить create-путь. Цель R12 (строжайшее наследование) достигнута.
- **derive() не переведён в async** — группы проекции считает отдельный резолвер-хелпер (derive остаётся sync/pure, используется широко).

**Инвариант off=байт-в-байт** соблюдён и проверен на каждой фазе (при `KNOWLEDGE_ACCESS_ENFORCEMENT=off` ни один путь не резолвит/не фильтрует). Верификация: typecheck+build+тесты на каждой фазе зелёные (на финале — сотни тестов knowledge-core/rbac/clones/api/orchestrator/meetings).

**Открыто (НЕ за разработкой — за владельцем/операциями):**
- Прогон seed/backfill на проде + поэтапный перевод `KNOWLEDGE_ACCESS_ENFORCEMENT` off→shadow (сверка `kc_access_shadow_diff_total`)→enforce. Инструкция — `docs/operations/prod-deploy-log.md`.
- Строка в реестр `second-brain/04_не-сделано/README.md` (закрыть «доступ к знаниям», добавить vNext) — файл правился параллельной сессией, НЕ тронут во избежание конфликта; внести владельцу.

**vNext (вне scope ТЗ, зафиксировано):** реальный ingest групповых чатов сотрудников (коннектора нет); усиление fuzzy-имён/LLM-arbiter атрибуции; UI крутилки `defaultClosedGroupKind` по типу встречи (backend-эндпоинт готов, нет org-admin листинга типов); чтение текущего `closedGroupKind` в meeting-detail DTO (post-factum селектор сейчас write-only); фильтр проекций в dashboard-агрегатах (senior-роли).
