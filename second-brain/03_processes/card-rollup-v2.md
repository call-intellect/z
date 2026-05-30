---
name: card-rollup-v2
title: Пересборка карточки клиента/проекта после изменений в графе
trigger_type: event
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - инженер knowledge-core
  - продакт CRM / карточек
related_plans:
  - plans/tz/2026-05-10-knowledge-core-tz.md
  - plans/tz/2026-05-21-second-brain-agents-umbrella.md
related_projects:
  - 02_architecture/knowledge-core.md
  - 01_projects/workers-queues.md
  - 01_projects/ai-jobs.md
---

# Пересборка карточки клиента/проекта после изменений в графе

> **Как читать этот файл:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов между разделами 3 и 5 синхронизированы.

## 1. О чём это (бытовой рассказ)

Каждая карточка в Z — клиент, проект, сделка, поставщик, тема — это «лицо» с кратким AI-саммари: где сейчас сделка, что обсуждали последний раз, какие есть риски. Это саммари не пишется человеком — оно собирается автоматически из всех фактов графа знаний, которые касаются этой карточки.

Когда в граф прилетают новые факты (например, после очередной встречи с клиентом Ромашка появился блок «Ромашка просит скидку 15%»), карточка клиента «Ромашка» должна перестроить своё саммари. Платформа делает это **с задержкой 60 секунд** — чтобы серии быстрых событий про одного клиента склеились в одну пересборку (debounce). Это спасает от того, чтобы при волне из 50 встреч за день карточка пересобиралась 50 раз.

AI берёт все блоки карточки (до 50 самых свежих), топ-3 связанные темы и одним вызовом пишет связное саммари — у каждого вида карточки (клиент / сделка / проект / тема / поставщик / прочее) свой промпт и свой стиль. Дальше включается **триаж куратора**: если новое саммари похоже на старое и уверенность высокая — карточка обновляется автоматически. Если есть подозрения на конфликт («закрыт» в старом → «активен» в новом) — создаётся версия для подтверждения куратором, а карточка остаётся в текущем состоянии до approve.

В проде это работает; для большинства типов карточек — auto-canonical с порогом confidence 0.85. Старый воркер `card-rollup` ещё жив (в ai-модуле), но новый pipeline постепенно его вытесняет (см. раздел 8).

## 2. Что запускает (триггер)

- **Тип:** событие (debounce 60 секунд).
- **Кто или что инициирует:** изменения в графе знаний, затрагивающие сущности карточки. Конкретно:
  - после `ai_ready` встречи (через [[meeting-post-processing]] Шаг 8);
  - `Specialist34ProjectCustomerWorker` на каждый canonical блок с `signalType='fact'` + упомянутыми Customer/Vendor/Project/Product/Client сущностями;
  - ручной `regenerate` из админки;
  - вызов API «привязать встречу к карточке» / «отвязать».
- **Технический источник:** `enqueueCardRollupV2(cardId)` → `core.card-rollup-v2` (см. `backend/src/modules/core-queue/core-queue.service.ts:181`).

## 3. Шаги процесса (общий список)

1. **Что-то в графе изменилось** (новый блок про клиента / новый блок с упоминанием Project и т.п.) — соответствующий специалист или ai-pipeline ставит карточку в очередь на пересборку.
2. **Платформа ждёт 60 секунд** (debounce) — если за это время прилетит ещё событие про эту же карточку, оно не создаст второй job, а обновит существующий.
3. **Воркер забирает карточку и собирает все связанные блоки**: через встречи карточки (по `Meeting.cardId`) + через сущности карточки (`Card.entityId` и `Card.relatedEntityIds`). Берёт до 50 самых свежих канонических блоков.
4. **К каждому блоку подгружается свежая цитата** (одна на блок) — для качества контекста LLM.
5. **Считаются топ-3 темы**, к которым принадлежат эти блоки (через `ThemeIdeaBlock`).
6. **Собираются `personSubjectIds`** — сотрудники, которые в этих блоках стоят как subject (для атрибуции «знание клиента закреплено за X»).
7. **AI пишет новое саммари** одним LLM-вызовом — промпт выбирается по виду карточки (client / deal / project / topic / vendor / custom), всего 5+ промптов.
8. **Триаж куратора** решает: применить автоматически (auto), нужна лёгкая проверка (light) или глубокая (deep).
9. **На auto** — карточка обновляется (саммари + `cachedTopThemeIds` + `sourceBlockIds` + `confidence` + `personSubjectIds` + `lastConfirmedAt`), создаётся `CardVersion`, и проверяются триггеры «нужно ли спросить куратора» (specialist 3.4 probes).
10. **На light/deep** — создаётся `CurationItem`, карточка не обновляется до approve; обновляется только `summaryUpdatedAt` (чтобы дебаунс не штурмовал триаж снова).
11. **Конфликт-детектор** — простая regex-эвристика «закрыт ↔ активен» между старым и новым саммари; на срабатывание — `ConflictService.report(relationType='contradicts')`.

