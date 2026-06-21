---
type: tz
status: ready-to-implement
feature: regulations-process-module-fix
date: 2026-06-20
owner: Сергей (Владелец)
relates_to:
  - plans/analysis/2026-06-20-regulations-process-module-audit.md
  - plans/analysis/2026-06-18-qa-meeting-molochnie-reki-and-chatbox-bugs.md
  - second-brain/02_architecture/knowledge-core.md
---
> Анализ (доказательная база, прод-данные, живой прогон промптов): `plans/analysis/2026-06-20-regulations-process-module-audit.md` · Согласование: 2026-06-20 · **Финальная редакция** после состязательной перепроверки 7 решений (7 агентов по коду, все вердикты revise — учтены).

# ТЗ — починка модуля регламентов/процессов/инструкций (Специалист 3-1 + ProcessDetector)

## Цель и зачем

Модуль «как мы работаем» из ~10 встреч за неделю наплодил **121 карточку** (74 процесса при ~15-20 реальных) и записал чужие процессы клиентов как наши нормы. Две корневые болезни доказаны кодом + прод-данными org «Ооо луа» + живым прогоном промптов на `deepseek-v4-pro` (см. анализ):

1. **Чужое стало нашим** — экстрактор не знает «чья норма» и не получает на входе кто говорит/тип встречи.
2. **Навал дублей** — пять механизмов размножения (молчаливый `new` при сбое, узкий top-5, пер-табличный дедуп, два конвейера процессов, нет консолидатора).

Решение лечит **классы** проблем: приток (Волна 1), размножение на входе (Волна 2), накопленное + структурный дубль (Волна 3).

## REALITY-CHECK (факт по коду на 2026-06-20)

- Гейт `isOrgNorm` **существует** (`specialist-3-1-regulations.service.ts:249-274`), `REGULATION_GATE_STRICT_ENABLED=true` — ловит «как в Google», не «клиент про свой завод». Чинить промпт+контракт.
- **Детерминированный сигнал «внешний»** уже есть: `enum PersonRelationship { employee, external, candidate }`; `router.service.ts:733-817` (`hasEmployeeSubject`/`hasEmployeeMention`) ходит `IdeaBlockEntity→Entity→Person.relationship`. `Meeting.type ∈ {sales, customer_success, partner, consultation, team, …}`. → ownerCompany можно ставить **гибридно** (факт БД + LLM), не чистым LLM.
- Дедуп-арбитр (`dedupeArbiter`, `service.ts:1367`) **адекватен** (живой тест: слил дубль, не тронул разный). Корень бага 2 — окружение арбитра. Вызов идёт через `responseFormat: json_schema strict` (`service.ts:1397-1402`) **без `maxTokens`** → на thinking-модели бюджет 4096 делится между «думанием» и JSON → обрезка ответа.
- Механизм «pending к человеку» есть (`CurationService.triage`, `curation.service.ts:275,312`) — но **очереди подтверждений владелец не хочет** (Ship-On + контекст «спам Подтверждений 32»). Поэтому режим отказа дедупа делаем **человеко-НЕ-зависимым** (см. Ф2).
- Крон-консолидатор **отсутствует**. Образец — `entity-resolver.cron.ts` (LATERAL top-1 HNSW, Redis negative-cache `entity-resolution.service.ts:585-600`, jobId, TICK_LIMIT). `CardVersion.trustTier ∈ {auto, human}` (`service.ts:374,440`) — ручные правки помечены `human`.
- `embedding` есть у `regulations/processes/policies/instructions`. Хаб `/regulations` (`regulations.service.ts`) считает/показывает `Process`, а `ProcessTemplate` — отдельная поверхность `/api/v1/processes/templates`.
- **Миграций Prisma не требуется ни в одной фазе** — решение D3 (fail-open вместо нового статуса) и D7 (существующий `trustTier`) сохраняют это свойство.

