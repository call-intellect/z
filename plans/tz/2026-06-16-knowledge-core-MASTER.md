---
type: tz
status: ready-to-implement
feature: knowledge-core-master
date: 2026-06-16
owner: владелец (Сергей, sergrv80@gmail.com)
relates_to:
  - docs/methodology/prompts/upgrade-progress.md
  - docs/methodology/prompts/README.md
  - docs/methodology/code-audit/README.md
  - plans/tz/2026-06-16-knowledge-core-ingest-prompts-revision.md
  - plans/tz/2026-06-16-knowledge-core-specialist-extractors-prompts.md
  - plans/tz/2026-06-16-knowledge-core-dedup-supersede-prompts.md
  - plans/tz/2026-06-16-knowledge-core-linking-prompts.md
  - plans/tz/2026-06-16-knowledge-core-cluster-rollup-prompts.md
  - plans/tz/2026-06-16-knowledge-core-final-misc-prompts.md
  - plans/tz/2026-06-16-task-dedup-and-tracker-reconcile.md
  - plans/tz/2026-06-16-task-dedup-and-tracker-reconcile-orchestrator-prompt.md
---

> **Это зонтичное (master) ТЗ.** Единая точка входа для другой сессии по ВСЕЙ работе над модулем
> усвоения `knowledge-core`. Сшивает три пласта в один исполняемый по волнам план. Финальные
> тексты промптов живут в приложениях своих ТЗ (ссылки ниже) — здесь они НЕ дублируются (копия =
> рассинхрон, методология промптов это прямо запрещает). Аудит-баги — **полный контракт инлайн**
> (своего дома нет). Документ **одновременно служит** аудит-ТЗ по `docs/methodology/code-audit`
> §7 (контракт §4: симптом+корень+фикс+`file:line` + блок «опровергнуто»).

# ТЗ-зонтик — модуль усвоения (knowledge-core): промпты + аудит-фиксы + дедуп задач

## 0. Как этим пользоваться (для исполняющей сессии)

