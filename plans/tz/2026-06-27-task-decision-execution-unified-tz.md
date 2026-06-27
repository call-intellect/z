---
type: tz
status: ready-to-implement
feature: task-decision-execution-unified
date: 2026-06-27
owner: sergrv80@gmail.com
relates_to:
  - plans/analysis/2026-06-27-task-decision-dashboard-control-model.md
  - plans/analysis/2026-06-27-task-progress-execution-feed.md
  - plans/analysis/2026-06-27-qa-extraction-fresh-findings.md
  - plans/analysis/2026-06-21-modular-dashboards-and-execution-focus.md
  - plans/tz/2026-06-25-task-decision-disambiguation.md
  - plans/tz/2026-06-25-knowledge-graph-hygiene.md
  - plans/tz/2026-06-08-agents-daily-value-engine.md
---
> Анализ: `plans/analysis/2026-06-27-task-decision-dashboard-control-model.md` + `…-task-progress-execution-feed.md` + свежие QA-находки `…-qa-extraction-fresh-findings.md`. Модель залочена владельцем 2026-06-27.

# ТЗ: задача / решение / идея — починка извлечения + сквозное исполнение + журнал хода (комплексное)

## Цель

Сделать жизненный цикл «разговор → знание → исполнение → закрытие» рабочим и непротиворечивым:
1. **Починить извлечение задач** (сейчас сломано на 100% — краш Prisma 7).
2. **Чётко развести три класса:** идея (предложение) / задача (поручение) / решение (выбор) — с контрастными примерами; перестать схлопывать предложение+поручение в одно решение.
3. **Снять вилку «задача ИЛИ решение» с пути исполнения** (две оси): actionable всегда доезжает до трекера как задача, авто, через дедуп; решение остаётся в памяти.
4. **Дашборд-контроля — на исполнении**; решения — источник задач + недельный индикатор-утечка.
5. **Журнал хода** задачи из бесед + рабочее **закрытие** задачи по сигналу из разговора (сейчас не доходит).
6. **Надёжность пайплайна** — не терять RawEvent на сбоях LLM (флап block-ingest), защитить парсинг JSON воркеров.

## Зачем (болезненное состояние, доказано свежим QA на «ооо ромашка» 2026-06-27)

- **Задачи в трекер не попадают ВООБЩЕ:** `specialist-3-15-tasks` крашится на advisory-lock (Prisma 7 `void`) → issues/intake дельта 0; все action items осели только блоками-обязательствами. `[verified: прод-логи diag]`
- «exponential backoff» (предложение Анны + поручение Михаила) стал ОДНИМ решением — предложение не стало идеей, задача не создана. `[verified: реестр решений]`
- «отдельную задачу пока не завожу» (бытовое не-действие) материализовалось решением — шум в реестре. `[verified]`
- Закрытие задачи из разговора не доходит до `TaskClosureCandidate` (нет `completion_signalled`/`done_item`-роутинга + флап embed). `[verified: pending-actions пуст, логи]`
- 160 ошибок/день в проде: block-ingest LLM-флап (21 — теряются RawEvent), StrategicAlignmentWorker битый JSON (12). `[verified: diag logs]`
- Концептуальный корень task/decision — категориальная ошибка (взаимоисключающий ярлык вместо двух осей), анализ §2.

## REALITY-CHECK (по коду на 2026-06-27)

