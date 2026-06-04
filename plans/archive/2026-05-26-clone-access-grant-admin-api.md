---
status: draft
created: 2026-05-26
type: tz
priority: critical
effort: 2-3 дня
depends_on: []
blocks:
  - plans/tz/2026-05-26-clones-marketplace-frontend.md (admin-страница CloneAccessGrant)
  - включение CLONE_V2_ENABLED на проде
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 100%.**
> Реализовано полностью и сверх ТЗ (прошло дополнительный пост-аудит В15/В17/С25/С14). Все 6 эндпоинтов, схема, RBAC-фильтр, audit-mapping, уведомление, patch-скрипт и тесты присутствуют в коде. Незакрытых задач нет — оста
> ⚠️ Хвосты (см. реестр приоритетов): §7.4 открытый вопрос: patch-скрипт не воскрешает revoked-гранты (выбран безопасный MVP-вариант «не трогать revoked»)
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Admin CRUD для `CloneAccessGrant` + миграционный patch-скрипт

> Связанный контекст:
> - [plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md §9](2026-05-25-llm-architecture-changes-from-experiments.md) — Фаза 7 (clone-respond v2, модель `CloneAccessGrant`, флаг `CLONE_V2_ENABLED`).
> - [plans/analysis/2026-05-26-llm-migration-followup-prompt.md §«Задача 4»](../analysis/2026-05-26-llm-migration-followup-prompt.md) — постановка.
> - [second-brain/01_projects/skill-and-clone.md](../../second-brain/01_projects/skill-and-clone.md) — ролевые клоны и их доступ.
> - [second-brain/01_projects/api-layer.md](../../second-brain/01_projects/api-layer.md) — конвенция API-эндпоинтов.
> - [second-brain/01_projects/admin.md](../../second-brain/01_projects/admin.md) — структура админки.

---

## §0. Контекст

В Фазе 7 миграции LLM (коммит `f897d99`) появилась модель `CloneAccessGrant` (`backend/prisma/schema.prisma:2206–2236`):

```
model CloneAccessGrant {
  id              String   @id @default(cuid())
  tenantId        String
  grantedToUserId String      // кому выдали галочку
  cloneType       String      // 'person' | 'role' (двойная природа, без FK)
  cloneRefId      String      // personId или roleId
  grantedById     String      // кто выдал (admin Org)
  grantedAt       DateTime @default(now())

  tenant    Org  @relation(...)
  grantedTo User @relation("CloneAccessGrant_grantedTo", ...)
  grantedBy User @relation("CloneAccessGrant_grantedBy", ...)

  @@unique([tenantId, grantedToUserId, cloneType, cloneRefId])
  @@index([tenantId, grantedToUserId])
  @@index([tenantId, cloneType, cloneRefId])
}
```

`RbacService.canAccessPersonClone` / `canAccessRoleClone` (`backend/src/modules/rbac/rbac.service.ts:477–543`) при `cloneV2Enabled=true` смотрят **только** в `CloneAccessGrant` и игнорируют legacy-правила (носитель / direct manager / owner / admin). Без записи в `CloneAccessGrant` доступа нет ни у кого — даже у owner Org.

Поэтому **включить `CLONE_V2_ENABLED` на проде нельзя** до тех пор, пока:
1) у админа Org нет UI/API чтобы выдавать гранты,
2) при включении флага не подложены первичные гранты (admin Org → все клоны своей Org, носитель роли → свой клон, прямой руководитель → клон подчинённого), иначе на следующее утро после включения **все пользователи теряют доступ ко всем клонам**.

Сейчас:
- Контроллер `backend/src/modules/clones/clones-admin.controller.ts` существует (создан в `6a15b88` для `POST /admin/clones/:roleId/force-new-version`), но эндпоинтов для CloneAccessGrant в нём ещё нет.
- `backend/scripts/patch-migrate-clone-access.ts` — заглушка, ничего в БД не пишет.
- В модели CloneAccessGrant **нет** полей `expiresAt` / `revokedAt` — это нужно добавить в эту волну.

---

## §1. Цели и не-цели

### Цели

1. Дать owner/admin Org полноценный CRUD для `CloneAccessGrant` через REST API (создать / отозвать / продлить / получить список / посмотреть гранты на конкретного клона).
2. Дать рядовому пользователю эндпоинт «что мне выдано» — для оптимистичной фильтрации UI (`useMyCloneAccess()` на фронте).
3. На каждый grant/revoke/extend писать запись в `AdminAuditLog` — кто, кому, когда, какой клон.
4. На каждый **grant** (НЕ на revoke) писать `Notification(eventType='clone.access_granted')` — пользователь получит in-app точку при следующем заходе. Telegram-канал подхватит то же событие, когда будет готов (без дополнительной интеграции сейчас).
5. Расширить схему: добавить `expiresAt` (бессрочные на старте, поле есть в коде на будущее) и `revokedAt` (soft-revoke вместо физического удаления).
6. Дописать patch-скрипт `patch-migrate-clone-access.ts` — идемпотентная первичная миграция первичных грантов (правила B). На пустой проде он создаст 0 записей, на любой непустой — выдаст ожидаемые гранты и не сломается при повторном запуске.
7. После применения схемы и патча включение `CLONE_V2_ENABLED=true` на любом тенанте проходит без визибл-регрессии: те, у кого были «легаси-причины» (носитель, прямой руководитель, admin Org), получают грант и продолжают видеть клона. Все остальные — нет.

### Не-цели

- **НЕ делаем bulk-эндпоинты** («выдай одному пользователю сразу 10 клонов» / «выдай 50 пользователям один клон»). Только one-by-one. Если в реальной эксплуатации появится боль — добавим отдельным ТЗ.
- **НЕ создаём новую роль `clone_admin`.** Раздавать гранты могут owner + admin Org (через `OrgAdminGuard`). super_admin Z — тоже, по факту работы guard'а.
- **НЕ делаем UI для `expiresAt` сейчас.** Поле в схеме появится, API его принимает, но фронт-форма из задачи 3 (`clones-marketplace-frontend.md`) на старте всегда отправляет `null`. Когда date-picker будет нужен — backend уже готов.
- **НЕ интегрируем Telegram-канал сейчас.** `Notification(eventType='clone.access_granted')` пишется в БД, in-app адаптер показывает значок; Telegram-канал подхватит через `NotificationDelivery` когда появится — дополнительной работы здесь не требуется.
- **НЕ трогаем legacy-ветку RBAC.** Поведение при `CLONE_V2_ENABLED=false` остаётся ровно как сейчас.
- **НЕ пишем frontend.** Все UI — в соседнем ТЗ `2026-05-26-clones-marketplace-frontend.md` (включая admin-страницу).
- **НЕ делаем seed-данных** грантов. Гранты выставляются либо patch-скриптом (первичная миграция), либо вручную через API.

