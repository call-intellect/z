---
name: specialist-3-2-knowledge-clone
title: Профиль знаний сотрудника — что человек знает (Специалист 3.2)
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт «памяти компании»
  - инженер knowledge-core
related_plans:
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
  - plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md
related_projects:
  - 01_projects/knowledge-clone.md
  - 01_projects/specialist-3-4-project-customer.md
  - 01_projects/curation.md
---

# Профиль знаний сотрудника (Специалист 3.2)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Шаги между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

В компании всегда есть «носитель знаний» — кто-то, кто реально умеет настроить рекламу в Яндексе, кто помнит, как именно три года назад устроили миграцию базы, кто умеет договариваться с банком. Это **знания, которые живут в людях**, а не в документах. Когда такой человек уходит, эти знания уходят вместе с ним — и компания заново наступает на те же грабли.

Специалист 3.2 решает эту проблему мягко: он **слушает встречи и заметки** и постепенно собирает по каждому сотруднику «карту того, что человек знает» — какие темы он реально объясняет другим, в чём принимал решения, какой опыт у него за плечами. Это не аттестация и не KPI — это **фактологический портрет**: «в этой теме у него много наблюдений с уверенными формулировками».

Эта карта — **фундамент клона должности** (Слой γ-1). Сначала мы понимаем, **что человек знает** (3.2), потом — **как он думает** (3.7 SkillProfile), и только потом собирается «клон Маркетолога v2», который может ответить за реального маркетолога, когда тот в отпуске или ушёл. Сам по себе профиль уже даёт ценность: AI-чат компании может ответить на «кто у нас разбирается в X» — не по штатному расписанию, а по реальным знаниям.

Сотрудник всегда может открыть свой профиль и **пометить категорию как неверную** — система тогда отправит её на повторную проверку куратору. Это важная гарантия: профиль — не приговор, а живая модель.

## 2. Что запускает (триггер)

- **Тип:** два триггера — событие + расписание.
- **Кто инициирует:** маршрутизатор знаний (на событие) или периодический ребилд (на расписании).
- **Технический источник:**
  - Событие: очередь `core.specialist-routing`, jobName `'3-2-knowledge-clone'` (source: `signalType ∈ {fact с employee subject, expertise, experience, knowledge_gap}`).
  - Cron: `KnowledgeCloneRebuildCron` каждые 6 часов (`@Cron('0 */6 * * *')`).

## 3. Шаги процесса (общий список)

1. **Маршрутизатор увидел блок с фактом о сотруднике** — кладёт в очередь специалиста 3.2.
2. **Специалист находит, о каких сотрудниках идёт речь** — через упоминания Person в блоке.
3. **Специалист дебаунсит «надо пересобрать профиль такого-то»** — несколько событий за минуту складываются в одну задачу пересборки.
4. **Отдельный воркер забирает задачу пересборки и собирает все блоки об этом человеке** — за окно 12 месяцев.
5. **LLM-вытяжка** делает черновик карт знаний: категории, цитаты-примеры, связанные сущности.
6. **Если профиль уже существовал — LLM-слияние** объединяет старые категории с новыми + ищет противоречия.
7. **Куратор автоматически одобряет или просит проверить вручную** — `knowledge_profile` НЕ в «критических», поэтому при высокой уверенности (≥0.85) — auto-canonical.
8. **Профиль пишется в `Person.knowledgeProfile`**, версия инкрементируется.
9. **Специалист проверяет 2 типа пробных вопросов**: новая экспертиза обнаружена / противоречие обнаружено.
10. **По расписанию каждые 6 часов** идёт фоновая проверка — для всех сотрудников со свежей активностью, чей профиль не пересобирали >6 ч, ставится задача ребилда.
11. **Профиль виден сотруднику** на странице `/me/knowledge-profile` — с цитатами и кнопкой «пометить неверным»; другие сотрудники видят его профиль на `/persons/[id]/knowledge-profile` (member — без цитат, owner/admin — с цитатами).

## 4. Что получается на выходе

