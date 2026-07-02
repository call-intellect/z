# ТЗ — Пакет A: целостность Person↔Entity

- **Архитектура:** [plans/architecture/2026-07-01-package-a-person-entity-integrity.md](../architecture/2026-07-01-package-a-person-entity-integrity.md) (status: approved)
- **Покрывает:** F-1, F-5 (entityTenantId), S-M3 (mergedIntoTenantId), S-C3 (клон-коллапс, оба пути)
- **Приоритет:** прод-блокер при 40–100 юзерах (авто-крон каждые 5 мин молча схлопывает клоны)

## Контракт (инвариант)
«id составного ключа никогда не пишется без tenant-компаньона; человек не сливается автоматически; мерж мигрирует ВСЕ ссылки на сущность; читатель по entityId устойчив к merged-away».

## Фазы

### [x] Ф1. F-1 — мёртвый резолв персон
- `entity-resolution.service.ts:1120`: `FROM "Person"` → `FROM persons` (проверить остальной SQL метода на имена таблиц).
- Убрать тихий `catch { return []; }` → логировать ошибку (warn с контекстом) и/или пробрасывать; 42P01 больше не прячется.
- Скан того же файла и соседей на другие PascalCase-таблицы в raw SQL (Decision→decisions, Idea→ideas, Insight→insights, Regulation→regulations, Process→processes, Experiment→experiments).

### [x] Ф2. Companion-инвариант (F-5 + S-M3)
- Писать `entityTenantId` вместе с `entityId`: `entity-resolution.service.ts:1316, 1376, 1417`; `onboarding/demo-data/knowledge-graph.ts:807`. ✅ через `setPersonEntity`.
- Писать `mergedIntoTenantId` вместе с `mergedIntoId`: `block-distill.worker.ts:306, 465, 533` (при обнулении `mergedIntoId` — обнулять и компаньон) ✅. Entity-сайты `entity-merge.service.ts:429` / `entity-resolver.worker.ts:216` покрываются в **Ф3** через `markEntityMerged` внутри единого мержера (не дублируем правку, которую Ф3 всё равно перепишет).
- Ввести узкие хелперы: `setPersonEntity(personId, entity)`, `markEntityMerged(from, into)`, `markBlockMerged(block, canonical)` — физически не дают написать id без компаньона.
- Spec-инвариант: тест, падающий, если в кодовой базе появился prisma-write `entityId`/`mergedIntoId` без пары (или защита на уровне хелпера + запрет прямых `.update({data:{mergedIntoId}})` линтом/ревью-нотой в docs).

### [x] Ф3. Единый безопасный мергер
- В `entity-merge.service.ts` собрать полный `mergeEntities(tenantId, fromId, intoId, actor)`: мигрирует `IdeaBlockEntity` (уже есть, pre-check composite-PK), `EntityLink` in/out **с учётом fromType/toType** (не по id вслепую), `Card.entityId`+`relatedEntityIds[]`, `ThemeEntity`, `SourceEntity`; **перепривязывает `Person.entityId`(+entityTenantId)**; ставит `mergedIntoId`+компаньон; разворачивает 2-хоп цепочку (`canonicalizeEntityIds` — транзитивно).
- `entity-resolver.worker.ts:178 applyMerge` → звать `mergeEntities` (убрать урезанную копию, которая не мигрирует EntityLink).
- Всё в одной транзакции с pre-check на composite-PK конфликты (иначе 25P02 абортит tx).

### [x] Ф4. Исключить людей из авто-мержа
- `entity-resolver.cron.ts findCandidatePairs`: в SQL добавить `AND a.type <> 'person' AND b.type <> 'person'`. Люди сливаются только ручным путём (человек подтверждает).

### [x] Ф5. Read-side defence
- `specialist-3-2-knowledge-clone.service.ts:418 loadBlocksForPerson`: если `entity(entityId).mergedIntoId != null` — резолвить canonical (следовать за цепочкой) перед сбором `IdeaBlockEntity`. Belt-and-suspenders поверх Ф3.

### [ ] Ф6. Backfill + prod-deploy
- `backend/scripts/backfill-entity-tenant-companions.ts` (idempotent, `createPrismaClient()`, `assertNotProd`-НЕТ — прод-скрипт): `Person.entityTenantId=tenantId` где `entityId` задан; `Entity/IdeaBlock.mergedIntoTenantId=tenantId` где `mergedIntoId` задан.
- Reconciler осиротевших ссылок на уже-слитые сущности (Person/Card/Theme/Source → canonical по `mergedIntoId`).
- Зарегистрировать оба в `backend/scripts/apply-prod-deploy.ts` (`STEPS`, phase `update`, `skipBootstrap`).
- Обновить `docs/operations/prod-deploy-log.md` Шаг 8 (backfill).

### [ ] Ф7. Тесты
- Unit: каждый write-site пишет компаньон; обнуление обнуляет пару; `findCandidatePairs` без person.
- Integration: форс-мерж двух НЕ-person → Person/Card/Theme/Source/EntityLink мигрированы, `include:{entity}`/`include:{mergedInto}` резолвятся.
- **Regression S-C3 через авто-путь** (`applyMerge`): person исключён → клон-рид НЕ падает в 0.
- F-1: KNN возвращает кандидатов; SQL-ошибка не глотается.
- Backfill: после прогона `Person.entityTenantId` NULL = 0.

## Критерии приёмки (DoD)
- `Person.entityTenantId` NULL = 0; `Entity/IdeaBlock.mergedIntoTenantId` NULL при заданном id = 0.
- Авто-крон не создаёт person-мержей; ручной мерж не осиротляет ни одну из 6 ссылок.
- Клон человека не пустеет после мержа соседних НЕ-person сущностей.
- Резолв персон по embedding возвращает кандидатов.

## Итог
_Заполнить после реализации: реализовано целиком / что осталось._
