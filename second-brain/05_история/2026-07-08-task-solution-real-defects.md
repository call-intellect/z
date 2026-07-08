---
type: reflection
date: 2026-07-08
feature: task-solution-real-defects
tz: plans/tz/2026-07-08-task-solution-real-defects.md
analysis: plans/analysis/2026-07-08-task-solution-materializer-weakness-audit.md
---

# Рефлексия — TaskSolution: реальные дефекты (E · B · C · A · D)

## Что было поставлено
Закрыть ВСЕ дефекты материализатора «Решений задач» из ТЗ `2026-07-08-task-solution-real-defects`:
Блок E (судья + e2e-режим стенда), B (атрибуция владельца), C (повтор/рецидив), A (захват с любого
источника — ядро), D (субъекты/текст). Красная зона R1/R2/R3/R6/R7 + жёлтые Y4-Y13. Каждый блок — в прод
включённым (Ship-On), с доказательством на стенде; детекция/повтор (R1/R6/R7) — доказуемы ТОЛЬКО через
новый e2e-режим (хардкод-вход даёт ложную зелень).

## Как решал (файлы, коммиты)

**Порядок E → (крутилки) → B → C → A → D → E2/C2** (сначала весь код, что доказуем на synth-стенде, потом
e2e-харнесс как проверочная площадка для A1/A2/C1).

- **E1** (`regulation-stand/judge.ts`, `types.ts`, `report.ts`): вынес голос-за-линзу в retry-цикл
  (`voteForLens`, до 3 попыток + рост maxTokens + валидация полей `parseVote`); `consensus` — строгая
  плюральность, ничья лидера → `no-quorum` (убрал баг «good бьёт flawed по порядку перебора»);
  `lostVotes` в `JudgedScenario` + видимость потерянных голосов в отчёте.
- **Крутилки** (3): `taskSolution.howSolvedSignalTypes` (массив, A2), `taskSolution.ownerInferenceEnabled`
  (kill-switch, B2), `taskSolution.maxPlaceholderRatio` (T-ось, D4) → `admin-setting-schema-registry.ts` +
  `seed-admin-setting-task-solution.ts` + `feature-flags.md` + `prod-deploy-log.md` (Шаги 1/4/7) +
  `apply-prod-deploy.ts` hint + KNOBS стенда.
- **B** (`task-solution-build.service.ts`, `+spec`, миграция `20260708120000_add_task_solution_owner_audit`):
  переписал `buildOne` (реордер: блоки → гейт длины → existing → newBlockIds → рефайнер(**дельта** новых
  блоков) → D3-гейт → резолв solver-персон с **context** (D1) → owner(B1/B2/B3) → subjects(union) →
  компилятор → транзакция). Новые хелперы `resolveAssigneePersonIds` (orderBy id), `pickAssigneeOwner`
  (детерминизм + solver-дизамбигуация), `resolveSolverPersonIds` (context), `buildOwnerAudit`.
  B1: нет assignee + ровно один решатель → owner=решатель + `ownerAudit`. B2: assignee∉solvers + ровно один
  решатель (под kill-switch) → owner=решатель + аудит расхождения. B4: на update owner **заморожен**
  (=existing.ownerPersonId, не пишется), `personSubjectIds` — **union** (не replace). +7 unit-тестов.
  B5: 4 adversarial-сценария в отдельных extra-JSON (`regulation-stand-corpus-a5-owner.json` +
  `-ruler-a5-owner.json`), подмёрж в `loadA5Cases`; мульти-assignee поддержка в сидере.
- **C1** (`task-solution-build.service.ts`): детекция и сбор блоков вынесены в `detectCandidateIssueIds` /
  `gatherSolutionBlockIds` — окно по `GREATEST(COALESCE(IdeaBlockEvidence.sourceTimestamp, RawEvent.occurredAt),
  RawEvent.occurredAt)`, НЕ по `IdeaBlock.createdAt` (рецидив мержится в старый canonical). **C3**
  (`block-ingest.worker.ts`): `applySignalTypeHint` теперь мутирует ВСЕ блоки ответа, не только `[0]`.
- **A1/A2** (`task-solution-build.service.ts`): детекция = probe(`contextCardId`) ∪ `TaskClosureCandidate`
  (status pending/accepted, createdAt в окне); сбор блоков — probe ∪ candidate-matched (резолв merged→canonical);
  candidate-путь НЕ фильтрует по signalType (сам матч — гейт), поэтому `task_completed/done_item` попадают в
  материал (A2). Крутилка `howSolvedSignalTypes` — только для probe-пути.
- **D2** (`structured-document-compiler.prompt.ts` + `.service.ts`): отдельный `buildTaskSolutionSystemPrompt`
  БЕЗ правила роль-аннотации (solver=владелец) и с необязательным §4 (нет граблей — раздел опускаем, не
  плейсхолдером); ветвление `compile()` по `kind==='task_solution'`. Общий компилятор регламентов НЕ трогал.
  **D3**: дельта-гейт (`refineBlocks` = только новые блоки на update) — отписка поверх решения → skippedNoMethod,
  Δверсии=0. **D4** (`report.ts`, `types.ts`, `seed-reg-feed.ts`): T-ось (доля строк-плейсхолдеров) отдельной
  секцией + проброс `compiled.signals` в наблюдение.