## 4. Что получается на выходе

- **Карточке клиента/проекта:** обновлённое `Card.summaryCache`, `cachedTopThemeIds`, `sourceBlockIds`, `confidence`, `personSubjectIds`, `lastConfirmedAt`, `currentVersionId`.
- **Истории карточки:** новая `CardVersion` (если auto) с `changeReason='auto-rollup'`.
- **Очереди куратора:** `CurationItem` (если light/deep) — карточка не обновляется до approve.
- **Реестру конфликтов:** `ConflictItem` (если detected status-flip).
- **Где это видно:**
  - `/cards/[id]` — карточка с саммари и связанными блоками;
  - `/dashboard/clients` — список клиентов с топ-темами;
  - `/admin/curation` — pending items для куратора.

## 5. Технический разрез (по шагам)

> Номера шагов синхронизированы с разделом 3.

| # | Шаг (бытовой) | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Триггеры на пересборку | `enqueueCardRollupV2(cardId, {reason})` вызывают: `Specialist34ProjectCustomerWorker.process` (после canonical блока с релевантной Entity), `MeetingService.linkCard`/`unlinkCard`, ai-pipeline после ai_ready, manual regenerate из админки | `backend/src/modules/knowledge-core/workers/specialist-3-4-project-customer.worker.ts:122,216`, `meetings.service.ts`, `backend/src/modules/core-queue/core-queue.service.ts:181` | (источник) | — | ✅ |
| 2 | Debounce 60s | `enqueueCardRollupV2` ставит job с `jobId=card_rollup_v2_<cardId>` и `delay=CARD_ROLLUP_V2_DEBOUNCE_MS=60000`; повторный enqueue в окне обновит delay существующего job'а (BullMQ behavior) | `backend/src/modules/core-queue/core-queue.service.ts:181`, `modules/core-queue/queues.ts:35` | `core.card-rollup-v2`, jobId=`card_rollup_v2_<cardId>`, delay 60s | — | ✅ |
| 3 | Сбор блоков карточки | `CardRollupV2Worker` получает job → `CardRollupV2Service.buildRollup({tenantId, cardId})` загружает Card; собирает blockIdSet из: (а) `IdeaBlockEvidence` где `rawEvent.sourceExternalId IN meetingIds(cardId)` и `block.status=canonical`; (б) `IdeaBlockEntity.entityId IN (card.entityId ∪ card.relatedEntityIds)` и `block.status=canonical`; финал — `findMany blocks ORDER BY updatedAt DESC LIMIT CARD_ROLLUP_V2_MAX_BLOCKS=50` | `backend/src/modules/knowledge-core/workers/card-rollup-v2.worker.ts:83,105`, `services/card-rollup-v2.service.ts:201,229,243,259,280` | consumer `core.card-rollup-v2`, concurrency=2 | — | ✅ |
| 4 | Свежие цитаты | `IdeaBlockEvidence.findMany({blockId IN sourceBlockIds}) ORDER BY sourceTimestamp DESC, createdAt DESC`; берётся одна цитата на блок (`CARD_ROLLUP_V2_EVIDENCE_PER_BLOCK=1`) и подкладывается рядом с блоком | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:310,326` | — | — | ✅ |
| 5 | Топ-3 темы | `ThemeIdeaBlock.findMany({blockId IN sourceBlockIds})` → counter по `themeId` → top-3 → `prisma.theme.findMany({id IN top3, status='active', tenantId})` | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:332,340,345` | — | — | ✅ |
| 6 | Person-subjects | `collectPersonSubjects({tenantId, blockIds})` — `IdeaBlockEntity` с `role='subject'` + `entity.type='person'` → Person.id для атрибуции (для γ-1 SkillProfile) | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:357,595` | — | — | ✅ |
| 7 | LLM card-rollup-v2 | `getCardRollupV2SystemPrompt(card.kind)` выбирает один из 5+ промптов (client / deal / project / topic / vendor / custom); `buildUserMessage` оборачивает blocks + themes + контактные данные; `withInjectionGuard` + `wrapUserData` (защита от prompt-injection при `AI_FEATURES_PROMPT_INJECTION_GUARD_ENABLED=true`); `LlmRouterService.call({taskType: 'card-rollup-v2', dataClass: maxDataClass(blocks.dataClass), maxTokens: 8000})` | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:364,379`, `prompts/card-rollup-v2.prompts.ts`, `modules/ai/services/prompts/common.ts` | LLM `card-rollup-v2` | — | ✅ |
| 8 | Curation triage | `CurationService.triage({resourceType:'card', resourceId, confidence=0.9 default, proposedPayload, conflictSignal:'none', dataClass})`; возвращает `{decision: 'auto'|'light'|'deep', cardVersionId?, curationItemId?}`; на auto — внутри triage создаётся `CardVersion(changeReason='auto-rollup')` | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:475`, `modules/curation/services/curation.service.ts` | — | `CardVersion` (auto), `CurationItem` (light/deep) | ✅ |
| 9 | Применение auto | `prisma.card.update({summaryCache, summaryUpdatedAt, cachedTopThemeIds, sourceBlockIds, confidence Decimal, currentVersionId, personSubjectIds, lastConfirmedAt, dataClassAudit})`; `Specialist34ProbeService.checkAndEmitProbes(card)` — 4 trigger'а (см. knowledge-core.md §SBA α-6) | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:490,511`, `services/specialist-3-4-probe.service.ts` | — | `Card.summaryCache`, `Card.summaryUpdatedAt`, `Card.cachedTopThemeIds`, `Card.sourceBlockIds`, `Card.confidence`, `Card.currentVersionId`, `Card.personSubjectIds`, `Card.lastConfirmedAt`, `Card.dataClassAudit`, опц. `ProbeEvent` | ✅ |
| 10 | Light/deep — pending | `prisma.card.update({summaryUpdatedAt: now})` — только метка, чтобы debounce 60s не штурмовал triage; карточка остаётся со старым summaryCache до approve | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:516` | — | `Card.summaryUpdatedAt` | ✅ |
| 11 | Conflict detection | `detectStatusContradiction(oldSummary, newSummary)` — regex-эвристика «закрыт ↔ активен» (heuristic='status-keyword-flip'); на срабатывание — `ConflictService.report({resourceType:'card', existingId=card.id, newId=card.id+':next', relationType:'contradicts', evidence.specialistName='3-4-project-customer', oldSummary, newSummary, sourceBlockIds(20)})` | `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts:525,532` | — | `ConflictItem` (опц.) | ✅ |

### 5.1 Структуры данных, через которые проходит процесс

```
Card { id, kind (client | deal | project | topic | vendor | custom),
       name, contactName, contactEmail, ownerId, tenantId,
       entityId? → Entity (primary), relatedEntityIds[],
       summaryCache, summaryUpdatedAt, cachedTopThemeIds[],
       sourceBlockIds[], confidence, currentVersionId? → CardVersion,
       personSubjectIds[], lastConfirmedAt, dataClassAudit, bornFromThemeId? }
  ↓ enqueueCardRollupV2 (debounce 60s)
