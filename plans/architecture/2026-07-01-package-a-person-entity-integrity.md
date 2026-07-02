---
feature: Пакет A — целостность Person↔Entity (companion-инвариант + безопасный мерж)
status: approved
approved_by: владелец (делегировано 2026-07-01 — «без одобрения блюпринта сразу к ТЗ»)
date: 2026-07-01
covers: F-1, F-5 (entityTenantId), S-M3 (mergedIntoTenantId), S-C3 (клон-коллапс) — оба пути мержа
source: plans/analysis/2026-07-01-functional-test-report-part1.md · функтест work/2026-06-29
---

# Пакет A — целостность Person↔Entity

## Зачем (одной фразой)
Сейчас знания людей **молча перемешиваются и теряются**: авто-крон каждые 5 минут сливает сущности (в т.ч. людей), не перепривязывая персон и не дописывая tenant-компаньоны составных ключей → клоны схлопываются, Prisma-связи рвутся. Это техкорень entity-вопросов про людей и целостности клонов.

## Что сейчас (as-is)

### 1. Составной компаньон партиции не пишется (F-5 + S-M3, системно)
В схеме связи заданы составными ключами `[id, tenantId]`:
- `Person.entity @relation(fields: [entityId, entityTenantId])`
- `Entity.mergedInto @relation(fields: [mergedIntoId, mergedIntoTenantId])`
- `IdeaBlock.mergedInto @relation(fields: [mergedIntoId, mergedIntoTenantId])`

Код почти везде пишет **только id-часть**, забывая tenant-компаньон:
| Поле | Места записи без компаньона | Правильно |
|---|---|---|
| `Person.entityId` | `entity-resolution.service.ts:1316, 1376, 1417`; `onboarding/demo-data/knowledge-graph.ts:807` | только `specialist-3-2-knowledge-clone.service.ts:408` |
| `Entity.mergedIntoId` | `entity-merge.service.ts:429` (ручной), `entity-resolver.worker.ts:216` (авто) | нигде |
| `IdeaBlock.mergedIntoId` | `block-distill.worker.ts:306, 465, 533` | нигде |

Итог замера: `Person.entityTenantId` = **11/11 NULL** (все персоны); после форс-мержа `Entity.mergedIntoTenantId` = **1/1 NULL**. SQL-by-id работает → баг тихий; рвётся `include:{entity}` / `include:{mergedInto}`.

### 2. Мерж сущностей осиротляет ссылки (S-C3 и шире) — в ОБОИХ путях
Слияние `from→into` происходит двумя путями:
- **Ручной:** `entity-merge.service.ts:298 mergeManually` ← endpoint `POST /org-admin/knowledge/entities/:id/merge`.
- **Авто:** `entity-resolver.cron.ts:54 @Cron('*/5 * * * *')` → `findCandidatePairs` (матч `b.type = a.type`, **person не исключён**) → `entity-resolver.worker.ts:178 applyMerge`.

Что мигрируется, что осиротляется при мерже:
| Ссылка на сущность | Ручной | Авто | Последствие если не мигрировано |
|---|---|---|---|
| `IdeaBlockEntity.entityId` | ✅ | ✅ | — |
| `EntityLink` (from/to) | ⚠️ по id без учёта type | ❌ не мигрирует | осиротевшие рёбра графа |
| **`Person.entityId`** | ❌ | ❌ | **клон-коллапс (S-C3)** |
| `Card.entityId` + `relatedEntityIds[]` | ❌ | ❌ | карточка на мёртвой сущности |
| `ThemeEntity.entityId` | ❌ | ❌ | тема теряет слитую сущность |
| `SourceEntity.entityId` | ❌ | ❌ | источник на мёртвой сущности |
| цепочка `mergedIntoId` (2-хоп) | ⚠️ один хоп | ⚠️ | `canonicalizeEntityIds` не разворачивает транзитивно |

