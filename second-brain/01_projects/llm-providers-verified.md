---
title: LLM-провайдеры и модели — verified
status: actual
verified_at: 2026-05-24
updated: 2026-05-24
---

# LLM-провайдеры Z — verified карта

> **Единственный источник правды о том, какие LLM-вызовы реально работают.**
> Любой новый AI-агент в Z должен использовать только провайдеры/модели из
> этой таблицы. Если задумываешься о новой модели — сначала добавь её сюда
> через прогон [backend/scripts/smoke-llm-providers.ts](../../backend/scripts/smoke-llm-providers.ts).
>
> Целевая политика дефолтов — в [llm-models-playbook.md §2.1](../../docs/reference/llm-models-playbook.md).
> Карта реализации в коде — в [llm-router.md](llm-router.md).

## Когда читать этот файл

- Создаёшь новый AI-агент / worker / `LlmTaskType`.
- Меняешь модель в `LlmTaskRoute` через Z-Admin или seed.
- Дописываешь fallback-цепочку.
- Сомневаешься, какой канал выбрать для конкретной задачи.

## Verified-таблица (последний прогон от 2026-05-24)

> Колонка **«В LlmRouter»** показывает, подключён ли канал к `LlmTaskRoute` /
> админке `/admin/ai-models`. Если ✗ — модель проверена smoke-вызовом, но
> переключить её на agent через админку **нельзя**, пока не реализовано ТЗ
> [2026-05-24-kie-grsai-llm-router-integration.md](../../plans/tz/2026-05-24-kie-grsai-llm-router-integration.md).

### A. Каналы в продакшен-роутере (доступны через админку)

> Колонка **«Кэш»** добавлена 2026-05-25 — фактическое состояние prompt caching по итогам контрольного эксперимента. Подробности и сырые цифры — [llm-cache-status.md](../02_architecture/llm-cache-status.md).

| Канал (provider) | Модель | Статус | В LlmRouter | Latency | Кэш | Где использовать |
|---|---|---|---|---|--:|---|
| **deepseek** | `deepseek-v4-flash` | ✓ verified | ✓ | ~1.3s | ✅ 99.9% (мин 64 ток, −99%) | Primary для большинства задач: block-ingest/distill/linker, chat-v2, card-rollup-v2, task-extract-v2, chapter-extract-v2, dashboard-summary |
| **deepseek** | `deepseek-v4-pro` | ✓ verified | ✓ | ~3.2s | ✅ 99.9% | Тяжёлый reasoning: summary-v2, goal-alignment |
| **deepseek** | `deepseek-chat` | ✓ verified | ✓ | ~0.8s | ✅ (по аналогии) | Лёгкие/быстрые ответы; legacy alias |
| **openai-via-proxy** | `gpt-5.5` | ✓ verified | ✓ | ~3.0s | ✅ (gpt-5.4-family, порог ~2048) | Top-intelligence fallback для summary-v2 |
| **openai-via-proxy** | `gpt-5.4` | ✓ verified | ✓ | ~1.4s | ✅ (порог ~2048) | Универсальный fallback для chat-v2 (сложные запросы) |
| **openai-via-proxy** | `gpt-5.4-mini` | ✓ verified | ✓ | ~1.2s | ✅ 99.7% (порог ~2048) | Primary fallback общего потока |
| **openai-via-proxy** | `gpt-5.4-nano` | ✓ verified | ✓ | ~1.5s | ⚠ кэш только при ≥2048 ток (классификаторы могут не попадать) | Primary для коротких классификаторов: theme-classify, entity-resolver |
| **openai-via-proxy** | `gpt-5-mini` | ✓ verified | ✓ | ~0.9s | ✅ 99.8% (мин 1024 ток, −90%) | Лёгкий быстрый канал, legacy дефолт `OpenAiProxyService` |
| **openai-via-proxy** | `gpt-4.1-mini` | ✓ verified | ✓ | ~3.4s | ✅ (по аналогии с gpt-5*) | Не-reasoning fallback (нужен `temperature`) |
| **openai-via-proxy** | `gpt-4o-mini` | ✓ verified | ✓ | ~1.7s | ✅ (по аналогии) | Не-reasoning fallback (нужен `temperature`) |
| **openai-via-proxy** | `gpt-4o` | ✓ verified | ✓ | ~2.5s | ✅ (по аналогии) | concierge-respond, brand-voice-extract, orchestrator-plan/synthesize. ⚠ нет в `MODEL_PRICES` — стоимость считается как 0 |
| **minimax** | `MiniMax-M2.5` | ✓ verified | ✗ (seed нет) | ~1.8s | ✅ 100% (требует явный `cache_control: 'ephemeral'`) | Anthropic-совместимый fallback, A/B-кандидат на summary-v2 |
| **minimax** | `MiniMax-M2.7` | ✓ verified | ✓ | ~2.9s | ✅ (по аналогии с M2.5) | Свежая M2.7, A/B-кандидат на summary-v2 |
| **ollama** (`ollama.agent-lia.ru`) | `qwen3.5:9b` | ✓ verified | ✓ | ~8.0s | ❌ prompt cache на уровне API не предусмотрен | Self-hosted secondary fallback; единственная chat-модель, реально установленная на нашем Ollama |
| **embeddings** (openai-via-proxy) | `text-embedding-3-small` | ✓ verified | (отдельный pipeline) | ~1.4s | n/a | **Единственный verified канал embeddings.** dim=1536 |

