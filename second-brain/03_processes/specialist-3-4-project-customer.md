---
name: specialist-3-4-project-customer
title: Карточки проектов и клиентов (Специалист 3.4, эталонный референс §5)
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт «памяти компании»
  - инженер knowledge-core
related_plans:
  - plans/archive/2026-05-21-second-brain-agents-umbrella.md
  - plans/archive/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md
related_projects:
  - 01_projects/specialist-3-4-project-customer.md
  - 01_projects/curation.md
  - 01_projects/chat-v2.md
---

# Карточки проектов и клиентов (Специалист 3.4)

> **Эталонный референс §5-контракта специалиста Слоя 3.** Все остальные специалисты Слоя 3 строятся по тому же паттерну. Разделы 1–4 — для не-программиста, раздел 5 — для разработчика, шаги синхронизированы.

## 1. О чём это (бытовой рассказ)

У каждой компании есть **карточки**: «клиент Сбер», «проект Запуск Москва», «вендор Яндекс.Облако», «продукт Тариф Pro». На них сидят менеджеры, в CRM есть колонки, в почте есть тред — но **актуальной сводки нет нигде**. Через две недели после встречи никто уже не помнит: «закрыли мы этот проект или ещё ведём?», «у клиента сейчас активный диалог или замолчали?», «когда последний раз касались?».

Специалист 3.4 решает это автоматически: каждый раз, когда в разговорах или заметках всплывают **факты о конкретном клиенте, проекте, продукте или вендоре**, он подхватывает их и пересобирает свежую сводку карточки — что происходит сейчас, кто ведёт, когда был последний контакт, есть ли проблемы. Сводка не «отчёт за квартал», а **живой пульс**: открыл карточку — и за 30 секунд понял ситуацию.

Если **новые факты противоречат старым** («раньше: проект закрыт» ↔ «теперь: проект активен») — специалист поднимает флажок и шлёт уведомление: «у вас тут странность, разберитесь». Если у проектной карточки **нет дедлайна**, нет ответственного, есть дубль — задаёт пробный вопрос ответственному. Если **уверенность сводки высокая** — обновляет карточку сама; если средняя — кладёт в очередь к куратору на подтверждение.

Этот специалист — **первая полная реализация единого контракта** Слоя 3. Все остальные специалисты (регламенты, решения, инсайты, идеи, навыки) — построены по этой же 9-пунктовой формуле.

## 2. Что запускает (триггер)

- **Тип:** событие в конвейере знаний.
- **Кто инициирует:** маршрутизатор знаний (Router), увидевший блок с упоминанием клиента/проекта/продукта/вендора.
- **Технический источник:** очередь `core.specialist-routing`, jobName `'3-4-project-customer'`. Источник блоков — `signalType='fact'` после `BlockDistillWorker` с упомянутыми Entity типов `customer | vendor | project | product | client`.

## 3. Шаги процесса (общий список)

1. **Маршрутизатор кладёт блок-факт в очередь** — указывает, что в блоке упомянут клиент/проект/продукт/вендор.
2. **Специалист находит, каких карточек этот блок касается** — по `entityId` и `relatedEntityIds[]`.
3. **Специалист дебаунсит «надо пересобрать вот эту карточку»** — несколько подряд идущих обновлений за минуту складываются в один rollup.
4. **Отдельный воркер забирает rollup'ы и собирает все блоки карточки** — топ-3 темы + цитаты + subject-Person'ы.
5. **LLM-сводка** под тип карточки (client / deal / project / topic / vendor / custom) пишет свежее саммари.
6. **Куратор принимает решение** — auto-canonical (триаж high confidence), light review (средний) или deep review (низкий / противоречие).
7. **Проверка status contradiction** — простая эвристика по ключевым словам «закрыт ↔ активен»: при срабатывании создаётся `ConflictItem`.
8. **Специалист проверяет 4 пробы**: нет владельца, у проекта нет дедлайна, найден дубль, давно не подтверждали — и шлёт вопрос ответственному.
9. **Карточка обновляется в `Card.summaryCache`**, создаётся новая `CardVersion`, специалист регистрирует себя в `CardSpecialistRegistry` — теперь AI-чат компании отдаёт эту карточку в ответах.

