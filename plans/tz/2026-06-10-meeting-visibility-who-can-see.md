---
type: tz
status: ready-to-implement
feature: meeting-visibility-who-can-see
date: 2026-06-10
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-10-source-access-parity-with-knowledge-groups.md
  - plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md
---
> Анализ: `plans/analysis/2026-06-10-source-access-parity-with-knowledge-groups.md` (§11 — решения владельца 2026-06-10) · Статус согласования: 2026-06-10.
> **Жёсткая граница (требование владельца):** ТЗ касается ТОЛЬКО видеовстреч (список/детали/отчёт/транскрипт/запись). Подсистему доступа к знаниям «второго мозга» (`block-access-deriver`, `IdeaBlockAccess`, retrieval chat/search/clones, флаг `KNOWLEDGE_ACCESS_ENFORCEMENT`) **НЕ ТРОГАЕМ и НЕ ЛОМАЕМ** — только читаем её резолвер групп. Документы и «факты наследуют доступ источника» — vNext (владелец: «надо подумать»).

# ТЗ: «Кому видно» — доступ к видеовстречам (как в Google Диске)

## Цель

Дать хосту встречи управлять, **кто видит встречу** (а вместе с ней — запись, расшифровку, отчёт): настройка **«Кому видно»** с дефолтом «Участникам» и ручным открытием конкретным людям/группам. Закрыть боль владельца: «я создаю встречи, сотрудники их не видят».

## Зачем (болезненное состояние)