## Принятые решения владельца (2026-06-20, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В-1 | ТЗ на все 3 волны | Цельная картина и порядок |
| В-2 | Накопленный мусор (121 карточка) → крон-консолидатор + разовый прогон | Аккуратно, обратимо (CardVersion) |
| В-3 | **Канонический конвейер процесса — ProcessTemplate** (подтверждено) | Богаче: шаги/роли/артефакты/SLA/handoffs/completeness-cron |

> **Развилка Р-3 ЗАКРЫТА владельцем: ProcessTemplate каноничен.** Не пересматривать.

## Что изменилось после состязательной перепроверки (7 решений, все revise)

| D | Было в черновике | Стало (root-fix) |
|---|---|---|
| D1 | ownerCompany только LLM | **Гибрид**: жёсткий приор из `Person.relationship='external'` (БД), LLM подтверждает; тип встречи — мягкий контекст (не жёсткий гейт — наш сотрудник тоже говорит на sales) |
| D2 | порог `confidence≥0.6` против мусора | **Признак существенности** `isKeepableOrgNorm`+`notabilityReason` (демо-кнопки продукта/тривиальное/разовое → не норма); 0.6 — вторичная сеть |
| D3 | сбой дедупа → очередь к человеку | **Fail-open + консолидатор-гарант**: при сбое best-effort `new`, Ф5 схлопывает авто; БЕЗ очереди и БЕЗ миграции |
| D4 | «вернуть на pro» | + **явный `maxTokens`** на вызов арбитра (корень обрезки JSON) |
| D5 | кросс-таблица → детект человеку | + **стабилизировать `kind` вверху** (дерево-дискриминатор в промпте) — норма не расщепляется по таблицам |
| D6 | просто убрать маршрут Process | **+ безопасный переход**: сохранить переклассификацию, показать ProcessTemplate на хабе, мигрировать 74 старых Process в Ф5 |
| D7 | консолидатор сливает всё | **Не трогать `trustTier='human'`** и пары, разведённые человеком (negative-cache) |

## Scope

**Входит:** промпты `regulation-extract`/`process-template-extract` (ownerCompany-гибрид + существенность + стабилизация kind); гейт `extractDraft`; надёжность+режим отказа `dedupeArbiter` (maxTokens, pro, fail-open); recall (KNN_TOP_K); дедуп инструкций; единый конвейер процессов с безопасным переходом; кросс-табличный консолидатор с защитой ручных правок + разовый прогон по «Ооо луа».

**Не входит (vNext):** переписывание `StructuredDocumentCompilerService`; полноценный UI-merge на хабе; UI-просмотр черновиков; единый embedding-неймспейс (отклонён как преждевременный — `kind` стабилизируем промптом, этого достаточно); probe по регламентам.

## Совместимость с prompt caching

Все новые правила (ownerCompany, существенность, дерево kind) — **в КОНЕЦ стабильного SYSTEM**; переменное (тип встречи, приор «внешний») — **в начало USER**. SYSTEM менять одним блоком в конце. Сохраняет cache-hit DeepSeek/proxy.

---

## Фаза 1 (Волна 1) — остановить приток: гибрид «чья норма» + существенность + стабилизация kind

**Цель.** Экстрактор перестаёт записывать (а) процессы клиента, (б) демо/тривиальные «как нажать кнопку», и стабильно выбирает `kind` (норма не расщепляется по таблицам).

**Картография.**
- `prompts/regulation-extract.prompt.ts` — SYSTEM (якорь `'isOrgNorm — повторяемая норма/инструкция/политика КОМПАНИИ'`), USER (:89), SCHEMA (:119).
- `prompts/process-template-extract.prompt.ts` — SYSTEM/USER/SCHEMA.
- `specialist-3-1-regulations.service.ts` — `extractDraft` (:156), гейт (:249-274), `RegulationDraft` (:1862), резолв субъекта `resolvePersonSubjects` (:1598).
- Детерминированный сигнал: `Person.relationship='external'` через `IdeaBlockEntity→Entity→Person` (образец — `router.service.ts:733-817`); `Meeting.type` через `IdeaBlockEvidence→RawEvent(sourceType='meeting')→Meeting` (образец резолва meetingId — `specialist-routing-dispatcher.worker.ts:130`).