Старт: прочитать `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp, Prisma-миграции, Ship-On),
затем этот файл целиком, затем — по мере захода в волну — конкретное под-ТЗ из `relates_to`.

Документ описывает **три пласта** работы над одним модулем:

| Пласт | Что | Состояние | Где детали |
|---|---|---|---|
| **A. Переписка промптов** | 31 промпт-агент переписан по методологии | 🟡 текст готов, ждёт переноса в код + выката | [upgrade-progress.md](../../docs/methodology/prompts/upgrade-progress.md) + 6 ТЗ ниже |
| **B. Аудит-фиксы** | 59 подтверждённых багов логики/контракта (4 high / 36 med / 19 low) | контракт готов, код не писан | §3 (инлайн) |
| **C. Дедуп задач + петля трекера** | 6 фаз: гейт→дедуп→петля закрытия→reconcile→supersede→вектор целей | ready-to-implement | [task-dedup ТЗ](2026-06-16-task-dedup-and-tracker-reconcile.md) |

**Главная ценность зонтика — §5 (сквозные связки) и §6 (план волн):** где правку промпта НАДО катить
вместе с код-фиксом, и в каком порядке всё исполнять, чтобы не делать дважды и не уронить данные.

**Режим исполнения — автономно, без вопросов.** Все продуктовые развилки уже закрыты (в под-ТЗ).
Новую неоднозначность решай сам: два прохода → доказать лучшее → `[ASSUMPTION: … — потому что …]`
inline → продолжать. Единственная точка подтверждения — `git push` (правило проекта).

---

## 1. Пласт A — переписка промптов (инвентарь, ссылки на тексты)

31 промпт-агент переписан по [методологии](../../docs/methodology/prompts/README.md). **Финальный
SYSTEM-текст каждого — в приложении своей ТЗ** (перенести в код дословно, не сочинять заново).
Поимённый реестр со статусом — [upgrade-progress.md](../../docs/methodology/prompts/upgrade-progress.md).

| ТЗ-пачка | Приложения → агенты |
|---|---|
| [ingest-prompts-revision](2026-06-16-knowledge-core-ingest-prompts-revision.md) | **Ф4-pre (делать ПЕРВЫМ):** общий словарь ярлыков `backend/src/modules/knowledge-core/prompts/signal-type-label.ts` + обёртки в `ai/services/prompts/common.ts`. A1 block-ingest · A2 axis-classify · A3 entity-merge-arbiter · B1 block-distill · B2 block-linker · B3 специалист-routing (combined) |
| [specialist-extractors-prompts](2026-06-16-knowledge-core-specialist-extractors-prompts.md) | C1 decision-extract · C2 idea-extract · C3 insight-extract · C4 regulation-extract · C5 experiment-extract · D1 knowledge-clone-extract · D2 knowledge-clone-merge · D3 goal-extract · D4 process-template-extract |
| [dedup-supersede-prompts](2026-06-16-knowledge-core-dedup-supersede-prompts.md) | E1 decision-supersede-detect · E2 fact-supersede-detect · E3 regulation-dedupe · E4 task-dedupe |
| [linking-prompts](2026-06-16-knowledge-core-linking-prompts.md) | E1 goal-hierarchy-link · E2 goal-task-link · E3 insight-link-to-decisions · E4 goal-alignment |
| [cluster-rollup-prompts](2026-06-16-knowledge-core-cluster-rollup-prompts.md) | E1 theme-classify · E2 idea-cluster-merge · E3 card-rollup-v2 (все 6 kind) · E4 idea-status-summarize |
| [final-misc-prompts](2026-06-16-knowledge-core-final-misc-prompts.md) | E1 role-profile-build · E2 reframing (2 константы) · E3 structured-document-compiler |

**Контракт переноса каждого промпта (DoD пласта A):**
1. Перенести SYSTEM-текст из приложения в `*.prompt.ts` дословно.
2. **Сверить enum по коду:** в JSON модель отдаёт ЛАТИНСКИЙ код, человеку показываем русский ярлык;
   мэппинг «ярлык→enum» в финальной строке промпта должен совпадать со значениями enum
   (`backend/prisma/schema.prisma`) / Zod-схемой агента. Не доверять тексту ТЗ — открыть код.
3. Машинные коды не должны попадать во вход человеку → словарь из `signal-type-label.ts`.
4. `bun run typecheck && bun run build` (из `backend/`).
5. Обновить snapshot: `bunx vitest run -u src/modules/knowledge-core/prompts/__snapshots__/<имя>.snapshot.spec.ts`.
6. В upgrade-progress.md статус агента 🟡→🟢 + дата **только после выката в прод**.

**Клон-агенты M5 (skill-trait-*, value-motivation, process-marker, role-principle, cdm-case,
executable-persona-compile, clone-respond, persona-behavior-judge, multi-query-clone,
knowledge-clone-*) — НЕ в scope этого ТЗ:** их ведёт другая сессия ([clone-agents-prompt-revision](2026-06-16-clone-agents-prompt-revision.md)).

---

## 2. REALITY-CHECK (общий по модулю)

- Аудит (§3) проведён по методологии `docs/methodology/code-audit` состязательным роем
  (12 под-областей, 2 скептика/находку, 178 агентов, 2 прохода): **82 находки → 59 подтверждено,
  23 опровергнуто.** Все `file:line` подтверждённых high сверены вручную (§3.1).
- В проде backend = ОДИН процесс/контейнер: «нет Redis-лока между процессами» сам по себе не баг,
  но **cron + HTTP-handler + BullMQ-worker конкурируют внутри процесса** — гонки реальны (это и
  вскрыто в Б1/Б11/Б18/Б24).
- Пласт A меняет только ТЕКСТ промптов; пласт B — ЛОГИКУ кода. Пересечение — только узкий класс
  «парсинг ответа LLM» (§5).
- task-dedup (пласт C) уже задевает `specialist-3-3-decisions.service.ts` (Ф4) и
  `specialist-3-14-goals.service.ts` (Ф5) — те же файлы, что и часть аудит-фиксов → **обязательная
  координация** (§5, §6), иначе двойная работа/конфликты.

---

## 3. Пласт B — аудит-фиксы (контракт: симптом + корень + `file:line` + фикс)

Severity проставлен скептиком ПОСЛЕ опровержения. `file:line` — на момент аудита 2026-06-16,
перед правкой перечитать по символу-якорю. `[класс Kn]` — связка «чинить вместе» (§4).

### 3.1 HIGH (4) — данные теряются/утекают СЕЙЧАС, чинить первыми

#### Б1 [high] P2002-`catch` внутри `$transaction` рискует abort'нуть всю транзакцию слияния `[K7]`
- **Симптом:** при ручном/авто слиянии сущностей P2002 на переносе mention/link может перевести
  транзакцию в aborted (25P02) → слияние частично/целиком не применяется, владелец видит ошибку.
- **Корень:** `catch(P2002)` сделан ВНУТРИ интерактивной `$transaction` без SAVEPOINT; в PostgreSQL
  любая ошибка SQL абортит транзакцию, последующие запросы в ней отвергаются. Скептик подтвердил
  **эмпирически** (Prisma 7.8 + @prisma/adapter-pg). **Баг-КЛАСС — 4 места:** `entity-merge.service.ts:243-307`
  (mergeManually, 3 try/catch), `entity-resolver.worker.ts:253-275` (applyMerge),
  `block-distill.worker.ts:317-336` (mergeInto), `:487-515` (swapDirection).
- **`file:line`:** `backend/src/modules/knowledge-core/services/entity-merge.service.ts:249` (+3 вхождения) ✓ сверено.
- **Фикс:** заменить «надежду на исключение» на предварительный `findUnique` конфликтной пары +
  условный update/delete БЕЗ опоры на P2002; либо `$executeRaw ... ON CONFLICT DO NOTHING` + cleanup.
  Закрыть все 4 вхождения + машинный гард (тест: update→P2002→ещё один update в одной tx).

#### Б2 [high] Soft-deleted (Org-Admin) рёбра графа отдаются читателям и в RAG — нет `deletedAt:null` в 5 из 6 ридеров `[K2]`
- **Симптом:** владелец удалил связь в Org-Admin — в админке/snapshot её нет, но в графе блока/сущности,
  в обходе графа и в ответах AI-чата (RAG) она продолжает участвовать (соседи, contradiction-флаги, graph-hop).
- **Корень:** soft-delete (`admin/services/org-admin-knowledge.service.ts:190-202`) пишет только
  `deletedAt`/`deletedBy`, НЕ трогает `status` (enum `LinkStatus` = только `active|archived`, значения
  `deleted` нет). Эталон `snapshot.service.ts:buildLinkWhere` фильтрует `status:'active' AND deletedAt:null`;
  остальные — только `status:'active'`. **Баг-КЛАСС, ридеры:** `graph.controller.ts:244,248,324-339`,
  `blocks.controller.ts:277,282`, `entities.controller.ts:281,291,439,449`,
  `chat-v2-retrieval.service.ts:757,768`, `chat-v2.service.ts:1513`.
- **`file:line`:** `backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts:757` (+класс) ✓ сверено.
- **Фикс:** добавить `deletedAt: null` во ВСЕ where чтения `IdeaBlockLink`/`EntityLink` (по образцу
  `buildLinkWhere`). Дополнительно — при soft-delete также ставить `status:'archived'` (defense-in-depth).

#### Б3 [high] Коллизия `@unique sourceIdeaBlockId` (direct-path vs Specialist 3.3) → богатое решение тихо теряется `[K4]`
- **Симптом:** в карточке решения остаётся тонкая запись из block-ingest (без rationale/alternatives/
  supersede), богатое решение Specialist 3.3 не появляется; растёт `core_specialist_extraction_failure{type=decision,reason=db_error}`, но job completed (без ретрая).
- **Корень:** block-ingest создаёт Decision с `sourceIdeaBlockId=blockId` (`@unique`, `schema.prisma:6134`);
  затем Specialist 3.3 `createNewDecision` пишет тот же `sourceIdeaBlockId: args.block.id`
  (`specialist-3-3-decisions.service.ts:883`) → P2002 → внешний `catch` (`:369-381`) инкрементит метрику,
  логирует и **return без re-throw** → потеря навсегда.
- **`file:line`:** `backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts:883` (create) + `:369-381` (глотание) ✓ сверено.
- **Фикс:** в начале `processBlock` guard `alreadyMaterialized` (как у ideas): найти Decision по
  `sourceIdeaBlockId=blockId`; если есть — **обогатить** существующий (rationale/alternatives/
  decidedByPersonIds/affectsEntityIds/sourceBlockIds), не создавать новый. (Связано: O21 опроверг
  «дубль при ретрае» именно потому, что `@unique` есть — но он же и причина этой коллизии.)

#### Б4 [high] RawEvent помечается `ingested` ДО `enqueueBlockDistill` → потеря дистилляции, реконсиляции нет `[K7]`
- **Симптом:** часть блоков навсегда в `status='draft'`: distill/специалисты не запускаются, карточки
  не рождаются, хотя RawEvent числится обработанным.
- **Корень:** `process()` сначала `rawEvent.update({processingStatus:'ingested'})` (`block-ingest.worker.ts:769-776`),
  потом `enqueueBlockDistill` в `.catch` best-effort (`:781-788`). При краше/сбое Redis между ними
  повторный заход делает ранний skip (`processingStatus!=='received'`, `:252`) и НИКОГДА не доenqueue'ит
  distill. Реконсиляции нет: ни один cron не добивает draft-блоки (verify-cron только ДЕТЕКТИРУЕТ gap).
- **`file:line`:** `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts:769-839` ✓ сверено.
- **Фикс:** реконсиляционный cron — найти `IdeaBlock status='draft'` старше N минут без активного
  `block_distill_<id>` job и переenqueue'ить (distill идемпотентен skip not-draft). Реордер «enqueue до
  ingested» НЕ годится (комментарий :778-780: enqueue намеренно после фиксации evidence) — нужен именно reconcile.

### 3.2 MED (36)

| id | область | `file:line` | суть (симптом→корень) | фикс | класс |
|---|---|---|---|---|---|
| Б5 | card-rollup | `card-rollup-v2.service.ts:490` | `triage='provisional'` (канонизировано системой) трактуется как «не auto» → Card не обновляется (summaryCache/currentVersionId дрейфуют от CardVersion) | условие `=== 'auto' \|\| === 'provisional'` | K9 |
| Б6 | card-rollup | `card-rollup-v2.service.ts:525` | `conflict.report` срабатывает даже когда новое summary НЕ применено (light/deep/provisional) → ложный конфликт в очереди | обернуть блок в `if (applied)` | K9 |
| Б7 | card-rollup | `curation/services/conflict.service.ts:108` | идемпотентность report через `findFirst` без `@@unique` → гонка двойного ConflictItem на пару | partial-unique `(tenantId,resourceType,existingId,newId) WHERE status='open'` + P2002→re-find | K1 |
| Б8 | clustering | `idea-clusterer.cron.ts:160,245-255,180-206` | `IdeaCluster.embedding` НИКОГДА не пишется → KNN-фильтр `IS NOT NULL` отсекает все → кластеры не дополняются (мёртвый код vs док) | писать embedding=mean при create/attach (raw UPDATE `::vector`) | K10 |
| Б9 | clustering | `core-queue/queues.ts:133` | очередь `core.idea-clusterer` без consumer'а → job'ы оседают мёртвыми; кластеризация только по @Cron | поднять Worker на очередь ЛИБО удалить очередь+producers (block-ingest:745, specialist-3-6:320) | K10 |
| Б10 | clustering | `theme-clusterer.cron.ts:165-167,331-340` | нет гарда: один блок в нескольких Theme (PK `(themeId,blockId)` не уникален по blockId; LLM-разрыв между SELECT и записью) | advisory-lock на tenant ИЛИ re-check `NOT EXISTS ThemeIdeaBlock` в tx записи | K10 |
| Б11 | dedup-distill | `block-distill.worker.ts:93` | concurrency:2 + два draft-дубля: оба видят себя draft, knnCandidates ищет только canonical → оба канонизируются, re-distill cron'а нет → дубль навсегда | concurrency:1 ЛИБО block re-distill cron-sweep (как entity-resolver) | K4 |
| Б12 | dedup-distill | `entity-merge.service.ts:159` | `judgeMerge` не передаёт dataClass → арбитр сущностей всегда `internal` → чувствительный контекст к провайдеру с меньшим maxDataClass | `dataClass: maxDataClass([...recentBlocks])` в llm.call (как block-distill) | K5 |
| Б13 | dedup-distill | `block-distill.worker.ts:352` | merge более-чувствительного блока в менее-чувствительный canonical не повышает его dataClass → тихий downgrade | пересчёт `dataClass=max(...)` в tx mergeInto/swapDirection | K5 |
| Б14 | dedup-distill | `entity-resolver.cron.ts:113` | self-join Entity×Entity с vector-предикатом в WHERE → O(n²) скан каждые 5 мин на крупном тенанте | пер-сущностный LATERAL top-k через HNSW ЛИБО окно по updatedAt | K6 |
| Б15 | dedup-distill | `entity-resolution.service.ts:835` | `findMany` без orderBy + `.find` первого по имени → недетерминированная привязка Entity↔Person при тёзках | orderBy + при >1 совпадении не линковать (как hint-резолверы) | K3 |
| Б16 | graph-links | `block-linker.worker.ts:172` | re-upsert не сбрасывает `deletedAt` (в отличие от fact-supersede) → состояние ребра зависит от того, какой воркер сработал | единый контракт «оживления»: сбрасывать `deletedAt:null` (как fact-supersede) либо не оживлять в обоих | K2 |
| Б17 | graph-links | `entity-graph-builder.cron.ts:81` | cron игнорирует Org-Admin тумблер воркера (нет WorkerOrgGate) → строит граф и жжёт LLM при выключенном воркере | инжектить `WorkerOrgGate` + `checkOrThrow(org.id,'entity-graph-builder')` в try/catch | K2 |
| Б18 | ingest | `block-access-deriver.service.ts:247-281` | singleton closed-группы (refId=NULL) дублируются: `@@unique([tenantId,kind,refId])` не защищает (NULL distinct в PG) → фрагментация закрытой памяти; тот же класс у support-kind | partial-unique `(tenantId,kind) WHERE refId IS NULL` (NULLS NOT DISTINCT) → оживит catch(P2002) | K1 |
| Б19 | ingest | `block-ingest.worker.ts:629-651` | fallback Decision-create обходит гейт `typedEntityMinConfidence` → в граф попадают «решения» ниже порога доверия | `if (block.confidence < minConfidence) continue` перед upsertEntity | K14 |
| Б20 | ingest | `entity-resolution.service.ts:843-850` | linkEntityPerson/linkPersonEntity берут первое совпадение по имени → неверная атрибуция при тёзках | при >1 совпадении не линковать | K3 |
| Б21 | ingest | `segment-builder.service.ts:302-316` | одиночный сверхдлинный turn уходит в LLM-окно без усечения → таймаут/обрезка JSON → потеря всего окна | резать длинный turn посимвольно ЛИБО лимит окна по символам | K13 |
| Б22 | ingest | `block-ingest.worker.ts:684-719` | Idea direct-path: create без БД-уникальности по sourceBlockIds (read-then-write) → дубль при reprocess-suffix | детерминированный ключ Idea + `@@unique` + create/catch(P2002) ЛИБО find+create в одной tx | K4 |
| Б23 | persona | `executable-persona-build.service.ts:484` | buildForRole создаёт role-персону без roleVersion/currentBearerPersonId/publicName/succeedsPersonaId → версии схлопываются в v1, имя носителя пустое | вычислять эти поля (как handler) ЛИБО версионирование роли только в handler | K11 |
| Б24 | persona | `executable-persona-build.service.ts:767` | гонка nextVersion + NULL в `@@unique` (profileId=NULL для role) → дубли версий и две active role-персоны | partial-unique по `(scope,scopeRefId,version) WHERE scope='role'` и `(scope,scopeRefId) WHERE status='active'` + сериализация | K1,K11 |
| Б25 | persona/chat-v2 | `chat-v2.service.ts:1498` | counter-evidence игнорирует `validAt` → «факты из будущего» в темпоральном вопросе «что знали тогда» | прокинуть validAt (+temporal-фильтр) в `loadContradictingBlocks` | K8 |
| Б26 | chat-v2 | `chat-v2-retrieval.service.ts:356` | pool-запросы `take 5000/1000` без orderBy → случайное подмножество кандидатов, ответы нестабильны (противоречит комментарию про ORDER BY cosine) | orderBy перед take; для org-scope — pgvector `ORDER BY embedding<=>qvec LIMIT topK` по HNSW | K3 |
| Б27 | specialist | `specialist-3-5-insights.service.ts:142` | нет детерминированного дедупа Insight → дубли при ретрае/промахе KNN | pre-check `insight.findFirst({sourceBlockIds:{has:block.id}})` перед KNN | K4 |
| Б28 | supersede/temporal | `temporal-probe.service.ts:192-203` | `escalateAfterWeeks*7 == PROBE_EXPIRY_DAYS` → probe становится эскалируемым ровно в момент протухания → эскалация почти не срабатывает | развести: порог эскалации строго < expiryDays ЛИБО выбирать и недавно-expired | K6 |
| Б29 | cost | `entity-resolver.cron.ts:107-133` | re-LLM «distinct»-пары каждые 5 мин без негативного маркера → раннавей-расход | персистить негативный вердикт (таблица/Redis negative-cache) + `NOT EXISTS` в выборке | K6 |
| Б30 | cost | `entity-graph.service.ts:192-252` | ежечасно re-LLM топ-50 co-mentioned пар даже при существующем EntityLink (~1200 вызовов/сутки/Org) | `AND NOT EXISTS EntityLink свежее N дней` ЛИБО last-judged timestamp | K6 |
| Б31 | cost | `executable-persona-trigger-watcher.cron.ts:188-202` | max_age форсит полный LLM-compile каждые ~48ч даже без новых черт | хэш входа (includedTraitIds) vs last active → совпало: продлить TTL без LLM | K6 |
| Б32 | cost | `meeting-report-fast.worker.ts:272-292` | внутренний ретрай ×3 × BullMQ attempts ×5 = до 15 дорогих LLM-вызовов на встречу при деградации провайдера | при исчерпании внутреннего цикла НЕ throw (пометить failed) ЛИБО attempts=1-2 + idempotent short-circuit | K6 |
| Б33 | cost | `core-queue/queues.ts:205-210` | дедуп по jobId опирается на `removeOnComplete count:1000` → на нагруженной очереди completed вытесняется → повторная дорогая обработка | убрать/поднять count где дедуп критичен ЛИБО persistent idempotency-guard в воркере | K6 |
| Б34 | idempotency | `specialist-3-14-goals.service.ts:528-568` | дедуп Goal по ILIKE без orderBy + нет source-block guard → дубли целей | **решается task-dedup Ф5** (Goal.embedding+KNN заменяет ILIKE) + source-block guard | K4→**C(Ф5)** |
| Б35 | idempotency | `core-queue.service.ts:231-251` | jobId с reason-суффиксом обходит дедуп → параллельные meeting-report-fast на одну встречу (lost-update) | не варьировать jobId по reason; remove прошлый job ЛИБО Redis-лок на meetingId | K7 |
| Б36 | idempotency | `block-distill.worker.ts:192-224` | `router.dispatch` после commit canonical, ошибки проглочены → специалисты не запускаются, повтор невозможен (status уже canonical). Класс — 3 вхождения (markCanonical/mergeInto/swapDirection) | throw до смены статуса (BullMQ ретрай) ЛИБО reconcile-cron canonical-без-проекций | K7 |
| Б37 | idempotency | `block-ingest.worker.ts:697-749` | Idea direct-path без triage/curation (расходится с Specialist 3.6) → разный набор полей/видимость одинаковых Idea | вызвать triageProposed для direct-path Idea без CurationItem ЛИБО зафиксировать инвариант | K4 |
| Б38 | parse-contract | `block-extraction.service.ts:481` | при одном невалидном блоке Zod-массив падает целиком → теряется всё окно (валидные блоки + типизированные сущности) | поэлементный parse (`safeParse` на item), отбрасывать только битые, метрика отброшенных | K12 |
| Б39 | parse-contract | `idea-clusterer.cron.ts:128` | остаток накопителя < minSupporters никогда не кластеризуется (вечные orphan-идеи) | финальный flush с осознанным поведением хвоста ЛИБО пометка 'pending_cluster' + метрика | K10 |
| Б40 | parse-contract | `specialist-3-3-decisions.service.ts:700` | supersede-арбитр: голый `JSON.parse as SupersedeVerdict` → невалидный verdict тихо трактуется как 'new' (потеря supersede-намерения) | Zod `z.enum(['new','merge','supersedes'])` + метрика invalid + осознанный fallback | K12 |

### 3.3 LOW (19)

| id | область | `file:line` | суть | фикс | класс |
|---|---|---|---|---|---|
| Б41 | card-rollup | `specialist-3-4-card-handler.service.ts:86` | 2× findMany карточек take без orderBy → недетерминированный отбор для chat-v2 | orderBy `[confidence desc, lastConfirmedAt desc, id asc]` | K3 |
| Б42 | card-rollup | `specialist-3-4-project-customer.worker.ts:154` | card.findMany take:200 без orderBy → часть карточек без rollup | orderBy `[lastConfirmedAt asc, id asc]` ЛИБО курсор | K3 |
| Б43 | card-rollup | `specialist-3-4-card-handler.service.ts:93` | промежуточный ideaBlockEntity без tenantId (утечки нет, нарушен задокументированный инвариант) | `block:{tenantId}` в where | K2 |
| Б44 | dedup-distill | `entity-resolution.service.ts:249` | KNN-reuse не переносит strong-IDs/не повышает dataClass (в отличие от strong-hit/exact веток) → дубль по ИНН позже | backfill пустых strong-полей в KNN-ветке (как exact) | K4 |
| Б45 | graph-links | `temporal-conflict.service.ts:217` | docstring заявляет пару manages↔reports_to, в Map её нет → код vs комментарий | убрать упоминание из docstring (или реализовать) | K2 |
| Б46 | persona | `executable-persona-versioning.service.ts:63` | Redis-замок берётся ДО pre-check и не освобождается → легитимные пересборки подавлены на TTL (до 60 мин) после холостого триггера | releaseLock во всех ветках без snapshot ЛИБО брать замок после pre-check | K11 |
| Б47 | persona | `role-clone-persona-versioning.handler.ts:240` | post-build supersede холостой (buildForRole уже погасил pending_rebuild) → 0 affected, лог вводит в заблуждение | убрать холостой updateMany ЛИБО не создавать pending_rebuild до немедленной пересборки | K11 |
| Б48 | specialist | `specialist-3-3-decisions.service.ts:133` | нет source-block дедупа (docstring обещает идемпотентность) → дубль Decision при промахе KNN/re-dispatch | guard `decision.findFirst({sourceBlockIds:{has:blockId}})` → mergeIntoExisting | K4 |
| Б49 | specialist | `specialist-3-3-decisions.service.ts:264` | supersedes-ветка: 4 записи без транзакции → рассинхрон статусов/дубль при сбое | обернуть create+update(superseded) в `$transaction` | K4,K7 |
| Б50 | specialist | `specialist-combined.service.ts:309` | combined persist без дедупа/идемпотентности → дубли при ON-флаге/ретрае (путь дремлет — латентно) | дедуп по sourceBlockId ЛИБО инвариант «combined и per-block взаимоисключающи» | K4 |
| Б51 | supersede/temporal | `temporal-probe.service.ts:97-117` | stale-кандидаты take без orderBy → произвольная выборка, древние факты могут не дочищаться | `orderBy {validFrom:'asc'}` | K3 |
| Б52 | supersede/temporal | `temporal-conflict.service.ts:215-230` | дубль Б45 в другом ридере: комментарий manages↔reports_to vs Map | привести комментарий к коду | K2 |
| Б53 | supersede/temporal | `temporal-conflict.service.ts:55-68` | конфликты закрываются только при совпадении направления (from,to) → пропуск при инвертированной связи. Класс — onNewBlockLink + onNewEntityLink | искать existing в обе стороны (OR from/to swap) ЛИБО нормализовать направление | K2 |
| Б54 | cost | `router.service.ts:547-558` | LLM-fallback не кэширует негативный результат при llm_error → шторм вызовов при сбое (флаг OFF по умолч.) | negative-TTL в Redis в catch ЛИБО circuit-breaker | K6 |
| Б55 | cost | `executable-persona-versioning.service.ts:23` | docstring «каждые 15 минут» vs реальный `@Cron('0 */2 * * *')` | привести docstring к факту | K2 |
| Б56 | idempotency | `curation/services/curation.service.ts:390-392` | triage не идемпотентен → дубль CurationItem при ретрае (раздувает «Подтверждения N») | findFirst pending перед create ЛИБО partial-unique + upsert | K4 |
| Б57 | parse-contract | `specialist-combined.service.ts:490,545` | sourceBlockId через `push` без дедупа → массив провенанса растёт дублями (vs single-путь `set:union`) | заменить `push` на `set:union(existing,[id])` | K4 |
| Б58 | parse-contract | `specialist-combined.service.ts:321` | cast статуса Decision сужает enum (теряет 'cancelled') → combined не пишет cancelled (vs single) | согласовать Zod/JSON-schema/каст с `DecisionStatus` | K12 |
| Б59 | parse-contract | `specialist-3-5-insights.service.ts:766` | insight-link: голый `JSON.parse` без `Array.isArray` → кривая форма тихо даёт пустой список (связки теряются) | guard `Array.isArray(parsed?.linkedDecisionIds)` + метрика; лучше Zod | K12 |

### 3.4 Опровергнуто (23 — НЕ перепроверять)

Скептик закрыл трассой; severity не присваивается. Кратко (полные причины — в прогоне аудита):

- **O1** fallback Decision confidence не capped — гард A capped выше по стеку.
- **O2** Idea direct-path дрейф метрики при ретрае — idempotency-гард в начале `process()` (status!=='received' skip).
- **O3** classifyTypedFailReason ложно age_unavailable — механизм верен, но это намеренный ретрай AGE, не баг.
- **O4** AxisClassifier без tenantId — структурная защита (classify грузит блок и выходит при tenant-mismatch).
- **O5** findExactByLowerName seq-scan/расхождение нормализации — create пишет normalized, расхождения нет.
- **O6** entity-resolver устаревший контекст target — контекст кандидата перезагружается каждую итерацию.
- **O7** weighted-avg confidence дрейф — `@db.Decimal(4,3)` квантует, toFixed(3) no-op.
- **O8** docstring «canonicalId в кандидатах» в tx — guard выше по стеку (parseVerdict), неточность дока.
- **O9/O17/O18/O19** findCoMentioned/findRecentShared/collectPersonSubjects без tenantId — ids приходят из tenant-scoped SQL, утечка недостижима.
- **O10** attachToCluster RMW гонка — конкурентного писателя нет (очередь без consumer, Б9).
- **O11** ThemeEntity.mentionsCount семантика — ни один потребитель не страдает.
- **O12/O23** resolveMeetingId без tenantId — запросы по глобально-уникальным CUID PK.
- **O13/O14** escalateUnanswered не помечает probe / take без orderBy — дедуп по contentHash + нет постоянного голодания (но см. Б28/Б51 — реальные смежные).
- **O15** статический confidence=0.9 «убивает» card-rollup пути — card не critical, путь 'auto' жив.
- **O16** idea_shipped recognition дубль — есть другой слой идемпотентности помимо jobId.
- **O20/O21** две Idea/дубль Decision direct-path vs Specialist — happens-before по конвейеру / `@unique sourceIdeaBlockId` (последнее — корень Б3).
- **O22** idea-clusterer jobId-bucket теряет события — у очереди нет consumer'а (предпосылка ложна, см. Б9).

---

## 4. Карта классов (чинить разом + машинный гард)

| Класс | Что | Баги | Системный фикс + гард |
|---|---|---|---|
| **K1** | NULL в `@@unique` / нет partial-unique → гонка дублей | Б7, Б18, Б24 | partial-unique индексы в `postgres-init.sql` (DO-блок) + обработка P2002→re-find. Гард: тест «два конкурентных create → одна строка» |
| **K2** | soft-delete/revive/gate/комментарий расходятся | Б2(high), Б16, Б17, Б43, Б45, Б52, Б53, Б55 | единый контракт чтения (`deletedAt:null` везде) + WorkerOrgGate во всех cron; синхронизировать docstring↔Map |
| **K3** | `take/find` без `orderBy` → недетерминизм | Б15, Б20, Б26, Б41, Б42, Б51 | детерминированный orderBy перед каждым take/курсор; для recall — pgvector ORDER BY по HNSW |
| **K4** | нет детерминированного source-block дедупа на специалистах | Б3(high), Б11, Б22, Б27, Б34→C, Б37, Б44, Б48, Б49, Б50, Б56, Б57 | guard `findFirst({sourceBlockIds:{has:block.id}})` ПЕРЕД KNN/create во ВСЕХ специалистах + (где есть ключ) `@@unique` |
| **K5** | dataClass downgrade при merge/арбитре | Б12, Б13 | `dataClass=maxDataClass(...)` в judgeMerge и в tx mergeInto/swapDirection |
| **K6** | cost-runaway (re-LLM/умножение ретраев) | Б14, Б28, Б29, Б30, Б31, Б32, Б33, Б54 | негативный кэш/`NOT EXISTS`-исключение уже-судёных пар; согласовать вложенные ретраи × BullMQ attempts; хэш-короткозамыкание compile |
| **K7** | нетранзакционная мульти-запись / порядок commit→enqueue | Б1(high), Б4(high), Б35, Б36, Б49 | атомарность перехода состояния (`$transaction` без catch-P2002-внутри); reconcile-cron на разрывах (draft-без-distill, canonical-без-проекций) |
| **K8** | temporal `validAt` не применён | Б25 | прокинуть validAt во все ветки retrieval (counter-evidence) |
| **K9** | card-rollup provisional/конфликт | Б5, Б6 | применять Card для provisional; конфликт только при `applied` |
| **K10** | мёртвый код кластеризации | Б8, Б9, Б10, Б39 | решить судьбу очереди idea-clusterer; писать embedding кластера; гард уникальности блок↔тема; flush хвоста |
| **K11** | persona role versioning рассинхрон | Б23, Б24, Б46, Б47 | единый путь версионирования роли (handler), partial-unique, корректный lifecycle замка |
| **K12** | парсинг LLM-ответа без валидации (тихая потеря) | Б38, Б40, Б58, Б59 | **Zod safeParse везде** где сейчас голый `JSON.parse`/cast; поэлементный parse массивов; согласовать enum. **Катить вместе с правкой промпта (§5)** |
| **K13** | сегментация/окно | Б21 | усечение длинного turn / лимит окна по символам |
| **K14** | обход гейта качества | Б19 | fallback подчиняется тому же `minConfidence` |

---

## 5. Сквозные связки (главное — что катить ВМЕСТЕ)

1. **K12 (парсинг) ↔ Пласт A (промпты).** Правка промпта добавляет мэппинг «ярлык→латинский enum».
   Если выкатить промпт БЕЗ код-фикса парсинга — модель отдаёт корректный код, но код его роняет/глотает.
   Катить парами в одной волне:
   - **Б40** (Zod-валидация verdict supersede) ⨯ `dedup-supersede` E1 (decision-supersede-detect).
   - **Б58** (enum decision-status cast) ⨯ `ingest-prompts` B3 (специалист-routing/combined).
   - **Б59** (insight-link `Array.isArray`) ⨯ `linking` E3 (insight-link-to-decisions).
   - **Б38** (поэлементный parse блоков) ⨯ `ingest-prompts` A1 (block-ingest).
2. **Б34 (дубли целей) → решается task-dedup Ф5.** Отдельно НЕ чинить: Ф5 даёт `Goal.embedding`+KNN
   взамен ILIKE. В рамках Ф5 добавить и source-block guard (часть K4).
3. **Б3 / Б48 / Б49 (Specialist 3.3 decisions) ↔ task-dedup Ф4.** Ф4 правит ветку `verdict='supersedes'`
   в ТОМ ЖЕ файле (`specialist-3-3-decisions.service.ts`). Делать вместе: при заходе в Ф4 заодно
   обернуть supersede в транзакцию (Б49), добавить source-block guard (Б48) и обогащение при коллизии (Б3).
4. **Б33 / Б35 / Б36 (jobId-дедуп/идемпотентность очередей)** — общий корень с пробелом **G5**
   (системный обзор attempts/removeOnFail по всем ~25 очередям). Чинить как единый проход по очередям.
5. **Б2 / Б16 / Б53 (soft-delete рёбер графа)** — один контракт чтения/записи рёбер; править разом (K2).

---

## 6. План волн (порядок для исполняющей сессии)

Между волнами: зелёная верификация (`typecheck`+`build`+затронутые `vitest`) → commit → следующая
волна. `git push` — только с подтверждением владельца (после каждой волны или по согласованию).

- **Волна 0 — фундамент промптов.** Пласт A Ф4-pre: `signal-type-label.ts` + словари ярлыков +
  обёртки `common.ts`. Без него остальные промпты не складываются. (Только инфраструктура, без выката текстов.)
- **Волна 1 — HIGH аудит-фиксы (Б1–Б4).** Данные теряются/утекают сейчас. Б1 — мини-e2e на abort
  транзакции перед фиксом (скептик уже подтвердил — но перепроверить на текущем драйвере). Б2 — класс
  из 6 ридеров. Б3/Б4 — guard + reconcile-cron.
- **Волна 2 — промпты + парные парс-фиксы (Пласт A + K12).** Переносить 31 промпт пачка за пачкой
  (6 ТЗ), и в тех же коммитах — Б38/Б40/Б58/Б59 (§5.1). Snapshot-апдейты. Статусы 🟡→🟢 после выката.
- **Волна 3 — MED классами.** Порядок по радиусу: K1 (partial-unique индексы) → K7 (атомарность/reconcile)
  → K2 (soft-delete/gate) → K4 (source-block дедуп) → K6 (cost-runaway) → K5/K8/K9/K10/K11/K13/K14.
- **Волна 4 — task-dedup ТЗ (Пласт C, Ф0→Ф5).** По своему [orchestrator-prompt](2026-06-16-task-dedup-and-tracker-reconcile-orchestrator-prompt.md).
  Координация §5.2/§5.3: Ф4 вместе с Б3/Б48/Б49, Ф5 поглощает Б34.
- **Волна 5 — LOW (Б41–Б59 остаток).** Дешёвые детерминизм/докстринги/идемпотентность.
- **Волна 6 — пробелы покрытия (G1–G8): доисследование, НЕ слепой фикс.** Это «что рой не проверил»,
  каждый сначала верифицировать (как находку), потом чинить. **G1 — потенциально HIGH (выручка):**
  обход платного `feature.graph` через `/entities/:id/graph` и `/blocks/:id/links` без entitlement +
  неограниченный `mark-wrong` (раздувает обучающий датасет). Поднять первым из G.

### Пробелы покрытия (G1–G8 — вход для следующего раунда аудита)

| id | что не покрыто | где смотреть |
|---|---|---|
| G1 ⚠️выручка | непоследовательный entitlement-гейтинг REST: обход `feature.graph` через `/entities/:id/graph`, `/blocks/:id/links`; `mark-wrong` без rate-limit | `graph.controller.ts:58` vs `entities.controller.ts:377`, `blocks.controller.ts:234,359`, `entities.controller.ts:646` |
| G2 | размерность/чистота эмбеддинга на READ-пути (toVectorLiteral без NaN/length-guard) → 500 на каждом /search при смене модели | `embedding.service.ts:42-47`, `api/search.service.ts:352-354,199-200` |
| G3 | N+1 в графовых BFS-ручках (до ~300 послед. запросов в одном HTTP) → исчерпание пула | `graph.controller.ts:149-180,242-255`, `reasoning-chain.service.ts:131-205` (батчит — сравнить) |
| G4 | под-домен experiment/process-детекторов (идемпотентность версий, гонка status-cron, дедуп) | `experiment-detector.worker.ts:115`, `specialist-3-9-experiments.service.ts`, `experiment-status-resolver.cron.ts`, `experiment-transitions.cron.ts`, `process-template-completeness.cron.ts` |
| G5 | конфиг очередей: removeOnFail/DLQ/backoff/attempts системно по всем ~25 очередям (связка с Б32/Б33) | `knowledge-core.module.ts`, `core-queue/queues.ts`, `CoreQueueService` |
| G6 | goal/strategic crons (goal-task-linker, goal-theme-linker, strategic-alignment, idea-status-auto-advance vs ручной статус) | `goal-task-linker.cron.ts`, `goal-theme-linker.cron.ts`, `idea-status-auto-advance.service.ts`, `strategic-alignment.cron.ts` |
| G7 | слой обучения/калибровки (preference-dataset дубли, confidence-calibration batch vs admin-edited, projection-rebuilder атомарность) | `preference-dataset.service.ts`, `confidence-calibration.service.ts/.cron.ts`, `projection-rebuilder.service.ts` |
| G8 | темпоральная семантика snapshot (асимметрия deletedAt: рёбра фильтруются, блоки нет; future-`at`) | `snapshot.service.ts:155-186` vs `:194-205`; `snapshot.controller.ts` |

---

## 7. Idempotency / миграции / prod-deploy (агрегат)

- **Prisma:** новые partial-unique (K1: KnowledgeGroup, ConflictItem, ExecutablePersona role) — версионируемые
  миграции (`prisma:migrate`), сами индексы с `WHERE`/`NULLS NOT DISTINCT` — в `postgres-init.sql`
  (Prisma не умеет partial). После правок моделей — `prisma:generate`.
- **Новые cron/reconcile** (Б4 draft-distill, Б36 canonical-проекции): per-Org, kill-switch ON, идемпотентны
  (повтор = no-op как acceptance) → `prod-deploy-log.md` Шаг 12 (smoke) + регистрация в `apply-prod-deploy.ts STEPS`.
- **task-dedup (C):** свой prod-блок — см. его ТЗ §12 (модель `TaskClosureCandidate`, колонки `Issue.closureReview*`,
  `Goal.embedding`+HNSW, backfill целей, новые taskType `task-dedup-arbiter`/`task-closure-verify`).
- **Промпты (A):** прод-операций по БД нет; выкат = деплой кода + обновлённые snapshot-тесты.
- После каждого push — блок «📋 Prod-инструкция» в чат (diff команд) + строки в `docs/operations/prod-deploy-log.md`.

## 8. DoD (общий)

- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные.
- `bunx vitest run` по затронутым файлам — зелёные; snapshot промптов обновлены.
- Каждый закрытый баг: `file:line` перечитан по якорю, фикс закрывает КЛАСС (где помечено), есть машинный гард/тест.
- second-brain обновлён по таблице производных заметок (data-model при новых индексах/моделях; workers-queues при
  reconcile-cron; ai-jobs при новых taskType); `prod-deploy-log.md` + `feature-flags.md` при затронутых schema/scripts/ENV/флагах.
- Рефлексия записана; реестр не-сделано обновлён (строка-указатель на этот файл закрывается по мере волн).

## 9. Итог
_(заполняет исполняющая сессия по завершении волн: что реализовано, что осталось, что отложено.)_