**Уже работает (переиспользуем):**
- AI-задачи идут через `IntakeIssue` → `IntakeAutoTriageWorker` (авто-приём при `confidence ≥ tracker.autoAcceptConfidenceThreshold` И `source ∈ intake.autoAcceptSources` И нет дубля; дубль/низкая уверенность → человек). Это и есть «авто-создание, гейт при сомнении».
- Дедуп: `TaskDedupService.evaluate` → `SimilarIssuesService.findSimilarByVector({openOnly})` (HNSW), порог `taskDedup.suggestThreshold` (0.88, AdminSetting).
- `DecisionTaskLink(linkType='derived')` авто-создаётся при пересечении `IntakeIssue.sourceBlockIds` с `Decision.sourceBlockIds` (см. `///` поля `IntakeIssue.sourceBlockIds`).
- Разграничение классов **частично есть**: `block-ingest.prompt.ts` (правила idea/decision/action_item, :346-435, включая АНТИ-ДУБЛЬ :418 и АНТИ-ПОТЕРЯ :419) + реализованный `prompts/task-decision-examples.ts` (пары решение↔задача из ТЗ 2026-06-25).
- Журнал: модель `IssueProgressUpdate` есть; кормит `progress-auto-draft.cron` только из завершений+ручного.
- Завершение: `TaskCompletionHandler` слушает `task.completion_signalled` (эмит `router.service.ts:397-419`) → KNN → `TaskClosureCandidate(pending)`, без авто-закрытия (R13).
- Контролёр внедрения (нижняя страховка): `DecisionImplementationCron`, `stale_days` 21.

**Сломано/отсутствует (строим):**
1. **P0 — создание задач крашится.** `specialist-3-15-tasks.service.ts:184` и `issues.service.ts:1946`: `tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\`` → Prisma 7 не десериализует `void`. (`cycles.service.ts:146`, `checklists.service.ts:358` — уже `$executeRawUnsafe`, корректны.)
2. **Разведение классов даёт сбой на смешанном контексте:** анти-дубль-правило (:418) схлопывает «предложение + поручение реализовать» в один decision (теряя idea и task); нет негатива «бытовое не-действие ≠ решение». Реестр примеров не содержит полюс idea (только решение↔задача).
3. **Решения не кормят intake** — `specialist-3-3` создаёт `Decision`, но не заводит задачу для actionable-части.
4. **Нет признака «решение влечёт действие»** (нужен для заведения задачи И для честной метрики «решения без движения»).
5. **Закрытие из разговора не доходит** до кандидата (классификация `done_item`/`task_completed` + устойчивость embed).
6. **Дашборд держит решения как параллельную очередь** (против execution-фокуса 2026-06-21).
7. **Нет «середины»** — ход выполнения из бесед не извлекается.
8. **Воркеры теряют данные на сбоях LLM** (block-ingest флап, StrategicAlignment JSON).

**Вне scope (есть свой дом):** P4 фрагментация сущностей + P6 легаси-мусор графа → `plans/tz/2026-06-25-knowledge-graph-hygiene.md` (ссылаемся, не дублируем).

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В1 | Память не трогаем: `Decision` создаётся как и было | источник правды «что выбрали» |
| В2 | На трекере/дашборде вилки «решение vs задача» нет — две ортогональные оси | категориальная ошибка — корень потери работы |
| В3 | Actionable всегда → задача, СРАЗУ и АВТО (без гейта на создании) | создание дёшево/обратимо; потеря работы дороже лишней задачи |
| В4 | Дедуп обязателен; дубль → линк к существующей задаче | память проекта про дубли Task/Issue; реюз `TaskDedupService` |
| В5 | Гейт человека ТОЛЬКО на дорогом/необратимом (закрытие, сдвиг статуса) | рынок осторожничает на закрытии, не на создании |
| В6 | Дашборд-контроля на исполнении; решения = источник+недельная метрика; знание — в «Память» | execution-фокус 2026-06-21 |
| В7 | Три класса чётко разведены: идея=предложение, задача=поручение, решение=выбор | свежий QA P3/P5; «а давайте сделаем» = идея, не задача |
| В8 | «Решили НЕ делать»/стратегия/бытовое не-действие → задачу НЕ создавать, решением НЕ метить | иначе мусор |

## Доказательство выбора