core.card-rollup-v2 job { cardId, reason }
  ↓ CardRollupV2Worker → CardRollupV2Service.buildRollup
  ├─ blockIdSet:
  │    A) via Meeting.cardId → meetingIds → RawEvent.sourceExternalId → IdeaBlockEvidence → IdeaBlock
  │    B) via (card.entityId ∪ card.relatedEntityIds) → IdeaBlockEntity → IdeaBlock
  ├─ blocks: top-50 by updatedAt DESC (status=canonical)
  ├─ evidence: 1 freshest quote per block
  ├─ topThemes: top-3 by ThemeIdeaBlock count
  └─ personSubjectIds: Person.id где IdeaBlockEntity.role='subject' и entity.type='person'
  ↓ LLM 'card-rollup-v2' (kind-specific)
{ summary, confidence(static 0.9), usedTier, usedModel, llmTokens }
  ↓ CurationService.triage(resourceType='card')
{ decision: auto|light|deep, cardVersionId?, curationItemId? }
  ↓
auto  → Card update + CardVersion(changeReason='auto-rollup')
        + Specialist34ProbeService.checkAndEmitProbes
        + (опц.) ConflictItem on status-flip
light → CurationItem (pending), Card.summaryUpdatedAt only
deep  → CurationItem (pending), Card.summaryUpdatedAt only
```

### 5.2 LLM-вызовы внутри процесса

| Шаг | taskType | Primary | Secondary | Tertiary | Где промпт |
|---|---|---|---|---|---|
| 7 | `card-rollup-v2` (5+ kind-промптов: client / deal / project / topic / vendor / custom) | DeepSeek V4-flash | OpenAI gpt-5.4-mini (через proxy) | Ollama qwen3.5:9b | `backend/src/modules/knowledge-core/prompts/card-rollup-v2.prompts.ts`, выбор через `getCardRollupV2SystemPrompt(card.kind)` |

Маршрут задаётся `backend/scripts/seed-llm-task-routes-default.ts:235` и `seed-llm-task-routes-knowledge-core.ts:141`. `maxTokens=8000` (multi-paragraph summary + резерв на thinking при переключении на Pro). **NB:** confidence rollup'а — статический `0.9` (`CARD_ROLLUP_V2_DEFAULT_CONFIDENCE`), потому что промпты возвращают свободный текст без structured output (см. TODO в коде — `card-rollup-v2.service.ts:48`).

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `core_specialist_pipeline_duration_seconds{type='card'}` — общая длительность вызова `buildRollup`;
- `core_specialist_llm_tokens_total{type='card', model, tier}` — токены LLM на rollup;
- `core_specialist_conflict_event_total{type='card'}` — кол-во созданных ConflictItem.

**BullMQ очереди:** `core.card-rollup-v2` (видно в `/admin/platform/workers`), jobId=`card_rollup_v2_<cardId>`.

**Логи** (pino): `CardRollupV2Worker` — на каждом job'е `cardId, reason, blocksUsed, summaryChars, topThemes, triageDecision, applied, cardVersionId, curationItemId, conflictReported, usedTier, usedModel`. `CardRollupV2Service` — на tenant mismatch, на пустые сорсы, на conflict.report fail.

**Известные грабли:**
- **`Card.tenantId=null` (legacy)** — `CardRollupV2Worker` пропускает с warn (`card-rollup-v2.worker.ts:97`); требуется backfill до выкатывания на старые карточки.
- **`detectStatusContradiction` — простая regex-эвристика**, может ложно срабатывать на словах «закрыт счёт» / «активен в чате». ConflictItem всё равно для куратора.
- **`existingId !== newId` валидация в ConflictService** — пришлось хакать `newId=card.id+':next'` (`card-rollup-v2.service.ts:540`), потому что хранилища previousId у Card нет.
- **Защита от вырожденных tenant'ов**: в `Specialist34ProjectCustomerWorker` лимит 200 cards на блок (`specialist-3-4-project-customer.worker.ts:202`); в `buildRollup` — лимит 50 блоков (`CARD_ROLLUP_V2_MAX_BLOCKS`).

**Кнопки админки:** `/admin/curation` — approve/reject CardVersion / CurationItem; ручной regenerate карточки через `POST /api/v1/cards/:id/regenerate` (если эндпоинт активен).

## 7. Связанные процессы

- [[raw-event-to-graph]] — Шаг 8 (specialist routing) порождает работу `Specialist34ProjectCustomerWorker`, которая запускает этот процесс.
- [[theme-clustering]] — порождает `Theme`-записи, которые здесь используются для топ-3 тем карточки.
- [[meeting-post-processing]] — Шаг 8 там — это вход в этот процесс через `MeetingService.linkCard` или post-ai_ready hook.
- [[reframing-cycle]] — ночная гигиена не дёргает rollup напрямую, но архивация слабых связей и тем меняет blockIdSet и topThemes, которые могут видоизмениться при следующем rollup'е.
- [[specialist-3-5-insights]] / [[specialist-3-6-ideas]] — могут также менять блоки карточки (insight/idea как блоки), что косвенно триггерит rollup через `Specialist34ProjectCustomerWorker`.

## 8. Расхождения «задумано vs реализовано»

**Заложено в ТЗ, реализовано:**
- ✅ Pipeline `Card → blocks → LLM → triage → auto|light|deep` целиком (SBA α-6 §5 контракта).
- ✅ Conflict detection с regex-эвристикой + ConflictService.report.
- ✅ Probe-checks после auto через `Specialist34ProbeService` (4 trigger'а).

**Заложено в ТЗ, но реализовано частично / отступления:**
- **`confidence` — статический `0.9`** (`CARD_ROLLUP_V2_DEFAULT_CONFIDENCE`) вместо реального confidence от модели. Промпты сознательно возвращают prose без JSON, перевод на structured output — отложенная задача SPO (TODO в коде `card-rollup-v2.service.ts:44`).
- **Старый `card-rollup.worker` (`ai.card-rollup`) ещё жив** и обрабатывает свою очередь параллельно (`card-rollup-v2.worker.ts:39`); полный переход на v2 запланирован на Фазы 5/6 (см. `02_architecture/knowledge-core.md` «Что вне Фазы 4»).

**Реализовано, но в ТЗ не описано:**
- **`KC-Temporal W4.1/W4.2` shadow-compare DataClass** — `DataClassPolicyService.derive` запускается на enforcement=`'enforce'`, иначе legacy `'internal'`; `dataClassAudit` пишется в Card только в enforce-режиме (`card-rollup-v2.service.ts:449,470`).
- **`withInjectionGuard` + `wrapUserData`** (ТЗ 2026-05-24 §4 F1.2) — обёртка system + user-данных маркерами защиты от prompt-injection (`card-rollup-v2.service.ts:376`). Управляется `AI_FEATURES_PROMPT_INJECTION_GUARD_ENABLED`.
- **`maxTokens: 8000`** (ТЗ 2026-05-25 LLM-architecture §10.4 Find 1) — резерв на multi-paragraph summary + thinking при переключении на Pro.

**Гейты:**
- `CARD_ROLLUP_V2_DEBOUNCE_MS=60000` — debounce 60s по jobId.
- `CARD_ROLLUP_V2_MAX_BLOCKS=50` — верхний лимит блоков для LLM.
- `triage.decision='auto'` при `confidence ≥ autoThreshold` (по умолчанию 0.85) — у нас всегда 0.9, поэтому большинство карточек идут auto. Critical resource types (`decision`, `regulation`, `process`, `policy`) не сюда.

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана | этот документ |
| 2026-05-25 | KC-Temporal W4.1/W4.2 DataClassPolicy shadow-compare | [[02_architecture/knowledge-core]] |
| 2026-05-24 | `withInjectionGuard` + `wrapUserData` обёртка LLM-вызова | ТЗ 2026-05-24 §4 F1.2 |
| 2026-05-22 | SBA α-6: triage + CardVersion + 5 kind-промптов + Specialist34Probe | [[02_architecture/knowledge-core]] §SBA α-6 |
| 2026-05-10 | CardRollupV2Worker + Service запущены (Фаза 4) | plans/tz/2026-05-10-knowledge-core-tz.md |