## 4. Что получается на выходе

- **Кому:** ответственному за карточку (probe-вопросы), admin'ам Org (missing owner / merge suggestion), AI-чату компании (через `CardSpecialistRegistry`), пользователю напрямую (на странице карточки).
- **В каком виде:** обновлённый `Card.summaryCache`, новая `CardVersion`, опциональный `CurationItem`, опциональный `ConflictItem`, до 4 probe-events.
- **Где видно:** `/cards/[id]` с `<CurationBanner resourceType='card'>` (если есть открытый CurationItem), AI-чат компании.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Маршрутизатор кладёт блок в очередь | `RouterService.dispatch` для `signalType='fact'` с упомянутыми Customer/Vendor/Project/Product/Client добавляет цель `'3-4-project-customer'` | `backend/src/modules/knowledge-core/services/router.service.ts:58,273` | `core.specialist-routing` jobName=`3-4-project-customer` (jobId=`3-4-project-customer_<blockId>`) | — | ✅ |
| 2 | Consumer + match карточек | `Specialist34ProjectCustomerWorker` фильтрует `job.name`, проверяет `block.status === 'canonical'`, грузит `IdeaBlockEntity` с фильтром на 5 типов, ищет `Card` через `entityId IN (...)` OR `relatedEntityIds hasSome (...)`, `take: 200` | `backend/src/modules/knowledge-core/workers/specialist-3-4-project-customer.worker.ts:55,67,89,121,168,190` | `core.specialist-routing` | — | ✅ |
| 3 | Debounce enqueue rollup | Для каждой Card → `coreQueue.enqueueCardRollupV2(cardId, {reason})` (jobId=`card_rollup_v2_<cardId>`, debounce `CARD_ROLLUP_V2_DEBOUNCE_MS=60000`) | `backend/src/modules/knowledge-core/workers/specialist-3-4-project-customer.worker.ts:216` + `backend/src/modules/core-queue/core-queue.service.ts` | `core.card-rollup-v2` | — | ✅ |
| 4 | Consumer rollup + сбор блоков | `CardRollupV2Worker` (`core.card-rollup-v2`) → `CardRollupV2Service.buildRollup`: блоки + темы + цитаты + `collectPersonSubjects` (subject-роль в `IdeaBlockEntity`) | `backend/src/modules/knowledge-core/workers/card-rollup-v2.worker.ts:42,53,105` + `services/card-rollup-v2.service.ts` | `core.card-rollup-v2` | — | ✅ |
| 5 | LLM `card-rollup-v2` kind-промпт | Выбор системного промпта по `Card.kind` (`client / deal / project / topic / vendor / custom`); LLM-вызов; confidence хардкодом `CARD_ROLLUP_V2_DEFAULT_CONFIDENCE=0.9` (LLM JSON Schema confidence — отложено) | `services/card-rollup-v2.service.ts` + `prompts/card-rollup-v2.prompts.ts` (6 системных промптов) | LLM `card-rollup-v2` через `LlmRouterService` | — | ✅ (`vendor` — placeholder, см. ТЗ §14) |
| 6 | Triage в Curation | `CurationService.triage({resourceType: 'card', proposedPayload, confidence})`: `auto` → CardVersion(changeReason='auto-rollup') + Card update; `light/deep` → CurationItem, Card не обновляется до approve | `services/card-rollup-v2.service.ts` + `backend/src/modules/curation/` | — | `CardVersion`, `CurationItem` | ✅ |
| 7 | Status contradiction (эвристика regex) | `detectStatusContradiction(oldText, newText)` — regex `closedRe` vs `activeRe`; при flip — `ConflictService.report({relationType: 'contradicts', detectedBy: 'specialist', evidence: {heuristic: 'status-keyword-flip'}})` | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:529,625,626,627` | — | `ConflictItem` | ✅ (regex — простой; LLM-арбитр откладывается) |
| 8 | 4 probe-trigger'а | `Specialist34ProbeService.checkAndEmitProbes(card)`: `card.missing_owner` (owner-creator не активен в Org), `card.missing_deadline` (kind='project' AND нет regex дедлайн/deadline/milestone AND age >7d), `card.merge_suggestion` (≥1 другая Card с тем же entityId), `card.outdated_summary` (lastConfirmedAt >183 дней AND свежие canonical-блоки за 7д) → `ConversationalService.sendNotification(eventType='specialist.probe')` channel policy `['in_app', 'email_smtp']` | `backend/src/modules/knowledge-core/services/specialist-3-4-probe.service.ts` | — | `ConversationalEvent`, `Notification` | ✅ |
| 9 | Регистрация в `CardSpecialistRegistry` для chat-v2 | `Specialist34CardHandler.onModuleInit` → `cardSpecialistRegistry.register('3-4-project-customer', this)`. `getCardsForQuery({tenantId, query, candidateBlockIds, limit})` — overlap `sourceBlockIds ∩ candidateBlockIds` + boost по `entityId/relatedEntityIds` | `backend/src/modules/knowledge-core/services/specialist-3-4-card-handler.service.ts` + `specialist-3-4.module.ts` | — | — | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
IdeaBlock (signalType='fact' с Customer/Vendor/Project/Product/Client, status='canonical')
  ↓ RouterService.dispatch → core.specialist-routing jobName='3-4-project-customer'
Specialist34ProjectCustomerWorker
  ↓ IdeaBlockEntity (entity.type IN [customer, vendor, project, product, client])
  ↓ Card (entityId IN ... OR relatedEntityIds hasSome ...)
  ↓ enqueueCardRollupV2 (debounce 60s)
core.card-rollup-v2
  ↓ CardRollupV2Worker → CardRollupV2Service.buildRollup
  ↓   1. Блоки карточки + top-3 темы + цитаты + collectPersonSubjects
  ↓   2. LLM card-rollup-v2 (kind-промпт)
  ↓   3. CurationService.triage
  ↓     auto → CardVersion + Card.summaryCache update
  ↓     light/deep → CurationItem (Card не обновляется до approve)
  ↓   4. detectStatusContradiction → ConflictService.report (если сработало)
  ↓   5. Specialist34ProbeService.checkAndEmitProbes (4 trigger'а)
ConversationalEvent (eventType='specialist.probe')
```

