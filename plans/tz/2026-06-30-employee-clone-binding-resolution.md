---
type: tz
status: ready-to-implement
feature: employee-clone-binding-resolution
date: 2026-06-30
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/architecture/2026-06-30-employee-clone-build-hardening.md
  - plans/analysis/2026-06-30-employee-clone-build-audit-and-risk-solutions.md
  - second-brain/02_architecture/knowledge-core.md
  - docs/operations/prod-deploy-log.md
---

> Архитектура (одобрена владельцем 2026-06-30): `plans/architecture/2026-06-30-employee-clone-build-hardening.md` (кластер C1) · Анализ: `plans/analysis/2026-06-30-employee-clone-build-audit-and-risk-solutions.md` (§C1, решения в исправленном после состязательной проверки виде) · Статус согласования: одобрено 2026-06-30.

# ТЗ — Привязка регламент↔роль/сотрудник: резолв сущностей на write (кластер C1, корень)

**Принцип.** Чиним КЛАСС бага «имя сущности хранится словами, а ищется внутренним id» — для привязки регламента к роли/владельцу и линковки Person↔Entity. Один источник правды о дизамбигуации — существующий `EntityResolutionService`. Никаких самописных копий поиска по подстроке. Это ПЕРВЫЙ из серии ТЗ `employee-clone-build-hardening`; C2–C6 — отдельными ТЗ.