- **E2/C2** (`regulation-stand/e2e.ts` — новый, `stub-embedder.ts`, `stand.ts` режим `e2e`): детерминированный
  стаб-эмбеддер (**1536d**, bag-of-tokens hashing + L2) через единый шлюз `EmbeddingFallbackService.embed`;
  e2e гоняет РЕАЛЬНЫЙ конвейер — block-ingest `process({data:{rawEventId}})` на сыром чате (без хардкод-signalType,
  без contextCardId) → `TaskCompletionHandler.handle()` матчит блок к открытой задаче (Issue.embedding засеян
  под текст блока → distance≈0) → `TaskSolutionBuildService.runForOrg` материализует по кандидату. C2: стаб в
  synth-стенде → `embeddingsWritten>0`; `match.ts` — embeddings=0 при репит-сценарии = жёсткий FAIL (не тихий N/A).

## Что вышло (верификация)
- **typecheck зелёный** (после каждого блока).
- **unit:** `task-solution-build.service.spec.ts` 25/25 (в т.ч. новые B1/B2/B3, обновлённый D3-гейт);
  `structured-document-compiler.service.spec.ts` 6/6.
- **integration** (реальная dev-Postgres): `task-solution-build.integration.spec.ts` 3/3 — новый SQL
  (UNION probe∪TaskClosureCandidate + окно GREATEST) валиден.
- **synth-стенд A5: PASS 16/16 · FAIL 0 · N/A 0** (baseline был 11/12 + A5.7 N/A). Все 4 B5-сценария PASS
  (owner_is_solver 13/13 с ВЫВЕДЕННЫМИ владельцами — тавтология сломана), A5.7 доказуема (embeddingsWritten=15),
  T-ось средняя доля плейсхолдеров 2% (0/13 сверх порога), судья 0 потерянных голосов, идемпотентность Δ=0.
- **e2e-стенд: PASS 5/5** — A1 (block-ingest классифицировал `task_completed` из сырого чата), матч
  (TaskClosureCandidate sim=1), материализация через матч без contextCardId (owner=Иван); C1 (рецидив в старый
  canonical со свежим evidence → в окне; реально старьё → вне окна).

## Чему научился
- **`schema.prisma` врёт про размерность вектора.** Колонки `Unsupported("vector(768)")`, но реально
  **1536** (миграции + `EMBEDDING_DIMENSIONS`). 768-стаб → `::vector(1536)` mismatch → тихий
  `embeddingsWritten=0` в best-effort try/catch → A5.7 FAIL. Записал в [[code-pitfalls]]. Стоило одного
  прогона.
- **Единый шлюз эмбеддингов** — `EmbeddingFallbackService.embed`: block-ingest, KnowledgeEmbeddingService,
  closure-handler, Issue/TaskSolution — все через него. Monkey-patch одной строкой в харнессе покрывает всё.
- **e2e без BullMQ:** приватный `BlockIngestWorker.process({data:{rawEventId}})` вызывается напрямую (нужен
  лишь RawEvent в статусе `received`); `TaskCompletionHandler.handle()` — тоже прямой awaited-вызов (через
  `eventEmitter.emit` был бы fire-and-forget).
- **B2 (owner-inference) — реальный риск на guard-сценариях:** LLM-мисатрибуция могла бы флипнуть владельца.
  Митигировано: флип только при assignee∉solvers И ровно одном решателе, под kill-switch, доказано на 4
  adversarial-сценариях ДО выката. На synth (реальный LLM) сторожа `a5-ownership-solver`/`a5-owner-not-mentioner`
  не регрессировали.
- **Эталон на русском склонении хрупок:** `contentMustContain "проверка восстановления"` (им.п.) провалился на
  корректном «проверку восстановления» (вин.п.). Фикс — стем «восстановлени». Точный substring для LLM-вывода
  ненадёжен.
- **Стаб-эмбеддер даёт умеренный cosine** (bag-of-tokens): репит-тексты 0.3–0.6, несвязанные 0.0. Для стенда
  `repeatSimilarity` подстроен под геометрию стаба (0.25), прод-дефолт 0.85 в сиде не трогал. Closure-матч —
  засев Issue.embedding под текст блока (distance≈0), т.к. distance-порог 0.18 в `findSimilarByVector` захардкожен.

## Осталось / открыто
- **Retro-after-close не захватывается:** A1 переиспользует `TaskClosureCandidate`, а closure-handler матчит
  только среди открытых задач (`completedAt IS NULL`). «Как решили», рассказанное ПОСЛЕ закрытия задачи, не
  породит кандидата → не материализуется. Архитектура запретила трогать петлю закрытия; окно «открытые +
  недавно закрытые» отложено. → строка в `04_не-сделано`.
- **B4 полная заморозка владельца на update** (вместо разрешённого ТЗ B2-переинференса на update с аудитом) —
  выбрана как более безопасная (нет owner-churn). Если понадобится корректировать первично-ошибочную
  атрибуцию на поздних прогонах — вернуться.