Состязательные матрицы (D1/D2/D3, рынок, red-team) — в двух анализах из `relates_to`. Кратко: мост решение→задача = авто-создание+дедуп (по асимметрии обратимости + прецеденту рынка); дашборд = execution-unified. Не переоткрываем.

## Scope

**Входит:** Фазы 0–5 ниже (починка краша; три класса; actionable→задача; закрытие+журнал; дашборд; надёжность).
**Не входит (vNext / другой дом):**
- Структурный авто-статус (commit/PR `Fixes #`) — Фаза 6 заглушка, отдельным ТЗ.
- Фрагментация/синонимный merge сущностей (P4) + чистка легаси (P6) → `2026-06-25-knowledge-graph-hygiene.md`.
- Чаты/переписка как источник хода — после потока чатов.
- Полная переработка `block-ingest`-классификатора сверх правок Фазы 1.

## Границы фичи

- ✅ Always: реюз `IntakeIssue`/auto-triage/`TaskDedupService`/`IssueProgressUpdate`/`TaskCompletionHandler`; крутилки в `AdminSetting`; Ship-On (выкатываем включённым); правка void-операторов через `$executeRaw`.
- ⚠️ Ask first: новое поле Prisma сверх перечисленного; новый `signalType`; смена R13.
- 🚫 Never: авто-закрытие/сдвиг статуса по разговорному сигналу; `process.env.*` мимо `env.schema.ts`; `prisma db push` в коммит; `new PrismaClient()` в скриптах; новые сущности на стороне исполнения; комментарии-проза.

---

## Фаза 0 — P0: починить краш создания задач (РАЗБЛОКИРОВКА) `[x]`

**Цель:** задачи снова создаются. Без этого Фазы 2/3 бессмысленны.

**Картография (перечитать строки перед правкой):**
- `backend/src/modules/knowledge-core/services/specialist-3-15-tasks.service.ts:184` — `await tx.$queryRaw\`SELECT pg_advisory_xact_lock(hashtext(${block.tenantId + ':' + normTitle}))\``.
- `backend/src/modules/tracker/services/issues.service.ts:1946` — `await args.tx.$queryRaw\`SELECT pg_advisory_xact_lock(hashtext(${key}))\``.
- Корректные образцы (НЕ трогать): `cycles.service.ts:146`, `checklists.service.ts:358` (`$executeRawUnsafe`).

**Что входит:**
- R1. Заменить `tx.$queryRaw` → `tx.$executeRaw` на двух сайтах (advisory-lock возвращает `void`; `$executeRaw` не десериализует колонки → краша нет). Тегированный шаблон сохранить (параметризация безопасна).
- R2. Прогон по всем `pg_advisory_*` (grep): убедиться, что иных `$queryRaw`+void-операторов нет; `pg_advisory_unlock` (`ai-usage-log-cleanup.service.ts:118`, `log-cleanup.service.ts:79`) возвращает `bool` (поддержан) — проверить, оставить как есть если не падает.
- R3. После фикса зависшие BullMQ-джобы `specialist:3-15-tasks` доедут по ретраю; ничего пере-эмитить не нужно (идемпотентность по блоку). Прод-смоук — раздел прод-деплой.

**Что НЕ входит:** изменение логики создания задачи; правка cycles/checklists.

**Acceptance:**
- `bun run typecheck` / `lint` / `build` зелёные.
- `bunx vitest run src/modules/knowledge-core/services/specialist-3-15-tasks.service.spec.ts` — путь создания `IntakeIssue` проходит без ошибки десериализации; добавить регресс-тест: транзакция с advisory-lock не бросает.
- Grep: в `specialist-3-15-tasks.service.ts:184` и `issues.service.ts:1946` — `$executeRaw`, не `$queryRaw`; в обоих нет `pg_advisory_xact_lock` под `$queryRaw`.
- Негатив-проверка: ни одного `$queryRaw` над `pg_advisory_xact_lock` в `src` (grep пуст).

Закрывает: R1–R3.

---