## Вне scope / отложено владельцем
- **Привязка регламента к ОТДЕЛУ** (`scope='department:<имя>'`) — готового `resolveDepartmentByHint` нет; отложено (Р10 блюпринта, строка в `second-brain/04_не-сделано/README.md`).
- **Поле «от кого появился» (provenance-автор) регламента** (C1-#5) — НЕ кодим; автор вычислим из `sourceBlockIds`; осознанная отсрочка.
- **C2 (нарезка), C3 (профиль), C4 (навыки), C5 (регламенты-дедуп/HNSW), C6 (cron)** — отдельные ТЗ серии.

---

## Цель + Зачем

**Болезненное состояние (доказано кодом).** «Способ C» (prod-deploy `2026-06-23`, `docs/operations/prod-deploy-log.md:534-548`) построил ЧИТАЮЩУЮ сторону клона роли: `RoleRegulationRetrievalService.retrieveForRole`/`listRoleSnapshot` фильтруют регламенты по `scope = ANY('role:<roleId>','org','department:<id>')`, где `roleId` — это **cuid** (`buildRoleScopeFilter`, `role-scope.util.ts:30-40`). Но ПИШУЩАЯ сторона так и осталась сырой: LLM в `regulation-extract` отдаёт `scope='role:<ИМЯ роли>'` (пример промпта `regulation-extract.prompt.ts:69` = `"scope":"role:менеджер"`), а write-путь сохраняет это без нормализации (`specialist-3-1-regulations.service.ts:363,382,…` — `scope: draft.scope ?? null`). Пересечение `role:менеджер` × `role:<cuid>` пусто → **role-scoped регламенты практически не доходят до клона роли**. Работает end-to-end только `scope='org'`.

**Чем решение лучше.** Резолвим имя роли → `Role.id` НА ЗАПИСИ через тот же `EntityResolutionService.resolveRoleByHint`, что уже используется при ingest-е блоков (`block-ingest.worker.ts:318`). Аналогично `ownerPersonId` (substring → `resolvePersonByHint`) и линковка Person↔Entity. Шов «Способ C» закрывается с обеих сторон; ничего нового в продукт не вводим — чиним существующий конвейер.

---

## REALITY-CHECK (проверено по коду 2026-06-30)

| Факт | Подтверждение |
|---|---|
| `EntityResolutionService.resolveRoleByHint(tenantId, hint): Promise<string\|null>` существует; каскад: `normalizeName` → exact `Role.name` → fuzzy substring (ровно 1 → id; >1 → null/skip). **LLM/embedding НЕ используется** (в отличие от person) | `entity-resolution.service.ts:700-732` |
| `resolveRoleByHint` уже зовётся при ingest-е блоков | `block-ingest.worker.ts:318` (`block.roleHint`), `:402` (`proc.ownerRoleHint`) |
| `resolvePersonByHint(tenantId, hint, context?): Promise<string\|null>` — каскад exact→alias→fuzzy→embedding→LLM-арбитр, **fail-closed null при неоднозначности** | `entity-resolution.service.ts:750-838` |
| `resolveSubjectEntityId(tenantId, {authorPersonId,...}): Promise<string\|null>` — даёт `Entity.id` по `personId` | `entity-resolution.service.ts:1403`; используется в `block-ingest.worker.ts:1514,1526` |
| `scope` пишется сырьём в **4 типах** карточек (не только regulation): regulation (`:363,382`), process (`:623,635`), policy (`:893,906`), instruction (`:1143,1158`) — везде `draft.scope ?? null/undefined` | `specialist-3-1-regulations.service.ts` |
| `deriveForRole(draft)` извлекает roleId из `draft.scope` (`startsWith 'role:'`), иначе из `draft.roles[0]` (имя) — наследует ту же сырость; используется для instructions (`:1123`) | `specialist-3-1-regulations.service.ts:1293-1301` |
| `resolveOwnerPersonHint` — **substring** `Person.name contains hint` (тёзки/роль → не тот/null), один helper на 4 call-site (`:333,592,854,1114`) | `specialist-3-1-regulations.service.ts:1755-1771` |
| `Person.entityId String?` + `entityTenantId String?` — **композитный FK** `@relation(fields:[entityId, entityTenantId], references:[id, tenantId], onDelete:SetNull)` | `prisma/schema.prisma:2361-2365` |
| `loadBlocksForPerson`: при `!entityId` → `logger.debug` + `return []` (тихо, без метрики) | `specialist-3-2-knowledge-clone.service.ts:385-391` |
| `attributeSubject`: ELSE-ветка (seg=null) уже резолвит через actor `args.authorPersonId/authorUserId/authorEmail`; `via='none'` только если actor пуст ИЛИ резолв вернул null | `block-ingest.worker.ts:1498-1546` |
| Колонки `scope @db.VarChar(120)` + `ownerPersonId` есть у regulations/instructions/policies/processes; `@@index([tenantId, scope])` | `prisma/schema.prisma:5882-5926, 6173-6212, 6234-6258` |
| **Новой Prisma-миграции НЕ требуется** — все поля существуют | вывод из схемы |
| `role:<значение>` существует в БД (backfill `2026-06-23` `backfill-reclassify-instructions.ts` переносил `Process scope=role:*`) → есть что нормализовать | `docs/operations/prod-deploy-log.md:1667` |

**Расхождений архитектуры с кодом нет** — блюпринт описывает ровно этот шов. Уточнение масштаба против анализа: фикс scope покрывает **4 типа карточек + deriveForRole**, а не один write-site.

---

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| В1 | Резолв через **существующий** `EntityResolutionService` (role/person), не самописный поиск | Единый источник дизамбигуации; самописная копия = тот же класс бага, который чиним (`feedback`: «частично = корень багов») | 2026-06-30 |
| В2 | Неразрешённый role-hint → scope сохраняется **СЫРЫМ** + counter (видимость), НЕ тихий `null` | Raw сохраняет читаемое намерение и **re-резолвится при повторном backfill** после создания роли; `null` теряет интент, и retrieval всё равно промахивается | 2026-06-30 |
| В3 | Промпт `regulation-extract` НЕ меняем (LLM даёт имя роли, система резолвит) | LLM не может знать cuid; «человек даёт имя → система резолвит id» — корректный дизайн | 2026-06-30 |
| В4 | Department-scope отложен; provenance-автор (C1-#5) не кодим | Р10/Р9 блюпринта; редкий кейс / вычислимо из sourceBlockIds | 2026-06-30 |
| В5 | Схемной миграции нет; новых AdminSetting-крутилок нет (`resolveRoleByHint` без порогов; person использует существующий `knowledge.entity_name_resolve_threshold`) | Поля и пороги уже существуют | 2026-06-30 |

## Доказательство выбора
Двухпроходный разбор + состязательная проверка — в анализе `plans/analysis/2026-06-30-employee-clone-build-audit-and-risk-solutions.md` §C1 (и biggestConcern). Скептик скорректировал: использовать существующий резолвер, писать ОБА поля композитного FK, idempotency-guard на уже нормализованном scope. Здесь — итог в исправленном виде.

---

## Scope

### Входит
- Нормализация `scope` имя→`Role.id` на записи (4 типа карточек + `deriveForRole`) — **R1–R5**.
- Backfill существующих карточек — **R6**.
- `ownerPersonId` через `resolvePersonByHint` — **R7**.
- Person без `entityId`: видимость + lazy-резолв (оба поля FK) + backfill — **R8, R9**.
- `attributeSubject` multi-segment-single-author fallback — **R10**.
- Метрики-счётчики видимости — в каждой фазе.

### Не входит
- Department-scope (`resolveDepartmentByHint`) → `second-brain/04_не-сделано/README.md` (строка 2026-06-30).
- Provenance-автор регламента (C1-#5) → там же / отсрочка.
- Backfill уже проставленных `ownerPersonId` (существующие владельцы не трогаем; исправление действует на новые/переизвлекаемые карточки) → vNext при необходимости.
- C2–C6 серии.

## Граничные контракты
- **Читающая сторона (`RoleRegulationRetrievalService`, `buildRoleScopeFilter`) — НЕ трогаем.** Она уже корректна (ждёт `role:<cuid>`). ТЗ чинит только пишущую сторону, чтобы данные совпали с уже задеплоенным read-контрактом «Способ C».
- **Промпты `regulation-extract`/`block-ingest` — НЕ трогаем** (В3).
- **`EntityResolutionService` — только аддитивно** (экстракция чистого helper'а role-name→id для переиспользования в backfill; публичное поведение `resolveRoleByHint`/`resolvePersonByHint` не меняется).

---

## Контракт-first

### Helper нормализации scope (Ф1)
Единая точка. Чистое ядро резолва роли по имени переиспользуется write-путём и backfill'ом (один источник правды).

```ts
// resolveScope: имя→Role.id ТОЛЬКО для role-scope; org/department/project/null — без изменений.
// Идемпотентность: если после 'role:' уже валидный Role.id (есть в БД) — оставить как есть.
// Неразрешено (нет роли / неоднозначно) → вернуть rawScope СЫРЫМ + inc counter (В2).
async resolveScope(tenantId: string, rawScope: string | null | undefined): Promise<string | null> {
  const raw = rawScope?.trim() ?? null;
  if (!raw || !raw.startsWith('role:')) return raw ?? null;     // org/department:*/project:*/null — untouched
  const hint = raw.slice('role:'.length).trim();
  if (!hint) return raw;
  // idempotency: уже Role.id?
  const existing = await this.prisma.role.findFirst({ where: { id: hint, tenantId, deletedAt: null }, select: { id: true } });
  if (existing) return `role:${existing.id}`;
  const resolved = await this.entities.resolveRoleByHint(tenantId, hint);   // тот же резолвер, что block-ingest
  if (resolved) return `role:${resolved}`;
  this.metrics.incRegulationScopeUnresolved({ tenant: tenantId });          // видимость, не тихо
  return raw;                                                               // СЫРЬЁ (В2)
}
```
Якорь: вставка в `specialist-3-1-regulations.service.ts`; `this.entities` — инжект `EntityResolutionService` (проверить конструктор: если не инжектится — добавить, оба сервиса в `KnowledgeCoreModule`). `this.metrics` — `KnowledgeMetricsService`/`MetricsService` (как в `block-ingest.worker.ts:1547` `incSubjectAttribution`).

Применение (на каждом из 4 entry-points, рядом со строкой `resolveOwnerPersonHint` — `:333,592,854,1114`): мутировать `draft.scope` ОДИН раз до всех upsert-веток и до `deriveForRole`:
```ts
draft.scope = await this.resolveScope(block.tenantId, draft.scope);
```
Тогда все существующие `scope: draft.scope ?? null/undefined` и `deriveForRole(draft)` автоматически получают нормализованное значение (минимальный диф, ни одна ветка не забыта).

### resolveOwnerPersonHint → делегирование (Ф3)
```ts
private async resolveOwnerPersonHint(tenantId: string, hint: string | null | undefined): Promise<string | null> {
  if (!hint) return null;
  const trimmed = hint.trim();
  if (trimmed.length < 2) return null;
  const personId = await this.entities.resolvePersonByHint(tenantId, trimmed);   // fail-closed на тёзках
  if (!personId) this.metrics.incRegulationOwnerUnresolved({ tenant: tenantId });
  return personId;
}
```
Заменяет тело `:1762-1770` (substring `name contains`). Один helper — все 4 call-site чинятся разом.

### loadBlocksForPerson — видимость + lazy-резолв + ОБА поля FK (Ф4)
```ts
if (!args.entityId) {
  this.logger.warn({ personId: args.personId },
    'specialist-3-2.loadBlocksForPerson: Person.entityId не заполнен');
  this.metrics.incKnowledgeClonePersonNoEntity({ tenant: args.tenantId });
  const resolvedEntityId = await this.entities.resolveSubjectEntityId(args.tenantId, {
    authorPersonId: args.personId, authorEmail: null, speakerParticipantId: null,
    speakerName: null, authorUserId: null,
  });
  if (!resolvedEntityId) return [];
  await this.prisma.person.update({
    where: { id: args.personId },
    data: { entityId: resolvedEntityId, entityTenantId: args.tenantId },   // ОБА поля композитного FK
  });
  args = { ...args, entityId: resolvedEntityId };
}
```
Заменяет `:385-391`. **КРИТИЧНО:** писать `entityTenantId` (без него композитный FK `[entityId, entityTenantId]` бьётся, schema:2365).

### attributeSubject — multi-segment-single-author fallback (Ф5)
В ELSE-ветке (`block-ingest.worker.ts:1523-1545`), когда `seg===null`: если `args.authorPersonId` пуст, но все сегменты блока имеют единственного `authorPersonId` — взять его (`via='author_fallback'`):
```ts
// перед resolveSubjectEntityId в ELSE:
const segAuthors = [...new Set(args.segments.map(s => s.authorPersonId).filter((x): x is string => !!x))];
const fallbackAuthor = (!args.authorPersonId && seg === null && segAuthors.length === 1) ? segAuthors[0] : null;
// в args.authorPersonId резолва подставить (args.authorPersonId ?? fallbackAuthor); если использован fallback → via='author_fallback'
```
Метрика `via` уже есть (`incSubjectAttribution`, `:1547`) — добавить значение `'author_fallback'`.

### Метрики (prom-client) — добавить в `MetricsService`/`KnowledgeMetricsService`
- `incRegulationScopeUnresolved` → counter `regulation_scope_role_unresolved_total{tenant}`
- `incRegulationOwnerUnresolved` → counter `regulation_owner_hint_unresolved_total{tenant}`
- `incKnowledgeClonePersonNoEntity` → counter `knowledge_clone_person_no_entity_total{tenant}`
- `incSubjectAttribution` — расширить allowed `via` значением `'author_fallback'`

### Backfill-скрипты (`backend/scripts/`, `createPrismaClient` из `_lib/prisma`, импорты из `../src`)
- `backfill-regulation-scope-normalize.ts` — по всем тенантам, по 4 таблицам (`regulation`/`instruction`/`policy`/`process`) для строк с `scope LIKE 'role:%'`: применить ту же `resolveScope`-логику (переиспользовать чистый helper role-name→id, НЕ копировать); идемпотентен (уже `role:<cuid>` → no-op); `--dry-run` по умолчанию, `--apply` пишет. Лог: сколько нормализовано / осталось сырыми (unresolved).
- `backfill-knowledge-clone-person-entity.ts` — по всем тенантам: `Person` где `entityId IS NULL`, резолв через `resolveSubjectEntityId(tenantId,{authorPersonId: person.id,...})`; при успехе `update {entityId, entityTenantId: tenantId}`; идемпотентен (есть entityId → skip); `--dry-run`/`--apply`.
- Оба — в `apply-prod-deploy.ts` `STEPS` (`phase:'backfill'`, `skipBootstrap:true`); prod-deploy-log **Шаг 8**.

> Чистое ядро резолва: рекомендуется вынести `resolveRoleByHint`-логику (normalize→exact→fuzzy, без LLM) в экспортируемую функцию `resolveRoleIdByName(prisma, tenantId, hint)`; `EntityResolutionService.resolveRoleByHint` делегирует ей; backfill импортирует её. Цель — ОДИН источник правды; acceptance: write-путь и backfill дают идентичный scope для идентичного входа.

---

## Границы фичи
- ✅ **Always:** все запросы tenant-scoped (`tenantId`); резолв через `EntityResolutionService`; идемпотентность backfill как acceptance.
- ⚠️ **Ask first:** менять читающую сторону retrieval / `buildRoleScopeFilter`; менять промпты; вводить department-резолв; дропать/нуллить scope.
- 🚫 **Never:** самописный поиск роли/персоны по подстроке; писать `entityId` без `entityTenantId`; `process.env.*`; `new PrismaClient()`; нарративные комментарии; Prisma `migrate*` (миграция не нужна).

---

## Фазы

Граф зависимостей: **Ф1 → Ф2** (backfill переиспользует helper из Ф1). **Ф3, Ф4, Ф5 — независимы** друг от друга и от Ф1/Ф2 (можно параллельно). Метрики добавляются в той фазе, что их использует.

### Ф1 — Нормализация scope на write (R1–R5) `[ ]`
**Ценность:** как клон роли, получаю свои регламенты в ответах, потому что записанный `scope` совпадает с тем `role:<cuid>`, что ждёт уже задеплоенная читающая сторона «Способ C».
- Картография: `specialist-3-1-regulations.service.ts` (entry-points `:333,592,854,1114`; upsert-ветки со `scope:`; `deriveForRole:1293`; конструктор — инжект `EntityResolutionService`), `entity-resolution.service.ts:700-732` (источник логики / экстракция helper), `role-scope.util.ts`, метрики.
- Что входит: helper `resolveScope`; экстракция чистого `resolveRoleIdByName` + делегирование из `resolveRoleByHint`; мутация `draft.scope` на 4 entry-points до upsert и `deriveForRole`; counter `regulation_scope_role_unresolved_total`; инжект `EntityResolutionService` в конструктор (если отсутствует).
- Что НЕ входит: backfill (Ф2); owner (Ф3); читающая сторона; промпты.
- Acceptance:
  - `grep -n "resolveScope" specialist-3-1-regulations.service.ts` → helper + 4 вызова; `grep -nE "draft\.scope = await this\.resolveScope"` → 4 совпадения.
  - Unit (`bunx vitest run` нового spec): вход `role:менеджер` при наличии роли «Менеджер» → `role:<id>`; вход `role:<существующий id>` → без изменений (идемпотентность); неоднозначно/нет роли → вход без изменений + counter инкремент; `org`/`department:x`/`project:y`/`null` → без изменений; `deriveForRole` при `scope=role:<id>` → `<id>`.
  - `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные.
  - Грепы запретов: в диффе нет `process.env.`, `new PrismaClient(`, `prisma migrate`, нарративных комментариев.
  - Закрывает: R1, R2, R3, R4, R5.

### Ф2 — Backfill scope существующих карточек (R6) `[ ]`
**Ценность:** как клон роли на уже накопленных данных, получаю регламенты, заведённые ДО фикса, — их `scope` пересчитан в `role:<cuid>`.
- Зависит от: Ф1 (общий helper `resolveRoleIdByName`).
- Картография: `backend/scripts/_lib/prisma.ts`, `apply-prod-deploy.ts` (`STEPS`), образец идемпотентного backfill `scripts/backfill-subject-attribution.ts`, `scripts/backfill-reclassify-instructions.ts`.
- Что входит: `backfill-regulation-scope-normalize.ts` (4 таблицы, `--dry-run`/`--apply`, идемпотентность, лог normalized/unresolved); регистрация в `STEPS` (`phase:'backfill'`, `skipBootstrap:true`); запись в prod-deploy-log Шаг 8.
- Что НЕ входит: owner-backfill; person-entity (Ф4).
- Acceptance:
  - `bun run scripts/backfill-regulation-scope-normalize.ts` (dry-run) — печатает план, БД не меняет; повторный `--apply` после первого → 0 изменений (no-op, идемпотентность).
  - После `--apply` на сид-данных: ни одной строки `scope LIKE 'role:%'` с не-cuid хвостом, кроме помеченных unresolved в логе.
  - Скрипт присутствует в `STEPS` (`grep -n "backfill-regulation-scope-normalize" apply-prod-deploy.ts`).
  - typecheck/lint/build зелёные.
  - Закрывает: R6.

### Ф3 — ownerPersonId через resolvePersonByHint (R7) `[ ]`
**Ценность:** как руководитель, вижу корректного ответственного за регламент (а не случайного тёзку), потому что владелец резолвится fail-closed.
- Картография: `specialist-3-1-regulations.service.ts:1755-1771`, метрики.
- Что входит: тело `resolveOwnerPersonHint` → делегирование `entities.resolvePersonByHint`; counter `regulation_owner_hint_unresolved_total`.
- Что НЕ входит: backfill существующих owner.
- Acceptance:
  - Unit: точное имя → personId; неоднозначное (2 тёзки) → null + counter; роль вместо имени («менеджер», нет такого Person) → null.
  - `grep -n "resolvePersonByHint" specialist-3-1-regulations.service.ts` → 1 (в helper); старого `name: { contains:` в этом методе нет.
  - typecheck/lint/build зелёные. Закрывает: R7.

### Ф4 — Person без entityId: видимость + lazy-резолв + backfill (R8, R9) `[ ]`
**Ценность:** как сотрудник без авто-линковки Entity, всё равно получаю собранный профиль знаний, и пробел больше не тихий.
- Зависит от: — (независима).
- Картография: `specialist-3-2-knowledge-clone.service.ts:380-425`, `entity-resolution.service.ts:1403` (`resolveSubjectEntityId`), `prisma/schema.prisma:2361-2365` (композитный FK), метрики, `apply-prod-deploy.ts`.
- Что входит: `loadBlocksForPerson` — warn + counter + lazy-резолв + `update {entityId, entityTenantId}`; `backfill-knowledge-clone-person-entity.ts` + STEPS + prod-deploy Шаг 8.
- Что НЕ входит: структурный инвариант entityId на создании Person (vNext, реестр не-сделанного).
- Acceptance:
  - Unit: Person без entityId, резолв вернул id → `person.update` вызван с **обоими** полями (`entityId` И `entityTenantId`); резолв null → `return []` + counter.
  - `grep -n "entityTenantId" specialist-3-2-knowledge-clone.service.ts` → присутствует в update.
  - Backfill идемпотентен (повторный `--apply` = 0 изменений); в `STEPS`.
  - typecheck/lint/build зелёные. Закрывает: R8, R9.

### Ф5 — attributeSubject multi-segment-single-author fallback (R10) `[ ]`
**Ценность:** как автор реплики в источнике без таймкодов (отчёт/чат, `startMs=0`), получаю корректную привязку авторства к блоку, если у блока единственный автор.
- Зависит от: — (независима).
- Картография: `block-ingest.worker.ts:1482-1547` (`attributeSubject`, ELSE-ветка), метрики `incSubjectAttribution`.
- Что входит: fallback по единственному `authorPersonId` сегментов при `seg===null`; `via='author_fallback'`.
- Что НЕ входит: переразметка signalType/role; общий рефактор атрибуции.
- Acceptance:
  - Unit: `seg=null`, `args.authorPersonId=null`, все сегменты с одним `authorPersonId='p1'` → subject резолвится через `p1`, `via='author_fallback'`; два разных автора сегментов → fallback НЕ применяется (`via='none'`).
  - `grep -n "author_fallback" block-ingest.worker.ts` → присутствует.
  - typecheck/lint/build зелёные. Закрывает: R10.

---

## Требования (EARS)
- **R1.** Когда специалист 3-1 пишет карточку (regulation/process/policy/instruction) со `scope`, начинающимся с `role:`, система shall заменить хвост на `Role.id`, разрешённый `EntityResolutionService` по имени-подсказке.
- **R2.** Если хвост `role:` уже равен существующему `Role.id` тенанта, then нормализация shall быть no-op (идемпотентность повторного прогона/backfill).
- **R3.** Если имя роли не разрешается (нет роли / неоднозначно), then `scope` shall сохраняться СЫРЫМ и инкрементировать `regulation_scope_role_unresolved_total`.
- **R4.** `scope` со значением `org` / `department:*` / `project:*` / `null` shall оставаться без изменений.
- **R5.** `deriveForRole` shall работать с нормализованным `scope` (для instructions `forRole` = `Role.id`).
- **R6.** Backfill shall нормализовать `scope LIKE 'role:%'` во всех существующих regulation/process/policy/instruction по всем тенантам той же логикой; повторный прогон shall быть no-op; зарегистрирован в `STEPS` (`phase:'backfill'`, `skipBootstrap`).
- **R7.** `ownerPersonId` shall резолвиться через `resolvePersonByHint` (fail-closed); при null — инкремент `regulation_owner_hint_unresolved_total`.
- **R8.** Когда `loadBlocksForPerson` встречает Person без `entityId`, система shall залогировать warn, инкрементировать `knowledge_clone_person_no_entity_total`, выполнить lazy-резолв через `resolveSubjectEntityId` и при успехе записать **оба** поля `entityId` и `entityTenantId`.
- **R9.** Backfill shall проставить `entityId`+`entityTenantId` всем Person без линковки (резолв через `resolveSubjectEntityId`); идемпотентен; в `STEPS`.
- **R10.** Когда `attributeSubject` не нашёл сегмент по времени (`seg===null`) и actor пуст, но все сегменты блока имеют единственного `authorPersonId`, система shall использовать его (`via='author_fallback'`).
- **R11.** Реализация shall НЕ вводить Prisma-миграцию, `process.env.*`, `new PrismaClient()`, нарративные комментарии; backfill shall использовать `createPrismaClient` и импорты из `../src`.

---

## Сквозные аспекты
- **RBAC/tenant:** все операции `tenantId`-scoped; backfill итерирует по тенантам. ✓
- **Observability:** 3 новых counter + расширение `via`. ✓
- **Errors/идемпотентность:** резолв catch→null (как `block-ingest.worker.ts:319`); backfill идемпотентен (acceptance). ✓
- **Миграции данных:** 2 backfill (R6, R9). Схемной миграции нет.
- **Rollout/флаг:** `[N/A: корректностный фикс пишущей стороны под уже задеплоенный read-контракт; рискованного поведенческого переключателя нет — Ship-On, выкат включённым; резолв роли уже работает в проде в block-ingest без флага]`.
- **Тесты:** unit на каждую фазу (см. Acceptance); golden-данные не требуются (LLM не вызывается в правках).

## Pre-mortem / Риски
- **Idempotency-guard scope.** Без проверки «уже Role.id» backfill на повторе пытался бы резолвить cuid как имя → null → (по В2) оставил бы сырьём, но это случайно; явный guard `role.findFirst({id})` — обязателен (R2).
- **Композитный FK.** Запись `entityId` без `entityTenantId` → битая связь / ошибка. Acceptance проверяет оба поля (R8).
- **Инжект EntityResolutionService.** Если в конструкторе `specialist-3-1` его нет — добавить; оба в `KnowledgeCoreModule` (циклов нет — `block-ingest.worker` уже зависит от обоих).
- **VarChar(120).** `role:<cuid>` (~30) влезает; сырое имя слайсится (`parseRoleScope`/`deriveForRole` уже `.slice(0,120)`).
- **Ревью-аспекты для `strict-production-review-gate`:** tenant-изоляция в backfill; идемпотентность; отсутствие второй копии резолва; оба поля FK; нет тихих фейлов.

## Idempotency / прод-деплой
- Полная инструкция — `docs/operations/prod-deploy-log.md`. Diff этого ТЗ: **Шаг 8** — 2 новых идемпотентных backfill в `STEPS` (`phase:'backfill'`, `skipBootstrap:true`), порядок: сначала dry-run, затем `apply-prod-deploy.ts --mode update`. Схемной миграции (Шаг 4), postgres-init (Шаг 5), ENV (Шаг 1) — нет.

## DoD
- typecheck (вкл. `.spec`)/lint/build зелёные; unit-spec'и фаз проходят.
- `second-brain/`: обновить `01_projects/<clone>.md` (если есть профильная) — write-сторона scope теперь резолвит id; иначе пометка в `02_architecture/knowledge-core.md`.
- `docs/operations/prod-deploy-log.md` Шаг 8 — 2 backfill.
- Рефлексия в `second-brain/05_история/`.
- Строка про department/provenance уже в `04_не-сделано/README.md` (подтвердить, не дублировать).

## Итог
_(заполняет tz-orchestrator после реализации: что сделано целиком/частично, что осталось.)_