**Требования (EARS):**
- **R1.** До LLM-вызова `extractDraft` shall вычислять `ownerCompanyPrior` новым методом `resolveOwnerCompanyPrior(blockId)`: если у субъекта/упомянутого Person блока `relationship='external'` (и нет ни одного `employee`-субъекта) → `prior='клиент'`; иначе `prior='неизвестно'`. `Meeting.type ∈ {sales, customer_success, partner, consultation}` передаётся в USER как **мягкий контекст** («вероятна внешняя сторона»), НЕ как жёсткий гейт (наш сотрудник тоже говорит про нас на продаже).
- **R2.** extract-схема (`REGULATION_EXTRACT_JSON_SCHEMA` + `RegulationDraft`) shall содержать `ownerCompany ∈ {наша, клиент, гость, неизвестно}` (required). В USER подаётся `ownerCompanyPrior` + тип встречи. SYSTEM: «фиксируем только норму нашей компании; на продаже/консультации собеседник рассказывает про себя → ownerCompany≠наша».
- **R3.** Если `ownerCompanyPrior='клиент'` (детерминированный факт) **или** LLM-`ownerCompany ≠ 'наша'`, then `extractDraft` shall вернуть `null` (`reason:'not_our_org'`) — **в т.ч. при** `extractionStatus ∈ {нужен, обсуждается}` (закрыть обход `service.ts:262-264`). Метрика `incCoreSpecialistSkipped({reason:'not_our_org'})`. Fallback: нет встречи в evidence → `prior='неизвестно'`, решает LLM.
- **R4.** extract-схема shall содержать `isKeepableOrgNorm: boolean` + `notabilityReason ∈ {product_demo, trivial_ui, one_off, null}`. SYSTEM-правило (дословный смысл): «Инструкции по нажатию кнопок в самом продукте Кора (например „как добавить ярлык на экран“, „как оплатить картой“, „перейти в раздел“) — это документация продукта, НЕ норма компании. Разовое/тривиальное действие — не норма. Такое → isKeepableOrgNorm=false». Если `isKeepableOrgNorm=false` → не материализовать (`reason:'not_keepable'`). **Порог `confidence` остаётся вторичной сетью** (дин. ключ `aiFeatures.regulationMinMaterializeConfidence`, fallback 0.6) — для действительно расплывчатых извлечений, НЕ как основной фильтр мусора.
- **R5.** `process-template-extract` (SYSTEM+SCHEMA) shall так же нести `ownerCompany` + `isKeepableOrgNorm` + тип встречи; `ProcessExtractionService.applyExtractedTemplate` (`process-extraction.service.ts:179`) отбрасывает шаблоны с `ownerCompany≠'наша'` или `isKeepableOrgNorm=false`.
- **R6 (стабилизация kind, root-fix D5).** SYSTEM `regulation-extract` shall содержать явное дерево выбора `kind` (а не только примеры): «последовательность шагов с передачей между ролями → process; пошаговое для ОДНОЙ роли без передачи → instruction; правило-принцип без процедуры → policy; формальный норматив/требование с проверкой → regulation». Цель — одна норма всегда классифицируется одинаково, не расщепляется по таблицам.

**Контракт схемы (добавить в `properties` + `required` где указано):**
```ts
ownerCompany: { type: 'string', enum: ['наша','клиент','гость','неизвестно'],
  description: 'Чья норма. Только «наша» материализуется. На продаже/консультации вторая сторона рассказывает про СВОЮ компанию → «клиент»/«гость».' },           // required
isKeepableOrgNorm: { type: 'boolean',
  description: 'true — реальная повторяемая норма нашей компании, которую стоит хранить; false — инструкция по UI самого продукта Кора, тривиальное/разовое действие.' }, // required
notabilityReason: { type: ['string','null'], enum: [null,'product_demo','trivial_ui','one_off'],
  description: 'Почему НЕ норма (если isKeepableOrgNorm=false).' },
```

