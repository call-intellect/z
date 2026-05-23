---
type: tz
status: ready-for-code
feature: α-5 — DialogService (Contextualizer / ConfidenceEstimator / QueryClassifier / MultiQueryExpansion / Summarizer) + AnswerCache + RetrievalCache + temporal validAt + mode prompts
phase: alpha-5
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-21-sba-alpha-5-layer5-chat-v2.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-5
  - plans/tz/2026-05-22-final-roadmap.md §α-5
---

# SBA α-5 — DialogService + кэш + temporal + mode prompts

## 1. Цель и контекст

Chat-v2 ядро уже работает: гибридный retrieval (cosine+BM25+граф), 3 уровня ответа, CardSpecialistRegistry, omnichannel bridge. Не хватает 30% продукта — слой диалога: standalone-question контекстуализация, multi-query expansion, classifier, summarizer для длинных диалогов, temporal queries и кэширование (которое радикально снижает cost при повторных запросах).

**Главное архитектурное решение** (§3): dialog-layer — препроцессор между `ChatV2OrchestrationService.ask()` и `KnowledgeCoreChatV2Service.ask()`. Не переписываем ядро.

## 2. Scope

**Входит:**
- Новый модуль `backend/src/modules/dialog-layer/` с сервисами:
  - `DialogService` (фасад) — `process({ userMessage, conversationId, tenantId, userId, validAt? })` → `{ standaloneQuestion, intent, complexity, queries[], cachedAnswerHit? }`.
  - `ContextualizerService` — восстанавливает standalone вопрос из последних N сообщений + Conversation.summary.
  - `ConfidenceEstimatorService` — confidence что standaloneQuestion корректен (если <0.5 — fallback на raw userMessage).
  - `QueryClassifierService` — `intent ∈ {factual|exploratory|analytical|clone-roleplay}`, гибрид эвристика + LLM-fallback.
  - `MultiQueryExpansionService` — 3 переформулировки (синонимы + перспективы + конкретизация).
  - `ConversationSummarizerCron` — `@Cron('*/30 * * * *')` сжимает messages >12 в `Conversation.summary` (оставляет окно 6 последних).
- `AnswerCache` (Redis) — ключ `tenantId:userId:hash(standaloneQuestion + scope)` → ответ + provenance. TTL 24h.
- `RetrievalCache` (Redis) — ключ `tenantId:hash(standaloneQuestion + scope + validAt?)` → blockIds[]. TTL 1h.
- Temporal queries: реализация фильтра `validAt: Date?` в `ChatV2RetrievalService` (выбор card.currentVersion с `validFrom ≤ validAt ≤ validUntil`; если validUntil NULL — всегда матчит).
- Mode-specific system prompts: 3 файла в `chat-v2/prompts/` — `factual.prompt.ts`, `synthetic.prompt.ts`, `clone-style.prompt.ts`. Default `BASE_SYSTEM_PROMPT` остаётся как fallback.
- Расширение `ChatV2Conversation`: поле `summary String? @db.Text`.
- 5 LlmTaskType: `dialog-contextualize`, `dialog-confidence`, `dialog-classify`, `dialog-multi-query`, `dialog-summarize`.
- Cache-invalidation hook: при `CurationDecision.publish` / `CardVersion.create` — invalidate `RetrievalCache:*` для затронутых cardIds (через Redis SCAN + DEL).
- Метрики Prometheus: `answer_cache_hit_total{tenant_top}`, `retrieval_cache_hit_total{tenant_top}`, `dialog_processing_duration_seconds{step}`.

**Не входит:**
- Полная замена `chat/` модуля — отдельный sub-ТЗ δ.
- Voice-input (TTS/ASR) — отдельный sub-ТЗ δ-3.
- Multi-tenancy для cache — уже встроено в key-prefix (tenantId).

## 3. Принятые решения

1. **Архитектура — препроцессор**. dialog-layer не переписывает ядро retrieval. `ChatV2OrchestrationService.ask()` вызывает `DialogService.process()`, получает standaloneQuestion+queries, форвардит в `KnowledgeCoreChatV2Service.ask({ queries, validAt, intent })`. Это минимизирует риск регрессий.
2. **ContextualizerService — кэширует через AnswerCache.** Если ответ уже в AnswerCache — возвращаем сразу, не зовём LLM. Cache hit ≥30% на повторных тестовых запросах = огромная экономия.
3. **ConfidenceEstimator — отдельный шаг ≠ контекстуализация.** Контекстуализатор отвечает «что хотел спросить пользователь». Confidence — «насколько я уверен, что мой ответ это». Если confidence <0.5 — фолбэк: возвращаем raw userMessage, оркестрация продолжается без контекстуализации.
4. **QueryClassifier гибрид:** сначала эвристика (фразы «как», «почему», «что такое», списки → exploratory) — покрывает 60-70%. Иначе LLM. Cost-оптимизация.
5. **MultiQueryExpansion — only для exploratory/analytical.** Для factual — одна query (стандартное retrieval). Избегаем lossiness и cost.
6. **Summarizer cron — батч-режим.** Не per-message trigger. Раз в 30 минут проходит conversations с >12 messages без summary or stale summary.
7. **AnswerCache vs RetrievalCache — два уровня:**
   - AnswerCache: финальный ответ (markdown + citations) — самый дорогой компонент. Hit = 0 LLM calls.
   - RetrievalCache: только blockIds — Hit = пропускаем cosine+BM25+граф, но LLM-synthesis всё ещё вызывается (потому что ответ может зависеть от user context).
