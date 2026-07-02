---
type: tz
status: ready-to-implement
feature: clone-entity-link-and-authorship
date: 2026-06-30
owner: Сергей (владелец продукта Кора)
relates_to:
  - plans/architecture/2026-06-30-employee-clone-build-hardening.md
  - plans/analysis/2026-06-30-employee-clone-build-audit-and-risk-solutions.md
  - plans/tz/2026-06-30-employee-clone-binding-resolution.md
  - plans/tz/2026-06-30-extraction-layer-rewrite.md
supersedes: plans/tz/2026-06-30-employee-clone-binding-resolution.md
---

> Архитектура (одобрена 2026-06-30): `plans/architecture/2026-06-30-employee-clone-build-hardening.md` (кластер C1, пункты #3,#4). Отколото от `2026-06-30-employee-clone-binding-resolution.md` после REALITY-CHECK: scope/owner регламентов уехали в combo (ТЗ переписывания Ф7б), а эти две правки **независимы от combo и делаются сейчас**.

# ТЗ — Линковка Person↔Entity для клона + авторство блоков без таймкодов (C1 #3,#4)

**Принцип.** Две независимые от извлекающего слоя правки: (1) сотрудник без линковки `Person↔Entity` тихо выпадает из сборки профиля — делаем видимым + lazy-резолв; (2) у источников без таймкодов (`startMs=0`) авторство блока теряется при единственном авторе — узкий fallback. Обе — на путях, которые переписывание combo НЕ затрагивает (rebuild-движок профиля + приёмная ingestion).

## Вне scope / отложено
- **scope/owner регламентов** (C1-#1,#2) → ТЗ переписывания Ф7б (combo — живой путь записи).
- **provenance-автор регламента** (C1-#5) → реестр не-сделанного, не кодим.

## Цель + Зачем
- **C1-#4.** `loadBlocksForPerson` при `Person.entityId == null` молча `return []` (`specialist-3-2-knowledge-clone.service.ts:385-391`) → сотрудник без линковки `Entity` не клонируется, и пробел невидим. Переписывание combo как раз начинает дёргать `enqueueRebuildKnowledgeProfile` (rewrite Ф3) → этот rebuild-движок будет вызываться чаще, и тихий выпад станет заметнее.
- **C1-#3.** `attributeSubject` (`block-ingest.worker.ts:1482-1547`): при `seg===null` (источник без таймкодов, `startMs=0`) основной кейс закрыт ELSE-веткой через actor, но если у блока единственный автор по сегментам, а event-level actor пуст — авторство теряется (`via='none'`).

## REALITY-CHECK (по коду 2026-06-30)
- `loadBlocksForPerson` — это **rebuild-движок** профиля (`specialist-3-2-knowledge-clone.service.ts:380`), он **выживает** при переписывании (combo его дёргает через `enqueueRebuildKnowledgeProfile`, rewrite Ф3). Снос в Ф11а касается per-block fan-out воркера, не rebuild-движка.
- `block-ingest.worker.ts` — приёмная ingestion (`segments→IdeaBlock`), переписывание её **усиливает** (overlap/skeleton, rewrite Ф5/Ф6), но не сносит. `attributeSubject` остаётся.
- `Person.entityId String?` + `entityTenantId String?` — **композитный FK** `@relation(fields:[entityId, entityTenantId], references:[id, tenantId], onDelete:SetNull)` (`prisma/schema.prisma:2361-2365`). Писать оба поля.
- `EntityResolutionService.resolveSubjectEntityId(tenantId, {authorPersonId,...}): Promise<string|null>` даёт `Entity.id` по `personId` (`entity-resolution.service.ts:1403`).
- **Схемной миграции нет** (поля существуют). Новых AdminSetting-крутилок нет.
- **Координация по файлам:** `block-ingest.worker.ts` правит и ТЗ переписывания (регионы `:282-330` segments/skeleton, `:1482` attributeSubject — разные). Делать на свежем `git pull`, регион attributeSubject не пересекается.

## Принятые решения владельца
| # | Решение | Обоснование |
|---|---|---|
| В1 | Резолв Person→Entity через существующий `resolveSubjectEntityId` | Единый источник; без самописного поиска |
| В2 | Писать ОБА поля композитного FK (`entityId`+`entityTenantId`) | Без `entityTenantId` FK битый (schema:2365) |
| В3 | attributeSubject — только узкий single-author fallback | Основной кейс уже закрыт ELSE-веткой; не переписываем атрибуцию |

## Контракт-first

### loadBlocksForPerson — видимость + lazy-резолв + оба поля FK (Ф1)
Заменяет `specialist-3-2-knowledge-clone.service.ts:385-391`:
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
    data: { entityId: resolvedEntityId, entityTenantId: args.tenantId },
  });
  args = { ...args, entityId: resolvedEntityId };
}
```

### attributeSubject — single-author fallback (Ф2)
В ELSE-ветке (`block-ingest.worker.ts:1523-1545`), при `seg===null` и пустом `args.authorPersonId`:
```ts
const segAuthors = [...new Set(args.segments.map(s => s.authorPersonId).filter((x): x is string => !!x))];
const fallbackAuthor = (!args.authorPersonId && seg === null && segAuthors.length === 1) ? segAuthors[0] : null;
// в resolveSubjectEntityId подставить (args.authorPersonId ?? fallbackAuthor); если использован fallback → via='author_fallback'
```
Метрика `incSubjectAttribution` (`:1547`) — расширить allowed `via` значением `'author_fallback'`.

### Backfill (Ф1)
`backfill-knowledge-clone-person-entity.ts` (`createPrismaClient`, импорты `../src`): по всем тенантам `Person` где `entityId IS NULL` → `resolveSubjectEntityId(tenantId,{authorPersonId: person.id,...})`; при успехе `update {entityId, entityTenantId: tenantId}`; идемпотентен (есть entityId → skip); `--dry-run`/`--apply`; в `apply-prod-deploy.ts` STEPS (`phase:'backfill'`, `skipBootstrap:true`); prod-deploy Шаг 8.

## Границы фичи
- ✅ Always: `tenantId`-scoped; резолв через `EntityResolutionService`; идемпотентность backfill.
- 🚫 Never: `entityId` без `entityTenantId`; самописный поиск Person; `process.env.*`; `new PrismaClient()`; нарративные комментарии; Prisma `migrate*`.

## Фазы
Граф: **Ф1, Ф2 — независимы** (разные файлы). Можно параллельно.

### [x] Ф1 — Person без entityId: видимость + lazy-резолв + backfill
**Ценность:** как сотрудник без авто-линковки Entity, всё равно получаю собранный профиль, и пробел больше не тихий.
Картография: `specialist-3-2-knowledge-clone.service.ts:380-425`; `entity-resolution.service.ts:1403`; `prisma/schema.prisma:2361-2365`; метрики; `apply-prod-deploy.ts`.
Что входит: контракт выше (loadBlocksForPerson + counter `knowledge_clone_person_no_entity_total`); backfill + STEPS.
Что НЕ входит: инвариант entityId на создании Person (vNext, реестр не-сделанного).
Acceptance: unit — резолв→`update` с **обоими** полями; резолв null→`return []`+counter; `grep -n "entityTenantId" specialist-3-2-knowledge-clone.service.ts` → присутствует; backfill идемпотентен (повтор `--apply`=0); в STEPS; `typecheck/lint/build` зелёные.
Закрывает: C1-#4 (R8, R9 исходного C1 ТЗ).

### [x] Ф2 — attributeSubject single-author fallback
**Ценность:** как автор реплики в источнике без таймкодов (отчёт/чат), получаю привязку авторства, если у блока единственный автор.
Картография: `block-ingest.worker.ts:1482-1547`; `incSubjectAttribution`.
Что входит: контракт выше; `via='author_fallback'`.
Что НЕ входит: переразметка signalType/role; общий рефактор атрибуции.
Acceptance: unit — `seg=null`, actor пуст, один автор сегментов → резолв через него, `via='author_fallback'`; два разных автора → fallback НЕ применяется (`via='none'`); `grep -n "author_fallback" block-ingest.worker.ts`; `typecheck/lint/build` зелёные.
Закрывает: C1-#3 (R10 исходного C1 ТЗ).

## Сквозные аспекты
- RBAC/tenant: всё `tenantId`-scoped ✓. Observability: 1 counter + расширение `via` ✓. Idempotency: backfill (acceptance) ✓. Миграции: backfill (Ф1); схемной нет. Rollout: `[N/A: корректностные фиксы, рискованного переключателя нет — Ship-On]`. Тесты: unit на фазу.

## Idempotency / прод-деплой
Diff: **Шаг 8** — 1 backfill (`backfill-knowledge-clone-person-entity.ts`) в STEPS. Миграций схемы/ENV/postgres-init нет.

## DoD
typecheck(вкл. `.spec`)/lint/build + unit зелёные; `02_architecture/knowledge-core.md` отметка (lazy entity-link в rebuild); prod-deploy-log Шаг 8; рефлексия.

## Итог
Реализовано целиком (Ф1 + Ф2), обе фазы независимы и сделаны параллельно.

- **Ф1** (`feat(knowledge-core): Ф1 …`): `loadBlocksForPerson` при `entityId=null` → `logger.warn` + counter `knowledge_clone_person_no_entity_total{tenant}` + lazy-резолв через `resolveSubjectEntityId` + `person.update` с **обоими** полями композитного FK (`entityId`+`entityTenantId`). Отступление от буквы контракта: вместо `args = {...args}` использована локальная `let entityId` (реассайн `args` давал TS2322 — тип параметра возвращал `string|null`, Prisma-`where` отвергал nullable); поведение идентично. Новый backfill `backfill-knowledge-clone-person-entity.ts` (`--apply`, default dry-run, идемпотентен) + STEPS (`phase:'backfill'`, `args:['--apply']`, `skipBootstrap`). Прогон на dev-БД: apply#1 → linked=9/errors=0, apply#2 → 0 кандидатов (идемпотентность доказана вживую).
- **Ф2** (`feat(knowledge-core): Ф2 …`): в ELSE-ветке `attributeSubject` узкий single-author fallback — при `seg===null` + пустом `args.authorPersonId` + ровно одном distinct `authorPersonId` среди сегментов резолв идёт через него, `via='author_fallback'`. Тип метрики `incSubjectAttribution({via:string})` расширять не пришлось (свободная строка). 2 теста в `block-ingest.subject.spec.ts` (h: fallback срабатывает; i: два автора → `via='none'`).

Верификация: typecheck 0 ошибок · lint 0 errors · build зелёный (heap 8GB) · тесты модуля 137 файлов / 1052 passed (вкл. новые 11). Схемной миграции/ENV/AdminSetting нет. Прод — Шаг 8 (один backfill).