## Фаза 1 — Три класса: идея(предложение) / задача(поручение) / решение(выбор) `[x]`

**Цель:** чёткое трёхстороннее разведение; перестать схлопывать «предложение + поручение» в одно решение; «бытовое не-действие» не метить решением.

**Картография:**
- `backend/src/modules/knowledge-core/prompts/task-decision-examples.ts` — реестр пар решение↔задача (расширить до тройки).
- `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts:346-435` — правила классов; :418 АНТИ-ДУБЛЬ (источник P3); :414-421 различитель идея/решение.
- `backend/src/modules/knowledge-core/prompts/decision-extract.prompt.ts` — гейт isDecision; `idea-extract.prompt.ts`.

**Что входит:**
- R4. Расширить `task-decision-examples.ts` до ТРЁХ полюсов: добавить полюс «идея(предложение)» к существующим парам и контрастные тройки «предложение → идея / поручение → задача / выбор → решение» из разных доменов (как пары в ТЗ 2026-06-25, разнообразные индустрии, без привязки к одной теме).
- R5. Поправить АНТИ-ДУБЛЬ (`block-ingest.prompt.ts:418`): схлопывать в один `decision` ТОЛЬКО когда в окне предложение и его принятие про ОДНО И ТО ЖЕ БЕЗ назначения исполнителя. Если предложение + кому-то поручено реализовать (разные люди/роли) → извлекать idea (предложение) И action_item/commitment (поручение), а decision — только если был зафиксирован ВЫБОР между альтернативами. Формула В7: предложение=идея, поручение=задача, выбор=решение; одно не подменяет другое.
- R6. Добавить негатив (block-ingest + decision-extract): бытовой отказ от действия / «пока не завожу задачу» / «не будем сейчас этим заниматься» — это НЕ зафиксированное решение команды (isDecision=false) и НЕ задача; максимум — факт/idea низкой уверенности или не извлекать. Few-shot-пример (из QA: «отдельную задачу пока не завожу»).
- R7. Совместимость с prompt caching: правила/примеры — в стабильный SYSTEM, переменные данные — в конце user.

**Что НЕ входит:** смена `signalType`-перечня; переработка дедупа решений; правка классификатора сверх R4–R6.

**Acceptance:**
- `bunx vitest run` обновлённого диаг-теста (расширить `backend/scripts/diag-decision-classifier-test.ts` фикстурами): кейс «backoff»: предложение → idea, поручение → action_item/commitment, decision НЕ создаётся (нет выбора между альтернативами); кейс «не завожу задачу» → isDecision=false, задача не создаётся.
- Регресс: ранее работавшие («retention=метрика», «пилот если −30%», идеи с rationale) — без деградации (PASS-набор QA §«Работает»).
- typecheck/lint/build зелёные; grep: в `task-decision-examples.ts` присутствует полюс idea.

Закрывает: R4–R7.

---

## Фаза 2 — Actionable-решение → задача (сквозная гарантия, две оси) `[x]`

(Зависит от Фазы 0 — создание задач должно работать.)

**Цель:** решение с конкретным делом авто-заводит задачу через intake (дедуп + линк к решению). Память не меняется.

**Картография:** `specialist-3-3-decisions.service.ts` (`processBlock` ~:184, `extractDraft` ~:528, `createNewDecision` ~:1018); `specialist-3-15-tasks.service.ts` (создание `IntakeIssue`, `tx.intakeIssue.create` ~:226); `intake-auto-triage-queue.service.ts`; `schema.prisma` (`Decision` ~:6226, `IntakeIssue`).