**Что НЕ входит:** dedupeArbiter, KNN, router, консолидатор.

**Acceptance Ф1:**
- typecheck/lint/build зелёные.
- Греп: `ownerCompany`, `isKeepableOrgNorm`, `resolveOwnerCompanyPrior`, `reason:'not_our_org'`, `reason:'not_keepable'` в коде/схемах; снапшоты промптов обновлены.
- Юнит (`specialist-3-1-regulations.service.spec.ts`): субъект `relationship='external'` → `extractDraft=null` даже при `extractionStatus:'нужен'`; `isKeepableOrgNorm:false` (демо) → не материализуется при `confidence:0.9`; наш `employee`-субъект, `ownerCompany:'наша', isKeepableOrgNorm:true` → проходит.
- Прогон `backend/scripts/eval/run-regulations-audit.ts`: клиентский кейс → `ownerCompany=клиент`; наш код-ревью → `наша`; «как добавить ярлык» → `isKeepableOrgNorm=false`.

Закрывает: R-1, R-8, R-9, R-10 (реестр анализа) + root-fix kind (часть R-4).

---

## Фаза 2 (Волна 2a) — надёжность арбитра + человеко-НЕ-зависимый режим отказа

**Цель.** Арбитр стабильно отдаёт JSON; сбой не плодит дубль и НЕ создаёт очередь к человеку.

**Картография.** `dedupeArbiter` (`service.ts:1367`), вызов `llm.call` (:1390-1405, **без `maxTokens`**), три `return {decision:'new'}` при ошибке (:1418, :1438, :1452). `LlmRouterService.call` принимает `maxTokens` (опц., `llm-router.service.ts`). Категория `regulation-dedupe` — `merge` (`patch-mass-migrate-to-deepseek-pro.ts`).

**Требования:**
- **R7 (надёжность, root-fix D4).** Вызовы `dedupeArbiter` (и `extractDraft`) shall передавать явный `maxTokens` (для арбитра — ≥2500), чтобы thinking-режим не обрезал JSON. При невалидном ответе — один ретрай LLM-вызова перед фоллбэком.
- **R8.** `regulation-dedupe` (+ merge-задачи на flash, если есть) shall маршрутизироваться на `deepseek-v4-pro` — применить `patch-mass-migrate-to-deepseek-pro.ts` (зарегистрировать в prod-deploy).
- **R9 (режим отказа, D3 — БЕЗ очереди, БЕЗ миграции).** Если после ретрая арбитр не вернул валидный вердикт, then `dedupeArbiter` shall вернуть `decision:'new'` (best-effort, как сейчас) с метрикой `incCoreSpecialistExtractionFailure({reason:'dedupe_fallback_new'})` — **НЕ создавать `CurationItem`/pending-очередь**. Гарантия отсутствия дубля переносится на **крон-консолидатор (Ф5)**, который автоматически схлопнёт любой ошибочно созданный дубль. → Ф5 — **жёсткая зависимость**, выкатывается тем же релизом, не позже.

**Что НЕ входит:** новый статус карточки/поле (миграции нет); KNN_TOP_K; инструкции; router.

**Acceptance Ф2:**
- typecheck/lint/build зелёные.
- Греп: `maxTokens` в вызове `dedupeArbiter`; метрика `dedupe_fallback_new`; **нет** нового `triage`/`pending`-пути в ветке сбоя арбитра.
- Юнит: `llm.call` бросает дважды → `dedupeArbiter` вернул `{decision:'new'}` + метрика, БЕЗ вызова `curation.triage`.
- `patch-mass-migrate-to-deepseek-pro.ts` идемпотентен, в `apply-prod-deploy.ts STEPS`.

Закрывает: R-2.

---

## Фаза 3 (Волна 2b) — recall + дедуп инструкций

