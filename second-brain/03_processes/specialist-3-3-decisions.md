---
name: specialist-3-3-decisions
title: Реестр решений компании с supersede-цепочками (Специалист 3.3)
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт «памяти компании»
  - инженер knowledge-core
related_plans:
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
  - plans/tz/2026-05-21-sba-beta-3-specialist-3-3-decisions.md
related_projects:
  - 01_projects/decisions.md
  - 01_projects/specialist-3-4-project-customer.md
  - 01_projects/curation.md
---

# Реестр решений компании (Специалист 3.3)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Шаги между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Каждый рабочий день в компании принимаются десятки решений: «выходим из этого региона», «переезжаем на другой стек», «отказываемся от скидок ниже 15%», «выбираем подрядчика А». Их обсуждают, обосновывают, что-то решают — и всё это **растворяется в чате и встречах**. Через полгода никто не помнит, **почему мы так решили**, какие были альтернативы, кто за это отвечал и был ли вообще установлен срок.

Специалист 3.3 решает эту проблему: каждое произнесённое на встрече решение фиксируется как **отдельная запись** в реестре решений компании — со ссылкой на цитату, автора, обоснование, отвергнутые альтернативы и срок. Если позже принимается **новое решение, которое отменяет старое** (например, «теперь скидки до 20%»), платформа сама замечает это и связывает решения в цепочку — старое помечается «отменено», новое получает ссылку «заменяет такое-то».

Когда есть **конкурирующие версии** («одна команда говорит — закрыли проект, другая — продолжаем»), специалист задаёт **пробный вопрос**: «какое из этих решений сейчас актуально?» — и пишет его именно тому человеку, кто это решение принимал. Дополнительно есть фоновые проверки: «у этого решения срок прошёл, а статус не сменился», «решение реализовано, но никто не записал результат». Так реестр **сам поддерживает себя в живом состоянии**.

## 2. Что запускает (триггер)

- **Тип:** событие + расписание.
- **Кто инициирует:** маршрутизатор знаний (на событие) или daily-cron (фоновые проверки).
- **Технический источник:**
  - Событие: очередь `core.specialist-routing`, jobName `'3-3-decisions'` (source: `signalType ∈ {decision, rationale, decision_basis}`).
  - Cron: `Specialist33ProbeService.runDailyChecks` (`@Cron('0 5 * * *')`).
  - Manual: `POST /api/v1/decisions` (owner/admin).

## 3. Шаги процесса (общий список)

1. **Маршрутизатор увидел блок типа «решение / обоснование»** — кладёт в очередь специалиста 3.3.
2. **Специалист подгружает блок и соседние блоки ±2 минуты той же встречи** — чтобы вытащить обоснование из блоков-рядом.
3. **LLM-вытяжка** делает черновик: формулировка, обоснование, отвергнутые альтернативы, кандидаты в авторы, дедлайн, статус.
4. **Платформа разрешает «кто принял»** — сначала по имени, потом по subject-Person'у блока; и «кого затрагивает» — резолвит Entity клиента/проекта/продукта/вендора.
5. **Поиск ближайших похожих решений** (KNN на embedding) + LLM-арбитр решает: новое решение / то же самое (merge) / отменяет старое (supersede) / противоречит.
6. **Платформа применяет вердикт**: создаёт новое решение, сливает с существующим, или строит supersede-цепочку (старое → новое) с интервалами действия.
7. **Куратор подтверждает** — все решения в «критических» (`decision` в `CURATION_CRITICAL_TYPES_DEFAULT`), всегда deep review.
8. **Специалист проверяет 2 синхронных пробы** (нет автора / нет дедлайна для критического) + 2 фоновых (раз в сутки): просроченные решения и решения с неизвестным результатом через 3 месяца после внедрения.
9. **Решение появляется в реестре** `/decisions` — с историей версий, supersede-цепочкой, alternatives, статусом, фактическим результатом.
10. **Owner/admin может вручную** изменить статус (`/status`), пометить отменённым, заменить новой версией (`/supersede`), записать фактический результат (`/outcomes`).

