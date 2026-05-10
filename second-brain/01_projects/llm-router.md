---
title: LlmRouter — маршрутизация LLM-вызовов
status: actual
updated: 2026-05-10
---

# LlmRouter

`backend/src/modules/ai/services/llm-router.service.ts` — центральный диспетчер LLM-вызовов в Z. Через него проходят ВСЕ AI-задачи.

## Зачем нужен

- **DB-конфигурируемая маршрутизация:** для каждого `taskType` (chapters, summary, chat, card-rollup, regenerate-section, и т.д.) указан список провайдеров в `LlmTaskRoute.providers` (JSON). Меняется через Z-Admin без передеплоя.
- **Fallback chain:** провайдеры пробуются последовательно; на любую ошибку — следующий. Все упали → `LlmRouterAllProvidersFailedError`.
- **Учёт стоимости:** на каждый вызов пишется `AiUsageLog` через `AiUsageLogService.record()`. costUsd — через `calcCostUsd()` (см. [model-prices.ts](../../backend/src/modules/ai/services/model-prices.ts) или БД-таблицу `LlmModelPrice`).
- **Метрики:** `llm_router_dispatch_total{taskType, provider, status}` (success/fallback/failed).

## Контракт `call()`

```typescript
interface LlmCallParams {
  taskType: LlmTaskType;
  systemPrompt: string;
  userMessage: string;
  tenantId: string | null;     // ОБЯЗАТЕЛЬНО (Фаза 0 knowledge-core)
  meetingId?: string;
  userId?: string;
  jobId?: string;
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  model?: string;              // override для бенчмарков
  sourceRef?: { type: string; id: string }; // drill-down для Z-Admin
}
```

**Жёсткое правило:** `tenantId` — обязательное поле. Если caller не может определить tenant (system jobs без owner) — допустимо `null` явно. Эта строгость нужна для биллинга в Z-Admin (Фаза 7).

Helpers:
- `LlmRouterService.resolveTenantByMeeting(meetingId)` — извлечь tenantId из Meeting.
- `LlmRouterService.resolveTenantByUser(userId)` — взять первый Membership.

## taskType (Фаза 0)

Существующие (legacy, до Фаз 5-6):
- `summary`, `chapters`, `tasks`, `chat`, `card-chat`, `card-rollup`
- `regenerate-section`, `custom-prompt`, `follow-up`, `clip-title`

Будущие (Фазы 1-6 knowledge-core):
- `block-ingest`, `block-distill`, `block-linker`
- `entity-resolver`, `entity-merge-arbiter`
- `theme-classify`, `theme-clusterer`
- `reframing`, `card-rollup-v2`
- `task-extract-v2`, `chapter-extract-v2`, `summary-v2`
- `chat-v2`, `goal-alignment`, `dashboard-summary`

## LlmTaskRoute (DB)

```
LlmTaskRoute {
  id, taskType, tenantId? (NULL = глобальный дефолт),
  providers Json (string[] или {provider, model}[]),
  isActive, experiment Json?, updatedAt
  @@unique([taskType, tenantId])
}
```

**`tenantId`:**
- `NULL` — глобальный дефолт от super_admin (видят все Org).
- не-NULL — override на конкретную Org (Z-Admin Фаза 7).

**`experiment` Json (Фаза 7):**
```
{
  enabled: bool,
  modelA: string, modelB: string,
  splitPercent: number,
  startedAt: ISO, endsAt: ISO
}
```
Когда `enabled=true` — LlmRouter рандомно выбирает A/B и пишет `experimentGroup` в `AiUsageLog`. На Фазе 0 поле есть, логика A/B — Фаза 7.

## LlmModelPrice (версионируемая прайс-карта)

```
LlmModelPrice {
  id, provider, model,
  inputCostPerMillionTokens, outputCostPerMillionTokens,
  cachedCostPerMillionTokens (default 0),
  currency (default USD),
  effectiveFrom (default now), effectiveTo?
}
```

**Логика расчёта** (Фаза 7+, на Фазе 0 LlmRouter всё ещё использует in-code `calcCostUsd`):
1. Сначала смотрим в БД: актуальная запись по `provider+model+effectiveFrom<=now AND (effectiveTo IS NULL OR effectiveTo>now)`.
2. Если нет — фолбэк на `MODEL_PRICES` в [model-prices.ts](../../backend/src/modules/ai/services/model-prices.ts).

При смене цены провайдером — закрываем старую (`effectiveTo=now`), создаём новую. Ретроспективные расчёты используют цену на момент вызова. Сейд: [seed-llm-model-prices.ts](../../backend/scripts/seed-llm-model-prices.ts).

## AiUsageLog (расширения Фазы 0)

```
AiUsageLog {
  id, tenantId?, meetingId?, userId?,
  agentType, taskType?, jobId?,
  model, provider,
  inputTokens, outputTokens, cachedTokens (NEW),
  reasoningTokens?, costUsd Decimal(10,6),
  durationMs, success, errorText?,
  sourceRef Json? (NEW: { type, id }),
  experimentGroup? (NEW: 'A'|'B'),
  createdAt
}
```

Индексы: `[meetingId]`, `[createdAt]`, `[userId, taskType, createdAt]`, `[tenantId, createdAt]`, `[tenantId, taskType, createdAt]`.

## Adapters (текущие)

- `AnthropicService` — Anthropic Messages API (через прокси при `ANTHROPIC_USE_PROXY`).
- `MinimaxService` — Anthropic-совместимый.
- `OpenAiProxyService` — OpenAI через прокси.

**TODO (вне Фазы 0):**
- `DeepSeekService` — для перевода primary stack на DeepSeek (см. ТЗ §1).
- `OllamaService` — для self-hosted моделей (qwen, bge-m3 embeddings).

## Cron

`@Cron(EVERY_MINUTE)` — `refreshCacheTick()` подтягивает изменения routes из БД. Максимум 60 сек до применения после изменения через UI.

## Точки вызова в коде (Фаза 0)

Все обновлены и передают `tenantId`:
- `chat.service` (single/cross-meeting/card)
- `chapter-extraction.service` (через worker)
- `task-extraction.service` (через worker)
- `regenerate.service`
- `card-rollup.service`

Спека `llm-router.service.spec.ts` обновлена под новый findFirst+create контракт `setRoute()` (вместо upsert — composite unique с NULL не поддерживается Prisma).