Поля `Card` для §5.2 контракта (расширены α-6 in-place): `sourceBlockIds[]`, `confidence Decimal(4,3)`, `currentVersionId → CardVersion`, `personSubjectIds[]`, `lastConfirmedAt`. Status — неявный: `summaryCache=null` → draft; `summaryCache!=null AND triage='auto'` → canonical; open CurationItem → pending; `archivedAt!=null` → archived.

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Fallback | Где промпт |
|---|---|---|---|---|
| 5 | `card-rollup-v2` (6 kind-промптов: client/deal/project/topic/vendor/custom) | DeepSeek V4 Flash | OpenAI gpt-5.4-mini (via proxy) → Ollama qwen3:30b | `backend/src/modules/knowledge-core/prompts/card-rollup-v2.prompts.ts` |

Конфиг — `backend/scripts/seed-llm-task-routes-knowledge-core.ts`.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики (label `type='card'`, эталонный набор §5.7):**
- `core_specialist_cards_total{type='card', status}` — gauge карточек по status.
- `core_specialist_pipeline_duration_seconds{type='card'}` — длительность цикла (matching этап + rollup этап).
- `core_specialist_llm_tokens_total{type='card', model, tier}`.
- `core_specialist_probe_events_total{type='card', reason}`.
- `core_specialist_conflict_events_total{type='card'}`.
- `core_specialist_routing_total{job_name='3-4-project-customer', status}`.

**BullMQ очереди** (видно в `/admin/platform/workers`): `core.specialist-routing`, `core.card-rollup-v2`.

**Логи:** `Specialist34ProjectCustomerWorker`, `CardRollupV2Worker`, `CardRollupV2Service`, `Specialist34ProbeService`, `Specialist34CardHandler`.