### B. Каналы проверенные smoke-тестом, но НЕ в LlmRouter (через админку недоступны)

Эти каналы реально дёргались с production-ключей и отвечают, но провайдер-сервиса в `LlmRouter` нет, в `LlmTaskRoute` посадить нельзя. Чтобы подключить — см. ТЗ [2026-05-24-kie-grsai-llm-router-integration.md](../../plans/tz/2026-05-24-kie-grsai-llm-router-integration.md).

> **Внимание:** в cache-эксперименте 2026-05-25 ни один канал группы B prompt caching не пробрасывает. При подключении в `LlmRouter` — **в расчётах экономики кэш не учитывать**.

| Канал | URL-формат | Модель | Статус smoke (2026-05-24) | Latency | Кэш |
|---|---|---|---|---|--:|
| **grsai-gemini** | `proxy.agent-lia.ru/grsai/v1/chat/completions` (SSE) | `gemini-3-pro` | ✓ verified | ~10.5s | ❌ 0% (usage без `cached_tokens`) |
| **grsai-gemini** | (то же) | `gemini-3.1-pro` | ✓ verified | ~9.5s | ❌ (по аналогии) |
| **kie-claude** | `api.kie.ai/claude/v1/messages` (Anthropic-compat) | `claude-opus-4-7` | ✓ verified | ~20s | ❌ `cache_read_input_tokens=0` даже с `cache_control` |
| **kie-gpt** | `api.kie.ai/codex/v1/responses` (OpenAI Responses) | `gpt-5-4` (через дефис) | ✓ verified | ~3s | ⚠ нестабильно (S1=0%, S2 parallel=47% — балансировка на разные backend) |
| **kie-gemini-direct** | `api.kie.ai/${model}/v1/chat/completions` (модель в URL) | `gemini-3-flash` | ✓ verified | ~25s | ❌ 0% |
| **kie-gemini** | `proxy.agent-lia.ru/kie/${model}/v1/chat/completions` | `gemini-3-pro` | ⚠ unstable (timeout 60s, раньше ~9s) | TBD | ❌ (по аналогии) |

Latency для KIE-каналов — TBD (зависит от прогона); внести после следующего полного smoke-запуска (`bun scripts/smoke-llm-providers.ts --only=kie-claude,kie-gpt,kie-gemini-direct,kie-gemini,grsai-gemini`).

## Каналы, которые НЕ работают / не используем

