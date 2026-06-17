---
name: specialist-3-1-regulations
title: Автоизвлечение регламентов, процессов и политик из встреч (Специалист 3.1)
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт «памяти компании»
  - инженер knowledge-core
related_plans:
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
  - plans/tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md
related_projects:
  - 01_projects/regulations.md
  - 01_projects/specialist-3-4-project-customer.md
  - 01_projects/curation.md
---

# Автоизвлечение регламентов / процессов / политик (Специалист 3.1)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Шаги между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Когда сотрудники в разговорах несколько раз произносят что-то вроде «у нас так принято: сначала менеджер согласует скидку, потом отправляет договор» — это не просто реплика, это **скрытый регламент**, который никто никогда не записывал. Специалист 3.1 — это часть «памяти компании», которая распознаёт такие устойчивые правила в речи и сама создаёт по ним записи: «Регламент скидок», «Процесс согласования договора», «Политика обращения с клиентскими данными».

У каждой такой записи остаётся **провенанс** — точная цитата из встречи, кто сказал, в какую минуту. Это значит, что любой регламент в библиотеке можно «открутить назад» и увидеть, откуда он взялся — а не «потому что 3 года назад кто-то так решил».

Платформа сама различает три похожие, но разные вещи: **регламент** (формальное правило компании), **процесс** (последовательность шагов) и **политику** (правило с уровнем строгости — рекомендация, обязательное, блокирующее). Помимо извлечения, она ловит **пробелы**: «у этого регламента нет ответственного», «у этого процесса не описаны шаги», «эту политику давно не подтверждали, а контекст вокруг неё уже изменился» — и аккуратно задаёт вопрос нужному человеку.

## 2. Что запускает (триггер)

- **Тип:** событие в конвейере знаний.
- **Кто инициирует:** маршрутизатор знаний (Router), который увидел блок с пометкой «это похоже на регламент или на шаг процесса».
- **Технический источник:** очередь `core.specialist-routing`, jobName `'3-1-regulations'`. Источник блоков — `signalType ∈ {regulation, process_step}` после `BlockDistillWorker`.

## 3. Шаги процесса (общий список)

1. **Маршрутизатор знаний кладёт «подозрительный» блок в очередь** — указывает, что блок похож на регламент или шаг процесса.
2. **Специалист берёт блок и сверяется с тем, что у компании уже есть** — нет ли похожего регламента / процесса / политики.
3. **LLM делает черновик карточки** — формулировка правила, область действия, кандидат в ответственные, уровень строгости.
4. **LLM-арбитр решает: это новая запись, дополнение к существующей, тот же смысл другими словами или противоречие** — и выдаёт вердикт.
5. **Платформа либо создаёт новую запись, либо обновляет существующую, либо помечает противоречие** — и в любом случае пишет, **из какого блока** и **из какой цитаты** это пришло.
6. **Запись отправляется на проверку человеку** — регламенты, процессы и политики всегда требуют ручного одобрения куратора (это «критические» сущности).
7. **Специалист проверяет 4 типа пробелов** в карточке: нет ответственного, у процесса нет шагов, давно не подтверждали, нечёткая область действия — и шлёт вопрос нужному человеку.
8. **Карточка появляется в библиотеке регламентов** на странице `/regulations` — с историей версий, кнопкой «подтвердить» и кнопкой «заменить новой версией».

## 4. Что получается на выходе