Сейчас встреча доступна **только создателю** (`ownerId === userId`). Даже участники встречи не видят её в списке и не могут открыть запись/отчёт после неё:
- список: жёсткий фильтр по владельцу — [meetings.repository.ts:155](../../backend/src/modules/meetings/meetings.repository.ts#L155) (`where: { ownerId, deletedAt: null }`), комментарий :126 «в MVP не считаем встречи, в которых он гость»;
- детали/отчёт/статус/транскрипт — `if (ownerId !== userId) throw NotAuthorizedError('not_meeting_host')` — [meetings.service.ts:659](../../backend/src/modules/meetings/meetings.service.ts#L659), :1057, :1109, :1132;
- запись (видео/аудио-дорожки) — те же проверки — [recordings.service.ts:469](../../backend/src/modules/recordings/recordings.service.ts#L469), :505.

Результат: команда из 2 сотрудников не видит встречи владельца. Это by design MVP, но больше не нужно.

Метрика «решено»: участник встречи (есть `Participant` с его `userId`) видит её в списке и открывает запись/отчёт; не-участник видит, только если хост ему её открыл (грант) или встреча помечена «Всей компании»; не-участник без гранта при дефолте «Участникам» — `403`.

## REALITY-CHECK (verified по коду 2026-06-10)

| Факт | path:line | Влияние на ТЗ |
|---|---|---|
| Список встреч фильтруется строго `ownerId`, БЕЗ tenantId | [meetings.repository.ts:155](../../backend/src/modules/meetings/meetings.repository.ts#L155) | Заменяем на фильтр «видимости»; добавляем tenant-scope (`@CurrentOrg`) в список |
| READ-методы кидают `not_meeting_host` при `ownerId !== userId` | [meetings.service.ts:659,1057,1109,1132](../../backend/src/modules/meetings/meetings.service.ts#L659) | Меняем ТОЛЬКО эти READ-проверки на `canView`; мутации не трогаем |
| Запись: 5 проверок `ownerId !== userId` | [recordings.service.ts:92,181,469,505,535](../../backend/src/modules/recordings/recordings.service.ts#L92) | На `canView` меняем ТОЛЬКО READ (`getDownloadUrl` :469, `getAudioTracks` :505). `start`/`stop`/`deleteEarly` — host-only, НЕ трогаем |
| `Participant` имеет `userId`, `personId`, `role`, `invitationStatus` | [schema.prisma:1407](../../backend/prisma/schema.prisma#L1407) | Участник = `Participant.userId === user.id`; маппинг person для грантов есть |
| Движок групп: `KnowledgeAccessResolver.resolveAccessibleGroups` → `{deptGroupIds, closedGroupIds, isBypass}` | [knowledge-access-resolver.service.ts:40](../../backend/src/modules/rbac/knowledge-access-resolver.service.ts#L40) | Переиспользуем для `isBypass` и резолва групп пользователя. Эти deptGroupIds **уже расширены матрицей** — для грантов нужна ПРЯМАЯ принадлежность → добавляем read-only метод `resolveDirectGroupIds` |
| `KnowledgeGroup` (department/leadership/council/personal) + `KnowledgeGroupMember` | [schema.prisma:2831](../../backend/prisma/schema.prisma#L2831) | Группы для гранта «Выбрать группу». НЕ трогаем |
| `Meeting.closedGroupKind` + `MeetingTypeConfig.defaultClosedGroupKind` — это про **граф знаний**, не про видео | [schema.prisma:1355](../../backend/prisma/schema.prisma#L1355), :9880 | НЕ переиспользуем для видимости встречи; видимость — отдельное новое поле |
| `block-access-deriver`, `IdeaBlockAccess`, retrieval chat/search/clones, флаг `KNOWLEDGE_ACCESS_ENFORCEMENT` | [block-access-deriver.service.ts](../../backend/src/modules/knowledge-core/services/block-access-deriver.service.ts), [chat-v2.service.ts:579](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L579) | **НЕ ТРОГАЕМ.** Видимость встречи — отдельная подсистема, не пересекается |
| Партнёрский путь Crossmark: `getForCrossmark`/`getCrossmarkDownloadUrl` — без userId (HMAC) | [meetings.service.ts:650](../../backend/src/modules/meetings/meetings.service.ts#L650) | НЕ трогаем |
| `getAccess` (вход в живой эфир `/m/:id`) — отдельная роль host/guest/none | [meetings.service.ts:688](../../backend/src/modules/meetings/meetings.service.ts#L688) | НЕ трогаем (это про живой вход, не про видимость после) |

**Вывод REALITY-CHECK:** фича изолирована. Добавляем поле + таблицу грантов + один сервис-предикат + правим ТОЛЬКО READ-проверки на 6 поверхностях встречи. Граф знаний и документы не затрагиваются.

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Д1 | Только **видеовстречи**. Граф знаний («второй мозг», авто-раскладка) — НЕ трогать, НЕ ломать | Владелец 2026-06-10 дословно: «мы тут говорим только про видео встречи… ту автораскладку во второй мозг вообще не трогай» |
| Д2 | Модель «**Кому видно**» (как Google Диск): `Только мне` · `Участникам` (ДЕФОЛТ) · `Выбрать людей и группы` · `Всей компании` | §11 анализа; ручной доступ + понятный дефолт |
| Д3 | **Один доступ на всё про встречу**: кому видна встреча — тому видны видео, аудио-дорожки, расшифровка, отчёт | §11; не разводить доступ к записи отдельно |
| Д4 | Дефолт обычной встречи = **«Участникам»**; остальным хост открывает руками | Владелец 2026-06-10 |
| Д5 | **Управление** встречей (запуск/остановка записи, удаление, приглашения, контролы, переименование, retry/regenerate, смена «Кому видно») остаётся **только у хоста** | Просмотр ≠ управление; не давать гранту-зрителю права хоста |
| Д6 | Документы — дефолт **«Всей компании»** (как сейчас), в этом ТЗ НЕ меняем | Владелец 2026-06-10; vNext если понадобится сузить |
| Д7 | «Факты наследуют доступ источника» (chat/search/клоны учитывают «Кому видно») — **отложено**, vNext | Владелец: «надо подумать»; не блокирует видео-видимость |

## Доказательство выбора

Полная матрица (A зеркало / B из блоков / C вертикаль / D ручной список) и состязательная перепроверка — в анализе §4–§7. Итог разговора с владельцем: **D — ручной список «Кому видно» с дефолтом**, потому что предсказуемо, под полным контролем владельца, не требует трогать граф знаний. Группы переиспользуем как «много людей сразу» (read-only), новый источник правды видимости — поле на встрече + таблица грантов.

**Challenge-loop:**
- *Корень, не симптом?* Да: меняем саму модель доступа к встрече (бинарный owner-only → список аудитории), а не латаем один эндпоинт. Чиним весь КЛАСС READ-поверхностей (6 точек) разом + единый предикат.
- *Самое эффективное?* Да: без новой авто-логики и без LLM; поле + грант-таблица + один предикат; переиспользуем резолвер групп (read-only).
- *Код ради кода?* Нет: группы и резолвер берём готовые; не дублируем person→dept→group (добавляем 1 read-only метод).

## Scope

**Входит:**
1. Поле `Meeting.visibilityScope` (дефолт `participants`) + таблица `MeetingAccessGrant`.
2. Сервис-предикат `MeetingVisibilityService` (`canView` / `assertCanView` / `buildListWhere`) + read-only метод `resolveDirectGroupIds` в `KnowledgeAccessResolver`.
3. Применение `canView` на 6 READ-поверхностях встречи (список, детали, отчёт, статус, транскрипт, запись: download + audio-tracks).
4. Эндпоинты `GET /meetings/:id/visibility` и `PATCH /meetings/:id/visibility` (host-only) + отдача `visibilityScope` в DTO встречи.
5. Frontend: контрол «Кому видно» при создании и на странице встречи (пресеты + пикер людей/групп).
6. Kill-switch `MEETING_VISIBILITY_ENABLED` (дефолт true) + строка в реестр флагов.

**Не входит (vNext, с судьбой):**
- «Факты наследуют доступ встречи» (chat-v2/search/клоны фильтруют блоки по видимости источника) → vNext-ТЗ, Д7. Заглушка: `relates_to` будущего ТЗ `plans/tz/202X-XX-XX-facts-inherit-source-visibility.md`.
- «Кому видно» для **документов** → vNext, Д6 (сейчас остаются «Всей компании», поведение не меняем).
- Авто-дефолт «Кому видно» по типу встречи (1:1/HR плотнее) → vNext; в v1 все типы → дефолт `participants`, хост сужает руками.
- Изменение партнёрского пути Crossmark.

## Граничные контракты с другими подсистемами

- **ОБЛАСТЬ ТЗ = только физический доступ к СТРАНИЦЕ встречи** (список → детали → отчёт → протокол/расшифровка → запись). Это «кто может ОТКРЫТЬ страницу». Никакой бизнес-логики после встречи.
- **Конвейер «во второй мозг» (ingest) работает БЕЗ ИЗМЕНЕНИЙ.** После встречи воркеры разбирают её в граф знаний как сегодня. Новое поле `Meeting.visibilityScope` — **отдельное; ingest-конвейер его НЕ читает** (`block-access-deriver` читает `closedGroupKind`/тип/участников из payload, не `visibilityScope` — [block-access-deriver.service.ts:169](../../backend/src/modules/knowledge-core/services/block-access-deriver.service.ts#L169)). Добавление поля и видимости страницы НЕ влияет на разбор, на блоки, на память.
- **knowledge-access (второй мозг)** — только ЧИТАЕМ `KnowledgeAccessResolver` (резолв групп + `isBypass`). Добавляем НОВЫЙ read-only метод `resolveDirectGroupIds` (additive, не меняет существующие). `block-access-deriver`, `IdeaBlockAccess`, `buildAccessWhere`, флаг `KNOWLEDGE_ACCESS_ENFORCEMENT`, воркеры ingest — НЕ читаем и НЕ пишем из видео-видимости. Регрессия-гард: existing-тесты knowledge-access зелёные без изменений.
- **`getAccess` (живой эфир)** — оставляем как есть; видимость не влияет на вход в идущую встречу по приглашению.
- **Документы** — модуль `documents` НЕ трогаем.

## Контракт-first

### Prisma (Ф1) — дословно

`Meeting` — добавить поле (рядом с существующим `closedGroupKind`, [schema.prisma:1355](../../backend/prisma/schema.prisma#L1355); номер перечитать перед правкой — якорь: строка `closedGroupKind String? @db.VarChar(20)`):
```prisma
  /// ТЗ 2026-06-10 meeting-visibility — «Кому видно» встреча (видео/запись/расшифровка/отчёт).
  /// 'owner_only' | 'participants' (дефолт) | 'custom' | 'org'. Источник правды доступа к
  /// READ-поверхностям встречи. НЕ влияет на граф знаний (отдельная подсистема).
  visibilityScope String @default("participants") @db.VarChar(16)
  accessGrants    MeetingAccessGrant[]
```

Новая модель (рядом с `Participant`/`Meeting`-блоком):
```prisma
/// ТЗ 2026-06-10 meeting-visibility — явный грант доступа к встрече (scope='custom').
/// Кому хост открыл руками: человек (Person) или группа (KnowledgeGroup, ПРЯМОЕ членство).
/// tenantId — денормализован скаляром для индекса; каскад через Meeting (не через Org,
/// чтобы не править модель Org). При удалении встречи гранты удаляются.
model MeetingAccessGrant {
  id          String   @id @default(cuid())
  tenantId    String
  meetingId   String
  granteeType String   @db.VarChar(8)  /// 'person' | 'group'
  granteeId   String                   /// Person.id | KnowledgeGroup.id
  grantedById String                   /// User.id хоста, выдавшего доступ
  createdAt   DateTime @default(now())
  meeting     Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  @@unique([meetingId, granteeType, granteeId])
  @@index([tenantId, meetingId])
  @@index([granteeType, granteeId])
}
```
Применение схемы: `bun run prisma:migrate -- --name meeting_visibility` (migrate dev → файл миграции + локальное применение), затем `bun run prisma:generate`. На прод — авто через `migrate deploy` (см. prod-deploy-log). Никакого `db push` в коммит. Никаких новых HNSW/GIN — индексы обычные, в schema.

### Предикат доступа (Ф2) — каноничное правило

`canView(meeting, userId, ctx)` → `boolean` (псевдокод, реализация в `MeetingVisibilityService`):
```
если !cfg.meetingVisibilityEnabled → return (meeting.ownerId === userId)   // kill-switch → legacy owner-only
если ctx.isBypass (owner/admin/super_admin Org)                 → true
если meeting.ownerId === userId                                 → true
если meeting.visibilityScope === 'org'                          → true
если meeting.visibilityScope ∈ {'participants','custom'}
      и ∃ Participant(meetingId, userId=userId)                 → true
если meeting.visibilityScope === 'custom' и (
        ∃ grant(meetingId, 'person', ctx.personId) ИЛИ
        ∃ grant(meetingId, 'group', g) где g ∈ ctx.directGroupIds
     )                                                          → true
иначе                                                           → false
// scope='owner_only' → видит только владелец (+bypass); участники НЕ видят.
```
- `ctx = { personId, directGroupIds, isBypass }` — из `KnowledgeAccessResolver.resolveDirectGroupIds({tenantId, userId})` (см. ниже). Кэш TTL как у существующего резолвера.
- **ПРЯМОЕ членство** (`directGroupIds`), НЕ матрица видимости отделов: грант группе «Логистика» видят прямые члены логистики, а не «кто видит логистику по матрице». Матрица — концепт графа знаний, в видео-видимость не тянем (Д1).

`resolveDirectGroupIds` (НОВЫЙ метод в [knowledge-access-resolver.service.ts](../../backend/src/modules/rbac/knowledge-access-resolver.service.ts), additive — НЕ менять существующие методы):
```
вернуть { personId, isBypass, groupIds } где
  isBypass — как в resolveAccessibleGroups (super_admin|owner|admin);
  personId — Person(tenantId,userId).id;
  groupIds — ПРЯМЫЕ группы пользователя БЕЗ матрицы:
     department-группы по его deptIds (primaryDepartmentId ∪ PersonRole.role.departmentId
       ∪ Appointment.departmentId ∪ headOfDepartments)
     ∪ closedGroupIds (KnowledgeGroupMember, group.isClosed)
     ∪ ручные KnowledgeGroupMember(kind=department).
  // То есть `ownDeptGroupIds ∪ closedGroupIds` ДО шага матрицы (строки :112-120 не применять).
```

### Where для списка (Ф2/Ф3)

`buildListWhere(ctx, tenantId)` → `Prisma.MeetingWhereInput`:
```ts
// kill-switch off → legacy: { ownerId: userId }
// ctx.isBypass → { tenantId }   (видит все встречи своей Org)
// иначе:
{
  tenantId,
  OR: [
    { ownerId: userId },
    { visibilityScope: 'org' },
    { visibilityScope: { in: ['participants', 'custom'] },
      participants: { some: { userId } } },
    { visibilityScope: 'custom',
      accessGrants: { some: { OR: [
        { granteeType: 'person', granteeId: ctx.personId ?? '__none__' },
        { granteeType: 'group', granteeId: { in: ctx.directGroupIds.length ? ctx.directGroupIds : ['__none__'] } },
      ] } } },
  ],
}
```
Этот фрагмент спредится рядом с существующими фильтрами (`status`/`type`/`query`/`createdAt`/`cardId`) и `deletedAt: null` в [meetings.repository.ts:155](../../backend/src/modules/meetings/meetings.repository.ts#L155).

### Эндпоинт «Кому видно» (Ф4) — Zod-DTO

`GET /api/v1/meetings/:id/visibility` (host-only) → 
```jsonc
{ "scope": "participants", "grants": [
  { "granteeType": "person", "granteeId": "<personId>", "name": "Иван" },
  { "granteeType": "group",  "granteeId": "<groupId>",  "name": "Руководство" }
] }
```
`PATCH /api/v1/meetings/:id/visibility` (host-only):
```ts
const SetVisibilitySchema = z.object({
  scope: z.enum(['owner_only', 'participants', 'custom', 'org']),
  grants: z.array(z.object({
    granteeType: z.enum(['person', 'group']),
    granteeId: z.string().min(1).max(50),
  })).max(200).optional(),   // обязателен/непустой только при scope='custom'
});
```
Семантика PATCH: ставит `visibilityScope`; при `scope='custom'` — полная замена набора грантов (delete-all + createMany в одной транзакции, идемпотентно по `@@unique`); при других scope — гранты очищаются. Коды ошибок: `403 not_meeting_host` (не хост), `404 meeting_not_found`, `400 grants_required_for_custom` (scope=custom без непустого grants), `400 invalid_grantee` (granteeId не Person/KnowledgeGroup этого tenant).

DTO встречи (детали/отчёт) дополняется полем `visibilityScope` (для UI). Список — добавить `visibilityScope` в summary-маппер [meetings.controller.ts:539](../../backend/src/modules/meetings/meetings.controller.ts#L539).

### ENV (Ф2) — kill-switch

В [env.schema.ts](../../backend/src/common/config/env.schema.ts) рядом с прочими флагами:
```ts
// Kill-switch видео-видимости. true = действует «Кому видно» (дефолт);
// false = аварийный откат к legacy owner-only. Ship-On: выкатываем ON.
MEETING_VISIBILITY_ENABLED: z.coerce.boolean().default(true),
```
Читать через `TypedConfigService` (геттер `cfg.meetingVisibilityEnabled`), НЕ `process.env`.

## Границы фичи

**✅ Always:** менять только READ-проверки встречи; переиспользовать резолвер групп read-only; tenant-scope в списке; host-only на мутациях и на PATCH visibility.
**⚠️ Ask first:** любой соблазн «заодно» прокинуть видимость в chat/search/клоны или в документы — это vNext (Д7/Д6), не делать.
**🚫 Never:** трогать `block-access-deriver`, `IdeaBlockAccess`, `buildAccessWhere`, флаг `KNOWLEDGE_ACCESS_ENFORCEMENT`, retrieval графа; менять `start/stop/deleteEarly` записи и мутации встречи на `canView`; `new PrismaClient()`/`process.env.*`/`db push` в коммит.

## Фазы

Граф зависимостей: **Ф1 → Ф2 → {Ф3, Ф4}; Ф4 → Ф5; Ф6 — последняя (после Ф3+Ф4+Ф5).** Ф3 и Ф4 параллельны (обе зависят от Ф2).

### Ф1 — Схема: поле видимости + таблица грантов `[x]`
**Цель:** добавить `Meeting.visibilityScope` + модель `MeetingAccessGrant`, миграция, generate.
**Входит:** правка `schema.prisma` (2 места — поле в `Meeting` + новая модель), `bun run prisma:migrate -- --name meeting_visibility`, `bun run prisma:generate`.
**Что НЕ входит:** любая логика чтения/записи (это Ф2+).
**Файлы:** `backend/prisma/schema.prisma`; новый файл миграции в `backend/prisma/migrations/`.
**Acceptance:**
- `bun run prisma:generate` без ошибок; в сгенерированном клиенте есть `Meeting.visibilityScope` и модель `MeetingAccessGrant`.
- `bun run typecheck` зелёный.
- grep: `visibilityScope String @default("participants")` и `model MeetingAccessGrant` присутствуют в schema.prisma.
- Миграция повторно применяется как no-op (idempotent на чистой БД).
**Закрывает:** R1.

### Ф2 — Бэкенд-ядро: резолвер + предикат `[x]`
**Цель:** `resolveDirectGroupIds` (read-only, в KnowledgeAccessResolver) + `MeetingVisibilityService` (`canView`/`assertCanView`/`buildListWhere`) + kill-switch ENV.
**Входит:**
- НОВЫЙ метод `resolveDirectGroupIds({tenantId,userId})` в `knowledge-access-resolver.service.ts` (additive; НЕ менять `resolveAccessibleGroups`/`buildAccessWhere`/прочее).
- Новый `backend/src/modules/meetings/meeting-visibility.service.ts` с `canView(meeting, userId)`, `assertCanView(meetingId, userId): Promise<Meeting>` (throws `NotAuthorizedError('meeting_not_visible')` / `MeetingNotFoundError`), `buildListWhere(ctx, tenantId, userId)`.
- ENV `MEETING_VISIBILITY_ENABLED` + геттер в `TypedConfigService`.
- Регистрация сервиса в `meetings.module.ts` (импорт RbacModule/резолвера, если ещё не виден).
**Что НЕ входит:** правка эндпоинтов/репозитория (Ф3), API visibility (Ф4).
**Файлы:** `backend/src/modules/rbac/knowledge-access-resolver.service.ts` (+1 метод), `backend/src/modules/meetings/meeting-visibility.service.ts` (new), `backend/src/modules/meetings/meetings.module.ts`, `backend/src/common/config/env.schema.ts`, `backend/src/common/config/typed-config.service.ts`.
**Acceptance (unit, vitest):**
- `meeting-visibility.service.spec.ts`: таблица кейсов canView — owner→true; bypass→true; scope=org→true (любой tenant-member); scope=participants + участник→true; scope=participants + НЕ участник→false; scope=custom + person-грант→true; scope=custom + group-грант (прямой член)→true; scope=custom + НЕ член→false; scope=owner_only + участник→false; kill-switch off → строго owner.
- `resolveDirectGroupIds` НЕ применяет матрицу: тест с `GroupVisibilityPolicy` — visibleGroup НЕ попадает в `groupIds`.
- Регресс-гард: existing `knowledge-access-resolver.service.spec.ts` зелёный без изменений.
- `bun run typecheck` + `bunx vitest run backend/src/modules/meetings/meeting-visibility.service.spec.ts` зелёные.
**Закрывает:** R3, R6, R7.

### Ф3 — Бэкенд: подключить `canView` на READ-поверхностях `[x]`
> Реализация: при переводе `getForUser` на `assertCanView` вскрылась эскалация — host-only мутации (`renameParticipant`/`setClosedGroupKind`) и контроллерный `retry-ai` гейтили хоста ЧЕРЕЗ `getForUser`. Добавлен публичный `assertMeetingHost` (явный owner-чек), им закрыты все три места. Регенерация — свой owner-чек, не затронута.
**Цель:** заменить owner-only READ-проверки на `canView`; список — на `buildListWhere` с tenant-scope; мутации НЕ трогать.
**Входит (точечно):**
- `meetings.repository.ts`: `listByOwner` → `listVisibleTo(userId, ctx, tenantId, filters)` — where через `buildListWhere`. Вызвать из `meetings.service.list` (прокинуть tenantId из контроллера).
- `meetings.controller.ts`: в `GET /` добавить `@CurrentOrg() tenantId`; пробросить в `service.list`. В summary-маппере добавить `visibilityScope`.
- `meetings.service.ts`: `getForUser` (:659), `getResult` (:1057), `getResultStatus` (:1109), `getTranscript` (:1132) — заменить `if (ownerId !== userId) throw not_meeting_host` на `assertCanView`. **Оставить** owner-проверку как есть в host-only методах (`renameParticipant`, `setClosedGroupKind`, `addInvitees`, `softDelete`, `retry-ai`-путь).
- `recordings.service.ts`: `getDownloadUrl` (:469) и `getAudioTracks` (:505) — на `assertCanView`. **НЕ трогать** `start`(:92)/`stop`(:181)/`deleteEarly`(:535).
**Что НЕ входит:** новый эндпоинт visibility (Ф4); UI (Ф5).
**Файлы:** `meetings.repository.ts`, `meetings.service.ts`, `meetings.controller.ts`, `recordings.service.ts` (+ обновить их `.spec.ts`).
**Acceptance:**
- `meetings.service.*.spec.ts`/новый spec: участник видит детали/отчёт/транскрипт; не-участник при дефолте → `meeting_not_visible`; owner/bypass → видят; запись (download/audio) тем же предикатом.
- Список: для участника содержит встречу, где он `Participant`, и встречу scope=org; НЕ содержит чужую `participants`-встречу без гранта. Bypass-роль видит все встречи Org.
- Регресс: host-only методы по-прежнему `403` не-хосту (grep — в `renameParticipant`/`setClosedGroupKind`/`addInvitees`/`softDelete` остался `ownerId !== ...` / `not_meeting_host`; в `start`/`stop`/`deleteEarly` тоже).
- `bun run typecheck` + затронутые `bunx vitest run` зелёные.
**Закрывает:** R2, R4.

### Ф4 — Бэкенд: API «Кому видно» `[x]`
**Цель:** `GET`/`PATCH /meetings/:id/visibility` (host-only) + отдача `visibilityScope` в DTO деталей/отчёта.
**Входит:** Zod-DTO `SetVisibilitySchema`; контроллер-методы (host-only через существующую owner-проверку `getForUser`-как-хост — НЕ `canView`); сервис-методы `getVisibility`/`setVisibility` (транзакция замены грантов, валидация granteeId принадлежит tenant); Swagger; коды ошибок из контракта.
**Что НЕ входит:** UI (Ф5).
**Файлы:** `meetings.controller.ts`, `meetings.service.ts`, `meetings/dto/*` (новый dto), `meeting-public.dto.ts` (+`visibilityScope`).
**Acceptance:**
- `PATCH` host-ом ставит scope; `custom` без непустых grants → `400 grants_required_for_custom`; чужой granteeId → `400 invalid_grantee`; не-хост → `403 not_meeting_host`.
- `GET` возвращает scope + список грантов с человекочитаемым `name`.
- Идемпотентность: повторный `PATCH` с тем же телом → тот же результат, без дублей (`@@unique`).
- Swagger smoke: оба эндпоинта в `/api/docs`. `bun run typecheck`/`build` зелёные.
**Закрывает:** R5.

### Ф5 — Фронтенд: контрол «Кому видно» `[x]`
> Реализация: `VisibilityControl`/`VisibilityDialog` (meeting-result-v2) + пресет в `CreateMeetingFormV2` (после create → PATCH если scope≠participants). Пикер людей — через существующий `ParticipantPicker` (поиск), группы — `knowledgeAccessApi.listGroups`. isHost — реакция на 403 (явного флага хоста на странице нет). Чип «Кому видно: …» в шапке. typecheck/lint/build 0; ручная приёмка глазами — в проде (qa-tester).
**Цель:** выбор «Кому видно» при создании встречи и на странице встречи (пресеты + пикер людей/групп), слои `ApiDto→DomainModel→UiModel`.
**Входит:** компонент «Кому видно» (radio пресеты: Только мне / Участникам / Выбрать людей и группы / Всей компании; при «Выбрать» — мультиселект людей и групп Org); вызовы `GET/PATCH visibility` через единый `api-client.ts`; маппер домена; показ текущего режима в карточке/деталях встречи. Все строки UI — русские; парные цветовые токены.
**Что НЕ входит:** документы.
**Файлы:** `frontend/src/api/*` (meetings visibility), `frontend/src/domain/*`, страница встречи/создания в `frontend/app/(authenticated)/...`.
**Acceptance:**
- Создание встречи: выбран «Участникам» по умолчанию; смена на «Выбрать» открывает пикер; сохранение шлёт `PATCH visibility`.
- На странице встречи (host) виден текущий режим и доступно редактирование; не-host режим не редактирует.
- `bun run typecheck` + `bun run lint` + `bun run build` (frontend) зелёные; ни одного английского слова в UI.
**Закрывает:** R10.

### Ф6 — Флаг, реестр, прод-инструкция `[ ]`
**Цель:** kill-switch задокументирован, прод-шаги выписаны, second-brain обновлён.
**Входит:** строка в `docs/operations/feature-flags.md` (kill-switch `MEETING_VISIBILITY_ENABLED`, ON); запись в `docs/operations/prod-deploy-log.md` (Шаг 1 ENV + Шаг 4 миграция `meeting_visibility`); обновить second-brain (`01_projects/api-layer.md` — 2 эндпоинта; `02_architecture/data-model.md` — поле+таблица; профильная заметка про встречи); убрать строку из реестра `04_не-сделано` (закрыто видео-частью) или переформулировать на остаток (документы/факты vNext).
**Acceptance:** флаг в реестре; prod-deploy-log содержит миграцию + ENV; `git grep` подтверждает обновление data-model.md и api-layer.md.
**Закрывает:** R7 (документирование), DoD-производные.

## Трассировка требований (EARS)

- **R1.** Система shall хранить `Meeting.visibilityScope ∈ {owner_only,participants,custom,org}`, дефолт `participants`.
- **R2.** Когда пользователь запрашивает READ-поверхность встречи (список/детали/отчёт/статус/транскрипт/запись-download/audio-tracks), система shall отдать её только если `canView=true`; иначе для деталей/записи — `403 meeting_not_visible`, для списка — исключить из выдачи.
- **R3.** Система shall вычислять `canView` строго по правилу из «Контракт-first» (bypass/owner/org/participant/custom-grant).
- **R4.** Управляющие действия встречи и записи (start/stop/delete, invitees, контролы, rename, closed-group, retry/regenerate, soft-delete, set-visibility) shall оставаться host-only (`ownerId===userId`), без изменений.
- **R5.** Если actor — хост, система shall позволить задать scope и (для `custom`) набор грантов через `PATCH /meetings/:id/visibility`; иначе `403`.
- **R6.** Грант группе shall срабатывать по ПРЯМОМУ членству, без матрицы видимости отделов.
- **R7.** Если `MEETING_VISIBILITY_ENABLED=false`, система shall вести себя как legacy owner-only на всех затронутых поверхностях.
- **R8.** Система shall НЕ изменять подсистему knowledge-access (deriver/IdeaBlockAccess/retrieval/флаг) — регресс-тесты зелёные без правок.
- **R9.** Доступ к документам shall остаться без изменений (всей компании).
- **R10.** Фронт shall предоставлять контрол «Кому видно» (пресеты + пикер людей/групп) при создании и на странице встречи.

## Pre-mortem / Риски и ревью-аспекты

| Риск | Митигация |
|---|---|
| Случайно ослабили host-only мутации (грант-зритель получил права хоста) | Ф3 меняет ТОЛЬКО READ; ревью-гейт грепает, что мутации и start/stop/delete сохранили `ownerId`-проверку (R4) |
| Сломали knowledge-access, тронув резолвер | `resolveDirectGroupIds` — ТОЛЬКО новый метод; регресс-спек knowledge-access обязателен в Acceptance Ф2 (R8) |
| Список потерял tenant-изоляцию | `buildListWhere` всегда добавляет `tenantId`; тест «не видно встречи чужой Org» |
| `owner_only` прячет встречу от участника, который реально был | Это осознанный режим (Д2); дефолт — `participants`, не `owner_only` |
| Матрица отделов «протекла» в видео-доступ | Грант группе — прямое членство; тест с `GroupVisibilityPolicy` (R6) |
| Bypass (admin) внезапно видит все встречи Org | Это намеренно (как в knowledge `isBypass`); зафиксировано в R3 |

**Для `strict-production-review-gate`:** auth на READ vs мутациях (не перепутаны), tenant-scope списка, идемпотентность PATCH грантов, отсутствие правок в knowledge-core, kill-switch действительно откатывает к owner-only.

## Идемпотентность / флаг / прод-деплой

- **Флаг:** `MEETING_VISIBILITY_ENABLED` — kill-switch (Ship-On: ON по умолчанию; аварийный откат к owner-only). Строка в `docs/operations/feature-flags.md`.
- **Миграция:** файловая `meeting_visibility`, на прод авто `migrate deploy` (`docker compose up -d`); повторный прогон no-op. Регистрировать в `apply-prod-deploy.ts` НЕ нужно (это миграция схемы, не seed/patch).
- **PATCH visibility** идемпотентен по `@@unique([meetingId,granteeType,granteeId])`.
- **Prod-инструкция:** только `docker compose up -d --build backend` (миграция применится сама) + выставить `MEETING_VISIBILITY_ENABLED=true` (дефолт). Полное — в prod-deploy-log.

## DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend и frontend).
- Новые unit-спеки зелёные; регресс knowledge-access зелёный без изменений.
- second-brain обновлён по таблице производных (data-model, api-layer, профильная встречи); `prod-deploy-log` (ENV+миграция); `feature-flags.md` (kill-switch).
- Рефлексия в `05_история/`.
- В коммитах нет `process.env.*` / `prisma migrate` в коде / `new PrismaClient(`.

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось.)_
