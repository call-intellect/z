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

### LLM (шаблоны по типу встречи) — Anthropic Claude Sonnet

- **Endpoint:** `api.anthropic.com` (прямо, без нашего прокси).
- **Модель на старте:** `claude-sonnet-4-6`.
- **Возможности:** prompt caching (до -90% input для стабильного system-промпта), длинный контекст (≥1M токенов).
- **Если из РФ-IP получим `403 "Request not allowed"`** — fallback на:
  1. MiniMax-M2.5 (Anthropic-совместимый, прямой);
  2. GPT-5.2 / GPT-4.1 через `proxy.agent-lia.ru/v1/responses`.

### Прокси для OpenAI / Gemini — `proxy.agent-lia.ru`

Не используем на старте Z, но доступен для:
- OpenAI (Responses API, Embeddings) — `proxy.agent-lia.ru/v1/...` с `Bearer myFeedproxy3128:<KEY>`;
- Gemini через grsai / KIE — для fallback'ов.

## Что это меняет для проекта

1. **Провайдеров не выбираем.** Этот вопрос закрыт инфраструктурой компании — в `plans/analysis/2026-05-05-ai-pipeline-providers.md` остаётся только интеграция.
2. **Готовые SDK-вызовы** есть в Crossmark (Anthropic streaming, Vox submit/poll, OpenAI Responses) — копируются один-в-один в Z.
3. **Логирование `ai_usage_logs`** — нужно завести аналогичную таблицу с полями `inputTokens / outputTokens / costUsd / durationMs / success` для биллинга и алертов.
4. **Цены модели** уже известны (см. reference §12) — экономика на встречу: при ~25k input токенов и Claude Sonnet ($3/1M input + $15/1M output) одна встреча ≈ $0.08–$0.12 + ASR.

## ENV для Z

```ini
# Anthropic (LLM-шаблоны по типу встречи)
ANTHROPIC_API_KEY=sk-ant-...

# GigaAM Vox (транскрибация)
VOX_API_URL=https://vox.agent-lia.ru
VOX_API_TOKEN=...

# OpenAI через proxy (для fallback)
OPENAI_API_KEY=sk-proj-...

# MiniMax (Anthropic-совместимый fallback)
MINIMAX_API_KEY=...
```

## Связанные заметки

- [[../01_projects/ai-analysis-by-type]] — что вытаскиваем по каждому типу встречи (промпты).
- [[../01_projects/recording]] — где берём аудио (Track Egress → S3).
- `plans/analysis/2026-05-05-ai-pipeline-providers.md` — план интеграции пайплайна.

[[../index|← index]]