---

## §2. API-контракт

Базовый префикс: `/api/v1/admin/clones/access-grants` (новые эндпоинты вешаются в существующий `ClonesAdminController`). Один user-эндпоинт — `/api/v1/me/clone-access` (вешается в существующий `ClonesController`, без admin-guard'а).

Все admin-эндпоинты защищены: `@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)`. User-эндпоинт: `@UseGuards(CookieAuthGuard, TenantGuard)`.

Audit обеспечивает существующий `AdminAuditInterceptor` (`backend/src/modules/admin/admin.audit.interceptor.ts`) — нужно расширить таблицу `classifyAction` в нём (см. §4).

DTO-конвенция (см. skill `nestjs-rules`): Zod-схема + `nestjs-zod` или `ZodValidationPipe` + `@ApiOperation` + `@ApiTags('admin-clones')`. Все тексты ошибок — на русском (см. memory `feedback_admin_ui_russian_only`).

### 2.1. `GET /api/v1/admin/clones/access-grants`

Список грантов в текущем тенанте с фильтрами. Стандартный pagination.

**Query DTO** (`AccessGrantListQuerySchema`):

```ts
{
  grantedToUserId?: string,         // фильтр по получателю
  grantedById?: string,              // фильтр по выдавшему
  cloneType?: 'person' | 'role',
  cloneRefId?: string,               // обычно вместе с cloneType
  isActive?: boolean,                // true: revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())
                                     // false: revoked OR expired
                                     // undefined: всё
  page?: number  (default 1, min 1),
  pageSize?: number (default 50, min 1, max 200),
}
```

**Response DTO** (`AccessGrantListResponseDto`):

```json
{
  "items": [
    {
      "id": "cuid",
      "cloneType": "role",
      "cloneRefId": "role-cuid",
      "cloneLabel": "Клон Маркетолога v3",   // публичное имя клона (см. §3.4 enrichment)
      "grantedTo": { "userId": "...", "userName": "Иван", "userEmail": "i@x" },
      "grantedBy": { "userId": "...", "userName": "Алексей" },
      "grantedAt": "ISO",
      "expiresAt": null,
      "revokedAt": null,
      "revokedBy": null,
      "isActive": true,
      "inactiveReason": null   // 'revoked' | 'expired' | null
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 50
}
```

### 2.2. `POST /api/v1/admin/clones/access-grants`

Выдать грант. Идемпотентность по unique-индексу: если активный грант на эту пару уже есть — вернуть его без создания нового (`201` либо `200`, см. §3.2). Если пара ранее существовала, но `revokedAt IS NOT NULL` — re-grant: создать новую запись (не reanimate'им старую, чтобы был чёткий audit-trail), вернуть новую.

**Body DTO** (`CreateAccessGrantSchema`):

```ts
{
  grantedToUserId: string (cuid),
  cloneType: 'person' | 'role',
  cloneRefId: string (cuid),
  expiresAt?: string (ISO date, nullable, default null),  // на старте всегда null из UI
}
```

**Response**: `201 Created` + `AccessGrantDto` (одна запись, та же форма что в items списка из §2.1).

**Эффекты**:
- `INSERT` в `CloneAccessGrant`.
- `AdminAuditLog`: `action='grant_clone_access'`, `targetType='CloneAccessGrant'`, `targetId=<id>`, `payload={ grantedToUserId, cloneType, cloneRefId, expiresAt }`.
- `Notification(eventType='clone.access_granted', recipientUserId=grantedToUserId)` (см. §5).

### 2.3. `DELETE /api/v1/admin/clones/access-grants/:id`

Soft-revoke. Выставляет `revokedAt = now()` и `revokedBy = currentUserId`. Запись **не удаляется** (нужна для audit-trail и истории на UI).

- Если уже revoked → `400 already_revoked` (детерминированный ответ, idempotent: повторный DELETE не падает 500, но и не меняет `revokedAt`).
- Если не найдена в текущем тенанте → `404`.

**Response**: `200 OK` + `AccessGrantDto` (запись с заполненным `revokedAt`).

**Эффекты**:
- `UPDATE` `CloneAccessGrant` (set `revokedAt`, `revokedBy`).
- `AdminAuditLog`: `action='revoke_clone_access'`, `targetId=<id>`.
- Никаких уведомлений пользователю (пользователю не сообщаем о потере доступа — это admin-операция).

### 2.4. `PATCH /api/v1/admin/clones/access-grants/:id`

Продление/изменение `expiresAt`. Других полей менять нельзя.

**Body DTO** (`UpdateAccessGrantSchema`):

```ts
{
  expiresAt: string | null (ISO date | explicit null)
}
```

- Если запись revoked → `400 cannot_update_revoked`.
- Если не найдена в текущем тенанте → `404`.
- Если `expiresAt < now()` — разрешено (так можно «погасить» грант через истечение, не делая revoke). В audit это всё равно `extend_clone_access` (название слегка условное; payload содержит новое значение).

**Response**: `200 OK` + `AccessGrantDto`.

**Эффекты**:
- `UPDATE` `expiresAt`.
- `AdminAuditLog`: `action='extend_clone_access'`, `targetId=<id>`, `payload={ expiresAt }`.

### 2.5. `GET /api/v1/admin/clones/:cloneType/:cloneRefId/access-grants`

Per-clone view: список всех грантов на конкретного клона (для страницы «Управление доступом» одного клона в UI).

**Params**: `cloneType ∈ {'person', 'role'}`, `cloneRefId: cuid`.

**Query DTO**: `{ includeInactive?: boolean (default false) }` — по умолчанию показывает только активные.

**Response**: тот же `AccessGrantListResponseDto` без pagination (ожидается, что на одного клона грантов мало; если потоком вырастет — добавим pagination отдельной правкой).

**Валидация**: 404 если `cloneRefId` не существует в текущем тенанте (см. §3.3).

### 2.6. `GET /api/v1/me/clone-access`

Что выдано текущему пользователю в текущем тенанте. Используется фронтом для оптимистичной фильтрации карточек/кнопок в маркетплейсе (`useMyCloneAccess()` хук). **Не admin-эндпоинт** — доступен любому залогиненному member'у Org.

**Query DTO**: пусто.

**Response DTO** (`MyCloneAccessResponseDto`):

```json
{
  "personClones": ["personId1", "personId2"],   // active grants
  "roleClones":   ["roleId1", "roleId2"],
  "fetchedAt": "ISO"
}
```

Фильтр: только active (`revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`).

### 2.7. `GET /api/v1/clones/conversations`

**User-facing endpoint** (не admin) — список диалогов текущего пользователя с конкретным клоном. Нужен фронту для отрисовки боковой панели «Прошлые диалоги» в `CloneChatClient` (см. ТЗ 3 §3 `useCloneConversations(roleId)`). Без него карточка клона деградирует — показывает только кнопку «+ Новый диалог» без истории.

Решение принято 2026-05-26: добавить в обычный `ClonesController` (не admin), RBAC через активный грант.

**Query DTO** (`CloneConversationsQuerySchema`):

```ts
{
  cloneType: 'person' | 'role',
  cloneRefId: string (cuid),
  limit?: number  (default 50, min 1, max 200),
  cursor?: string (cuid последнего conversation для пагинации, опц.),
}
```

**Response DTO** (`CloneConversationsListResponseDto`):

```json
{
  "items": [
    {
      "id": "conversation-cuid",
      "title": "Как готовить квартальный отчёт",  // null если ещё не сгенерирован
      "lastMessageAt": "ISO",
      "messageCount": 12,
      "createdAt": "ISO"
    }
  ],
  "nextCursor": "cuid"  // null если больше нет
}
```

**Guards**: `@UseGuards(CookieAuthGuard, TenantGuard)`.

**RBAC**: 403 `clone_access_denied` если у текущего user'а нет активного гранта (`CloneAccessGrant`) на пару `(cloneType, cloneRefId)` в текущем тенанте. Эта же проверка уже работает в `POST /clones/(persons|roles)/:id/ask` — переиспользовать helper `assertCanAccessClone(userId, tenantId, cloneType, cloneRefId)` из `ClonesAccessService` (или создать helper там же, если ещё нет).

**Запрос к БД**: `prisma.cloneConversation.findMany({ where: { tenantId, userId: currentUserId, cloneType, cloneRefId, deletedAt: null }, orderBy: { lastMessageAt: 'desc' }, take: limit, ...cursor })`. Сортировка по `lastMessageAt DESC` (свежие сверху). `messageCount` — через include `_count`.

**Валидация**: 404 `role_not_found` / `person_not_found` если `cloneRefId` не существует в текущем тенанте.

**Эффекты**: только чтение, никакого audit log.

---

## §3. RBAC, валидация и логика сервиса

### 3.1. Guards

- Admin-эндпоинты: `@UseGuards(CookieAuthGuard, TenantGuard, OrgAdminGuard)` + `@UseInterceptors(AdminAuditInterceptor)` (см. `skill-trait-concepts.controller.ts:55–58` как референс).
  - `OrgAdminGuard` (`backend/src/modules/auth/guards/org-admin.guard.ts`) уже пропускает `User.isSuperAdmin || role ∈ {'owner','admin'}` — ничего расширять не надо. coo / manager / member получат `403 org_admin_required`.
- User-эндпоинт `/me/clone-access`: `@UseGuards(CookieAuthGuard, TenantGuard)`.

### 3.2. Валидация при POST (`grant`)

В `ClonesAdminService.createAccessGrant`:

1. **`grantedToUserId` должен быть membership текущего тенанта.** `prisma.membership.findFirst({ where: { orgId: tenantId, userId: grantedToUserId } })`. Если нет — `400 user_not_in_org` (текст: «Нельзя выдать грант пользователю, не состоящему в организации»).
2. **`cloneRefId` должен существовать в текущем тенанте.**
   - `cloneType === 'role'`: `prisma.role.findFirst({ where: { id: cloneRefId, tenantId, deletedAt: null } })`. Если нет — `404 role_not_found`.
   - `cloneType === 'person'`: `prisma.person.findFirst({ where: { id: cloneRefId, tenantId, deletedAt: null } })`. Если нет — `404 person_not_found`.
3. **Идемпотентность.** `prisma.cloneAccessGrant.findUnique({ where: { tenantId_grantedToUserId_cloneType_cloneRefId: { tenantId, grantedToUserId, cloneType, cloneRefId } } })`.
   - Если есть и `revokedAt IS NULL` → возвращаем существующую запись (200, без аудит-записи о grant — чтобы избежать спама). Можно опц. возвращать 200 с заголовком `Idempotent-Replayed: true`.
   - Если есть и `revokedAt IS NOT NULL` → создаём новую запись (re-grant). Чтобы не падать на unique-index, перед insert делаем `await prisma.cloneAccessGrant.deleteMany({ where: { tenantId, grantedToUserId, cloneType, cloneRefId, revokedAt: { not: null } } })` (физически удаляем revoked-запись, audit о ней уже есть). Альтернатива — `update revokedAt = null + grantedAt = now()`, **не рекомендуем** (теряем историю).
4. `prisma.cloneAccessGrant.create({ data: { tenantId, grantedToUserId, cloneType, cloneRefId, grantedById: actorUserId, expiresAt } })`.
5. Эмитим Notification (см. §5).
6. Возвращаем enriched DTO (см. §3.4).

Шаги 2–5 обернуть в `prisma.$transaction`, чтобы grant + delete revoked + notification были атомарны (notification можно вынести из транзакции, лучше — внутрь, чтобы при ошибке нотификации откатился и grant: см. подход в `ConversationalService.sendNotification`).

### 3.3. Валидация при GET per-clone (§2.5)

Если `cloneRefId` не существует в текущем тенанте — `404`. Это чтобы admin не «прозванивал» чужие id фильтром.

### 3.4. Enrichment (`cloneLabel`, `userName`, `userEmail`)

В ответах админ-эндпоинтов нужен человекочитаемый ярлык клона и пользователя — иначе UI каждый раз будет дозапрашивать. Реализация:

- Для `cloneType='role'`: загрузить `ExecutablePersona` (scope='role', scopeRefId=cloneRefId, status='active') → взять `publicName`; fallback на `Role.name` если persona ещё не построена.
- Для `cloneType='person'`: загрузить `Person.name`.
- Пользователи: `Membership` уже содержит `personId`, можно через него вытащить `Person.name`; для `email` — `User.email`. Один батч-запрос на список грантов (избегать N+1).

User-эндпоинт (`/me/clone-access`) **не** делает enrichment — отдаёт только id (его фронт сам мапит, имея уже загруженный список клонов).

### 3.5. Активность гранта

В коде один helper:

```ts
function isGrantActive(grant: CloneAccessGrant, now: Date): boolean {
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}
```

Тот же фильтр в Prisma:

```ts
const activeFilter: Prisma.CloneAccessGrantWhereInput = {
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
};
```

**Важно**: `RbacService.canAccessPersonClone` / `canAccessRoleClone` сейчас делают `findUnique` и считают любой найденный грант валидным. Их нужно поправить — добавить тот же активный-фильтр (см. §8 «Затронутые файлы»). Иначе revoked/expired гранты будут давать доступ.

---

## §4. Audit log

### 4.1. Используем `AdminAuditLog` (не `AuditLog`)

В Z есть две таблицы:
- `AuditLog` (`schema.prisma:1833`) — общий журнал user-действий внутри Org.
- `AdminAuditLog` (`schema.prisma:1333`) — действия админа (Org-admin / super_admin) над платформой.

Для grant/revoke/extend пишем в **`AdminAuditLog`** — это действия админа, целевая аудитория = аудит безопасности Org, форма уже подходит.

### 4.2. Расширение `AdminAuditInterceptor`

В `backend/src/modules/admin/admin.audit.interceptor.ts` (функция `classifyAction`) добавить три ветки:

```ts
// POST /api/v1/admin/clones/access-grants
if (/\/api\/v1\/admin\/clones\/access-grants\/?$/.test(path)) {
  if (method === 'POST') {
    return { action: 'grant_clone_access', targetType: 'CloneAccessGrant' };
  }
}
// DELETE /api/v1/admin/clones/access-grants/:id
// PATCH  /api/v1/admin/clones/access-grants/:id
if (/\/api\/v1\/admin\/clones\/access-grants\/[^/]+\/?$/.test(path)) {
  if (method === 'DELETE') {
    return { action: 'revoke_clone_access', targetType: 'CloneAccessGrant' };
  }
  if (method === 'PATCH') {
    return { action: 'extend_clone_access', targetType: 'CloneAccessGrant' };
  }
}
```

В `extractTargetIdFromPath` добавить регекс для access-grants — либо обобщить до `/(?:integration-keys|meetings|access-grants)\//` чтобы захватить `:id`. Для POST id берётся из `responseBody.id` (interceptor уже умеет — строка 134–139).

**Payload** автоматически берётся из request.body (см. интерсептор). Никаких чувствительных полей в нашем DTO нет, маска `SENSITIVE_FIELDS` не нужна. Для DELETE `body={}` — это ок, в `payload` будет `{}`.

### 4.3. Что в payload

| action | payload |
|---|---|
| `grant_clone_access` | `{ grantedToUserId, cloneType, cloneRefId, expiresAt }` (= request.body) |
| `revoke_clone_access` | `{}` (DELETE без body) |
| `extend_clone_access` | `{ expiresAt }` |

`actorId` — берётся из `req.user.id` интерсептором; `targetId` — id записи CloneAccessGrant. `tenantId` в `AdminAuditLog` **отсутствует как поле** — это глобальный платформенный журнал. Если нужно по-тенантски — фильтровать через JOIN на `CloneAccessGrant.tenantId`. Считаем это достаточным.

### 4.4. Per-clone GET не пишет audit

GET-запросы interceptor пропускает (строка 120). Это устраивает.

---

## §5. In-app уведомления о выдаче гранта

### 5.1. Когда

**Только** при успешном `POST /admin/clones/access-grants` (новая запись, не идемпотентный no-op). При DELETE / PATCH уведомления **не отправляем**.

### 5.2. Куда писать

Используем существующую модель `Notification` (`schema.prisma:5607`). Для нашего event'а никакой новой таблицы не нужно.

**Поля Notification при создании**:

```ts
{
  tenantId,
  recipientUserId: grantedToUserId,
  eventType: 'clone.access_granted',
  payload: {
    schemaVersion: 1,
    body: {
      cloneType,                  // 'person' | 'role'
      cloneRefId,                 // personId | roleId
      cloneLabel,                 // публичное имя клона ('Клон Маркетолога v3' или Person.name)
      grantedByUserId,
      grantedByName,
      grantedAt: ISO,
      expiresAt: ISO | null,
    },
  },
  dataClass: 'internal',
  status: 'queued',
  // contextBlockId / contextCardId — null
  expiresAt: null,                // notification не самоистекает
}
```

### 5.3. Через ConversationalService

В Z уже есть `ConversationalService.sendNotification(input)` (`backend/src/modules/conversational/conversational.service.ts`) — он валидирует payload через `NotificationEventPayloadRegistry`, создаёт Notification + NotificationDelivery по всем релевантным `ChannelBinding`'ам, обходит ENV-флаги и dataclass-gate. Используем его, а не голый `prisma.notification.create`.

**Нужно добавить событие** в `backend/src/modules/conversational/types/event-payload.registry.ts`:

```ts
const CloneAccessGrantedPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  body: z.object({
    cloneType: z.enum(['person', 'role']),
    cloneRefId: z.string().min(1),
    cloneLabel: z.string().min(1).max(200),
    grantedByUserId: z.string().min(1),
    grantedByName: z.string().min(1).max(200),
    grantedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  }),
}).strict();

// Зарегистрировать в реестре:
//   'clone.access_granted': CloneAccessGrantedPayloadSchema
```

### 5.4. In-app адаптер автоматически подхватит

`in-app.adapter.ts` (`backend/src/modules/conversational/adapters/in-app.adapter.ts`) уже знает, как доставлять Notification в in-app канал. На фронте при следующем заходе пользователь увидит точку-индикатор (стандартный механизм). Никаких новых страниц/UI здесь делать не нужно — это часть задачи 3 (frontend).

### 5.5. Telegram-канал

`ConversationalService` сам по `ChannelBinding`'ам пользователя решит, что доставить в Telegram (через `telegram-bot.adapter.ts`), когда у пользователя будет привязка к Telegram. Никакой дополнительной работы здесь не требуется. Если нужно ограничить только in-app — задать `preferredChannelKinds: ['in_app']` в `sendNotification` (рекомендация: **не ограничивать** — пусть пользователь сам выберет канал через настройки).

### 5.6. Если Notification упал

Notification создаётся в той же транзакции что и `CloneAccessGrant.create` → при ошибке всё откатывается. Если это создаёт проблемы (например, `sendNotification` валидирует канал и падает по таймауту) — обернуть в `try/catch` и логировать warn, не откатывая grant (grant важнее уведомления). Решение реализующего по факту тестов.

---

## §6. Изменения схемы Prisma

### 6.1. Расширение `CloneAccessGrant`

```prisma
model CloneAccessGrant {
  id              String    @id @default(cuid())
  tenantId        String
  grantedToUserId String
  cloneType       String
  cloneRefId      String
  grantedById     String
  grantedAt       DateTime  @default(now())

  /// ТЗ 2026-05-26 — soft-revoke. Запись не удаляется, чтобы остался audit-trail.
  /// При повторной выдаче этому же пользователю на этот же клон старая revoked-запись
  /// физически удаляется в транзакции create, чтобы не падать на unique-индексе.
  revokedAt       DateTime?
  revokedBy       String?

  /// ТЗ 2026-05-26 — опциональный срок действия. Из UI на старте всегда null
  /// (UI с date-picker появится позже). При expiresAt < now() грант считается
  /// неактивным (см. RbacService.isGrantActive).
  expiresAt       DateTime?

  tenant     Org   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  grantedTo  User  @relation("CloneAccessGrant_grantedTo", fields: [grantedToUserId], references: [id], onDelete: Cascade)
  grantedBy  User  @relation("CloneAccessGrant_grantedBy", fields: [grantedById], references: [id])
  revokedByU User? @relation("CloneAccessGrant_revokedBy", fields: [revokedBy], references: [id])

  @@unique([tenantId, grantedToUserId, cloneType, cloneRefId])
  @@index([tenantId, grantedToUserId])
  @@index([tenantId, cloneType, cloneRefId])
  @@index([revokedAt])
  @@index([expiresAt])
}
```

Также в модели `User` добавить обратную relation: `cloneAccessGrantsRevoked CloneAccessGrant[] @relation("CloneAccessGrant_revokedBy")`.

Применение: `bun run prisma:push` (правило проекта `prisma-db-push-rules`, **никаких** `prisma migrate`). После — `bun run prisma:generate`.

### 6.2. Никакой новой таблицы для notification

См. §5 — `Notification` уже есть и подходит.

---

## §7. Patch-скрипт `patch-migrate-clone-access.ts`

### 7.1. Цель

Первичная миграция грантов при первом включении `CLONE_V2_ENABLED=true` в проде. На пустой проде даёт 0 записей и тихо завершает работу. На непустой — выдаёт ожидаемые гранты по правилам B (см. §7.2). Идемпотентен — повторный запуск не плодит дубликаты благодаря `createMany({ skipDuplicates: true })` (unique-индекс уже есть).

**Нет** флага `--apply` / `--dry-run` (пользователь явно сказал: на пустой проде это лишнее). Один режим работы — сразу пишет.

**Нет** аргумента `--tenant` обязательным: по умолчанию проходит по **всем** тенантам. Опциональный `--tenant <orgId>` — для прогона на одном тенанте при отладке.

### 7.2. Правила выдачи (B)

Для каждого `Org`:

1. **Носитель роли** (Appointment где `validTo IS NULL AND status IN ('active','acting')`) с заполненным `Person.userId` → грант `(grantedToUserId=Person.userId, cloneType='role', cloneRefId=roleId)`.
   - Под scoped-личного клона (`cloneType='person'`) **гранты не выдаются** — клоны теперь ролевые (см. memory `project_clones_are_role_based`). Запасной маршрут для legacy `cloneType='person'` оставляем только через ручное API (если admin потом захочет дать person-grant).
2. **Прямой руководитель носителя.** В Z **нет** поля `parentRoleId` / иерархии ролей в `Role`. Definition «прямого руководителя» в текущей схеме:
   - руководитель = `Membership.role='manager'` в той же `primaryDepartmentId` что и `Person.primaryDepartmentId` носителя (это та же логика что и `canAccessPersonCloneLegacy`, см. `rbac.service.ts:593–614`).
   - Для каждого носителя роли (см. п.1): найти всех manager'ов того же отдела → выдать каждому грант на этот role-клон.
   - **NB**: если manager — сам носитель этой же роли (бывает), грант всё равно выдать (как self-доступ).
3. **Owner / admin Org.** Все `Membership` с `role IN ('owner', 'admin')` → грант на **все** активные ролевые клоны этой Org. То же по person-клонам **не выдаём** (см. п.1).

**`grantedById`** для всех первичных грантов = `User.id` первого owner'а Org (если owner'ов несколько — берём min id для детерминированности; если нет owner'а вообще — берём первого admin'а; если и тех нет — пропускаем тенант с warn'ом).

**`expiresAt`** = `null` (бессрочно).

### 7.3. Алгоритм (псевдокод)

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs(): { tenantId: string | null } { /* --tenant <id> */ }

interface OrgStat { created: number; skipped: number; tenantId: string; orgName: string; }

async function migrateOrg(tenantId: string): Promise<OrgStat> {
  // 1. Найти actorUserId — первый owner.
  const owner = await prisma.membership.findFirst({
    where: { orgId: tenantId, role: 'owner' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  const adminFallback = owner ?? await prisma.membership.findFirst({
    where: { orgId: tenantId, role: 'admin' },
    orderBy: { joinedAt: 'asc' },
    select: { userId: true },
  });
  if (!adminFallback) {
    console.warn(`[migrate-clone-access] tenant ${tenantId}: нет owner/admin, пропускаем`);
    return { created: 0, skipped: 0, tenantId, orgName: '' };
  }
  const actorUserId = adminFallback.userId;

  // 2. Собрать все нужные пары (grantedToUserId, cloneType, cloneRefId).
  const grants = new Map<string, { grantedToUserId: string; cloneType: 'role'; cloneRefId: string }>();
  const keyOf = (g: { grantedToUserId: string; cloneType: string; cloneRefId: string }) =>
    `${g.grantedToUserId}::${g.cloneType}::${g.cloneRefId}`;

  // 2.1. Носители активных ролей.
  const activeAppointments = await prisma.appointment.findMany({
    where: { tenantId, validTo: null, status: { in: ['active', 'acting'] } },
    select: {
      roleId: true,
      personId: true,
      person: { select: { userId: true, primaryDepartmentId: true } },
    },
  });

  for (const ap of activeAppointments) {
    if (!ap.person.userId) continue;
    // Носитель → грант на свой role-клон.
    const g = { grantedToUserId: ap.person.userId, cloneType: 'role' as const, cloneRefId: ap.roleId };
    grants.set(keyOf(g), g);
  }

  // 2.2. Прямые руководители (manager в том же primaryDepartmentId).
  // Группируем appointments по primaryDepartmentId носителя.
  const departmentToRoleIds = new Map<string, Set<string>>();
  for (const ap of activeAppointments) {
    const dep = ap.person.primaryDepartmentId;
    if (!dep) continue;
    if (!departmentToRoleIds.has(dep)) departmentToRoleIds.set(dep, new Set());
    departmentToRoleIds.get(dep)!.add(ap.roleId);
  }

  for (const [depId, roleIds] of departmentToRoleIds) {
    // Найти всех manager'ов в этом отделе.
    const managers = await prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: 'manager',
        person: { primaryDepartmentId: depId },
      },
      select: { userId: true },
    });
    for (const m of managers) {
      for (const roleId of roleIds) {
        const g = { grantedToUserId: m.userId, cloneType: 'role' as const, cloneRefId: roleId };
        grants.set(keyOf(g), g);
      }
    }
  }

  // 2.3. Owner / admin Org → все активные ролевые клоны.
  const orgAdmins = await prisma.membership.findMany({
    where: { orgId: tenantId, role: { in: ['owner', 'admin'] } },
    select: { userId: true },
  });
  // Все активные ролевые клоны = все Role где есть active ExecutablePersona scope='role'.
  // Можно проще: все Role где deletedAt IS NULL (даже без persona — admin'у выдадим заранее).
  const roles = await prisma.role.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true },
  });
  for (const a of orgAdmins) {
    for (const r of roles) {
      const g = { grantedToUserId: a.userId, cloneType: 'role' as const, cloneRefId: r.id };
      grants.set(keyOf(g), g);
    }
  }

  // 3. createMany с skipDuplicates — идемпотентность.
  if (grants.size === 0) {
    return { created: 0, skipped: 0, tenantId, orgName: '' };
  }
  const data = Array.from(grants.values()).map((g) => ({
    tenantId,
    grantedToUserId: g.grantedToUserId,
    cloneType: g.cloneType,
    cloneRefId: g.cloneRefId,
    grantedById: actorUserId,
    // grantedAt — default(now)
    // expiresAt, revokedAt — null
  }));

  const before = await prisma.cloneAccessGrant.count({ where: { tenantId } });
  const res = await prisma.cloneAccessGrant.createMany({ data, skipDuplicates: true });
  const after = await prisma.cloneAccessGrant.count({ where: { tenantId } });

  const org = await prisma.org.findUnique({ where: { id: tenantId }, select: { name: true } });
  return {
    created: res.count,
    skipped: data.length - res.count,
    tenantId,
    orgName: org?.name ?? '',
  };
}