**Что входит:**
- R8. `extractDraft` (specialist-3-3): расширить LLM-выход полями `impliesAction: boolean` + `actionTitle: string|null` (действие в повелительном виде). Промпт: «влечёт конкретную работу → impliesAction=true + actionTitle; „решили НЕ делать“/стратегия без действия → false». Реюз правил Фазы 1.
- R9. Prisma: `Decision += impliesAction Boolean @default(false)` + `actionExtractedAt DateTime?`. Миграция `bun run prisma:migrate -- --name decision_implies_action` + `prisma:generate`.
- R10. После создания/мёржа `Decision` с `impliesAction=true` → завести `IntakeIssue` тем же путём, что specialist-3-15 (`sourceBlockIds=decision.sourceBlockIds`, `extractedTitle=actionTitle`, `source='meeting'`/новый `'decision'`, `confidence` решения) → очередь `INTAKE_AUTO_TRIAGE`. Дедуп + `DecisionTaskLink` срабатывают сами.
- R11. Идемпотентность: не заводить второй `IntakeIssue` по тем же `(tenantId, sourceBlockIds/decisionId)` — проверка перед enqueue (образец `specialist-3-15:128`).
- R12. Если введён `source='decision'` — добавить в дефолт `intake.autoAcceptSources` (AdminSetting, Ship-On: ON сразу), иначе авто-приём не сработает. `DecisionTaskLink.linkType='implements'` при явном линке из этого пути.

**Что НЕ входит:** правка block-ingest-классификатора (Фаза 1); decision-дедуп.

**Acceptance:**
- `bunx vitest run src/modules/knowledge-core/services/specialist-3-3-decisions.*.spec.ts`: `impliesAction=true` → создан `IntakeIssue` с провенансом; `=false` → не создан; повтор блока → второй intake не создаётся.
- Negative: «решили НЕ делать X» → impliesAction=false, задача не заведена.
- Grep: `impliesAction Boolean @default(false)` в schema; миграция-файл `*decision_implies_action*`.
- typecheck/lint/build зелёные.

Закрывает: R8–R12.

---

## Фаза 3 — Закрытие из разговора (P7) + журнал хода («середина») `[x]`

(Зависит от Фазы 0.)

**Цель:** (а) починить путь «сказали „выполнено“ → кандидат на закрытие»; (б) копить событийный журнал хода из бесед; авто-закрытие/сдвиг статуса по-прежнему запрещён (R13).

**Картография:** `router.service.ts:397-419` (эмит `task.completion_signalled`); `operations/services/task-completion.handler.ts` (`@OnEvent` ~:101, KNN, `task-closure-verify`, embed); `tracker/workers/progress-auto-draft.cron.ts` (`collectSignals` ~:321); `IssueProgressUpdate` (schema).

**Что входит:**
- R13 (инвариант — НЕ нарушать): закрытие/сдвиг статуса из разговора — только `TaskClosureCandidate(pending)` + подтверждение человеком. Никакого авто-`transitionState`/`issue.update` из разговорного сигнала.
- R14. Починить P7: разобрать, почему `done_item`/`task_completed` не доходят — (а) классификация сигнала завершения в block-ingest (фикстура «база готова, задача выполнена» должна давать `task_completed`/`done_item`); (б) устойчивость embed в `TaskCompletionHandler` (WARN «embed блока не посчитался» → ретрай/фолбэк, не молчаливый пропуск матча). Acceptance — кандидат `task_closure` появляется в pending-actions.
- R15. «Не-терминальное упоминание задачи» (работа ведётся/блокер) на ТОМ ЖЕ KNN-матче, что у completion-handler: если блок сматчен к открытой задаче, но не «готово» → классифицировать прогресс/блокер (tense-aware). Без нового `signalType` (реюз матч-проход; если потребуется новый — ⚠️ Ask first).
- R16. Событийная запись по дельте в `IssueProgressUpdate` (`authorType='ai_agent'`) ТОЛЬКО при уверенной новой дельте (анти-fatigue, В9-стиль), с провенансом (`sourceBlockIds`+`evidenceQuote`+`previewSourceRef` через `ProvenanceService.computePreviewSnapshot`).
- R17. Роутинг записи владельцу/ответственному через существующие каналы (`pending-actions`/персональный бриф), не новый поток.
- R18. Порог записи журнала — `AdminSetting` `tracker.progressFromConversationMinConfidence` (code-fallback) + реестр + сид.