- **Кому:** администраторам организации (правила компании — их зона), а также человеку, кого LLM назначил «ответственным за это правило».
- **В каком виде:** запись в одной из трёх таблиц (`Regulation` / `Process` + `ProcessStep` / `Policy`) с провенансом до цитаты + опционально CurationItem на ручную проверку + probe-вопрос ответственному.
- **Где видно:** страница `/regulations` (единый список со всех трёх таблиц с фильтрами kind / status / scope), детальная карточка `/regulations/[id]`, лента валидации куратора `/admin/curation`, лента уведомлений сотрудника.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Маршрутизатор кладёт блок в очередь | `RouterService.dispatch(block)` смотрит `signalType`; для `regulation` и `process_step` добавляет цель `'3-1-regulations'`, затем `coreQueue.enqueueSpecialistRouting(jobName, blockId)` | `backend/src/modules/knowledge-core/services/router.service.ts:54,235,242` | `core.specialist-routing` jobName=`3-1-regulations` (jobId=`3-1-regulations_<blockId>`) | — | ✅ |
| 2 | Consumer-фильтр, валидация блока | `Specialist31RegulationsWorker` слушает `core.specialist-routing` с `concurrency=2`, фильтрует `job.name !== '3-1-regulations'`, проверяет tenant + `block.status === 'canonical'`, грузит блок + evidence + entities | `backend/src/modules/knowledge-core/workers/specialist-3-1-regulations.worker.ts:46,66,98` | `core.specialist-routing` | — | ✅ |
| 3 | LLM-черновик `regulation-extract` | `Specialist31Service.processRegulationBlock` → LLM `regulation-extract` (тройная цепочка) → черновик `{kind, name, statement, scope?, ownerHint?, severity?, category?, processStepHint?}` | `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts:124,226` + `prompts/regulation-extract.prompt.ts` | LLM-вызов через `LlmRouterService` (taskType `regulation-extract`) | — | ✅ |
| 4 | KNN top-5 + LLM-арбитр `regulation-dedupe` | Поиск похожих карточек kind через cosine на embedding (fallback ILIKE по name) → LLM `regulation-dedupe` → verdict `{decision: 'new' \| 'merge' \| 'extension' \| 'contradicts', targetId?}` | `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts:1001` + `prompts/regulation-dedupe.prompt.ts` | LLM `regulation-dedupe` | — | ✅ |
| 5 | Upsert + provenance / conflict | Создание/обновление `Regulation` / `Process` / `Policy` / instruction с полями α-7 (`entityId`, `statement`, `scope`, `ownerPersonId`, `sourceBlockIds`, `personSubjectIds`, `embedding`); если verdict='contradicts' — `ConflictService.report(relationType='contradicts')` | `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts` (методы upsertRegulation/upsertProcess/upsertPolicy) | — | `Regulation` / `Process` / `ProcessStep` / `Policy`, `CardVersion`, `ConflictItem` | ✅ |
| 5а | Структурный компилятор `compile-org-document` | `tryCompileContent` (`StructuredDocumentCompilerService`) — с 2026-06-17 вызывается на СОЗДАНИИ карточки (ветка 'new') + merge, для всех 4 типов вкл. instruction; при успехе → `compiled.contentMd` (process — в `description`) + `CardVersion` v1 (`trustTier='auto'`, `changeReason='create'`) одной транзакцией. Fallback (kill-switch `docCompilerEnabled` OFF / ошибка LLM / пусто) → сырой `draft.statement`, `CardVersion` не пишется | `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts:394,506,679,781,985,1087,1265` + `services/structured-document-compiler.service.ts` + `prompts/structured-document-compiler.prompt.ts` | LLM `compile-org-document` | `CardVersion` (v1 на create) | ✅ |
| 6 | Triage в Curation (всегда deep review) | `CurationService.triage({resourceType: 'regulation' \| 'process' \| 'policy'})` — все три в `CURATION_CRITICAL_TYPES_DEFAULT` → всегда `CurationItem` с candidateCuratorIds | `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts` + `backend/src/modules/curation/` | — | `CurationItem` | ✅ |
| 7 | 4 probe-trigger'а (синхронные) | `Specialist31ProbeService.checkAndEmitProbesRegulation(reg)`, `…Process(proc)`, `…Policy(policy)` — проверки `missing_owner`, `process_no_steps`, `stale` (>6 мес + свежие блоки), `scope_unclear` → `ConversationalService.sendNotification(eventType='specialist.probe')` | `backend/src/modules/knowledge-core/services/specialist-3-1-probe.service.ts:30,52,93,126,233` | — | `ConversationalEvent`, `Notification` | ✅ (4 trigger'а есть; cron-обхода stale нет — проверка работает реактивно на блок-апдейтах) |
| 8 | REST + UI | `RegulationsController` агрегирует три таблицы через дискриминатор `kind`; UI master-detail с фильтрами и действиями supersede/confirm | `backend/src/modules/regulations/regulations.controller.ts:60,66,85,99,113,129` + `services/regulations.service.ts` + `frontend/app/(authenticated)/regulations/{page.tsx,RegulationsListClient.tsx}` | `GET /api/v1/regulations`, `GET /:id`, `GET /:id/history`, `POST /:id/supersede`, `POST /:id/confirm` | — | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType ∈ {regulation, process_step}, status='canonical')
  ↓ RouterService.dispatch → core.specialist-routing jobName='3-1-regulations'
Specialist31RegulationsWorker
  ↓ regulation-extract (LLM) → черновик
  ↓ KNN top-5 + regulation-dedupe (LLM) → verdict
Regulation | Process + ProcessStep | Policy
  + entityId? + sourceBlockIds[] + personSubjectIds[] + embedding + lastConfirmedAt
  ↓ CurationService.triage (deep review всегда)