**Клон-коллапс (S-C3), замер:** форс-мерж Елена→Игорь → клон-рид Елены **6→0**, Игоря **9→15** (забрал всё), `Person(Елена).entityId` осиротел на merged-away. Читатели по `entityId`, которые НЕ следуют за `mergedIntoId`: `loadBlocksForPerson:418`, `knowledge-clone-rebuild.cron.ts:55-83`, skill-worker → **read-side defence одна недостаточна**.

### 3. F-1 — резолв персон по embedding мёртв
`entity-resolution.service.ts:1120` — сырой SQL `FROM "Person" p` (реальная таблица `persons`) → `42P01 relation does not exist` → проглатывается `catch { return []; }`. KNN-склейка персон не работает НИКОГДА, тихо.

## Что делаем (to-be)

**Инвариант:** *«id составного ключа никогда не пишется без своего tenant-компаньона; сущность-человек не сливается автоматически; мерж мигрирует ВСЕ ссылки на сущность; читатель по entityId устойчив к merged-away»*.

1. **Companion-инвариант.** Во всех местах записи `entityId`/`mergedIntoId` (таблица выше) писать компаньон в той же операции; при обнулении `mergedIntoId` обнулять и компаньон. Backfill существующих (11 персон + любые слитые сущности/блоки).
2. **Безопасный мерж — единый путь.** Вынести полную логику миграции ссылок в один сервис-метод `mergeEntities(from,into)`, которым пользуются оба вызывателя (ручной endpoint и авто-worker). Он: мигрирует `IdeaBlockEntity`, `EntityLink` (с учётом type), `Card.entityId`+`relatedEntityIds[]`, `ThemeEntity`, `SourceEntity`; **перепривязывает `Person.entityId`(+tenant)**; ставит `mergedIntoId`+компаньон; разворачивает цепочку.
3. **Исключить людей из авто-мержа.** В `findCandidatePairs` добавить `AND a.type <> 'person' AND b.type <> 'person'` — идентичности людей автоматом не сливаем (арбитр может ошибиться → bleed).
4. **Read-side defence.** `loadBlocksForPerson` (и прочие читатели по entityId) следуют за `mergedIntoId` (резолв в canonical) — belt-and-suspenders поверх write-side re-point.
5. **F-1.** `FROM "Person"` → `persons`; убрать тихий `catch→[]` (логировать/пробрасывать, чтобы будущие 42P01 не прятались).

## Развилки — решены (с доказательством)

**Р-1. S-C3 чиним write-side re-point ИЛИ read-side follow?** → **Оба (defence-in-depth), но write-side re-point — обязателен.**
*Доказательство:* только read-side (следовать `mergedIntoId`) недостаточно — `knowledge-clone-rebuild.cron.ts:55` СНАЧАЛА выбирает `persons WHERE entityId`, затем читает блоки по этому entityId; если Person.entityId указывает на merged-away, cron и skill-worker всё равно читают пустоту/чужое. Значит Person.entityId должен быть корректным (write-side). Read-side follow добавляем как страховку для исторических/пропущенных случаев.

**Р-2. Мигрировать все ссылки vs только Person?** → **Все (Person, Card, ThemeEntity, SourceEntity, EntityLink).**
*Доказательство:* память владельца — «полное решение, а не заплатка, когда частично = корень багов». Частичная миграция (только Person) оставит Card/Theme/Source на мёртвых сущностях → те же тихие потери в других витринах. Один раз пишем полный мигратор — закрываем класс.

**Р-3. Людей авто-сливать или нет?** → **Не сливать автоматом (исключить type='person').**
*Доказательство:* цена ошибки арбитра для человека = перемешивание идентичности и знаний (bleed), необратимо и невидимо. Для не-людей over-merge дешевле и обратимее. Ручной путь для людей остаётся (человек подтверждает). Это снимает главный прод-риск целиком у источника, а не только лечит последствие.