**Что НЕ входит:** структурный авто-статус (Фаза 6); чаты как источник; непрерывный журнал.

**Acceptance:**
- `bunx vitest run` хендлера: блок «настраивал интеграцию, не закончил» (матч к открытой задаче) → `IssueProgressUpdate` (doneText/health+провенанс); блок «задачу закрыл» → `TaskClosureCandidate(pending)` (не журнал); повтор без новой дельты → запись не создаётся.
- P7-регресс: фикстура исполнения → кандидат `task_closure` в `GET /api/v1/pending-actions` (а не пусто).
- Grep: запись журнала несёт `sourceBlockIds.length>0`; нет авто-`transitionState` из разговорного пути.

Закрывает: R13–R18.

---

## Фаза 4 — Дашборд-контроль на исполнении + честная метрика утечки `[ ]`

(Зависит от Фазы 2 — `impliesAction`.)

**Картография:** `operations-dashboard.controller.ts` (`decisions/throughput` ~:371, `decisions/stalled` ~:400); `operations/services/decision-implementation.service.ts` (`computeForTenant`, `linkedTaskCount=0 AND actualOutcomes IS NULL`); раскладка — `2026-06-21-modular-dashboards-and-execution-focus` §7.

**Что входит:**
- R19. `DecisionImplementationService`: в «stalled»/throughput учитывать `impliesAction=true` (не метить «решили НЕ делать»/стратегию как застрявшее; знаменатель = actionable-решения).
- R20. Дашборд ежедневный: решения убрать из ежедневной очереди контроля → один индикатор-утечка «N решений без действия» (ссылка в недельную аналитику); решения-список → раздел «Память». Раскладка по execution-focus §7 (задачи/блокеры/обещания наверх).
- R21. `decisions/throughput`/`decisions/stalled` остаются как недельные/аналитические (не удалять).

**Acceptance:**
- `bunx vitest run src/modules/operations/services/decision-implementation.*.spec.ts`: `impliesAction=false`+`linkedTaskCount=0` НЕ в `stalled`; `impliesAction=true` без задач старше порога — в `stalled`.
- Front `bun run typecheck && bun run build`; Swagger smoke throughput/stalled.
- Playwright (qa-tester): на ежедневном экране нет очереди решений; есть индикатор-утечка; решения-знание в «Память».

Закрывает: R19–R21.

---

## Фаза 5 — Надёжность пайплайна: не терять данные на сбоях LLM `[ ]`

**Цель:** флап LLM не теряет RawEvent (P2) и не роняет воркеры на битом JSON (P3).

**Картография:** `knowledge-core/workers/block-ingest.worker.ts` (`kc.block-ingest`); `kc.strategic-alignment` воркер; образец устойчивости — `plans/tz/2026-06-06-graph-arbiter-json-resilience.md`.

**Что входит:**
- R22. block-ingest (P2): при провале всех LLM-окон — ретрай с фолбэком провайдера (через `llm-router`) и/или не терять RawEvent (повторная постановка, dead-letter с алертом), не «job → failed» молча. Acceptance — RawEvent не теряется при единичном сбое окна.
- R23. StrategicAlignmentWorker (P3): обернуть парсинг в устойчивый JSON-ремонт (`tryParseJson`/repair) + ретрай + защита схемы (Zod safeParse → при провале не throw, а лог+skip с метрикой), как в graph-arbiter-json-resilience.
- R24. Метрики: счётчики потерь/ремонтов (prom-client) для наблюдаемости.

**Что НЕ входит:** P4/P6 (граф-гигиена — другой ТЗ).

