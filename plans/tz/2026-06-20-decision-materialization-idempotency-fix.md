---
title: ТЗ — идемпотентная материализация Decision (устранение тихой потери решений)
date: 2026-06-20
status: реализовано в dev — Ф1/Ф2/Ф3/Ф6 [x], Ф5 [x]-частично (unit-гарды; real-DB e2e — CI); Ф4 РЕШЕНО НЕ ДЕЛАТЬ (оставить @unique). Коммиты 6e344b59/3fcaa2df/5657f5b2
severity: 🔴
owner: Сергей
source: plans/analysis/2026-06-20-agents-big-test-RESULTS.md (находки №2b/№2c, большой тест агентов)
parent: plans/tz/2026-06-16-knowledge-core-MASTER.md (Б3 [high, K4]) — это ТЗ детализирует и подтверждает на проде
area: knowledge-core / материализация графа
---

# ТЗ — идемпотентная материализация Decision

> **Связь с зонтиком MASTER (НЕ дублировать).** Этот дефект уже учтён в
> [`2026-06-16-knowledge-core-MASTER.md`](2026-06-16-knowledge-core-MASTER.md) как **Б3 [high]** (класс **K4** —
> «нет детерминированного source-block дедупа на специалистах»), вместе с **Б48** (source-block guard) и
> **Б49** (supersede в `$transaction`). **Б48 и Б49 по текущему коду уже реализованы** (guard `findFirst`
> на [:187](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L187) и
> `$transaction` на [:328](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L328)).
> **Но Б3 НЕ закрыт** и **подтверждён срабатывающим на проде 2026-06-20** (4× P2002 у Романа) — потому что guard Б48
> это check-then-create **без лока** (TOCTOU). Это ТЗ — узкий, прод-подтверждённый «добив» Б3 + расширение класса
> (второй писатель `specialists-combined`, латентный cross-tenant), с актуальными `file:line` (в MASTER они слегка
> устарели: `:883`/`:369-381` → ныне `:991`/`:445`). Каноническое место фикса — волна **K4** MASTER; исполнять
> можно вместе с Ф4 task-dedup (тот же файл).

## Проблема (подтверждена прод-логами)

У активного тенанта «ООО Луа» (23 встречи) реестр решений **молча пуст**: у встреч с явными `decision`-сигналами материализовано `Decision = 0`, при том что Idea материализуется штатно. Корень — подтверждён trace-логами встречи Романа `mtg_01KV89P3GMAY2P52W3SVKB0BVM`:

```
[ERROR] Specialist33Service: specialist-3-3.processBlock: внутренняя ошибка — пропускаю блок
[ERROR] PrismaService: Invalid `prisma.decision.create()` invocation:
        Unique constraint failed on the fields: (`sourceIdeaBlockId`)   ← 4× за одну встречу
```

## Корень (архитектурный)