## 4. Что получается на выходе

- **Кому:** всем сотрудникам организации (read), owner/admin (write), участникам исходной встречи (probe-вопрос «кто принял?»), AI-чату компании (для retrieval).
- **В каком виде:** запись в таблице `Decision` со всеми полями β-3 + `CardVersion` timeline + опциональный `ConflictItem` (evolving для supersede) + опциональный `CurationItem` (всегда deep review).
- **Где видно:** `/decisions` master-detail с фильтрами status/deadline/affects/search, детальная карточка `/decisions/[id]` со statement, supersede chain, rationale, alternatives, provenance, validity timeline, actualOutcomes.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Маршрутизатор кладёт блок в очередь | `RouterService.dispatch` для `signalType ∈ {decision, rationale, decision_basis}` добавляет цель `'3-3-decisions'` | `backend/src/modules/knowledge-core/services/router.service.ts:53,232` | `core.specialist-routing` jobName=`3-3-decisions` (jobId=`3-3-decisions_<blockId>`) | — | ✅ |
| 2 | Consumer + загрузка контекста ±2 мин | `Specialist33DecisionsWorker` фильтрует `job.name`, проверяет tenant + `block.status === 'canonical'`, грузит блок + evidence + соседние блоки в ±2 мин окне той же RawEvent | `backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts:44,93,128` + `services/specialist-3-3-decisions.service.ts (processBlock)` | `core.specialist-routing` | — | ✅ |
| 3 | LLM `decision-extract` | Черновик `{statement, rationale, alternatives, decidedByPersonHints, affectsEntityHints, decidedAt?, deadline?, status?, confidence}`. JSON Schema strict | `services/specialist-3-3-decisions.service.ts` + `prompts/decision-extract.prompt.ts` | LLM `decision-extract` | — | ✅ |
| 4 | Resolve авторов и затронутых | `decidedByPersonIds`: name-match по `Person.name` (`relationship='employee'`) → fallback subject-Person'ы. `affectsEntityIds`: `EntityResolutionService.findOrCreate` для типов {customer, project, product, vendor} | `services/specialist-3-3-decisions.service.ts` | — | — | ✅ (`process` skip — Process не Entity) |
| 5 | KNN top-5 + LLM-арбитр `decision-supersede-detect` | Cosine на embedding (fallback ILIKE) → LLM арбитр `{verdict: 'new' \| 'merge' \| 'supersedes', targetId?, evolvingMeta?}` | `services/specialist-3-3-decisions.service.ts` + `prompts/decision-supersede-detect.prompt.ts` | LLM `decision-supersede-detect` | — | ✅ |
| 6 | Apply verdict | **new** → новый Decision. **merge** → существующий обновляется (alternatives мерджатся, sourceBlockIds/decidedBy/affectsEntity объединяются, rationale append-only). **supersedes** → новый Decision с `supersedesId=existing.id` + `validFrom`; старый помечается `status='superseded'` + `validUntil` | `services/specialist-3-3-decisions.service.ts` | — | `Decision`, `CardVersion` | ✅ |
| 7 | ConflictItem evolving (если supersede) | `ConflictService.report({resourceType: 'decision', relationType: 'supersedes'})` с suggested resolution='evolving' | `services/specialist-3-3-decisions.service.ts` + `backend/src/modules/curation/services/conflict.service.ts` | — | `ConflictItem` | ✅ |
| 8 | Triage в Curation (всегда deep review) | `CurationService.triage({resourceType: 'decision'})` — `decision` в `CURATION_CRITICAL_TYPES_DEFAULT` → всегда CurationItem | `services/specialist-3-3-decisions.service.ts` + `backend/src/modules/curation/` | — | `CurationItem` | ✅ |
| 9 | Probe sync trigger'ы | `Specialist33ProbeService.checkAndEmitForDecision`: `decision.missing_decider` (decidedByPersonIds[] пуст AND status='approved'), `decision.no_deadline_critical` (status='approved' AND deadline=null AND есть блок с тегом 'critical' в sourceBlockIds) → `ConversationalService.sendNotification(eventType='specialist.probe')` | `backend/src/modules/knowledge-core/services/specialist-3-3-probe.service.ts:151` | — | `ConversationalEvent`, `Notification` | ✅ |
| 10 | Probe cron trigger'ы | `Specialist33ProbeService.runDailyChecks` обходит все Org, по 100 кандидатов на Org: `decision.overdue` (deadline < now AND status ∉ {implemented, cancelled, rejected, superseded}); `decision.outcome_unknown` (status='implemented' AND actualOutcomes=null AND decidedAt < now − 3 мес) | `backend/src/modules/knowledge-core/services/specialist-3-3-probe.service.ts:114,123` | `@Cron('0 5 * * *')` | — | ✅ |
| 11 | REST + UI + RBAC | `DecisionsController` — 8 endpoint'ов (list / detail / history / supersede-chain / manual create / supersede / status / outcomes). UI master-detail. RBAC: read=member, write=owner/admin | `backend/src/modules/decisions/decisions.controller.ts:68,74,89,109,121,133,147,169,191` + `services/decisions.service.ts` + `frontend/app/(authenticated)/decisions/{page.tsx,DecisionsListClient.tsx}` | `GET /api/v1/decisions`, `POST /api/v1/decisions`, `GET /:id`, `GET /:id/history`, `GET /:id/supersede-chain`, `POST /:id/supersede`, `POST /:id/status`, `POST /:id/outcomes` | — | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType ∈ {decision, rationale, decision_basis}, status='canonical')
  ↓ RouterService.dispatch → core.specialist-routing jobName='3-3-decisions'
