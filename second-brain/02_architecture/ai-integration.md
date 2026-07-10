---
type: architecture
---

# AI Integration — внутренние API компании

> Полная техническая карта (ENV, SDK-вызовы, цены, fallback) лежит в memory как reference `LLM Integration Handover (Crossmark)` — она автоматически подтягивается при упоминании AI. Здесь — только проектные решения для **Z**.

## Что используем для Z

### Транскрибация (ASR) — GigaAM Vox

- **Сервис:** `vox.agent-lia.ru` (наш self-hosted GigaAM v3 RNN-T).
- **Модель:** `v3_rnnt`.
- **Язык:** русский (основной).
- **Протокол:** submit (multipart/form) → poll по `taskId` (interval 2s, до 60 раз).
- **Параметры на старте:**
  - `punctuationMode: 'pro'` — расставляем пунктуацию.
  - `diarizationEnabled: false` — спикер известен по `participant_id` (отдельные дорожки), диаризация Vox не нужна.

### LLM (шаблоны по типу встречи) — DeepSeek через `LlmRouterService`

- **Маршрутизация:** все LLM-вызовы идут через `LlmRouterService` (`ai/services/llm-router.service.ts`), который выбирает провайдер по `taskType` и `dataClass`.
- **Основной провайдер:** `deepseek` (прямой, `https://api.deepseek.com/v1`).
- **Модели:** `deepseek-v4-flash` (по умолчанию, `DEEPSEEK_DEFAULT_MODEL`) и `deepseek-v4-pro` (reasoning, напр. GEPA). Основной отчёт встречи (`LLM_MAIN_REPORT_PRIMARY`) — `deepseek`.
- **Возможности:** prompt caching (см. [llm-cache-status.md](llm-cache-status.md) — DeepSeek кэширует на ~99% от 64 токенов).
- **Claude / Anthropic — НЕ закупаем** (решение владельца; Opus/Claude не закупается, DeepSeek-v4 — primary). Канал `anthropic` в роутере **реализован** (`case 'anthropic'` → `AnthropicService`, capability=`sensitive`), но по стандарту маршрутизации не назначается primary для COS-задач и отфильтровывается на private-данных (`sensitive < private`). См. [llm-cache-status.md](llm-cache-status.md) (строка 11) и [llm-providers-verified.md](../01_projects/llm-providers-verified.md).
- **Прочие каналы роутера:** `openai-via-proxy` (gpt-5* через `proxy.agent-lia.ru/v1/responses`), `minimax` (Anthropic-совместимый, прямой). Полная verified-карта — [llm-providers-verified.md](../01_projects/llm-providers-verified.md).

#### DB-реестр `LlmProvider` — боевой источник подключений (2026-07-02)

С 2026-07-02 (`USE_PROTOCOL_ADAPTER_REGISTRY=true` по умолчанию, Ship-On) все 7 провайдеров резолвятся через `ProviderInfoResolver` из таблицы `LlmProvider`, а не из ENV напрямую:

- **Резолв:** `ProviderInfoResolver.resolveByName(name)` — DB-строка `LlmProvider` (кэш 60с); БД-строки нет → `null`, dispatch бросает «провайдер не найден» (ENV-fallback `buildFromEnv()` удалён 2026-07-09, коммит 5d8f9137).
- **Прокси-формула** (единственная реализация — `resolveEffectiveConnection` в [effective-connection.util.ts](../../backend/src/modules/ai/services/protocol-adapter/effective-connection.util.ts), используют резолвер и admin discover-preview): `useProxy=false` → `baseUrl` как есть; `useProxy=true, proxyPath=null` → корневой `PROXY_BASE_URL`; `useProxy=true, proxyPath='X'` → `{proxyRoot}/X/v1`. Исключение — протоколы, строящие путь с `/v1` сами (`PROTOCOLS_APPENDING_OWN_PATH`: `anthropic-messages`, `kie-native`): им `/v1` не дописывается — `{proxyRoot}/X`, при пустом path — `{proxyRoot}`. Anthropic через прокси = `proxyPath=anthropic` → `…/anthropic/v1/messages`, ключ в `x-api-key` (нужен openai-proxy с anthropic-маршрутом от 2026-07-10, см. [plans/tz/2026-07-10-anthropic-proxy-route.md](../../plans/tz/2026-07-10-anthropic-proxy-route.md)). Ключ при `useProxy=true` префиксуется `PROXY_PREFIX:`.
- **Честные протоколы** (`ProtocolKind`): `openai-chat`/`openai-responses`/`anthropic-messages`/`ollama-native`/`kie-native`/`grsai-native`/`custom-http` — каждый резолвится в `LlmProtocolAdapterRegistry`. `kie-native`/`grsai-native` заменили фейковый `custom-http`, на котором до этой фазы smoke kie/grsai был гарантированно красным (несуществующий протокол).
- **Connection-override:** легаси-сервисы (`AnthropicService`/`MinimaxService`/`OllamaService`/`KieService`/`GrsaiService`/`OpenAiProxyService`) принимают опциональный `override?: LlmConnectionOverride` — без override поведение байт-в-байт как раньше (ENV), с override — строят клиент/URL из переданных значений (DB).
- **Дискавери моделей:** `POST /api/v1/admin/llm-providers/:id/models/discover` → `GET {effectiveBaseUrl}/models` (OpenAI-формат); для `anthropic-messages` автополучение не реализовано — модели добавляются вручную.
- **Дефолт-модель провайдера:** `LlmProvider.defaultModelKey` — приоритет в `dispatch()`: `params.model ?? entry.model ?? defaultModelKey ?? легаси-дефолт-сервиса`.
- **dataClass-фильтр:** читает `LlmProvider.capability` из БД с фолбэком на хардкод-карту `PROVIDER_CAPABILITY` (код).
- **Дефолт-цепочка** (когда для taskType нет маршрута) — `AdminSetting` ключ `llm.router.defaultChain` (code-fallback = прежний хардкод `DEFAULT_FALLBACK_CHAIN`: deepseek→openai-via-proxy→kie/gemini-3.1-pro). С 2026-07-09: `setDefaultProvider` автоматически ставит выбранного провайдера в начало `defaultChain` (`ensureDefaultChainPrimary`, через `AdminSettingsService.set`) — иначе дефолт-провайдер не резолвился в runtime для пустых taskType. `list()`/`detail()` ai-models отдают `effectivePrimary` (= `defaultChain[0]`) для taskType без явного primary, а UI таблицы роутинга показывает «primary · по умолчанию» вместо «— не задана —».
- **Bulk-назначение маршрутов** (`/admin/ai/routing` → «Балковое назначение»): с 2026-07-09 провайдеры и модели берутся из каталога `LlmProvider`/`LlmModel` (через searchable combobox `SearchSelect`), не из legacy-enum `AI_MODELS_PROVIDERS`; при смене провайдера модель автоподставляется из `defaultModelKey`. Ручной ввод модели убран — только каталог. DTO `BulkReassignSchema.toProviderName` ослаблен с enum на string+regex (валидация против каталога — в сервисе).
- **Kill-switch:** `USE_PROTOCOL_ADAPTER_REGISTRY=false` в `.env` откатывает на legacy ENV-switch (прежнее поведение) без изменения кода — см. `feature-flags.md`.
- **Управление из UI:** `/admin/ai/catalog` (CRUD провайдеров/моделей, см. [[../01_projects/admin]]).
- **ТЗ:** [plans/tz/2026-07-02-llm-providers-models-routing-admin.md](../../plans/tz/2026-07-02-llm-providers-models-routing-admin.md).