**Цель.** Арбитр видит весь кластер; инструкции дедуплицируются.

**Картография.** `KNN_TOP_K=5` (`service.ts:48`), `knnByEmbedding` (:1252), `knnByNameLike` (:1306). `upsertInstruction` (:1059-1116) — без KNN/арбитра; `knnCandidates.table` union не содержит `'instruction'` (:1212).

**Требования:**
- **R10.** `KNN_TOP_K` shall быть конфигурируем (`knowledgeCore.regulationDedupeTopK`, fallback **12**), применяться в `knnByEmbedding` и `knnByNameLike`.
- **R11.** `upsertInstruction` shall проходить тот же путь: `knnCandidates({table:'instruction'})` → `dedupeArbiter` → ветки. Добавить `'instruction'` в union таблиц + ветку `"instructions"` (поле `statement`/`contentMd`, есть `embedding`).

**Acceptance Ф3:** typecheck/lint/build; греп `regulationDedupeTopK` + `'instruction'` в knn; юнит: две близкие инструкции → вторая через арбитр (мок merge) → апдейт, не вторая карточка.

Закрывает: R-5, R-7.

---

## Фаза 4 (Волна 3a) — единый конвейер процесса с безопасным переходом

**Цель.** Один `process_step` → один артефакт (ProcessTemplate), без дубля Process, без потери переклассификации и видимости.

**Картография.** `router.service.ts:236-252` (`process_step`→REGULATIONS+PROCESS_DETECTOR). `processProcessStepBlock` (`service.ts:106-129`) — при `draft.kind='process'` зовёт `upsertProcess`; при `regulation/policy/instruction` — переклассифицирует в другие upsert'ы. `regulations.service.ts` `getSummary` (считает `Process`), `list` (показывает `Process`).

**Требования (по В-3 = ProcessTemplate каноничен):**
- **R12 (убрать дубль Process, сохранить переклассификацию — D6).** В `processProcessStepBlock`: при `draft.kind==='process'` **не создавать** `Process`-карточку (пропустить `upsertProcess`) — каноничен `ProcessTemplate` от ProcessDetector. Ветки переклассификации (`draft.kind ∈ {regulation, standard, policy, instruction}` → `upsertRegulation/upsertPolicy/upsertInstruction`) **сохранить**. Маршрут router (`process_step → REGULATIONS + PROCESS_DETECTOR`) НЕ трогать — так переклассификация жива, а дубль Process исчезает в самом специалисте.
- **R13 (видимость — D6).** `getSummary` (`regulations.service.ts`) shall добавить поле `processTemplates` (count активных `ProcessTemplate`); хаб `/regulations` shall показывать процессы из `ProcessTemplate` (а не из пустеющего `Process`) — иначе после Ф4 процессы «исчезнут» с хаба. Минимально: summary возвращает оба счётчика, фронт-список тянет ProcessTemplate.
- Обновить `second-brain/02_architecture/knowledge-core.md` (смена источника процессов).

**Что НЕ входит:** удаление 74 старых `Process` (мигрирует Ф5); полный редизайн хаба.

**Acceptance Ф4:**
- typecheck/lint/build; router/специалист-тесты обновлены.
- Греп: в `processProcessStepBlock` при `kind==='process'` нет вызова `upsertProcess`; ветки reclass сохранены; `processTemplates` в summary.
- Юнит: блок `signalType:'process_step'`, `draft.kind:'process'` → НЕ создан `Process`, создан/обновлён `ProcessTemplate` (через PROCESS_DETECTOR); блок `draft.kind:'regulation'` → создан `Regulation` (reclass жив).

Закрывает: R-3.

---

## Фаза 5 (Волна 3b) — консолидатор с защитой ручных правок + кросс-таблица + разовый прогон

**Цель.** Схлопнуть накопленные дубли авто, не затирая ручные правки и решения человека; мигрировать старые Process.