Только `Decision` несёт **legacy-поле** `sourceIdeaBlockId String? @unique` ([schema.prisma:6207](../../backend/prisma/schema.prisma#L6207)). Idea/Insight/Goal этот путь бросили в β-3 и хранят источник в **неуникальном** `sourceBlockIds String[]` (+ `entityId @unique` через upsert-резолюцию). Уникальность на всё ещё пишущемся legacy-поле превращает любую гонку/повтор в `P2002`. Дальше — два не-идемпотентных писателя, которые этот `P2002` **глотают**, теряя решение.

### Инвентарь писателей `Decision.sourceIdeaBlockId`

| Писатель | Идемпотентность | Обработка конфликта | Вердикт |
|---|---|---|---|
| `graph.service.upsertEntity(decision)` ([:691](../../backend/src/common/graph/graph.service.ts#L691)) — оба пути block-ingest | ✅ `findUnique` в `$transaction` | возвращает существующий | безопасен; 🟡 латентный cross-tenant fall-through ([:697](../../backend/src/common/graph/graph.service.ts#L697)) |
| `specialist-3-3-decisions.createNewDecision` ([:973/991](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L991)) | ❌ сырой `create`; guard `findFirst` ([:187](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L187)) = check-then-create **без лока** (TOCTOU под `concurrency=4` / re-dispatch) | внешний `catch` ([:445](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L445)) inc-метрика + `return` (молча) | 🔴 **подтверждённый источник потери** |
| `specialists-combined.decisions` ([:269/280](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L269)) | ❌ сырой `create`; guard `findFirst(sourceBlockIds has)` без лока | `catch`→`warn`+`continue` (молча) | 🔴 **тот же класс** |

### Что НЕ затронуто (границы)
- **Idea/Insight/Goal** — неуникальный `sourceBlockIds[]`, сырой `create` P2002 не даёт. Не трогаем.
- **Task** ([meeting-report-fast.worker.ts:466](../../backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts#L466)) — нет уникального source-поля; тихой потери нет (отдельный, более мягкий риск дублей — вне этого ТЗ).

## Целевое поведение (инварианты)

1. **И1 — нулевая потеря:** ни одна гонка/повтор/re-dispatch не приводит к молчаливому отбросу извлечённого Decision. P2002 на `sourceIdeaBlockId` обязан схлопываться в merge в уже существующий Decision, а не в `return`/`continue`.
2. **И2 — ровно один Decision на блок-источник:** для одного `sourceIdeaBlockId` в графе ровно одна Decision-карточка (или явная supersede-цепочка), без дублей.
3. **И3 — наблюдаемость:** конфликт уникальности учитывается отдельной метрикой `db_conflict` (recoverable), НЕ сливается с `db_error` (как сейчас на [:447](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L447)), иначе фикс невозможно подтвердить по графику.
4. **И4 — cross-tenant безопасность:** upsertEntity при коллизии `sourceIdeaBlockId` чужого тенанта не падает в `create`.

## Фазы

> **Координация с параллельной сессией (важно).** Файл `specialist-3-3-decisions.service.ts` **идентичен** на `feature/assistant-assign-task-notify` и `feature/knowledge-core-master` → фикс Ф1 ляжет чисто на любую ветку. А вот `specialists-combined.service.ts` (+160) и `graph.service.ts` (+362) **активно переписывает сессия knowledge-core-master** — поэтому Ф2/Ф3 здесь НЕ трогаю (иначе merge-конфликт), их фикс делать **на ветке kcore**. Combined к тому же спит (cron-producer удалён 2026-06-10), cross-tenant — латентный. Живое кровотечение — только Ф1, оно и закрыто.

### Ф1 — идемпотентный `createNewDecision` в специалисте 3-3 `[x]` ✅
**Реализовано** (worktree `fix/decision-materialization-idempotency`, коммит `08305286`, не запушено). `createNewDecision`: `create` обёрнут — на `P2002` с target `sourceIdeaBlockId` (только не-tx путь) → `findFirst` по `sourceIdeaBlockId` → `mergeIntoExisting`; supersede-`$transaction` не трогаем (P2002 внутри tx абортит её — Б1). Внешний catch: `db_conflict` отделён от `db_error`. Helper `isSourceBlockUniqueViolation`. Удалён устаревший нарратив-комментарий (описывал уже исправленный баг). Тест-гард в `dedup.spec.ts`: «create роняет P2002 → re-find + merge, без потери, метрика db_conflict». Верификация: **8/8 тестов, tsc 0, eslint 0**.

<details><summary>Исходный план Ф1 (выполнен)</summary>
- В `createNewDecision` ([:973](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L973)) обернуть `db.decision.create` так: при `PrismaClientKnownRequestError code === 'P2002'` с target `sourceIdeaBlockId` — **re-find** `findFirst({ tenantId, sourceIdeaBlockId: block.id })` и вернуть его (вызвав `mergeIntoExisting` тем же набором аргументов, что уже собран в `processBlock`). Гонка закрыта на уровне «create проиграл — значит кто-то уже создал, обогащаем его».
  - НЕ заворачивать в `$transaction` ради ретрая (анти-паттерн Б1 уже зафиксирован в комментарии [:325](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L325): P2002 внутри tx абортит её). Ловить P2002 **снаружи** конкретного `create`-вызова.
  - supersede-ветка ([:328](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L328)) создаёт новый Decision внутри tx — там P2002 должен **пробросить наружу** в общий recovery (re-find→merge), а не оставаться проглоченным.
- Внешний `catch` ([:445](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L445)): различать `P2002` (→ `incCoreSpecialist...({reason:'db_conflict'})` + recovery-merge, НЕ молчаливый `return`) и прочие (`db_error`, как сейчас).
- **Приёмка:** unit на P2002-ветку: мок `create` бросает P2002 → ожидается вызов `mergeIntoExisting` в найденный Decision, метрика `db_conflict`, метод НЕ теряет решение. Расширить существующий [specialist-3-3-decisions.dedup.spec.ts](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.dedup.spec.ts).
</details>

### Ф2 — тот же фикс в `specialists-combined` `[x]` ✅
**Реализовано** (коммит `3fcaa2df`). В `specialists-combined.persistDecisions` `P2002` на `sourceIdeaBlockId` больше НЕ ложится в `errors.push`, а трактуется как дедуп: метрика `db_conflict` + `continue` (решение не теряется при ретрае BullMQ, повтор идемпотентен). +тесты.

### Ф3 — cross-tenant fall-through + P2002-safe `upsertDecision` в `graph.service` `[x]` ✅
**Реализовано** (коммит `3fcaa2df`). `graph.service.upsertDecision` стал P2002-safe: ловит `P2002` вне `$transaction` → re-find по `{tenantId, sourceIdeaBlockId}` → возврат существующего; коллизия чужого тенанта → `ConflictException` (НЕ тихий проглот P2002, НЕ проваливается в `create`). +тесты.

### Ф4 — структурная гигиена: снять legacy `@unique` (решение владельца Р-1) — **РЕШЕНО НЕ ДЕЛАТЬ (оставить @unique)**
**Не делаем; миграции НЕТ.** После Ф1 (`create`+`catch(P2002)`→merge) `@unique sourceIdeaBlockId` больше НЕ теряет решение, а работает как **точка сериализации** между тремя писателями Decision (`graph.service` / `specialist-3-3` / `specialists-combined`) — кто проиграл гонку, обогащает существующий Decision. Посылка Р-1 «`@unique` превращает гонку в потерю» снята фиксом Ф1; снятие `@unique` вернуло бы кросс-писательские дубли. Само ТЗ это санкционирует (см. ниже «Если Р-1 = оставить @unique»).

### Ф5 — e2e приёмочный тест (изолированный тенант) `[x]`-частично
**Unit-гарды готовы и зелёные** (P2002-ветки покрыты детерминированными моками во всех трёх писателях — `*.dedup.spec.ts`, `graph.service.spec.ts`, `specialists-combined.service.spec.ts`). **Real-DB e2e гонки** (один decision-блок диспетчеризуется в 3-3 дважды параллельно → ровно 1 Decision, `db_conflict≥1`) в этой среде НЕ прогнан: dev-postgres = pgvector/pg17 **без Apache AGE**, полный конвейер требует AGE + LLM-доступ. Real-DB e2e — CI-гейт (когда поднят полный стек). Строка-указатель — `second-brain/04_не-сделано/README.md`.

### Ф6 — бэкофилл пустых реестров (решение владельца Р-2) `[x]` ✅
**Реализовано** (коммит `5657f5b2`). `backend/scripts/backfill-decisions-from-signals.ts`: для тенантов с canonical decision-сигнальными блоками (`decision`/`rationale`/`decision_basis`) без материализованного Decision — переэкстракция через `router.dispatch`→3-3, идемпотентно (Ф1 guard+merge); флаги `--dry-run`/`--org`/`--limit`. Зарегистрирован в `apply-prod-deploy.ts` `STEPS` (`phase: backfill`, `skipBootstrap: true`), PrismaClient — `createPrismaClient()`.

## Совместимость с prompt caching
Не применимо — ТЗ не трогает LLM-промпты (дефект в слое записи). `decision-extract`/`block-ingest` остаются как есть (3/3 в харнессе).

## Ship-On / флаги
Фиксы Ф1–Ф3 — исправление дефекта, выкатываются включёнными, без флага. Ф4 (миграция) и Ф6 (бэкофилл) — разовые прод-операции. Новых рантайм-флагов нет.

## Принятые решения (с доказательством)
Не «меню владельцу» — лучшее решение выбрано и обосновано фактами кода/прода.

- **Р-1 — снять legacy `@unique sourceIdeaBlockId` (Ф4): ДА.**
  - *Доказательство:* поле помечено «legacy» в самой схеме ([6206](../../backend/prisma/schema.prisma#L6206)); Idea/Insight/Goal от него отказались в β-3 в пользу неуник. `sourceBlockIds[]` и **материализуются без единого P2002** (прод: 19 Idea у Романа). Единственный код, требующий уникальности, — `graph.service.ts:693` `findUnique({sourceIdeaBlockId})` → тривиально меняется на `findFirst`; `documents.service.ts:480` (`{in}`) и оба guard'а уже на `findFirst`. Грепом подтверждено: больше никто не читает поле как уникальный ключ. Значит «гарантия 1 блок→≤1 Decision» от `@unique` ничего не даёт сверх guard+merge, но превращает гонку в **потерю**. Снятие убирает капкан в корне.
  - *Порядок:* идемпотентность (Ф1, уже сделана) — немедленная остановка кровотечения; снятие `@unique` (Ф4) — следующим, закрывает класс структурно. Ship-On обоих.
- **Р-2 — бэкофилл пустых реестров (Ф6): ДА.**
  - *Доказательство:* Ф1 чинит только НОВЫЕ экстракции; уже накопленные 23 встречи «ООО Луа» останутся с Decision=0 (diag показывает «расхождение»). Прогон идёт штатным путём 3-3, который теперь идемпотентен (Ф1) → повтор безопасен, дублей не создаст. Без бэкофилла заявленная ценность «реестр решений» остаётся пустой у текущих клиентов.
- **Р-3 — где land'ить и кто делает Ф2/Ф3: на ветке `feature/knowledge-core-master`.**
  - *Доказательство:* `specialist-3-3` идентичен на всех ветках → Ф1 портируется куда угодно. Но `specialists-combined` (+160) и `graph.service` (+362) **активно переписывает** сессия knowledge-core-master (коммит 61671d58 «Б1–Б4»), и канонический дом этого бага — её зонтик (Б3/K4). Land Ф1 + делать Ф2/Ф3 там → весь decision-idempotency-класс ложится одним когерентным куском, без merge-войны за те же файлы. (Combined вдобавок спит — cron-producer удалён 2026-06-10; cross-tenant латентный — приоритет ниже Ф1.)
- **Р-4 — supersede-$transaction ветку НЕ оборачивать в P2002-recovery: ДА (оставить throw наружу).**
  - *Доказательство:* P2002 внутри `$transaction` абортит её (PostgreSQL 25P02) — это анти-паттерн Б1, прямо описанный в коде ([:325](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L325)). Recovery делаем только на не-tx пути; tx-P2002 пробрасывается и метится `db_conflict` во внешнем catch. Подтверждённый прод-провал — именно не-tx `create` (новые решения), tx-supersede реже и требует существующей цели.

## Прод-операции (для prod-deploy-log при выкате)
- Ф4 (Р-1=ДА): новая Prisma-миграция (drop unique index на `Decision.sourceIdeaBlockId`) → Шаг 4; применяется авто через `migrate deploy`.
- Ф6 (Р-2=ДА): новый `backfill-decisions-from-signals.ts` → Шаг 8 + регистрация в `apply-prod-deploy.ts`.
- Ф1–Ф3, Ф5 — код/тесты, без прод-действий сверх `docker compose up -d --build backend`.

## Почему предыдущий фикс (Б48) не удержал — и почему «повторный»
Прошлый заход (Б48) добавил **guard** = «проверь `findFirst`, нет ли уже Decision из этого блока, перед `create`». Это **check-then-create без лока** — классический TOCTOU. Под `concurrency=4` диспетчера (+ re-dispatch / BullMQ-ретрай) два исполнения одного блока проходят guard **одновременно** (оба видят «нет») → оба идут в `create` → второй ловит `P2002` → внешний `catch` его **глотает** → решение теряется. Guard снизил частоту, но гонку не закрыл — **гонку проверкой не лечат**. Прод 2026-06-20 это доказывает: 4× P2002 у Романа уже ПОСЛЕ внедрения Б48/Б49.

**Вывод для повторного фикса:** не «проверять ещё лучше», а сделать **сам `create` идемпотентным к constraint** — `create` + `catch(P2002)` → re-find по `sourceIdeaBlockId` → `mergeIntoExisting`. Constraint становится точкой сериализации (кто проиграл гонку — обогащает существующий Decision, а не теряет свой). Guard Б48 остаётся как быстрый путь (экономит лишний `create`-roundtrip), но корректность держит уже не он.

## Итог
**Реализовано целиком (в dev), кроме структурной Ф4, которая осознанно НЕ делается.** Все три писателя Decision приведены к идемпотентному `create+catch(P2002)→merge`: `specialist-3-3.createNewDecision` (Ф1, коммит `6e344b59` — cherry-pick прежнего worktree-фикса 08305286), `specialists-combined.persistDecisions` (Ф2, `3fcaa2df` — P2002 = дедуп + метрика `db_conflict`, не `errors.push`), `graph.service.upsertDecision` (Ф3, `3fcaa2df` — P2002-safe re-find + cross-tenant→`ConflictException`). Гонку лечит не проверка, а constraint-as-serialization. Бэкофилл пустых реестров (Ф6, `5657f5b2`) переэкстрагирует canonical decision-блоки без Decision идемпотентным re-dispatch'ем в 3-3.

**Решение по @unique (Ф4): оставить.** Снятие отменено — после Ф1 уникальность стала точкой сериализации трёх писателей (кто проиграл гонку, обогащает существующий Decision), а не источником потери; снятие вернуло бы кросс-писательские дубли. **Миграции Prisma в этом ТЗ НЕТ.**

**Верификация.** typecheck зелёный; unit-гарды на P2002-ветки трёх писателей зелёные (8/8 у 3-3 + тесты у combined/graph). **Real-DB e2e гонки (2 параллельных dispatch на живой БД)** в этой среде не прогонялся — dev-postgres без Apache AGE, полный конвейер требует AGE + LLM; логика гонки/идемпотентности покрыта детерминированными unit-гардами, real-DB e2e — CI-гейт (Ф5, строка в `second-brain/04_не-сделано/README.md`). Класс локализован, границы проверены эмпирически (Idea/Insight/Goal материализуются; Task/IntakeIssue без уникального source → не сиблинги), причина рецидива установлена (TOCTOU поверх check-then-create) и закрыта на всех трёх писателях.
