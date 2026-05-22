---
type: project
status: active
phase: alpha
sba_step: α-7
related:
  - specialist-3-4-project-customer
  - curation
  - chat-v2
---

# SBA α-7 — Specialist 3.1 (Regulations) — первая видимая ценность Слоя 3

> «У компании появились регламенты сами собой» — автогенерация Regulation / Process / Policy из встреч с провенансом до цитаты.

## Что появилось

Specialist 3.1 — третий специалист Слоя 3 (после α-6 Specialist 3.4 и до β-3 Specialist 3.3 Decisions). Закрывает три из 5 уровней «каркаса компании» Фазы 0b:
- **Регламенты** (`Regulation.category='regulation'`) — формальные правила.
- **Стандарты** (`Regulation.category='standard'`) — внешние нормы (ISO и т.п.).
- **Процессы** (`Process` + `ProcessStep`) — последовательности шагов.
- **Политики** (`Policy`) — правила с уровнем строгости.

## Откуда берутся регламенты

Источник — `IdeaBlock`'и с `signalType='regulation'` или `'process_step'`. Их размечает Layer-1 (α-2) в момент BlockExtraction. Router (α-3) диспатчит такие блоки в очередь `core.specialist-routing` jobName=`3-1-regulations`, где consumer — `Specialist31RegulationsWorker`.

Воркер передаёт блок в `Specialist31Service`, который:
1. Делает LLM-вызов `regulation-extract` (DeepSeek-flash → OpenAI gpt-5.4-mini → Ollama qwen3:30b) → черновик `{kind, name, statement, scope?, ownerHint?, severity?, category?, processStepHint?}`.
2. KNN top-5 похожих карточек того же `kind` в Org через cosine на embedding (fallback — ILIKE по name).
3. LLM-арбитр `regulation-dedupe` → verdict `{decision: 'new'|'merge'|'extension'|'contradicts', targetId?}`.
4. Upsert в нужную таблицу (Process/Regulation/Policy) с обогащением полями α-7 (`statement`, `scope`, `ownerPersonId`, `sourceBlockIds`, `personSubjectIds`, `embedding`).
5. Если verdict='contradicts' — `ConflictService.report` с relationType='contradicts'.
6. `CurationService.triage` — поскольку `regulation`/`process`/`policy` в `CURATION_CRITICAL_TYPES_DEFAULT` → **всегда deep review** (CurationItem с candidateCuratorIds).
7. `Specialist31ProbeService` — 4 probe-event'а (см. ниже).

## Probe-events

| Reason | Trigger | Получатели |
|---|---|---|
| `regulation.missing_owner` | Active регламент/процесс/политика без `ownerPersonId` | admin'ы Org |
| `regulation.process_no_steps` | Process без `ProcessStep`-записей | owner процесса + admin'ы |
| `regulation.stale` | `lastConfirmedAt > 6 мес` AND есть свежие блоки-источники | owner + admin'ы |
| `regulation.scope_unclear` | Regulation без `scope` ИЛИ Policy(mandatory/blocking) без `scope` | admin'ы Org |

Отправка — `ConversationalService.sendNotification({eventType:'specialist.probe', ...})`. После β-5 (`ProbeService`) превратится в тонкую обёртку.

## Решения по моделям (см. план α-7 §14)

- **§14.1**: НЕ создавали новую таблицу `Regulation` с `kind`. Вместо этого расширили существующие модели Phase 0b (`Process`, `Regulation`, `Policy`) новыми полями in-place: `entityId`, `scope`, `ownerPersonId`, `currentVersionId`, `sourceBlockIds`, `personSubjectIds`, `dataClass`, `embedding`, `lastConfirmedAt`, для Regulation — `statement`/`supersedesId`, для Process — `inputs`/`outputs`/`metricsJson`. UI агрегирует три таблицы в одно `RegulationListItemDto` через дискриминатор `kind`.
- **§14.2**: Standard = `Regulation.category='standard'`.
- **§14.3**: Phase 0b extraction-путь (block-ingest.worker через `GraphService.upsertEntity`) **НЕ переписывали** — он остался жить параллельно. Specialist 3.1 обогащает legacy-записи через `merge`-арбитра (upsert по `(tenantId, name)`).
- **§14.4**: `process-steps-extract` — отдельный LLM-проход поверх группы блоков одного процесса. На α-7 — заглушка через single-step upsert по `processStepHint` из extract-LLM; multi-step pass — будущая итерация.

## REST API + UI

- `GET /api/v1/regulations?kind=&status=&scope=&q=&page=&limit=` — единый список со всех трёх таблиц.
- `GET /api/v1/regulations/:id?kind=` — детальная карточка (для process — со steps).
- `GET /api/v1/regulations/:id/history?kind=` — timeline CardVersion'ов (через единый `resourceType='regulation'|'process'|'policy'`).
- `POST /api/v1/regulations/:id/supersede` — заменить версией (owner/admin).
- `POST /api/v1/regulations/:id/confirm` — пометить `lastConfirmedAt=now()` (owner/admin/curator).

UI: `/regulations` master-detail с фильтрами kind / status / scope / search. В детали — список ProcessStep для process, markdown render statement/contentMd, действия supersede / confirm.

## CardSpecialistRegistry — chat-v2 retrieval

`Specialist31CardHandler.getCardsForQuery` ищет Regulation/Process/Policy с пересечением `sourceBlockIds ∩ candidateBlockIds` retrieval'а chat-v2. Возвращает merged top-N с type='regulation'/'process'/'policy'. ChatV2Service использует эти карточки для подкрепления ответов цитатами регламентов.

## Метрики (label `type` = `'regulation'` / `'process'` / `'policy'`)

- `core_specialist_pipeline_duration_seconds{type}` — длительность цикла.
- `core_specialist_llm_tokens_total{type,model,tier}` — расход токенов.
- `core_specialist_probe_events_total{type,reason}` — probe-events.
- `core_specialist_conflict_events_total{type}` — конфликты.
- `core_specialist_extraction_failures_total{type,reason}` (**новый α-7**) — провалы LLM/JSON/DB.

## Что отложено

- Process multi-step extraction (полный `process-steps-extract` pass поверх группы блоков). На α-7 — single-step upsert.
- UI выбора Person для назначения ownerPersonId — пока только heuristic name-match.
- Workflow approval-цепочки — γ+.
- Импорт из Confluence/Notion — отдельный sub-TZ в ε.

## Файлы

- `backend/src/modules/knowledge-core/workers/specialist-3-1-regulations.worker.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-1-probe.service.ts`
- `backend/src/modules/knowledge-core/services/specialist-3-1-card-handler.service.ts`
- `backend/src/modules/knowledge-core/specialist-3-1.module.ts`
- `backend/src/modules/knowledge-core/prompts/{regulation-extract,regulation-dedupe,process-steps-extract}.prompt.ts`
- `backend/src/modules/regulations/{regulations.controller.ts,regulations.module.ts,services/regulations.service.ts,dto/regulations.dto.ts}`
- `backend/scripts/seed-llm-task-routes-regulations.ts`
- `frontend/src/api/regulations.api.ts`, `frontend/src/domain/regulation.ts`
- `frontend/app/(authenticated)/regulations/{page.tsx,RegulationsListClient.tsx}`