**Картография.** `knnCandidates` (`service.ts:1210`, пер-таблица). `entity-resolver.cron.ts` (образец) + `EntityResolutionService` (Redis negative-cache :585-600). `CardVersion.trustTier ∈ {auto, human}` (:374,440); ручное решение «разные» — `curation.decide()` (`curation.service.ts:478`, ставит `trustTier='human'`/decision). `CoreQueueService` (enqueue, jobId).

**Требования:**
- **R14 (консолидатор внутри типа).** Новый `RegulationConsolidatorCron` + `RegulationConsolidatorWorker` (зеркало `entity-resolver.cron.ts`): `@Cron` (ENV `REGULATION_CONSOLIDATOR_CRON`, fallback `*/30 * * * *`), per-Org, LATERAL top-1 HNSW по `embedding` в пределах ОДНОГО типа, окно `updatedAt` (fallback 7д), Redis negative-cache, `TICK_LIMIT` (50), `jobId=regconsolidate_<type>_<id>` (concurrency=1). Слияние — через `dedupeArbiter` (`merge`/`extension`) с `CardVersion(changeReason:'consolidate')`. kill-switch `aiFeatures.regulationConsolidatorEnabled` (default **ON**; строка в `docs/operations/feature-flags.md`).
- **R15 (защита ручного труда — D7, КРИТИЧНО).** Консолидатор shall **НЕ сливать/НЕ перезаписывать** карточку, у которой `currentVersion.trustTier='human'` (ручная правка) — такие исключать из авто-слияния (максимум — `conflictSignal:'soft'` пометка). Negative-cache shall учитывать **решения человека «это разные»**: если по паре есть `CurationDecision` с вердиктом reject/keep-separate — пара исключается из авто-слияния навсегда (не только по cosine, как у entity-resolver).
- **R16 (кросс-таблица — D5, мягко).** `knnCandidates` shall (при низкой уверенности `kind`) искать кандидатов и в других таблицах орг-документов; при совпадении одного концепта в РАЗНЫХ типах — **не авто-merge между типами** (process≠policy семантически), а `conflictSignal:'soft'` аннотация (не блокирующая очередь). После стабилизации kind (Ф1 R6) такие случаи редки.
- **R17 (разовый прогон + миграция старых Process).** Скрипт `backend/scripts/backfill-regulation-consolidate.ts` (`createPrismaClient()`, импорт `../src`): консолидирует дубли по org (флаг `--org`), идемпотентно (negative-cache + jobId); дополнительно **связывает/помечает 74 старых `Process`** (созданных до Ф4) — где есть соответствующий `ProcessTemplate` по cosine>0.85, перенести `sourceBlockIds` и пометить legacy-`Process` как `deprecated` (не удалять). Зарегистрировать в `apply-prod-deploy.ts STEPS` (phase update, skipBootstrap). Прогнать по «Ооо луа» (`cmpndk2tw000101mwmixvacuj`).

**Что НЕ входит:** авто-merge между разными типами; жёсткое удаление legacy Process; UI массового merge.

**Acceptance Ф5:**
- typecheck/lint/build; `bunx vitest run` нового воркера.
- Юнит: 2 близких процесса `trustTier='auto'` → консолидатор зовёт арбитр (мок merge) → один остаётся, `CardVersion changeReason:'consolidate'`; карточка `trustTier='human'` → консолидатор НЕ трогает; пара с `CurationDecision` reject → не сливается; повторный enqueue (тот же jobId) = no-op.
- Грепы: воркер/крон в `knowledge-core.module.ts` + `WorkersModule`; `regulationConsolidatorEnabled` в typed-config; строка в `feature-flags.md`; шаг в `apply-prod-deploy.ts`.
- Идемпотентность: повторный `backfill-regulation-consolidate.ts --org <id>` = 0 merge.
- Smoke по «Ооо луа»: число `Process`(active) сократилось (was 74), кластер «онбординг» схлопнут — сверка `diag-regulations.ts`.

Закрывает: R-4, R-6 + миграция legacy Process (D6).

---