Specialist33DecisionsWorker
  ↓ context window ±2 min на той же RawEvent
  ↓ decision-extract (LLM) → черновик
  ↓ resolve decidedByPersonIds + affectsEntityIds
  ↓ KNN top-5 + decision-supersede-detect (LLM)
Decision (new | merge | supersedes)
  + statement + rationale + alternatives Json + decidedByPersonIds[] + affectsEntityIds[]
  + sourceBlockIds[] + embedding + validFrom/validUntil + supersedesId
  + status (proposed|approved|rejected|implemented|cancelled|superseded)
  ↓ CurationService.triage (всегда deep review)
  ↓ ConflictService.report (если supersedes — evolving)
CurationItem + ConflictItem? + CardVersion
  ↓ Specialist33ProbeService (2 sync + 2 cron + 1 manual trigger)
ConversationalEvent (eventType='specialist.probe', dataClass='sensitive')
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 3 | `decision-extract` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/decision-extract.prompt.ts` |
| 5 | `decision-supersede-detect` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/decision-supersede-detect.prompt.ts` |

`maxDataClass ≥ sensitive` (решения чаще стратегические). Конфиг — `backend/scripts/seed-llm-task-routes-decisions.ts`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики (label `type='decision'`):**
- `core_specialist_pipeline_duration_seconds{type='decision'}`.
- `core_specialist_llm_tokens_total{type='decision', model, tier}`.
- `core_specialist_probe_events_total{type='decision', reason}`.
- `core_specialist_conflict_events_total{type='decision'}`.
- `core_specialist_conflict_evolving_total{type='decision'}` — отдельный counter для evolving (новый β-3).
- `core_specialist_extraction_failures_total{type='decision', reason}`.
- `decision_supersede_chain_length` (histogram).
- `core_specialist_routing_total{job_name='3-3-decisions', status}`.

**BullMQ очереди** (видно в `/admin/platform/workers`): `core.specialist-routing`.