async function main(): Promise<void> {
  const { tenantId } = parseArgs();
  console.log(`=== patch-migrate-clone-access START (tenantId=${tenantId ?? 'ALL'}) ===`);

  const orgs = tenantId
    ? [{ id: tenantId }]
    : await prisma.org.findMany({ select: { id: true } });

  let totalCreated = 0;
  let totalSkipped = 0;
  for (const org of orgs) {
    const stat = await migrateOrg(org.id);
    console.log(
      `[migrate-clone-access] tenant ${stat.tenantId} (${stat.orgName}): создано ${stat.created} грантов (skipped ${stat.skipped} дубликатов)`,
    );
    totalCreated += stat.created;
    totalSkipped += stat.skipped;
  }

  console.log('=== patch-migrate-clone-access DONE ===');
  console.log(`  total tenants processed: ${orgs.length}`);
  console.log(`  total grants created:    ${totalCreated}`);
  console.log(`  total duplicates skipped: ${totalSkipped}`);
}

main()
  .catch((err) => {
    console.error('patch-migrate-clone-access FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

### 7.4. Идемпотентность — почему `createMany({ skipDuplicates: true })`

Unique-индекс `(tenantId, grantedToUserId, cloneType, cloneRefId)` уже есть. `createMany` с `skipDuplicates: true` (Postgres-native через `ON CONFLICT DO NOTHING`) при повторном запуске вставит 0 записей и не упадёт. Это **проще чем upsert** (`upsert` срабатывает один-к-одному и был бы O(N) запросов).

**Что НЕ делает скрипт идемпотентным «как было» при изменении состояния**:
- Если между прогонами добавился новый Appointment / Membership — скрипт выдаст новые гранты для нового состояния. Это **желаемое поведение** (повторный запуск — это и есть «синхронизировать»).
- Revoked гранты скрипт **не воскрешает**. Если admin вручную revoke'нул, повторный запуск патча создаст НОВУЮ запись (revoked старая не мешает unique-индексу — она по факту физически есть → `skipDuplicates` отбросит). Это потенциальная проблема. **Решение**: перед `createMany` сделать `prisma.cloneAccessGrant.deleteMany({ where: { tenantId, revokedAt: { not: null } } })` **на старте migrateOrg**, чтобы revoked записи не блокировали re-grant.
  - **Альтернатива**: оставить как есть — повторный прогон патча не воскрешает revoked'нутые admin'ом записи (что правильно: admin принял решение, патч не должен его перебивать). Решение реализующего; если выбран этот вариант — задокументировать в комментарии скрипта.
  - **Рекомендуемый вариант для MVP**: оставить как есть (не трогать revoked), это безопаснее.

### 7.5. Запуск

```bash
cd backend
bun run scripts/patch-migrate-clone-access.ts                 # все тенанты
bun run scripts/patch-migrate-clone-access.ts --tenant <orgId> # один тенант
```

Лог идёт в stdout (`console.log`/`console.warn`). Никакого UI, никаких prometheus-метрик (это one-off патч).

Перед прогоном на проде — `bun run prisma:push` (применить расширение схемы из §6.1).

### 7.6. Что делать, если упало посередине

Скрипт идемпотентен, дубликаты не плодятся. Просто запустить ещё раз — `createMany` пропустит то, что уже создал.

---

## §8. Тесты

### 8.1. Unit-тесты RBAC активного фильтра

Файл: `backend/src/modules/rbac/rbac-clone-access.spec.ts` (уже существует — расширить).

Новые кейсы:
- `canAccessPersonClone` с `cloneV2Enabled=true`, grant **revoked** (`revokedAt < now()`) → `allowed=false, relation='none'`.
- то же с `expiresAt` в прошлом → `allowed=false`.
- то же с `expiresAt` в будущем → `allowed=true, relation='grant'`.
- то же с `expiresAt=null` → `allowed=true`.
- те же 4 кейса для `canAccessRoleClone`.

### 8.2. Unit-тесты сервиса `ClonesAdminService`

Файл: `backend/src/modules/clones/services/clones-admin.service.spec.ts` (новый).

Моки: `prisma`, `conversationalService.sendNotification`, `metrics` (если есть).

Кейсы:
- `createAccessGrant` happy path → создаёт запись, эмитит notification, возвращает enriched DTO.
- `createAccessGrant` — `grantedToUserId` не в Org → throw `400 user_not_in_org`.
- `createAccessGrant` — `cloneType='role'`, `cloneRefId` не существует → throw `404 role_not_found`.
- `createAccessGrant` — идемпотентность: уже есть active grant → возвращает существующий, **не** эмитит повторно notification, **не** пишет в audit (audit делает interceptor, но в моках проверяем что повторного INSERT нет).
- `createAccessGrant` — re-grant поверх revoked: удаляет revoked запись и создаёт новую.
- `revokeAccessGrant` happy path → `revokedAt` set, `revokedBy` set; повторный revoke → `400 already_revoked`.
- `revokeAccessGrant` не найдена → `404`.
- `extendAccessGrant` happy path → `expiresAt` обновлён.
- `extendAccessGrant` для revoked → `400 cannot_update_revoked`.
- `listAccessGrants` — фильтры `isActive=true` / `false` / `undefined` дают правильную выборку.
- `listMyCloneAccess` — отдаёт только активные гранты текущего user'а в текущем тенанте.

### 8.3. E2E-тесты эндпоинтов

Файл: `backend/test/e2e/admin-clone-access-grants.spec.ts` (новый).

Сценарии (с реальной test-DB):
- POST → 201 + запись в БД + запись в `AdminAuditLog` (`action='grant_clone_access'`).
- POST как member (не owner/admin) → 403.
- POST с несуществующим `cloneRefId` → 404.
- DELETE → 200, `revokedAt` выставлен, запись в `AdminAuditLog` (`revoke_clone_access`).
- DELETE дважды → второй раз 400 `already_revoked`.
- PATCH expiresAt → 200, audit `extend_clone_access`.
- GET list с фильтром `isActive=true` → возвращает только активные.
- GET `/api/v1/me/clone-access` как member → возвращает только его активные гранты.
- При POST — в `Notification` появилась запись с `eventType='clone.access_granted'` и `recipientUserId=grantedToUserId`.

### 8.4. Тест идемпотентности patch-скрипта

Файл: `backend/test/integration/patch-migrate-clone-access.spec.ts` (новый).

- Подготовить test-БД с 1 Org, 1 owner, 2 ролями, 2 Person + Appointment, 1 manager в том же отделе.
- Прогнать скрипт (вызвать `main()` напрямую с моками `process.argv`).
- Проверить: создано N грантов = (носитель→свой клон ×2) + (manager→каждая роль отдела) + (owner→все роли). Конкретное число посчитать по фикстуре.
- Прогнать скрипт ВТОРОЙ раз.
- Проверить: количество грантов не изменилось, в логе `created: 0, skipped: N`.

### 8.5. Acceptance criteria (DoD)

- [ ] `bun run prisma:push` применил расширение схемы; `bun run prisma:generate` без ошибок.
- [ ] `cd backend && bun run typecheck` зелёный.
- [ ] `cd backend && bun run lint` зелёный (новые файлы — 0 ошибок).
- [ ] `cd backend && bunx vitest run src/modules/rbac/rbac-clone-access.spec.ts` — все кейсы зелёные.
- [ ] `cd backend && bunx vitest run src/modules/clones/services/clones-admin.service.spec.ts` — зелёные.
- [ ] `cd backend && bunx vitest run test/e2e/admin-clone-access-grants.spec.ts` — зелёные.
- [ ] `cd backend && bunx vitest run test/integration/patch-migrate-clone-access.spec.ts` — зелёные (включая повторный прогон).
- [ ] Swagger `/api/docs` показывает 6 новых эндпоинтов с правильными body/response DTO.
- [ ] Все тексты ошибок на русском (см. memory `feedback_admin_ui_russian_only`).
- [ ] Метрики не сломаны (общий `bun run test:unit` зелёный).
- [ ] `patch-migrate-clone-access.ts` на пустой dev-БД отрабатывает: «total tenants processed: 0, total grants created: 0».

---

## §9. Затронутые файлы

**Создаются:**
- `backend/src/modules/clones/services/clones-admin.service.ts` — сервис для CRUD.
- `backend/src/modules/clones/services/clones-admin.service.spec.ts` — unit-тесты.
- `backend/src/modules/clones/dto/clone-access-grants.dto.ts` — Zod-схемы + типы для access-grants и my-access.
- `backend/test/e2e/admin-clone-access-grants.spec.ts` — e2e.
- `backend/test/integration/patch-migrate-clone-access.spec.ts` — тест идемпотентности патча.

**Изменяются:**
- `backend/prisma/schema.prisma` — расширение `CloneAccessGrant` (см. §6.1), обратная relation у `User`.
- `backend/src/modules/clones/clones-admin.controller.ts` — добавить 4 admin-эндпоинта (§2.1–§2.5) и `AdminAuditInterceptor`.
- `backend/src/modules/clones/clones.controller.ts` — добавить `GET /api/v1/me/clone-access` (§2.6). **Альтернатива**: вынести в новый `MeCloneAccessController` — на усмотрение реализующего, оба варианта приемлемы.
- `backend/src/modules/clones/clones.module.ts` — зарегистрировать `ClonesAdminService`, импортировать `ConversationalModule` для нотификаций.
- `backend/src/modules/rbac/rbac.service.ts` — в `canAccessPersonClone` и `canAccessRoleClone` добавить активный-фильтр (`revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`) в `findUnique` (либо использовать `findFirst` с активным where). Сейчас findUnique даёт доступ по любому existing-гранту.
- `backend/src/modules/rbac/rbac-clone-access.spec.ts` — расширение под revoked/expired кейсы.
- `backend/src/modules/admin/admin.audit.interceptor.ts` — расширить `classifyAction` и `extractTargetIdFromPath` для access-grants.
- `backend/src/modules/conversational/types/event-payload.registry.ts` — зарегистрировать `clone.access_granted` payload-схему.
- `backend/scripts/patch-migrate-clone-access.ts` — полная реализация (см. §7.3).

**Документация (после релиза волны):**
- `second-brain/01_projects/skill-and-clone.md` — секция «Доступ к клонам v2: CloneAccessGrant + флаг».
- `second-brain/01_projects/admin.md` — упомянуть новые admin-эндпоинты.
- `second-brain/01_projects/api-layer.md` — добавить /api/v1/admin/clones/access-grants/* и /api/v1/me/clone-access.
- `second-brain/02_architecture/data-model.md` — изменения CloneAccessGrant (revokedAt, expiresAt).
- `second-brain/02_architecture/module-map.md` — упомянуть `ClonesAdminService`.

---

## §10. Roadmap (разделение на коммиты)

Один разработчик, последовательно. Объём 2-3 дня.

### Коммит 1 — `feat(prisma): expand CloneAccessGrant with revokedAt + expiresAt`
- `schema.prisma` — поля + индексы + обратная relation у User.
- `bun run prisma:push && bun run prisma:generate`.
- `bun run typecheck` зелёный (prisma client типы обновлены).
- Без бизнес-кода — только схема, чтобы остальные коммиты тестировались на актуальной модели.

### Коммит 2 — `fix(rbac): фильтр активности гранта в canAccessPersonClone/canAccessRoleClone`
- Обновить два метода в `rbac.service.ts` (revoked / expired игнорируем).
- Расширить `rbac-clone-access.spec.ts` (4×2 новых кейса).
- `bun run typecheck && bunx vitest run src/modules/rbac/` — зелёные.

### Коммит 3 — `feat(clones): admin CRUD для CloneAccessGrant + DTO + service`
- Создать `clones-admin.service.ts` + `clone-access-grants.dto.ts`.
- Расширить `clones-admin.controller.ts` (4 admin-эндпоинта + AdminAuditInterceptor).
- Расширить `clones.module.ts` (провайдеры, импорт ConversationalModule).
- Без notification пока (заглушка `void`).
- Unit-тесты `clones-admin.service.spec.ts` (без notification кейсов).
- typecheck / lint / vitest зелёные.

### Коммит 4 — `feat(clones): эмитим Notification(clone.access_granted) при выдаче гранта`
- Зарегистрировать payload в `event-payload.registry.ts`.
- Раскомментировать вызов `conversationalService.sendNotification` в `clones-admin.service.ts`.
- Доделать тест-кейс «при POST появляется Notification» в spec'е.
- typecheck / vitest зелёные.

### Коммит 5 — `feat(clones): GET /api/v1/me/clone-access — список моих грантов`
- Добавить эндпоинт в `clones.controller.ts` + DTO.
- Метод в `clones-admin.service.ts` (или отдельный `MeCloneAccessService`, но проще в admin-сервис: метод public, без owner-чека).
- Unit-тест + добавление в e2e.

### Коммит 6 — `feat(admin-audit): action mapping для clone access grants`
- Расширить `classifyAction` и `extractTargetIdFromPath` в `admin.audit.interceptor.ts`.
- Проверить вручную через e2e: 3 действия пишут в `AdminAuditLog`.

### Коммит 7 — `test(e2e): admin-clone-access-grants — RBAC + audit + notification`
- Создать `backend/test/e2e/admin-clone-access-grants.spec.ts` со всеми сценариями из §8.3.
- Прогнать `bun run test:e2e` — зелёные.

### Коммит 8 — `feat(scripts): patch-migrate-clone-access — реальная миграция первичных грантов`
- Заменить заглушку на полную реализацию (см. §7.3).
- Создать `backend/test/integration/patch-migrate-clone-access.spec.ts`.
- `bun run scripts/patch-migrate-clone-access.ts` на dev — отрабатывает.
- Прогнать дважды — второй раз `created: 0, skipped: N`.

### Коммит 9 — `docs(second-brain): рефлексия — CloneAccessGrant admin API + patch-скрипт`
- Обновить `skill-and-clone.md`, `admin.md`, `api-layer.md`, `data-model.md`, `module-map.md`.
- Запись в `second-brain/05_история/2026-XX-XX-clone-access-grant-admin-api.md` (см. CLAUDE.md правила).
- Если миграция отработала на dev — приложить статистику в рефлексии.

После коммита 8 — **уведомить пользователя**: «Готов к включению CLONE_V2_ENABLED. Перед флипом флага на проде: 1) bun run prisma:push, 2) bun run scripts/patch-migrate-clone-access.ts, 3) включить флаг через admin settings».

---

## §11. Открытые вопросы

1. **Notification в той же транзакции что и `create CloneAccessGrant` или вне?** Рекомендация — внутри транзакции (атомарность), но если `sendNotification` интегрируется с внешними каналами и может зависнуть — лучше `try/catch` + warn-log. Решение по факту тестов на этапе коммита 4.
2. **Re-grant поверх revoked — физически удалять старую запись или upsert (set revokedAt=null + grantedAt=now)?** В ТЗ выбран первый вариант (удаление) — он чище для audit, потому что audit-trail revoke остаётся в `AdminAuditLog` независимо от записи в `CloneAccessGrant`. Если реализующий обнаружит проблему с FK-ссылками — переключить на upsert и задокументировать в коммите.
3. **Person-клоны (`cloneType='person'`) в patch-скрипте — действительно не выдаём?** В рефлексии 2026-05-25 зафиксировано «клоны теперь ролевые, не персональные». Person-grant остаётся только как ручная админская опция через API. **Подтверждение этого решения** не требуется — оно уже принято в memory `project_clones_are_role_based`.
4. **Удалять ли revoked-записи перед re-prepare в patch-скрипте?** Зафиксирована рекомендация «не удалять» (admin принял решение revoke'нуть, патч не должен перебивать). Если в реальной эксплуатации захочется «синхронизировать всё под чистую» — добавить отдельный флаг `--reset-revoked` отдельным ТЗ.