## Границы фичи

- ✅ Always: правки в названных файлах; re-Read `path:line` (якоря по уникальным строкам); промпты cache-friendly; русский UI/метрики.
- ⚠️ Ask first: смена В-3; перевод kill-switch консолидатора в OFF на выкате (запрещено Ship-On); жёсткое удаление legacy Process (только пометка).
- 🚫 Never: `prisma migrate`/`new PrismaClient()`/`process.env.*`; авто-merge между разными типами или с `trustTier='human'`; очередь подтверждений как регулярный путь; дефолт-OFF новых флагов.

## Граф зависимостей фаз

- **Ф1** — независима (extract-промпты+гейт).
- **Ф2 → Ф3** — общий dedupe-путь; Ф2 (надёжность+режим отказа) раньше Ф3 (recall).
- **Ф4** — независима (специалист/summary); до Ф5.
- **Ф5** — последняя И **обязательна в том же релизе, что Ф2** (гарант от дублей вместо очереди — R9).
- Порядок реализации: **Ф1 → Ф2 → Ф3 → Ф4 → Ф5** (строго последовательно).

## Риски / pre-mortem (для strict-production-review-gate)

- **Гипер-фильтрация (Ф1):** правила «чья норма»/«существенность» могут резать своё. Митигация: контрольные кейсы (наш код-ревью=наша/true; внутренний процесс с инструментом ≠ product_demo); метрики `not_our_org`/`not_keepable` после выката. `product_demo`-правило — про UI **самого продукта Кора**, не про «используем инструмент X в нашей работе».
- **Fail-open дубли (Ф2+Ф5):** при сбое арбитра возможен временный дубль до тика консолидатора (≤30 мин) — приемлемо (лучше очереди); поэтому Ф5 в том же релизе.
- **Затирание ручного труда (Ф5):** консолидатор без проверки `trustTier='human'`/`CurationDecision` перезапишет ручные правки — R15 обязателен, проверять на ревью.
- **Исчезновение процессов с хаба (Ф4):** без R13 (показ ProcessTemplate) процессы «пропадут» — проверять summary+список.
- **Раннавей LLM (Ф5):** TICK_LIMIT + lookback + negative-cache (вкл. human-решения).
- **Кэш промптов (Ф1):** переменное в SYSTEM ломает кэш — строго в USER.

## Idempotency / флаги / prod-deploy

- **ENV/крутилки → Шаг 1:** `REGULATION_CONSOLIDATOR_CRON`; дин. ключи `aiFeatures.regulationMinMaterializeConfidence`(0.6), `knowledgeCore.regulationDedupeTopK`(12), `knowledgeCore.crossTableDupThreshold`(0.9); kill-switch `aiFeatures.regulationConsolidatorEnabled`(ON). Через `TypedConfigService`/AdminSetting, code-fallback.
- **Флаг → `docs/operations/feature-flags.md`:** `regulationConsolidatorEnabled` (аварийный рубильник, ON).
- **Скрипты → Шаг 6/8 + `apply-prod-deploy.ts STEPS`:** `patch-mass-migrate-to-deepseek-pro.ts`, `backfill-regulation-consolidate.ts`.
- **Новый @Cron/воркер → Шаг 12 (smoke grep):** `RegulationConsolidatorCron`.
- Миграций схемы НЕТ (Шаг 4 не затронут).

## DoD

- typecheck(.spec)/lint/build зелёные; затронутые vitest проходят.
- second-brain обновлён: смена источника процессов (`knowledge-core.md`), новый воркер/крон (`workers-queues.md`, `ai-jobs.md`), гейт «чья норма»+существенность (`knowledge-core.md`).
- `prod-deploy-log.md` (Шаги 1, 6, 8, 12); реестр «не-сделано» — закрыть R-1…R-6 строками.
- Прод-инструкция в чат после push; рефлексия в `05_история/`.

## Итог

(заполнит оркестратор: что реализовано, что осталось, ссылки на коммиты)