| Канал | Причина | Что делать |
|---|---|---|
| **anthropic** (claude-sonnet-4-6, claude-haiku-4-5-20251001, claude-opus-4-7) | `ANTHROPIC_API_KEY` в `.env` невалиден (32 символа, формат KIE-ключа вместо `sk-ant-…`). По решению владельца — **Claude в Z не используем**, ключ не закупаем. | Не предлагать как primary и не закладывать в fallback. Сервис `AnthropicService` остаётся в коде на случай, если когда-нибудь решат подключить — но в дефолтных `LlmTaskRoute.providers` его быть не должно. |
| **embeddings via Ollama** (`bge-m3`) | На `ollama.agent-lia.ru` модели `bge-m3` физически нет, доступны только `qwen3.5:9b` и `kwangsuklee/Nanbeige4.1-3B.Q4_K_M:latest`. По решению владельца — **embeddings через Ollama не делаем**. | Все embeddings идут через `text-embedding-3-small` через прокси (dim=1536). Не закладывать `bge-m3` ни в какие fallback'и. Если когда-нибудь понадобится — DevOps сначала делает `ollama pull bge-m3`, затем повторный smoke. |
| **ollama** (`qwen3:30b-a3b-instruct-2507`) | На нашем инстансе не установлена. Везде, где плейбук упоминает «qwen3:30b-a3b-instruct-2507» — читать как «qwen3.5:9b». | Использовать `qwen3.5:9b`. |
| **ollama** (`kwangsuklee/Nanbeige4.1-3B.Q4_K_M:latest`) | Установлена, но отвечает пустой строкой при выходе 256 токенов (формат-несовместимость с OpenAI-compat chat). | Не использовать. |

## Обязательные правила вызова

1. **Всегда через `LlmRouterService.call({ ... })`** — не дёргать `DeepSeekService.complete()`/`OpenAiProxyService.complete()` напрямую. Router добавляет fallback-chain, `AiUsageLog`, метрики, `dataClass`-фильтр.
2. **`tenantId` обязателен** для любого LLM-вызова (см. [llm-router.md](llm-router.md)).
3. **Модель НЕ хардкодить в коде воркера**. Дефолт берётся из `LlmTaskRoute.providers` (БД). Override через `params.model` — только для бенчмарков.
4. **`max_tokens` ≥ 256** для reasoning-моделей (`deepseek-v4-pro`, `gpt-5*`) — бюджет на скрытое рассуждение. Иначе ответ приходит пустым. См. урок в [plans/analysis/2026-05-21-llm-smoke-test.md](../../plans/analysis/2026-05-21-llm-smoke-test.md).
5. **reasoning effort:**
   - `gpt-5`, `gpt-5-mini`, `gpt-5-nano` — допускают `'minimal'|'low'|'medium'|'high'`.
   - `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.5` — **только** `'none'|'low'|'medium'|'high'` (без `'minimal'` — `OpenAiProxyService` сейчас шлёт `'medium'` по умолчанию, для smoke было поправлено).
6. **Anthropic-провайдеры (`anthropic`) не добавлять в дефолты.** В коде сервис есть, но любой `LlmTaskRoute.providers` со строкой `'anthropic'` будет ронять задачу с 401.
7. **Embeddings → только `text-embedding-3-small` через прокси.** Никакого `bge-m3`.
8. **KIE / GRSAI пока через `LlmRouter` НЕ ходят.** Модели в разделе B доступны только из smoke-скрипта. Если кому-то нужно дёргать Gemini/Claude через KIE из прод-кода — это запрещено до выполнения ТЗ [2026-05-24-kie-grsai-llm-router-integration.md](../../plans/tz/2026-05-24-kie-grsai-llm-router-integration.md). После выполнения ТЗ — переключать через `/admin/ai-models/[taskType]`.
9. **`deepseek-v4-pro` (thinking) НЕ поддерживает strict `json_schema` и forced `tool_choice`** — `400 «This response_format type is unavailable now»` / «Thinking mode does not support this tool_choice». Работает только `tools + tool_choice='auto'`. Для caller-кода это прозрачно: `DeepSeekService.buildParams` автоматически конвертирует `responseFormat: json_schema` в виртуальный `tool` + hint в user-сообщении (ТЗ [2026-05-25-deepseek-pro-output-format-fix.md](../../plans/tz/2026-05-25-deepseek-pro-output-format-fix.md)). Метрика срабатываний — `z_deepseek_schema_to_tool_conversion_total{model}`. Эмпирическая проверка 8 комбинаций — `backend/scripts/eval/probe-deepseek-formats.ts`.

## Готовые образцы вызова (для копи-пейста)

Минимальные snippet'ы для каждого канала. Полные обёртки уже реализованы в `backend/src/modules/ai/services/*.ts` — здесь только для случая, когда нужен прямой вызов вне Nest (smoke, эксперимент, скрипт).

### 1. OpenAI via proxy (Responses API)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1',
  apiKey: `${process.env.PROXY_PREFIX ?? 'myFeedproxy3128'}:${process.env.OPENAI_API_KEY}`,
});