- **Кому:** самому сотруднику (свой профиль), его руководителю (через `/persons/[id]/knowledge-profile`), AI-чату компании (для retrieval), будущему клону должности γ-1.
- **В каком виде:** JSON-поле `Person.knowledgeProfile` со структурой `{ version, builtAt, categories[], experienceHighlights[] }`; каждая категория имеет название, confidence (low/medium/high), счётчик наблюдений, 1–3 цитаты-примера и связанные `entityIds`.
- **Где видно:** `/me/knowledge-profile`, `/persons/[id]/knowledge-profile`, AI-чат компании (через `Specialist32CardHandler` в `CardSpecialistRegistry`).

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Маршрутизатор кладёт блок в очередь | `RouterService.dispatch` для `signalType='fact'` с employee-subject или `'knowledge_gap'` добавляет цель `'3-2-knowledge-clone'` | `backend/src/modules/knowledge-core/services/router.service.ts:58,281,289` | `core.specialist-routing` jobName=`3-2-knowledge-clone` | — | ✅ |
| 2 | Resolve упомянутых сотрудников | `Specialist32KnowledgeCloneWorker.process` грузит `IdeaBlockEntity` где `entity.type='person'`, потом `Person` с `relationship='employee'`, `take: 50` | `backend/src/modules/knowledge-core/workers/specialist-3-2-knowledge-clone.worker.ts:46,94,134,151` | `core.specialist-routing` | — | ✅ |
| 3 | Debounce enqueue ребилда | Для каждого Person → `coreQueue.enqueueRebuildKnowledgeProfile({tenantId, personId, reason})` (jobId=`rebuild-knowledge-profile_<personId>`, debounce из `cfg.knowledgeClone.debounceMs` default 60s) | `backend/src/modules/knowledge-core/workers/specialist-3-2-knowledge-clone.worker.ts:170` + `backend/src/modules/core-queue/core-queue.service.ts` | `core.knowledge-clone-rebuild` | — | ✅ |
| 4 | Consumer ребилда + загрузка блоков | `KnowledgeCloneRebuildWorker` (concurrency=1) → `Specialist32Service.rebuildForPerson`: загружает блоки за `lookbackMonths` (default 12); если блоков < `minBlocksForProfile` (default 10) — skip | `backend/src/modules/knowledge-core/workers/knowledge-clone-rebuild.worker.ts:34,77` + `services/specialist-3-2-knowledge-clone.service.ts` | `core.knowledge-clone-rebuild` | — | ✅ |
| 5 | LLM `knowledge-clone-extract` | Черновик профиля: категории, sample statements, related entities | `services/specialist-3-2-knowledge-clone.service.ts` + `prompts/knowledge-clone-extract.prompt.ts` | LLM-вызов через `LlmRouterService` | — | ✅ |
| 6 | LLM `knowledge-clone-merge` (если был старый профиль) | Объединение категорий + conflict detection («раньше: не знает X» → «теперь: знает X») | `services/specialist-3-2-knowledge-clone.service.ts` + `prompts/knowledge-clone-merge.prompt.ts` | LLM `knowledge-clone-merge` | `ConflictItem` (при contradiction) | ✅ |
| 7 | Triage в Curation | `CurationService.triage({resourceType: 'knowledge_profile'})` — НЕ в `CURATION_CRITICAL_TYPES_DEFAULT` → auto-canonical при `confidence ≥ 0.85`, deep review при `mark-wrong` / низкой уверенности | `services/specialist-3-2-knowledge-clone.service.ts` + `backend/src/modules/curation/` | — | `CurationItem` (только при light/deep) | ✅ |
| 8 | Запись в `Person.knowledgeProfile` | Update `Person.knowledgeProfile (Json)`, `lastProfileBuildAt`, `profileBuildVersion++` | `services/specialist-3-2-knowledge-clone.service.ts` | — | `Person.knowledgeProfile`, `Person.lastProfileBuildAt`, `Person.profileBuildVersion` | ✅ |
| 9 | 2 probe-trigger'а | `Specialist32ProbeService.checkAndEmitProbes(person)`: `knowledge.new_expertise_detected` (новая категория с confidence='high'), `knowledge.contradiction_detected` (противоположное высказывание в одной категории) → `ConversationalService.sendNotification(eventType='specialist.probe')` | `backend/src/modules/knowledge-core/services/specialist-3-2-probe.service.ts` | — | `ConversationalEvent`, `Notification` | ✅ (direct-manager как первый получатель не реализован — нет `Department.headPersonId`, шлёт только admin'ам Org) |
| 10 | Cron-ребилд каждые 6 ч | `KnowledgeCloneRebuildCron` обходит всех Person с `relationship='employee'`, у которых есть свежая активность за `FRESH_ACTIVITY_DAYS` и `lastProfileBuildAt > 6 ч назад`; enqueue до `MAX_PERSONS_PER_SWEEP` за проход | `backend/src/modules/knowledge-core/workers/knowledge-clone-rebuild.cron.ts:28,43,79,100` | `@Cron('0 */6 * * *')` | — | ✅ |
| 11 | REST + UI | `KnowledgeCloneController` — 3 endpoint'а; UI master-detail | `backend/src/modules/knowledge-clone/knowledge-clone.controller.ts:47,54,66,99` + `services/knowledge-clone.service.ts` + `frontend/app/(authenticated)/me/knowledge-profile/{page.tsx,KnowledgeProfileClient.tsx}` + `frontend/app/(authenticated)/persons/[id]/knowledge-profile/{page.tsx,PersonKnowledgeProfileClient.tsx}` | `GET /api/v1/me/knowledge-profile`, `GET /api/v1/persons/:id/knowledge-profile`, `POST /api/v1/me/knowledge-profile/mark-wrong` | — | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType='fact' с employee subject OR 'knowledge_gap', status='canonical')
  ↓ RouterService.dispatch → core.specialist-routing jobName='3-2-knowledge-clone'