**Acceptance:**
- `bunx vitest run` спеков воркеров: битый JSON («Unrecognized token 'Г'», пустой ответ) → воркер не падает, идёт ремонт/skip+метрика; единичный сбой LLM-окна block-ingest → ретрай, RawEvent сохранён.
- Grep: в обоих воркерах нет «голого» `JSON.parse` без защиты.

Закрывает: R22–R24.

---

## Фаза 6 (vNext, заглушка) — Структурный авто-статус `[ ]`

Контракт-набросок (отдельным ТЗ): commit/PR `Fixes #<issue>` / закрытие связанной задачи во внешнем трекере → детерминированный авто-сдвиг статуса. Граница по типу сигнала: структурный → авто; разговорный → подтверждение (Фаза 3). Здесь не реализуется.

---

## Граф зависимостей фаз

- **Фаза 0** — первая, разблокирует всё (создание задач). Строго до Фаз 2/3.
- **Фаза 1** (классы) и **Фаза 5** (надёжность) — независимы, можно параллельно с 0.
- **Фаза 2** (actionable→задача) — после 0; использует impliesAction.
- **Фаза 3** (закрытие+журнал) — после 0.
- **Фаза 4** (дашборд) — после 2 (нужен impliesAction).

## Pre-mortem / Риски (для strict-production-review-gate)

- **R13** — ревью: нет авто-закрытия/сдвига статуса из разговорного сигнала. High.
- **Дубли задач** — авто-создание из решения ОБЯЗАНО через `TaskDedupService`. Med.
- **Ложный impliesAction** на стратегии → лишняя задача (обратимо); негатив-фикстуры обязательны. Med.
- **Анти-дубль регресс** (Фаза 1): не вернуть старое схлопывание И не начать плодить дубли idea+decision — гонять PASS-набор QA. Med-High.
- **Fatigue журнала** — запись по дельте, порог в AdminSetting. Med.
- **$executeRaw фикс** — проверить, что advisory-lock всё ещё берётся (lock работает; меняется только способ вызова). Med.
- **prompt caching** — новые поля/правила в конце user, SYSTEM стабилен.
- **multi-tenancy** — все запросы с `tenantId`.

## Идемпотентность / флаги / прод-деплой

- Миграция `decision_implies_action` (Фаза 2) → `prod-deploy-log` Шаг 4. Авто-применение `migrate deploy` на `docker compose up`.
- Новые AdminSetting (`intake.autoAcceptSources` дефолт с `decision`, `tracker.progressFromConversationMinConfidence`) → `admin-setting-schema-registry.ts` + сид (`seed-admin-setting-*`) + `apply-prod-deploy.ts STEPS` (идемпотентно) → `prod-deploy-log` Шаг 1/7.
- Флаги — Ship-On (включёнными). Допустим kill-switch журнала (стиль `tracker.progressAutoDraftEnabled`, ON) → строка в `docs/operations/feature-flags.md`.
- Прод-смоук P0 (Фаза 0): после выката — `diag logs --search "3-15-tasks"` без `failed`; новая загрузка → задачи появляются в трекере. → `prod-deploy-log` Шаг 12.
- second-brain по DoD: `02_architecture/data-model.md` (Decision.impliesAction), `01_projects/ai-jobs.md`/`workers-queues.md` (Фаза 3/5), `01_projects/director-dashboard.md` (Фаза 4), `02_architecture/code-pitfalls.md` (Prisma 7 advisory-lock void → $executeRaw).

## DoD

- typecheck (вкл. `.spec`)/lint/build зелёные back+front; vitest по затронутым спекам зелёный.
- second-brain обновлён; `prod-deploy-log` по затронутым schema/scripts/ENV/очередям/эндпоинтам; рефлексия записана.
- Инварианты Z не нарушены (Ship-On, AdminSetting вместо ENV/хардкода, R13, без комментариев-прозы, multi-tenancy).

## Итог

(заполняет tz-orchestrator: что реализовано целиком / что осталось.)