**Р-4. Единый мергер vs два параллельных фикса?** → **Единый метод, два вызывателя.**
*Доказательство:* сейчас ручной и авто разошлись (авто беднее — не мигрирует EntityLink). Две копии логики = гарантированный дрейф и повторение S-C3. Единый метод устраняет расхождение навсегда.

**Р-5. Как гарантировать компаньон в будущем (не только сейчас)?** → **Хелпер + тест-инвариант.**
*Доказательство:* точечно поправить 9 мест — завтра появится 10-е. Вводим узкий хелпер записи связи (`setPersonEntity`, `markEntityMerged`, `markBlockMerged`), который физически не даёт написать id без компаньона, + спек, падающий если в схеме появилась `_prisma_` запись `mergedIntoId`/`entityId` без пары. Дешевле, чем ловить регресс на проде.

## Как будет выглядеть (после)
- Авто-крон каждые 5 мин сливает только НЕ-людей; людей предлагает к слиянию лишь ручной путь.
- После любого мержа: `include:{entity}`/`include:{mergedInto}` резолвятся; клон человека не пустеет; Card/Theme/Source/EntityLink указывают на canonical.
- Резолв персон по embedding (KNN) работает; ошибки SQL больше не прячутся.
- `Person.entityTenantId` и `Entity/IdeaBlock.mergedIntoTenantId` заполнены у всех (backfill + инвариант вперёд).

## Объём изменений (для ТЗ)
- `entity-resolution.service.ts`: :1120 таблица `persons`; убрать тихий catch; :1316/1376/1417 писать `entityTenantId`.
- `entity-merge.service.ts`: вынести полный мигратор ссылок; писать `mergedIntoTenantId`; re-point Person(+tenant).
- `entity-resolver.worker.ts`: applyMerge → звать единый мигратор (не свою урезанную версию); `entity-resolver.cron.ts findCandidatePairs` → исключить person.
- `block-distill.worker.ts`: :306/465/533 писать/обнулять `mergedIntoTenantId` вместе с `mergedIntoId`.
- `specialist-3-2-knowledge-clone.service.ts loadBlocksForPerson`: следовать `mergedIntoId`.
- `onboarding/demo-data/knowledge-graph.ts:807`: писать компаньон.
- Хелперы записи связи + spec-инвариант.
- Backfill-скрипт: `Person.entityTenantId`, `Entity.mergedIntoTenantId`, `IdeaBlock.mergedIntoTenantId` (+ регистрация в `apply-prod-deploy.ts` phase update).

## Миграция/бэкфилл
1. `backfill-entity-tenant-companions.ts` (idempotent): проставить `entityTenantId=tenantId` где `entityId` задан, `mergedIntoTenantId=tenantId` где `mergedIntoId` задан (Entity+IdeaBlock).
2. Одноразовый reconciler осиротевших ссылок на уже-слитые сущности (Person/Card/Theme/Source → canonical по `mergedIntoId`).

## Тест-план
- Unit: каждый write-site пишет компаньон; обнуление обнуляет пару.
- Unit: `findCandidatePairs` не возвращает пары с type='person'.
- Integration: форс-мерж двух не-person сущностей → Person/Card/Theme/Source/EntityLink мигрированы, `include` резолвятся.
- **Regression S-C3:** повторить сценарий Елена→Игорь через авто-worker путь → клон-рид НЕ падает в 0 (person исключён / re-point).
- Integration: F-1 KNN возвращает кандидатов; SQL-ошибка больше не глотается.
- Backfill: после прогона `Person.entityTenantId` NULL = 0.

## Риски
- Единый мигратор трогает много таблиц в транзакции — покрыть pre-check на composite-PK конфликты (как уже сделано для IdeaBlockEntity), иначе 25P02 абортит tx.
- Исключение person из авто-мержа может оставить реальные дубли людей — их закрывает ручной путь + (позже) Пакет E. Приемлемо: лучше два клона, чем перемешанные.