Specialist32KnowledgeCloneWorker
  ↓ IdeaBlockEntity (role='subject'|'mentioned', entity.type='person')
  ↓ Person (relationship='employee')
  ↓ enqueueRebuildKnowledgeProfile (debounce 60s)
core.knowledge-clone-rebuild
  ↓ KnowledgeCloneRebuildWorker → Specialist32Service.rebuildForPerson
  ↓   1. Блоки Person за 12 мес (минимум 10)
  ↓   2. knowledge-clone-extract (LLM)
  ↓   3. knowledge-clone-merge (LLM) если был старый профиль
  ↓   4. CurationService.triage (auto при confidence ≥ 0.85)
  ↓   5. Update Person.knowledgeProfile + lastProfileBuildAt + profileBuildVersion++
  ↓   6. Specialist32ProbeService.checkAndEmitProbes (2 trigger'а)
```

Структура `Person.knowledgeProfile`:
```json
{
  "version": 3,
  "builtAt": "2026-05-25T10:00:00Z",
  "categories": [
    {
      "name": "AI-pipeline в knowledge-core",
      "confidence": "high",
      "observationCount": 12,
      "sampleStatements": [{ "quote": "...", "blockId": "..." }],
      "relatedEntityIds": ["...", "..."],
      "lastObservedAt": "2026-05-20T15:30:00Z"
    }
  ],
  "experienceHighlights": [
    { "summary": "Запустил миграцию X в Q1 2026", "blockIds": ["..."] }
  ]
}
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 5 | `knowledge-clone-extract` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/knowledge-clone-extract.prompt.ts` |
| 6 | `knowledge-clone-merge` | DeepSeek V4 Flash | OpenAI gpt-5.4-mini → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/knowledge-clone-merge.prompt.ts` |

`maxDataClass ≥ internal`. Конфиг — `backend/scripts/seed-llm-task-routes-knowledge-clone.ts`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики (label `type='knowledge_profile'`):**
- `core_specialist_pipeline_duration_seconds{type='knowledge_profile'}`.
- `core_specialist_llm_tokens_total{type='knowledge_profile', model, tier}`.
- `core_specialist_probe_events_total{type='knowledge_profile', reason}`.
- `core_specialist_conflict_events_total{type='knowledge_profile'}`.
- `core_specialist_extraction_failures_total{type='knowledge_profile', reason}`.
- `knowledge_clone_categories_per_profile` (histogram).
- `knowledge_clone_profile_size_kb` (histogram).
- `core_specialist_routing_total{job_name='3-2-knowledge-clone', status}`.

**BullMQ очереди** (видно в `/admin/platform/workers`): `core.specialist-routing`, `core.knowledge-clone-rebuild`.

**Логи:** `Specialist32KnowledgeCloneWorker`, `KnowledgeCloneRebuildWorker`, `KnowledgeCloneRebuildCron`, `Specialist32Service`, `Specialist32ProbeService`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- При `minBlocksForProfile < 10` — профиль не строится, тихо skip (особенно для новых сотрудников). Кнопка «Запустить ребилд» вручную в UI отсутствует.
- `KnowledgeCloneRebuildCron` ходит **только по сотрудникам со свежей активностью** — «спящие» Person'ы не обновляются автоматически, профиль может устаревать.
- Сейчас direct-manager НЕ резолвится (нет `Department.headPersonId`) — probe-events идут только admin'ам Org.

**Кнопки админки:** `/admin/curation` (deep review профилей с `mark-wrong`), `/admin/platform/workers` (повторить упавший job), `/me/knowledge-profile` действие «помечу неверным».

## 7. Связанные процессы

- [[raw-event-to-graph]] — Шаг 0 (как `IdeaBlock` со `signalType='fact'` про сотрудника попадает в граф).
- [[meeting-post-processing]] — основной поставщик блоков.
- [[probe-question-flow]] — Шаг 9 здесь.
- [[specialist-3-1-regulations]], [[specialist-3-3-decisions]], [[specialist-3-4-project-customer]] — параллельные специалисты Слоя 3.
- [[specialist-gamma-1-skill-clone]] — γ-1 надстройка над knowledgeProfile (что человек знает → как он думает → клон должности).
- [[curation]] — Шаг 7.

## 8. Расхождения «задумано vs реализовано»

**Реально работает `core.specialist-routing` для jobName=`3-2-knowledge-clone`:**
- ✅ Router-маршрутизация подключена (`router.service.ts:281,289`). Worker отделяет jobs других специалистов через `job.name`.
- ✅ Двойной путь: реактивный (от блока) + cron (раз в 6 ч по активным сотрудникам).
- ⚠️ **Из дюжины `signalType`-ов в роутер попадают далеко не все, что подразумевал ТЗ:** `fact` без employee-subject уходит в общий `block-ingest` без вызова специалиста 3.2; `expertise` и `experience` как самостоятельные `signalType` в `router.service.ts` явно **не упомянуты** — основной путь это `fact` с employee + `knowledge_gap` + `personal_request`. Покрытие неполное, но базовая логика работает.

**Заложено в ТЗ, реализовано частично:**
- **Direct-manager как первый получатель probe** — отложено до появления `Department.headPersonId` или аналогичного «head of department» поля. Сейчас все probe-events идут только admin'ам Org.
- **Embedding-based search в `Specialist32CardHandler`** — на β-2 простой substring-match по `categories[].name`; γ+.

**Заложено в ТЗ, не реализовано:**
- **Dashboard widget «Топ-5 людей с богатыми профилями»** (β-2.13) — отложен.
- **Кнопка «попробовать своего клона»** в `/me/knowledge-profile` — disabled до γ-1.
- **Ручной триггер ребилда из UI** — отсутствует; пересборка только через cron или новые блоки.

**Реализовано, но не описано в основном ТЗ:**
- Разделение `Specialist32KnowledgeCloneWorker` (routing-фильтр + dispatch) и `KnowledgeCloneRebuildWorker` (LLM + запись) — два разных воркера в двух разных очередях, чтобы дорогой rebuild не блокировал routing.
- Cron-fallback `KnowledgeCloneRebuildCron` — описан в `01_projects/knowledge-clone.md`, но как «дополнительно». На практике для «спящих» компаний он становится основным.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-22 | SBA β-2 — выкат Specialist 3.2 | [[01_projects/knowledge-clone]] |