### Embeddings — локальная Ollama через `llm.korateam.ru` (`LocalEmbeddingService`)

- **Сервис:** `LocalEmbeddingService` (`embeddings/services/local-embedding.service.ts`), провайдер `local` (`EMBEDDING_PROVIDER=local` — primary с 2026-06-30).
- **Endpoint:** `https://llm.korateam.ru/v1/embeddings` (Ollama OpenAI-совместимый), auth `Bearer ${EMBEDDING_LOCAL_API_KEY}` (опционально).
- **Модель:** `embeddinggemma:latest`, размерность `768` (MRL, можно резать до 512/256/128/64).
- **Fallback:** `OpenAiProxyEmbeddingService` (`EMBEDDING_PROVIDER=openai-via-proxy` → `https://proxy.agent-lia.ru/v1/embeddings`, модель `text-embedding-3-small`, 1536-dim). Цепочка в `EmbeddingFallbackService.buildChain()`.
- **Схема БД:** все `vector(N)` колонки мигрированы на `vector(768)` (см. `plans/tz/2026-06-30-embeddinggemma-768-migration.md`). HNSW-индексы `vector_cosine_ops` остались (`m=16, ef_construction=128`).
- **Прочее:** `EMBEDDING_PROVIDER=openai-direct` задекларирован в схеме, но реализации нет.

## Что это меняет для проекта

1. **Провайдеров не выбираем.** Этот вопрос закрыт инфраструктурой компании — в `plans/analysis/2026-05-05-ai-pipeline-providers.md` остаётся только интеграция.
2. **Готовые SDK-вызовы** есть в Crossmark (DeepSeek chat, Vox submit/poll, OpenAI Responses/Embeddings) — копируются один-в-один в Z.
3. **Логирование `ai_usage_logs`** — нужно завести аналогичную таблицу с полями `inputTokens / outputTokens / costUsd / durationMs / success` для биллинга и алертов.
4. **Цены модели** — экономика считается по DeepSeek (`deepseek-v4-flash`/`deepseek-v4-pro`), не по Claude; цены и пороги кэша — в [llm-providers-verified.md](../01_projects/llm-providers-verified.md) и [llm-cache-status.md](llm-cache-status.md).

## ENV для Z

```ini
# DeepSeek (основной LLM через LlmRouterService)
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_DEFAULT_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=...
LLM_MAIN_REPORT_PRIMARY=deepseek

# GigaAM Vox (транскрибация)
VOX_API_URL=https://vox.agent-lia.ru
VOX_API_TOKEN=...

# Embeddings (локальная Ollama — embeddinggemma 768 dim, primary с 2026-06-30)
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=embeddinggemma:latest
EMBEDDING_DIMENSIONS=768
EMBEDDING_FALLBACK_LOCAL_URL=https://llm.korateam.ru/v1
EMBEDDING_LOCAL_API_KEY=sk-emb-...
# Fallback на OpenAI через прокси (цепочка: local → openai-via-proxy)
OPENAI_PROXY_EMBEDDINGS_URL=https://proxy.agent-lia.ru/v1/embeddings
OPENAI_PROXY_API_KEY=sk-proj-...

# MiniMax (Anthropic-совместимый канал роутера)
MINIMAX_API_KEY=...
```

## Связанные заметки

- [[../01_projects/ai-analysis-by-type]] — что вытаскиваем по каждому типу встречи (промпты).
- [[../01_projects/recording]] — где берём аудио (Track Egress → S3).
- `plans/analysis/2026-05-05-ai-pipeline-providers.md` — план интеграции пайплайна.

[[../index|← index]]