**Логи:** `Specialist33DecisionsWorker`, `Specialist33Service`, `Specialist33ProbeService`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- LLM иногда формулирует rationale в виде «потому что Х», теряя контекст блока — fallback на blocks-evidence-cite в провенансе.
- `affectsEntityHints` для `process` — пока skip (Process не Entity); решения, касающиеся процессов, теряют связь.
- Legacy-поля Decision (`text`, `decidedByPersonId`) сделаны nullable — все новые записи β-3 пишут только в новые поля (`statement`, `decidedByPersonIds[]`).
- `runDailyChecks` без лимита на total работ — при N Org × 100 decisions может стать дорогим (но в β-3 это пока приемлемо).

**Кнопки админки:** `/admin/curation` (одобрить/отклонить Decision), `/decisions/:id` (статус, outcomes, supersede), `/admin/platform/workers`.

## 7. Связанные процессы

- [[raw-event-to-graph]] — Шаг 0 (как `IdeaBlock` со `signalType='decision'` появляется).
- [[meeting-post-processing]] — основной поставщик блоков.
- [[probe-question-flow]] — Шаги 9, 10 (5 типов probe-events декомпозированы там).
- [[specialist-3-1-regulations]], [[specialist-3-4-project-customer]] — параллельные специалисты Слоя 3, тот же контракт §5.
- [[specialist-3-5-insights]] — β-4 будет читать Decision'ы, чтобы связать «эта проблема — следствие решения X».
- [[specialist-gamma-1-skill-clone]] — γ-1 будет использовать `rationale` как главный источник «как сотрудник принимает решения».
- [[curation]] — Шаг 8 (всегда deep review).

## 8. Расхождения «задумано vs реализовано»

**Реально работает `core.specialist-routing` для jobName=`3-3-decisions`:**
- ✅ Router-маршрутизация по `signalType='decision'` подключена (`router.service.ts:232`).
- ✅ Worker фильтрует по `job.name`, обрабатывает 3 типа `signalType` (`decision`, `rationale`, `decision_basis`).
- ⚠️ **В router'е явно есть только `decision`** — для `rationale` и `decision_basis` явного `dispatch` я в `router.service.ts` не нашёл (worker всё равно проверяет эти signalType в `if`-блоке, но Router их не диспатчит → они приходят через другой путь или вообще не приходят). Это потенциальный gap покрытия.

**Заложено в ТЗ, реализовано частично:**
- **`decision.competing_versions`** — на β-3 НЕ вызывается автоматически; оставлено для будущей админ-страницы (документ `01_projects/decisions.md` это явно указывает). 4 из 5 probe-trigger'ов работают.
- **`affectsEntityIds` для `process`** — пока skip (Process не Entity), решения о процессах не получают связь.
- **Workflow согласования (proposed → approved через approvals)** — отложено в γ+.

**Заложено в ТЗ, не реализовано:**
- **UI кнопка «Создать решение вручную»** — endpoint `POST /decisions` есть и доступен через Swagger, но UI-кнопка отсутствует.
- **Голосование за решение** — γ+.
- **Decision как тип Entity (для графовых запросов)** — НЕ добавили; есть `Decision.entityId?` для будущей связки.
- **Migration `text` → `statement` для legacy-записей** — отложена.
- **Dashboard widget «Overdue decisions»** (β-3.14 опциональный) — нет.

**Реализовано, но не описано в основном ТЗ:**
- Подгрузка контекста **±2 минуты** на той же RawEvent для извлечения rationale из соседних reasoning-блоков — best-effort приём, не в ТЗ.
- HNSW + GIN + tsvector на `decisions` (`apply-postgres-init.sql`) — реализация выходит за §14 ТЗ.
- `Specialist33CardHandler` в `CardSpecialistRegistry` — НЕ возвращает Decision'ы со статусом rejected/cancelled/superseded.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-22 | SBA β-3 — выкат Specialist 3.3 | [[01_projects/decisions]] |