8. **Cache invalidation — pattern Redis SCAN с tenant-prefix.** При CardVersion.create для cardId X — SCAN `retrieval:*:cards:*X*` → DEL. Также soft TTL — 1h максимум для RetrievalCache гарантирует freshness.
9. **Temporal validAt** — опц. поле в API request. Default = now(). Если запрос «как было год назад?» — UI/concierge должен передать validAt = now() - 365d.
10. **Mode-specific prompts** — `clone-style` использует SkillProfile/ExecutablePersona персональные particle'ы (после γ-1 доделок появятся). Пока MVP — fallback на BASE.
11. **Conversation.summary** — sliding window: после summarize старых messages, summary становится «short markdown 200-400 chars + ключевые entities». В systemPrompt идёт `summary + last 6 messages`.

## 4. Зависимости

- α-1 (готово) — ConversationalService для chat_query inbound.
- α-3 wave 1+2 (готово) — Entity, EntityLink (для axis filters).
- α-4 (готово) + α-4 wave 2 (параллельно) — Curation invalidation hook target.
- α-6 (готово) — Card.currentVersionId / validFrom / validUntil.
- chat-v2 базис (готово) — ChatV2OrchestrationService, KnowledgeCoreChatV2Service, ChatV2RetrievalService.
- common/redis (готово).

## 5. Prisma-дельта

```prisma
model ChatV2Conversation {
  // ... existing fields
  summary               String?  @db.Text
  summaryUpdatedAt      DateTime?
}
```

## 6. Patch / миграция данных

Нет. AnswerCache/RetrievalCache — populated lazily. Существующие conversations будут summarize'нуты cron'ом постепенно.

## 7. REST API

Расширение existing `POST /api/v1/chat-v2/messages`:
- Optional body field `validAt?: ISO8601-date` (temporal query).
- Response unchanged, но при cache hit добавляется header `X-Z-Cache: hit|miss`.

Новый endpoint `POST /api/v1/chat-v2/conversations/:id/clear-cache` (admin/owner):
- Очищает AnswerCache+RetrievalCache по prefix `*conversationId*`.

## 8. BullMQ worker'ы и cron'ы

- `ConversationSummarizerCron` — `@Cron('*/30 * * * *')`.
  - Filter: `messageCount > 12 AND (summaryUpdatedAt IS NULL OR summaryUpdatedAt < now() - 12h)`.
  - Per conversation: LLM-вызов `dialog-summarize` → update summary atomically.
  - JobId паттерн — `summarize_${conversationId}_${messageCount}`. Idempotent.
- Cache invalidation НЕ через cron — через event-listener на `CardVersion.create` (BullMQ event subscriber).

## 9. LlmTaskType регистрация

`backend/scripts/seed-llm-task-routes-dialog-layer.ts`:
```ts
// dialog-contextualize: standalone-question recovery, частый, дешёвый
{ taskType: 'dialog-contextualize',  priority: 'primary',   provider: 'ollama',   model: 'qwen3.5:9b' }
{ taskType: 'dialog-contextualize',  priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'dialog-contextualize',  priority: 'tertiary',  provider: 'openai',   model: 'gpt-4o-mini' }

// dialog-confidence: очень дёшево, бинарная оценка
{ taskType: 'dialog-confidence',     priority: 'primary',   provider: 'ollama',   model: 'qwen3.5:9b' }
{ taskType: 'dialog-confidence',     priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'dialog-confidence',     priority: 'tertiary',  provider: 'openai',   model: 'gpt-4o-mini' }

// dialog-classify: эвристика first, LLM fallback
{ taskType: 'dialog-classify',       priority: 'primary',   provider: 'ollama',   model: 'qwen3.5:9b' }
{ taskType: 'dialog-classify',       priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'dialog-classify',       priority: 'tertiary',  provider: 'openai',   model: 'gpt-4o-mini' }

// dialog-multi-query: 3 переформулировки, средняя стоимость
{ taskType: 'dialog-multi-query',    priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'dialog-multi-query',    priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'dialog-multi-query',    priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }

// dialog-summarize: средне-дорогой (нужно сжатие)
{ taskType: 'dialog-summarize',      priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'dialog-summarize',      priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'dialog-summarize',      priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }
```

## 10. RBAC ResourceType

`chat_v2.message` — существует. Расширений нет.
`chat_v2.cache.clear` — новый, admin/owner.