CurationItem (resourceType='regulation' | 'process' | 'policy')
  ↓ Specialist31ProbeService (4 trigger'а)
ConversationalEvent (eventType='specialist.probe')
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 3 | `regulation-extract` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/regulation-extract.prompt.ts` |
| 4 | `regulation-dedupe` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/regulation-dedupe.prompt.ts` |
| 5/доп | `process-steps-extract` (multi-step pass) | DeepSeek V4 Flash | OpenAI → Ollama | `backend/src/modules/knowledge-core/prompts/process-steps-extract.prompt.ts` |

Конфиг моделей — `backend/scripts/seed-llm-task-routes-regulations.ts`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики (label `type` ∈ `regulation` / `process` / `policy`):**
- `core_specialist_pipeline_duration_seconds{type}` — длительность цикла специалиста.
- `core_specialist_llm_tokens_total{type,model,tier}` — токены LLM.
- `core_specialist_probe_events_total{type,reason}` — probe-events по reason.
- `core_specialist_conflict_events_total{type}` — конфликты.
- `core_specialist_extraction_failures_total{type,reason}` — провалы LLM/JSON/DB.
- `core_specialist_routing_total{job_name='3-1-regulations',status}` — успешность routing.

**BullMQ очереди** (видно в `/admin/platform/workers`): `core.specialist-routing`.

**Логи:** контекст `trace`, имена логгеров `Specialist31RegulationsWorker`, `Specialist31Service`, `Specialist31ProbeService`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- LLM иногда возвращает `kind: 'process'` без `processStepHint` — fallback на single-step upsert.
- Phase 0b extraction-путь (через `block-ingest.worker → GraphService.upsertEntity`) живёт **параллельно** со специалистом — отсюда возможны legacy-записи без полей α-7, специалист их обогащает через `merge`-арбитра.
- `regulation` / `process` / `policy` — всегда deep review (в `CURATION_CRITICAL_TYPES_DEFAULT`), без одобрения куратора в `/regulations` не появятся (хорошее поведение, но новички удивляются).

**Кнопки админки:** `/admin/curation` (одобрить/отклонить запись), `/admin/platform/workers` (повторить упавший job), `/regulations/:id` действия supersede/confirm для owner/admin.

## 7. Связанные процессы

- [[raw-event-to-graph]] — Шаг 0 этого процесса (как `IdeaBlock` со `signalType='regulation'` или `'process_step'` появляется).
- [[meeting-post-processing]] — поставщик блоков №1 (Шаг 7б там — общая точка вызова специалистов Слоя 3).
- [[probe-question-flow]] — Шаг 7 здесь (общий механизм probe → доставка → ответ).
- [[specialist-3-3-decisions]], [[specialist-3-4-project-customer]] — параллельные специалисты Слоя 3, тот же контракт §5.
- [[curation]] — Шаг 6 (CurationItem deep review для всех трёх kind).
- [[card-rollup-v2]] — не пересекается напрямую: Regulation/Process/Policy — отдельные таблицы, не `Card`.

## 8. Расхождения «задумано vs реализовано»

**Реально работает `core.specialist-routing` для jobName=`3-1-regulations`:**
- ✅ Router-маршрутизация по `signalType='regulation'` и `'process_step'` подключена (`router.service.ts:235,242`).
- ✅ Worker фильтрует jobs других специалистов по `job.name`.
- ⚠️ **Параллельный legacy-путь:** `block-ingest.worker → GraphService.upsertEntity` по-прежнему создаёт legacy-записи (без полей α-7) — специалист обогащает их через `merge`-арбитра, но это **два независимых пути**, а не один. Полное переключение «только через специалиста» — γ+.

**Заложено в ТЗ, реализовано частично:**
- **Multi-step `process-steps-extract`** — отдельного pass'а поверх группы блоков одного процесса нет; на α-7 — single-step upsert через `processStepHint` из extract-LLM. Промпт `process-steps-extract.prompt.ts` существует, но не подключён в pipeline.
- **UI выбора Person для назначения ownerPersonId** — только heuristic name-match через LLM; UI-выбор отсутствует.

**Заложено в ТЗ, не реализовано:**
- **Cron для probe `stale`** — `Specialist31ProbeService.checkAndEmitProbesRegulation` вызывается **синхронно после upsert'а**, проверка stale (>6 мес) работает в момент входа нового блока. Отдельного daily-cron'а «обойди всё устаревшее» (как у 3-3 `runDailyChecks`) **нет**.
- **Workflow approval-цепочки** — отложено в γ+.
- **Импорт из Confluence/Notion** — отдельный sub-TZ ε.

**Реализовано, но не описано в основном ТЗ:**
- **Структурный компилятор `compile-org-document` на СОЗДАНИИ карточки** (2026-06-17, ТЗ knowledge-base-redesign-and-formatter Ф1) — ✅ реализовано. Раньше `tryCompileContent` зывался **только** на merge/extension, и карточка-`new` несла сырой `draft.statement`; теперь компилятор работает и в ветке `new` для всех 4 типов (вкл. instruction, который раньше не компилировался вообще) + пишет `CardVersion` v1 (`changeReason='create'`). Бэкфилл старых плоских карточек — `backend/scripts/backfill-compile-flat-cards.ts` (Ф2). Карта — [[01_projects/regulations]] §«База знаний компании».
- Расширение существующих моделей Phase 0b in-place (вместо новой `Regulation` с `kind`) — решение §14.1 плана α-7.
- `RegulationsController` агрегирует три таблицы через единый дискриминатор `kind` в одном `RegulationListItemDto`.
- `Specialist31CardHandler` зарегистрирован в `CardSpecialistRegistry` под именем `'3-1-regulations'` — chat-v2 умеет подсветить регламент в ответах (через overlap `sourceBlockIds ∩ candidateBlockIds`).

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-06-17 | Компилятор `compile-org-document` на создании карточки (Шаг 5а) + все 4 типа вкл. instruction; ручная загрузка docType→signalTypeHint; раздел переименован в «База знаний» | [[05_история/2026-06-17-knowledge-base-redesign-and-formatter]] |
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-22 | SBA α-7 — выкат Specialist 3.1 | [[01_projects/regulations]] |
