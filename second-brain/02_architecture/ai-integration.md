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

### Embeddings — OpenAI через прокси (`OpenAiProxyEmbeddingService`)

- **Сервис:** `OpenAiProxyEmbeddingService` (`embeddings/services/openai-proxy-embedding.service.ts`), провайдер `openai-via-proxy` (`EMBEDDING_PROVIDER`).
- **Endpoint:** `https://proxy.agent-lia.ru/v1/embeddings` (OpenAI-совместимый), auth `Bearer myFeedproxy3128:<KEY>`.
- **Модель:** `text-embedding-3-small`, размерность `1536`.
- **Прочее:** доступны `local` (self-hosted) и `openai-direct` как альтернативы `EMBEDDING_PROVIDER`.

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

# Embeddings (OpenAI через proxy.agent-lia.ru)
EMBEDDING_PROVIDER=openai-via-proxy
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_PROXY_EMBEDDINGS_URL=https://proxy.agent-lia.ru/v1/embeddings
OPENAI_API_KEY=sk-proj-...

# MiniMax (Anthropic-совместимый канал роутера)
MINIMAX_API_KEY=...
```

## Связанные заметки

- [[../01_projects/ai-analysis-by-type]] — что вытаскиваем по каждому типу встречи (промпты).
- [[../01_projects/recording]] — где берём аудио (Track Egress → S3).
- `plans/analysis/2026-05-05-ai-pipeline-providers.md` — план интеграции пайплайна.

[[../index|← index]]