## 11. Метрики Prometheus

- `answer_cache_hit_total{tenant_top}` counter.
- `retrieval_cache_hit_total{tenant_top}` counter.
- `dialog_processing_duration_seconds{step}` histogram — step ∈ {contextualize|confidence|classify|multi-query|summarize}.
- `conversation_summary_total{tenant_top}` counter.
- `dialog_confidence_low_total{tenant_top}` counter (когда confidence < 0.5 → fallback).
- Cardinality ~ 100 × 5 = 500.

## 12. Frontend

- Existing `/chat-v2` page — добавить визуальный индикатор «Кэш hit» (subtle badge) при `X-Z-Cache: hit` header.
- Optional: DateRange picker для validAt («задать дату для temporal query») в advanced-search slot.
- No major page changes — orchestration изменения прозрачны для UI.

## 13. ENV переменные

- `DIALOG_LAYER_ENABLED: boolean (default true)`.
- `ANSWER_CACHE_TTL_SECONDS: number (default 86400)`.
- `RETRIEVAL_CACHE_TTL_SECONDS: number (default 3600)`.
- `CONTEXTUALIZER_CONFIDENCE_MIN: number (default 0.5)`.
- `SUMMARIZER_MESSAGE_THRESHOLD: number (default 12)`.
- `MULTI_QUERY_EXPANSION_ENABLED: boolean (default true)`.

## 14. Связь с существующим кодом

- `backend/src/modules/chat-v2/chat-v2-orchestration.service.ts` — точка интеграции `DialogService.process()`.
- `backend/src/modules/knowledge-core/services/chat-v2.service.ts` — accept `intent`/`validAt`/`queries[]` параметры.
- `backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts` — реализация фильтра validAt.
- `backend/src/common/redis/` — для Cache implementations.
- `backend/src/modules/ai/services/llm-router.service.ts` — для LLM calls.
- schema.prisma `ChatV2Conversation`.

## 15. DoD

- [ ] dialog-layer модуль создан с 5 сервисами + Cron + Cache implementations.
- [ ] 5 LlmTaskType зарегистрированы.
- [ ] AnswerCache hit rate ≥ 30% на тест-сценарии «3 идентичных вопроса подряд».
- [ ] RetrievalCache hit rate ≥ 60% на «10 похожих вопросов вокруг одной темы».
- [ ] Temporal query тест: `validAt = 2025-01-01` для evolving card возвращает версию валидную на эту дату.
- [ ] ConversationSummarizerCron сжимает >12-message conversation, новые messages используют summary в systemPrompt.
- [ ] Standalone question test: «А сколько стоит?» после диалога про продукт X → standalone-вопрос с продуктом X.
- [ ] Multi-query expansion даёт recall ≥ 85% на тестовом наборе exploratory-запросов.
- [ ] Cache invalidation работает при CardVersion.create.
- [ ] Метрики в /metrics.
- [ ] `bun run typecheck` + `bun run lint` + `bunx vitest run` зелёные.

## 16. Тесты

- **unit:** `contextualizer.service.spec.ts` — recover standalone из mocked conversation.
- **unit:** `confidence-estimator.service.spec.ts` — high/low confidence scenarios + fallback.
- **unit:** `query-classifier.service.spec.ts` — эвристика matches + LLM fallback.
- **unit:** `multi-query-expansion.service.spec.ts` — 3 формулировки + intent gating.
- **unit:** `conversation-summarizer.cron.spec.ts` — threshold + summary update.
- **unit:** `answer-cache.service.spec.ts` — set/get/TTL/invalidate.
- **integration:** `dialog-service.integration.spec.ts` — process() end-to-end с mocked LLM.
- **integration:** `chat-v2-temporal.integration.spec.ts` — validAt фильтр в реальном retrieval.
- **integration:** `cache-invalidation.integration.spec.ts` — CardVersion.create → cache cleared.

## 17. Риски и mitigation

- **Регрессия в chat-v2 ядре** — DialogService обёртка, не модификация. Feature-flag `DIALOG_LAYER_ENABLED=false` отключает (fallback на raw userMessage).
- **Cost-spike на cache miss** — 5 LLM-calls (contextualize+confidence+classify+multi-query+synthesize) — primary models дешёвые (ollama/deepseek-chat) + AnswerCache минимизирует.
- **Stale cache** — TTL + event-based invalidation. Acceptable freshness — до 1 часа для retrieval.
- **Conversation.summary потеря качества** — LLM может «потерять» важные детали. Mitigation: summary включает list of mentioned entities (явный JSON-section); цепочка summary→messages всегда содержит last 6 raw messages.
- **Schema merge** — изменяем только `ChatV2Conversation` — не пересекается с другими wave-3 sub-ТЗ.
- **Multi-tenancy в cache** — tenantId — обязательная часть key-prefix.
- **`.next/types/` кэш** — minimal frontend изменения, но Remove-Item на всякий случай после правок.