const response = await (client as any).responses.create({
  model: 'gpt-5.4-mini',
  stream: false,
  instructions: 'Ты ассистент. Отвечай кратко.',
  input: [{ role: 'user', content: 'Москва — столица РФ?' }],
  max_output_tokens: 1024,
  reasoning: { effort: 'low' }, // 'low' для gpt-5.4*, 'minimal' можно только для gpt-5/5-mini/5-nano
});

const text = response.output_text ?? '';
```

### 2. DeepSeek (direct, OpenAI-compat chat/completions)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'deepseek-v4-flash',
  stream: false,
  max_tokens: 256,
  messages: [
    { role: 'system', content: 'Ты ассистент. Отвечай кратко.' },
    { role: 'user', content: 'Москва — столица РФ?' },
  ],
});

const text = response.choices?.[0]?.message?.content ?? '';
```

### 3. MiniMax (Anthropic-compat)

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.MINIMAX_API_KEY,
  baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
});

const message = await client.messages.create({
  model: 'MiniMax-M2.5',
  max_tokens: 256,
  system: 'Ты ассистент. Отвечай кратко.',
  messages: [{ role: 'user', content: 'Москва — столица РФ?' }],
});

const text = message.content
  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
  .map((b) => b.text)
  .join('');
```

### 4. Ollama self-hosted (OpenAI-compat)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL ?? 'https://ollama.agent-lia.ru/v1',
  apiKey: process.env.OLLAMA_API_KEY || 'sk-local-test-20260319',
});

const response = await client.chat.completions.create({
  model: 'qwen3.5:9b', // единственная установленная chat-модель
  stream: false,
  max_tokens: 256,
  messages: [
    { role: 'system', content: 'Ты ассистент. Отвечай кратко.' },
    { role: 'user', content: 'Москва — столица РФ?' },
  ],
});
```

### 5. Gemini через grsai (через прокси, SSE-стрим)

```ts
const url = `${process.env.PROXY_BASE_URL?.replace(/\/v1$/, '') ?? 'https://proxy.agent-lia.ru'}/grsai/v1/chat/completions`;
const resp = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.PROXY_PREFIX ?? 'myFeedproxy3128'}:${process.env.GRSAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'gemini-3-pro',
    stream: true,
    max_tokens: 256,
    messages: [
      { role: 'system', content: 'Ты ассистент. Отвечай кратко.' },
      { role: 'user', content: 'Москва — столица РФ?' },
    ],
  }),
});
// Парсинг SSE — см. collectSse() в backend/scripts/smoke-llm-providers.ts
```

### 6. Embeddings (OpenAI через прокси)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1',
  apiKey: `${process.env.PROXY_PREFIX ?? 'myFeedproxy3128'}:${process.env.OPENAI_API_KEY}`,
});

const response = await client.embeddings.create({
  model: 'text-embedding-3-small',
  input: ['строка 1', 'строка 2'], // батч до 100
});

const vectors = response.data.map((d) => d.embedding); // dim=1536
```

## Как переверифицировать карту

```bash
cd backend && bun scripts/smoke-llm-providers.ts
```

Опционально ограничить:
```bash
bun scripts/smoke-llm-providers.ts --only=deepseek,openai-via-proxy
bun scripts/smoke-llm-providers.ts --skip=kie-gemini
```

После прогона:
- JSON-отчёт → `backend/tmp/llm-smoke-<timestamp>.json`.
- Если статус модели изменился (✓ ↔ ✗) — обнови этот файл + дату `verified_at` в frontmatter.
- Если появилась новая работающая модель — добавь строку в Verified-таблицу + образец вызова.

## Связанные документы

- [llm-models-playbook.md](../../docs/reference/llm-models-playbook.md) — целевая политика дефолтов, цены, fallback chains
- [llm-router.md](llm-router.md) — реализация маршрутизации в коде
- [02_architecture/ai-integration.md](../02_architecture/ai-integration.md) — общая карта AI-интеграций
- [plans/analysis/2026-05-21-llm-smoke-test.md](../../plans/analysis/2026-05-21-llm-smoke-test.md) — методология и результаты прогона
- [backend/scripts/smoke-llm-providers.ts](../../backend/scripts/smoke-llm-providers.ts) — сам smoke-test