**Известные грабли** (см. [[02_architecture/code-pitfalls]]):
- `take: 200` карточек на блок — защита от вырожденных tenant'ов; если блок ссылается на entity, по которой завязано >200 карточек, часть rollup'ов будет пропущена.
- Status-contradiction — **простая regex-эвристика** (`закрыт|завершён|остановлен|приостановлен|отменён` vs `активен|идёт|развивается|продолжается|открыт`), без учёта отрицаний. LLM-арбитр конфликтов отложен в β-.
- Старый `ai/workers/card-rollup.worker.ts` (legacy v1) помечен `@deprecated`, но ещё **не удалён** — теоретически может конкурировать за `Card.summaryCache`.
- В Curation `card` НЕ в `CURATION_CRITICAL_TYPES_DEFAULT` — при высокой `confidence` (≥0.9) Card обновляется тихо без участия куратора.

**Кнопки админки:** `/admin/curation` (deep review при противоречиях), `/cards/[id]` с `<CurationBanner>` если открыт CurationItem, `/admin/platform/workers`.

## 7. Связанные процессы

- [[raw-event-to-graph]] — Шаг 0 (как `IdeaBlock` со `signalType='fact'` с упоминанием Entity появляется).
- [[meeting-post-processing]] — основной поставщик блоков (Шаг 8 там — это card-rollup-v2 ровно через этого специалиста).
- [[probe-question-flow]] — Шаг 8 (4 типа probe-events).
- [[card-rollup-v2]] — Шаги 4–7 здесь, описан подробно отдельно.
- [[specialist-3-1-regulations]], [[specialist-3-3-decisions]] — параллельные специалисты Слоя 3, тот же контракт §5 (этот — эталон).
- [[curation]] — Шаг 6.
- [[chat-v2]] — Шаг 9 (chat-v2 использует `CardSpecialistRegistry`).

## 8. Расхождения «задумано vs реализовано»

**Реально работает `core.specialist-routing` для jobName=`3-4-project-customer`:**
- ✅ Router-маршрутизация подключена (`router.service.ts:273`) — только для `signalType='fact'` с упомянутыми типами Entity {customer, vendor, project, product, client}.
- ✅ Worker идемпотентен по jobId, фильтрует jobs других специалистов.
- ✅ Через rollup-цепочку (Specialist34 → card-rollup-v2) проходит полный §5-контракт (probe + conflict + chat-v2 + RBAC + metrics).
- ⚠️ **Block-linker'овый side-effect:** `BlockLinker` тоже умеет ставить `core.card-rollup-v2` в обход специалиста — это значит, что rollup может произойти **не только через специалиста 3.4**, а часть карточек обновляется без прохода через probe/conflict пайплайна (legacy-путь). Это документировано в `01_projects/specialist-3-4-project-customer.md` §10 как «отложено».

**Заложено в ТЗ, реализовано частично:**
- **LLM confidence от промпта** — требует переход к JSON Schema output; пока хардкод `CARD_ROLLUP_V2_DEFAULT_CONFIDENCE=0.9`.
- **LLM-арбитр конфликтов** — на α-6 это простая regex-эвристика; задача β-.
- **Embedding-search в `Specialist34CardHandler`** — на α-6 overlap по sourceBlockIds; β-2.
- **Промпт `card-rollup-v2-vendor`** — placeholder с TODO (5 из 6 kind'ов готовы).
- **Backfill `CardVersion(v1)` для legacy Card** — patch-script `patch-backfill-card-versions.ts` создан, но факт его применения на проде надо подтверждать по deploy log'у.

**Заложено в ТЗ, не реализовано:**
- **`Card.metadata.ownerUserId`** для назначенного ответственного — β-/γ-.
- **Удаление legacy `ai/workers/card-rollup.worker.ts`** — отдельный sub-TZ.
- **Migration `core_card_rollup_*` → `core_specialist_*`** для старых метрик — пока **сосуществуют**.
- **Smoke-тест на реальной встрече** — DoD §9.13 не закрыт (ручная проверка).

**Реализовано, но не описано в основном ТЗ:**
- Защита `take: 200` карточек на один блок (опираясь на «плохую онтологию» как сигнал).
- Двухочередной разрыв: routing-этап (быстрый, без LLM) и rollup-этап (медленный, с LLM) — для предотвращения LLM-rate-limit задержек на routing-стороне.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-22 | SBA α-6 — выкат Specialist 3.4 как первого эталона §5 | [[01_projects/specialist-3-4-project-customer]] |
