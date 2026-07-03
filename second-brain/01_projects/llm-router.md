---
title: LlmRouter — маршрутизация LLM-вызовов
status: actual
updated: 2026-05-10
---

# LlmRouter

`backend/src/modules/ai/services/llm-router.service.ts` — центральный диспетчер LLM-вызовов в Z. Через него проходят ВСЕ AI-задачи.

> Этот файл — про **реализацию роутера** (контракт `call()`, схемы, кэш). Какие провайдеры/модели реально работают и какие закладывать в дефолты — единственный источник правды [llm-providers-verified.md](llm-providers-verified.md).

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

Legacy (до Фаз 5-6):
- `summary`, `chapters`, `tasks`, `chat`, `card-chat`, `card-rollup`
- `regenerate-section`, `custom-prompt`, `follow-up`, `clip-title`

Knowledge-core (Фазы 1-6, реализованы и активно вызываются из воркеров/сервисов):
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

**`experiment` Json — DEPRECATED (2026-07-03).** Легаси-механизм A/B (рандомный выбор A/B на каждый вызов, `/admin/experiments`) выведен из эксплуатации целиком (ТЗ [`2026-07-03-llm-model-ab-experiments-real-split.md`](../../plans/tz/2026-07-03-llm-model-ab-experiments-real-split.md)). Поле больше не читается/не пишется новым кодом — оставлено в схеме без функции.

**Канонический A/B-механизм сегодня — `LlmModelExperiment`** (отдельная таблица: `controlModel/controlProvider/variantModel/variantProvider/splitPercent/status('draft'|'running'|'stopped'|'completed')/startedAt/endsAt/createdById/notes`). `LlmRouterService.chooseProviders()` читает активные (`status='running'`, в окне `[startedAt,endsAt)`) записи из in-memory кэша (`activeModelExperiments`, обновляется в `refreshCache()`), деление трафика — **sticky по `meetingId`** (`simpleHash(experimentId::meetingId) % 100 < splitPercent`), а не рандом на каждый вызов — один и тот же `meetingId` всегда попадает в одну группу. Управление — REST `/admin/llm-model-experiments*` (`AdminAiModelsService`), UI — вкладка «A/B-тест» на `/admin/ai/routing/[taskType]` (`ExperimentTabSection.tsx`).

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
  experimentGroup? ('A' control | 'B' variant, из LlmModelExperiment; | 'gepa_candidate'),
  createdAt
}
```

Индексы: `[meetingId]`, `[createdAt]`, `[userId, taskType, createdAt]`, `[tenantId, createdAt]`, `[tenantId, taskType, createdAt]`.

## Adapters (текущие)

- `AnthropicService` — Anthropic Messages API (через прокси при `ANTHROPIC_USE_PROXY`). **Не используется и не закладывается в дефолты:** по решению владельца Claude в Z не подключён (ключ невалиден), сервис остаётся в коде на случай будущего подключения. См. [llm-providers-verified.md](llm-providers-verified.md) (раздел «Каналы, которые НЕ работают»).
- `MinimaxService` — Anthropic-совместимый.
- `OpenAiProxyService` — OpenAI через прокси.
- `DeepSeekService` (Фаза 2 шаг 0, 2026-05-10) — DeepSeek native API:
  поддерживает `responseFormat: 'text' | 'json_object' | 'json_schema'`
  и `reasoningEffort` (`low/medium/high`) для DeepSeek-V4-pro.
- `OllamaService` (Фаза 2 шаг 0, 2026-05-10) — self-hosted chat-моделей
  (`qwen3.5:9b`). API-совместим с OpenAI Chat Completions. Embeddings `bge-m3`
  не реализованы (модели на инстансе нет — эмбеддинги идут через
  `text-embedding-3-small`); сам канал выведен из боевых LLM-цепочек 2026-06-05.
  Канал-SoT — [llm-providers-verified.md](llm-providers-verified.md).

## Структурированный вывод (Фаза 2)

`LlmCompleteInput.responseFormat`:
- `{ type: 'text' }` — обычный текст.
- `{ type: 'json_object' }` — best-effort JSON.
- `{ type: 'json_schema', name, strict: true, schema }` — strict JSON Schema.
  Используется в knowledge-core для всех LLM-арбитров (block-distill,
  entity-merge-arbiter) и block-ingest.

`LlmCompleteOutput.cachedTokens` — провайдеры с prompt cache (DeepSeek,
Anthropic) возвращают; пишется в AiUsageLog.

## taskType-семья knowledge-core (Фаза 2)

- `block-ingest` — извлечение IdeaBlock'ов из сегментов диалога.
- `block-distill` — арбитр merge / distinct между новым и top-5 candidate'ом.
- `entity-merge-arbiter` — арбитр сущностей с metadata-контекстом.
- `block-linker`, `theme-classify`, `reframing` — реализованы и вызываются
  из соответствующих сервисов/кронов knowledge-core.

Дефолтные routes изначально засеяны через `seed-llm-task-routes-knowledge-core.ts`
(политика 2026-05): primary — `deepseek:deepseek-v4-flash`, fallback —
`openai-via-proxy:gpt-5.4-mini`. С 2026-06-05 цепочки нормализованы к
стандарту `deepseek → openai(gpt) → kie:gemini-3.1-pro` (ollama выведен из всех
боевых цепочек) — патч `patch-normalize-llm-chains-deepseek-openai-kie.ts`.
Актуальная карта каналов — [llm-providers-verified.md](llm-providers-verified.md).

## Providers как массив

`LlmTaskRoute.providers` теперь — JSON-массив `[{provider, model?}]`. Это
позволяет переопределять fallback-цепочку per-task без изменения кода.

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
