# LLM Models Playbook — Z

> Справочник по доступным моделям и способу их вызова в проекте Z (AI-видеовстречи
> на LiveKit). Принцип: **тестируем все доступные модели на наших задачах**, выбираем
> по балансу качество × цена × латентность × приватность. Никаких догм типа «только
> Claude» — открытый список кандидатов, в который можно дописывать.
>
> Файл вырос из LLM-handover проекта Crossmark — оттуда же шаблоны кода. Здесь они
> переработаны под Z и дополнены методологией бенчмарка.

---

## Назначение и наши задачи

**Где LLM применяется в Z:**

- **AI-отчёт по типу встречи** — главное продуктовое отличие (9 типов встреч, разные
  шаблоны отчёта). Требования: качество reasoning, длинный контекст (часовая встреча
  ≈ 25–40k токенов транскрипта), стабильный JSON под структурный шаблон.
  См. [second-brain/01_projects/ai-analysis-by-type.md](second-brain/01_projects/ai-analysis-by-type.md).
- **Возможные задачи на будущее:** суммари в реальном времени по ходу встречи,
  чат-помощник по записи. TBD, см. `plans/analysis/`.

**Что НЕ выбираем (фиксированный канал):**

- **Транскрибация** — наш собственный self-hosted GigaAM v3 RNN-T на
  `vox.agent-lia.ru`. Не сравниваем с Whisper / Deepgram / AssemblyAI / Yandex
  SpeechKit — у нас уже своя инфра. Детали в §1.

---

## 1. Транскрибация — Vox / GigaAM (фиксированный канал)

Сервис собственного хостинга `vox.agent-lia.ru` на базе GigaAM. Двухступенчатый
протокол: submit → poll. Прокси не нужен.

**Параметры на старте Z:**

- `model: 'v3_rnnt'` — GigaAM v3 RNN-T.
- `punctuationMode: 'pro'` — авто-пунктуация.
- `diarizationEnabled: false` — диаризация **не нужна**: спикеры известны по
  `participant_id` LiveKit, у нас отдельные аудиодорожки на каждого участника
  через Track Egress (см. CLAUDE.md, принцип №4).

```ts
const VOX_URL   = process.env.VOX_API_URL ?? 'https://vox.agent-lia.ru';
const VOX_TOKEN = process.env.VOX_API_TOKEN!;

// 1. Submit
const form = new FormData();
form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
form.append('model',              'v3_rnnt');
form.append('punctuationMode',    'pro');
form.append('diarizationEnabled', 'false');

const submitRes = await fetch(`${VOX_URL}/api/v1/transcription/submit`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${VOX_TOKEN}` },
  body: form,
});
const { taskId } = await submitRes.json() as { taskId: string };

// 2. Poll (interval=2s, до 60 раз = 2 минуты)
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const taskRes = await fetch(`${VOX_URL}/api/v1/transcription/task/${taskId}`, {
    headers: { Authorization: `Bearer ${VOX_TOKEN}` },
  });
  const task = await taskRes.json() as {
    status: string; transcriptText?: string; errorMessage?: string; durationSeconds?: number;
  };
  if (task.status === 'COMPLETED') return { text: task.transcriptText ?? '', audioDurationSec: task.durationSeconds ?? 0 };
  if (task.status === 'FAILED')    throw new Error(`Vox failed: ${task.errorMessage}`);
}
throw new Error('Vox timeout');
```

---

## 2. Карта моделей-кандидатов

Таблица — что доступно сегодня. Колонка **Статус для Z** — где модель находится в
нашем процессе тестирования. Обновляется по результатам бенчмарков (§15).

| Ключ | Модели | Тип API | Через прокси? | Назначение в Z | Статус |
|---|---|---|---|---|---|
| `openai` | `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5.2`, `gpt-5.4`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o-mini`, `text-embedding-3-small`, `text-embedding-3-large` | OpenAI Responses + Embeddings | **Да** (`proxy.agent-lia.ru`) | Кандидат для AI-отчёта (reasoning, structured outputs) | candidate |
| `sonnet` | `claude-sonnet-4-6`, `claude-opus-4-7` | Anthropic Messages | Нет (прямо в `api.anthropic.com`) | Кандидат для AI-отчёта (длинный контекст, prompt caching) | candidate |
| `haiku` | `claude-haiku-4-5-20251001` | Anthropic Messages | Нет | Кандидат для лёгких/частых вызовов | candidate |
| `deepseek` | `deepseek-reasoner`, `deepseek-chat` | OpenAI-compat chat/completions | Нет (`api.deepseek.com`) | Дешёвая reasoning-альтернатива GPT-5 | candidate |
| `minimax` | `MiniMax-M2.5` | Anthropic-compat Messages | Нет (`api.minimax.io/anthropic`) | Дешёвый Anthropic-совместимый канал, фолбэк | candidate |
| `grsai` | `gemini-3-pro`, `gemini-3.1-pro` | OpenAI-compat (SSE-streaming) | **Да** (`/grsai/...`) | Gemini через proxy: дешевле и стабильнее | candidate |
| `kie` | `gemini-3-pro` | OpenAI-compat (developer-role + thoughts) | **Да** (`/kie/...`) | Gemini c thinking; запасной канал | candidate |
| `ollama` | `qwen3.5:9b` (может смениться) | OpenAI-compat chat/completions | Нет (`ollama.agent-lia.ru`) | Self-hosted дешёвый канал для фоновых/массовых задач | candidate |

> **Важно:** прямой выход в `api.anthropic.com` из российских IP может блокироваться
> с ошибкой `403 "Request not allowed"`. На случай блокировки — фолбэк-цепочка (§11)
> или MiniMax как Anthropic-совместимый канал.

---

## 3. Прокси `proxy.agent-lia.ru`

Самописный nginx-прокси, который:

1. Принимает запрос клиента с заголовком `Authorization: Bearer myFeedproxy3128:<REAL_KEY>`.
2. Извлекает `<REAL_KEY>` (отрезает префикс `myFeedproxy3128:`).
3. Пересылает запрос upstream'у с `Authorization: Bearer <REAL_KEY>`.
4. Возвращает ответ клиенту, включая SSE-стрим.

### Базовые константы

```ts
const PROXY_BASE   = 'https://proxy.agent-lia.ru/v1';
const PROXY_PREFIX = 'myFeedproxy3128';
```

### Маршруты прокси

| Путь на прокси | Upstream |
|---|---|
| `https://proxy.agent-lia.ru/v1/responses` | `https://api.openai.com/v1/responses` |
| `https://proxy.agent-lia.ru/v1/embeddings` | `https://api.openai.com/v1/embeddings` |
| `https://proxy.agent-lia.ru/v1/chat/completions` | `https://api.openai.com/v1/chat/completions` |
| `https://proxy.agent-lia.ru/grsai/v1/chat/completions` | `https://grsaiapi.com/v1/chat/completions` |
| `https://proxy.agent-lia.ru/kie/gemini-3-pro/v1/chat/completions` | `https://api.kie.ai/gemini-3-pro/v1/chat/completions` |

### Аутентификация на прокси

```
Authorization: Bearer myFeedproxy3128:<REAL_API_KEY>
```

Например, для OpenAI:

```
Authorization: Bearer myFeedproxy3128:sk-proj-XXXXXXXX
```

Если использовать официальный `OpenAI` SDK, достаточно подсунуть ему `baseURL`
и склеенный ключ:

```ts
new OpenAI({
  baseURL: 'https://proxy.agent-lia.ru/v1',
  apiKey: `myFeedproxy3128:${process.env.OPENAI_API_KEY}`,
});
```

### Параметры nginx (важно для генераций > 60с)

```nginx
proxy_read_timeout    600s;   # генерация может занять 2-5 мин
proxy_send_timeout    600s;
proxy_connect_timeout 30s;
client_max_body_size  2m;
proxy_buffering       off;    # критично для SSE-стрима grsai
proxy_cache           off;
proxy_http_version    1.1;
proxy_set_header      Connection "";
```

Прокси **не** проксирует Anthropic API — Anthropic-провайдеры идут напрямую.

---

## 4. ENV-переменные

```ini
# OpenAI (через proxy.agent-lia.ru)
OPENAI_API_KEY=sk-proj-XXXX

# Anthropic (прямой выход; может блокироваться из РФ)
ANTHROPIC_API_KEY=sk-ant-XXXX

# DeepSeek (прямой)
DEEPSEEK_API_KEY=sk-XXXX

# MiniMax (Anthropic-совместимый, прямой)
MINIMAX_API_KEY=...
MINIMAX_BASE_URL=https://api.minimax.io/anthropic   # опционально, дефолт такой

# Gemini через grsai (через прокси)
GRSAI_API_KEY=sk-cc8eaXXXX

# Gemini через KIE (через прокси для текста)
KIE_API_KEY=73bcc169XXXX
KIE_BASE_URL=https://api.kie.ai                     # опционально, дефолт такой

# GigaAM Vox transcription (наш канал)
VOX_API_URL=https://vox.agent-lia.ru                # опционально, дефолт такой
VOX_API_TOKEN=...

# Self-hosted Ollama (OpenAI-compat)
OLLAMA_BASE_URL=https://ollama.agent-lia.ru/v1/chat/completions  # опционально
OLLAMA_API_KEY=sk-local-test-20260319                            # опционально
OLLAMA_MODEL=qwen3.5:9b                                          # опционально, может смениться
```

### NPM-зависимости

```json
{
  "@anthropic-ai/sdk": "^0.88.0",
  "openai":            "^6.34.0"
}
```

Для KIE и Vox SDK не нужен — там обычный `fetch`.

---

## 5. OpenAI Responses API (через прокси)

Используется для текстовых генераций, JSON-Schema structured outputs, function-calls,
reasoning-моделей (`gpt-5*`) и мультимодального ввода.

### Особенности

- `gpt-5*` — reasoning-модель: вместо `temperature` передаётся `reasoning.effort`
  (`'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`).
- `gpt-4.1*`, `gpt-4o*` — обычные: принимают `temperature` и `top_p`.
- Structured outputs идут через `text.format = { type: 'json_schema', name, strict, schema }`.
- Для `jsonMode`/`jsonSchema` Responses API требует, чтобы в одном из сообщений
  встречалось слово "json" — иначе бросает 400. Добавляем `"Reply with valid JSON only."`,
  если пользовательский промпт его не содержит.
- Function-calls идут как `tools: [{ type: 'function', name, description, parameters, strict }]`,
  результат — массив элементов `output[].type === 'function_call'`.

### Самодостаточный код вызова

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://proxy.agent-lia.ru/v1',
  apiKey: `myFeedproxy3128:${process.env.OPENAI_API_KEY}`,
});

interface AiTextRequest {
  model: string;                   // 'gpt-5.2' | 'gpt-4.1' | 'gpt-4o-mini' | ...
  system: string;
  prompt: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  jsonMode?: boolean;
  jsonSchema?: {
    type: 'json_schema';
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
  timeoutMs?: number;
}

const RETRY_DELAYS_MS = [500, 1000, 2000];

export async function aiText(req: AiTextRequest): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}> {
  const isReasoning = req.model.startsWith('gpt-5');

  let userPrompt = req.prompt;
  if ((req.jsonMode || req.jsonSchema) && !req.prompt.toLowerCase().includes('json')) {
    userPrompt += '\n\nReply with valid JSON only.';
  }

  const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: req.model,
    stream: false,
    instructions: req.system,
    input: [{ role: 'user', content: userPrompt }],
    ...(req.maxOutputTokens ? { max_output_tokens: req.maxOutputTokens } : {}),
  };

  if (req.jsonSchema) {
    Object.assign(params, { text: { format: req.jsonSchema } });
  } else if (req.jsonMode) {
    Object.assign(params, { text: { format: { type: 'json_object' } } });
  }

  if (isReasoning) {
    Object.assign(params, { reasoning: { effort: req.reasoningEffort ?? 'medium' } });
  } else {
    if (typeof req.temperature === 'number') Object.assign(params, { temperature: req.temperature });
    if (typeof req.topP === 'number') Object.assign(params, { top_p: req.topP });
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const response = (await client.responses.create(
        params,
        req.timeoutMs ? { timeout: req.timeoutMs } : undefined,
      )) as OpenAI.Responses.Response;

      return {
        text: response.output_text ?? '',
        inputTokens:     response.usage?.input_tokens ?? 0,
        outputTokens:    response.usage?.output_tokens ?? 0,
        reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      };
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt > RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function shouldRetry(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = Reflect.get(error, 'status') as number | undefined;
  if (typeof status !== 'number') return true;        // network error → retry
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

### Мультимодальный ввод (текст + картинка)

```ts
const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
  model: 'gpt-4o-mini',
  stream: false,
  instructions: systemPrompt,
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text',  text: 'Опиши что на фото' },
        { type: 'input_image', image_url: 'data:image/jpeg;base64,...', detail: 'high' },
      ],
    },
  ],
};
```

### Function calling

```ts
Object.assign(params, {
  tools: [{
    type: 'function',
    name: 'get_weather',
    description: 'Получить погоду в городе',
    parameters: { /* JSON Schema */ },
    strict: true,
  }],
  tool_choice: 'auto',
});
```

---

## 6. OpenAI Embeddings API (через прокси)

```ts
const response = await client.embeddings.create({
  model: 'text-embedding-3-small',  // или 'text-embedding-3-large'
  input: ['строка 1', 'строка 2'],   // batch до 100 за раз
  dimensions: 1536,                   // опционально
});
```

Рекомендации (опыт Crossmark):

- Кеш по sha256(content) в Redis с TTL 30 дней — экономит деньги при переиндексации.
- Батч до 100 элементов на один запрос (лимит OpenAI).
- Retry: `[500, 1000, 2000, 4000, 8000]ms` на 429/5xx/`ECONNRESET`/`ETIMEDOUT`.
- Размерность: `1536` для `text-embedding-3-small`, `3072` для `large`.

---

## 7. Anthropic Messages API (Claude — прямой)

Длинные генерации, prompt caching, streaming. **Прокси не задействован.**

### Базовый вызов

```ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  baseURL: 'https://api.anthropic.com',  // дефолтный, можно опустить
});

const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',          // | 'claude-haiku-4-5-20251001' | 'claude-opus-4-7'
  max_tokens: 16000,
  system: 'Ты эксперт по...',
  messages: [
    { role: 'user', content: [{ type: 'text', text: userPrompt }] },
  ],
});

const text = message.content
  .filter((b) => b.type === 'text')
  .map((b) => (b as { text: string }).text)
  .join('\n\n');
```

### Prompt caching (экономит до 90% input tokens)

```ts
const message = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 16000,
  system: [
    {
      type: 'text',
      text: largeStableSystemPrompt,
      cache_control: { type: 'ephemeral' },   // 5 минут TTL
    },
  ] as unknown as string,
  messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
});
```

Кеш работает только с Claude (MiniMax-M2.5 на той же Anthropic-схеме игнорирует
блок). При repair-ретраях (когда меняется system) кеш отключаем.

### Streaming

```ts
const stream = anthropic.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 16000,
  system: systemPrompt,
  messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
});

let fullText = '';
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    const piece = event.delta.text;
    fullText += piece;
    onDelta(piece, fullText);
  }
}

const final = await stream.finalMessage();
```

**Важно:** retry в стриминге **не делаем** — фрагменты уже ушли пользователю,
повторный старт сломает UI. Orchestrator должен делать fallback на non-stream
`messages.create`.

---

## 8. MiniMax (Anthropic-совместимый)

Тот же SDK `@anthropic-ai/sdk`, но другой `baseURL`. Кеш-блок (`cache_control`)
не поддерживается — `cache_control` ставим только если `provider.model` начинается
с `claude-`.

```ts
const minimax = new Anthropic({
  apiKey:  process.env.MINIMAX_API_KEY!,
  baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
});

const message = await minimax.messages.create({
  model: 'MiniMax-M2.5',
  max_tokens: 16000,
  system: systemPrompt,
  messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
});
```

---

## 9. OpenAI-compat chat/completions: DeepSeek, Gemini-grsai, Gemini-KIE

Прямой `fetch`, не SDK — потому что у каждого свои нюансы (SSE для grsai,
`role=developer` для KIE). Общий формат:

```
POST <baseUrl>
Authorization: Bearer <apiKey>
Content-Type: application/json
{
  "model": "<model>",
  "stream": <bool>,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user",   "content": "..." }
  ],
  "max_tokens":  <int?>,
  "temperature": <float?>
}
```

### Конфиги провайдеров

```ts
// Прямой
const deepseek = {
  type: 'openai-compat',
  baseUrl: 'https://api.deepseek.com/v1/chat/completions',
  apiKey:  process.env.DEEPSEEK_API_KEY,
  model:   'deepseek-reasoner',
};

// Через наш прокси (myFeedproxy3128:<key>)
const grsai = {
  type: 'openai-compat',
  baseUrl: 'https://proxy.agent-lia.ru/grsai/v1/chat/completions',
  apiKey:  `myFeedproxy3128:${process.env.GRSAI_API_KEY}`,
  model:   'gemini-3.1-pro',   // или 'gemini-3-pro'
};

const kie = {
  type: 'openai-compat',
  baseUrl: 'https://proxy.agent-lia.ru/kie/gemini-3-pro/v1/chat/completions',
  apiKey:  `myFeedproxy3128:${process.env.KIE_API_KEY}`,
  model:   'gemini-3-pro',
};
```

### Особенности по провайдерам

| Провайдер | `stream` | role системного | Доп. поля |
|---|---|---|---|
| DeepSeek | `false` | `system` | — |
| grsai (Gemini) | `true` (SSE) | `system` | — |
| KIE (Gemini) | `false` | `developer` (массив частей) | `include_thoughts: true`, `reasoning_effort: 'high'` |

### Универсальный код

```ts
async function chatCompletion(req: {
  provider: { baseUrl: string; apiKey: string; model: string; label: string };
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const isGrsai = req.provider.baseUrl.includes('grsai');
  const isKie   = req.provider.baseUrl.includes('kie');

  const body: Record<string, unknown> = {};

  if (isKie) {
    body.stream = false;
    body.messages = [
      { role: 'developer', content: [{ type: 'text', text: req.system }] },
      { role: 'user',      content: [{ type: 'text', text: req.prompt }] },
    ];
    body.include_thoughts  = true;
    body.reasoning_effort  = 'high';
    // model в KIE-роуте задаётся через URL, поле model можно не слать
  } else {
    body.model    = req.provider.model;
    body.stream   = isGrsai;
    body.messages = [
      { role: 'system', content: req.system },
      { role: 'user',   content: req.prompt },
    ];
  }
  if (req.maxTokens)  body.max_tokens  = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;

  const resp = await fetch(req.provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${req.provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : undefined,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`${req.provider.label} HTTP ${resp.status}: ${errText.slice(0, 500)}`);
    Object.assign(err, { status: resp.status });
    throw err;
  }

  if (isGrsai) {
    return collectSSE(resp);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; text?: unknown }>;
    usage?:  { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  const raw = choice?.message?.content ?? choice?.message?.reasoning_content ?? choice?.text ?? '';
  const text = typeof raw === 'string'
    ? raw
    : Array.isArray(raw)
      ? raw.map((p: any) => p?.text ?? '').join('')
      : String(raw);

  return {
    text,
    inputTokens:  data.usage?.prompt_tokens     ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

async function collectSSE(resp: Response) {
  const chunks: string[] = [];
  let inputTokens = 0, outputTokens = 0;

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try {
          const data = JSON.parse(payload);
          const content = data.choices?.[0]?.delta?.content;
          if (content) chunks.push(content);
          if (data.usage) {
            inputTokens  = data.usage.prompt_tokens     ?? inputTokens;
            outputTokens = data.usage.completion_tokens ?? outputTokens;
          }
        } catch { /* skip malformed line */ }
      }
    }
  } finally {
    reader.releaseLock();
    resp.body?.cancel().catch(() => {});
  }
  return { text: chunks.join(''), inputTokens, outputTokens };
}
```

### Retry для KIE

KIE нестабилен, поэтому даём ему отдельную, более длинную лестницу задержек:
`[3000, 6000, 10000, 15000]ms` против дефолтных `[3000, 8000]ms`.

---

## 10. Self-hosted Ollama (`ollama.agent-lia.ru`)

Наш собственный инстанс Ollama, поднятый рядом с прокси на отдельном поддомене
(без прохождения через nginx-обёртку).

**Текущая модель:** `qwen3.5:9b`. Может смениться на любую совместимую (`llama3.1`,
другие qwen, кастом-файнтюн) — конфиг через ENV без правок кода.

```ts
const ollama = {
  type: 'openai-compat',
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'https://ollama.agent-lia.ru/v1/chat/completions',
  apiKey:  process.env.OLLAMA_API_KEY  ?? 'sk-local-test-20260319',
  model:   process.env.OLLAMA_MODEL    ?? 'qwen3.5:9b',
  label:   'self-hosted-ollama',
};
```

API — обычный OpenAI-compat `/v1/chat/completions`. Заголовок `Authorization: Bearer
<OLLAMA_API_KEY>`. Ответ читается из `choices[0].message.content`. JSON-парсинг —
тем же `extractJson` (с защитой от ```fenced``` блоков), что и для остальных
openai-compat провайдеров.

**Когда использовать в Z:**

- Массовые/фоновые задачи без жёстких требований к качеству — например, экспе­рименты
  с вторичными суммари, генерация заголовков, тегов.
- Бюджетные сценарии — когда счёт за API на внешних провайдерах сильно растёт.

**Когда НЕ использовать:**

- Основной AI-отчёт по типу встречи — там нужен top-tier reasoning. Сначала
  бенчмарк на эталонных встречах (см. §15), потом решение.

---

## 11. Fallback chain

Если основной провайдер падает с `401 / 403 / 408 / 409 / 429 / 5xx / fetch
failed / ECONNRESET / ENOTFOUND / EAI_AGAIN / socket hang up`, переключаемся на
следующий в цепочке.

**Стартовая цепочка для Z (предложение, актуализируется по результатам бенчмарка):**

```ts
const Z_FALLBACK_CHAIN = {
  // основная задача — AI-отчёт по типу встречи
  meetingReport: ['sonnet', 'gpt54', 'gpt52', 'deepseek', 'grsai', 'minimax'],
};
```

```ts
async function callWithFallback(stage, providers, payload) {
  let lastError;
  for (let i = 0; i < providers.length; i++) {
    try { return await callOne(providers[i], payload); }
    catch (e) {
      lastError = e;
      if (i === providers.length - 1 || !isRetriableProviderError(e)) throw e;
      // лог переключения и идём дальше
    }
  }
  throw lastError;
}

function isRetriableProviderError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as any).status;
  if (typeof status === 'number') {
    return [401, 403, 408, 409, 429].includes(status) || status >= 500;
  }
  const msg = e.message ?? '';
  if (/\b(401|403|408|409|429|5\d\d)\b/.test(msg)) return true;
  return /Request not allowed|forbidden|timeout|ECONN|fetch failed|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg);
}
```

**Zod-ошибки валидации** (модель ответила, но JSON битый) НЕ триггерят фолбэк —
это ответственность той же модели. На repair дёргаем ту же модель ещё раз
с приставкой к system: «Попытка N: предыдущий ответ не был валидным JSON. Верни
ТОЛЬКО JSON по схеме без какого-либо текста до или после».

---

## 12. Цены (на 2026-02-26, USD per 1M tokens)

```ts
export const MODEL_PRICES = {
  // OpenAI
  'gpt-4.1':                 { input: 2.0,  output: 8.0,  cached: 0.5   },
  'gpt-4.1-mini':            { input: 0.4,  output: 1.6,  cached: 0.1   },
  'gpt-4.1-nano':            { input: 0.1,  output: 0.4,  cached: 0.025 },
  'gpt-5':                   { input: 1.25, output: 10.0, cached: 0.125 },
  'gpt-5-mini':              { input: 0.25, output: 2.0,  cached: 0.025 },
  'gpt-5-nano':              { input: 0.05, output: 0.4,  cached: 0.005 },
  'gpt-5.2':                 { input: 1.75, output: 14.0, cached: 0.175 },
  'text-embedding-3-small':  { input: 0.02, output: 0 },
  'text-embedding-3-large':  { input: 0.13, output: 0 },

  // DeepSeek
  'deepseek-reasoner':       { input: 0.28, output: 0.42 },

  // Anthropic
  'claude-sonnet-4-6':       { input: 3.0,  output: 15.0 },

  // MiniMax (Anthropic-совместимый)
  'MiniMax-M2.5':            { input: 0.3,  output: 1.2 },

  // Gemini (через grsai/kie)
  'gemini-3-pro':            { input: 0.5,  output: 3.5 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model] ?? { input: 0, output: 0 };
  return (inputTokens  / 1_000_000) * p.input
       + (outputTokens / 1_000_000) * p.output;
}
```

> **Self-hosted (Ollama, Vox/GigaAM):** прямой денежный расход = 0 (только
> электричество + амортизация железа). При сравнении в бенчмарке записываем
> «self-hosted» в колонку цены, отдельно прикидываем стоимость инфры.

---

## 13. Дефолтные таймауты и retry

| Уровень | Таймаут на вызов | Retry-задержки | Условие retry |
|---|---|---|---|
| Синхронные эндпоинты (HTTP→AI) | `request.timeoutMs` (нет дефолта) | `[500, 1000, 2000]ms` | network ошибка ИЛИ `status === 429` ИЛИ `status >= 500` |
| BullMQ воркеры (фоновые AI-job) | `300_000ms` (5 мин) | `[3000, 8000]ms` | то же + `terminated` / `aborted` в message |
| Воркеры → KIE | `300_000ms` | `[3000, 6000, 10000, 15000]ms` | то же |
| Embeddings | нет | `[500, 1000, 2000, 4000, 8000]ms` | 429 / 5xx / `ECONNRESET` / `ETIMEDOUT` |
| Anthropic streaming | таймаут SDK | **0 retry** | стрим нельзя перезапустить |

---

## 14. Логирование usage (для биллинга и аналитики)

На каждый вызов — строка в `ai_usage_logs`:

```ts
{
  meetingId:    string | null,
  meetingType:  string | null,         // тип встречи (для разреза по типам)
  agentType:    string,                // 'meeting-report' | 'transcription' | ...
  jobId:        string | null,
  model:        string,
  provider:     string,
  inputTokens:  number,
  outputTokens: number,
  reasoningTokens: number,
  costUsd:      number,
  durationMs:   number,
  success:      boolean,
  errorText:    string | null,
}
```

Минимум — `inputTokens`, `outputTokens`, `costUsd`. Без них нельзя сравнить модели
в бенчмарке (§15) и нельзя посчитать unit-economics встречи.

---

## 15. Методология бенчмарка модели на задаче AI-отчёта

**Зачем:** прежде чем включать модель в основной канал — проверить на наших данных,
не на маркетинговых бенчмарках провайдера.

**Алгоритм:**

1. **Эталонный набор** — 5–10 встреч, по одной на каждый из 9 типов плюс пара
   «сложных» (длинные, многоучастниковые). Для каждой — ручно сделанный эталонный
   отчёт.
2. **Фиксированный шаблон промпта** под каждый тип встречи — берём из админки,
   меняем только модель.
3. **Прогон** — каждая модель-кандидат обрабатывает весь набор. Логируем:
   - вход/выход в токенах,
   - стоимость одного отчёта,
   - латентность (p50/p95),
   - JSON-стабильность (доля прогонов без repair-ретрая).
4. **Оценка качества** — три метрики:
   - **Покрытие ключевых пунктов** (вручную, чек-лист): % обязательных пунктов
     эталонного отчёта, попавших в сгенерированный.
   - **Релевантность** (1–5): субъективная оценка эксперта.
   - **Структурность** (0/1): соответствие JSON-схеме после первого ответа.
5. **Результат** — таблица в `plans/analysis/llm-bench-YYYY-MM.md`:

   | Модель | Покрытие | Релевантность | JSON-OK | $/отчёт | p95, с | Вывод |
   |---|---|---|---|---|---|---|
   | claude-sonnet-4-6 | 92% | 4.6 | 100% | 0.18 | 28 | основной канал |
   | gpt-5.2 | 88% | 4.4 | 100% | 0.22 | 22 | фолбэк |
   | deepseek-reasoner | 81% | 4.0 | 95% | 0.04 | 35 | дешёвый канал |
   | qwen3.5:9b (Ollama) | 62% | 3.1 | 80% | 0 | 12 | не годится для отчёта |

6. **Решение** — записать в memory `project_z_infra_and_ai.md` итог:
   основной/фолбэк/дешёвый каналы, с датой ревью.
7. **Перепроверка** — каждые 3 месяца или при появлении новой версии моделей.

---

## 16. Чек-лист: добавить новую модель в тестирование

- [ ] Добавить ENV (если новый ключ/URL).
- [ ] Зарегистрировать модель в карте §2 со статусом `candidate`.
- [ ] Дописать конфиг в `MODEL_PRICES` (§12) или пометить «self-hosted, цена 0».
- [ ] Прогнать эталонный набор по методике §15.
- [ ] Записать результат в `plans/analysis/llm-bench-YYYY-MM.md`.
- [ ] Перевести в `tested` / `in-prod` / `rejected` в карте §2.
- [ ] Если включаем в фолбэк-цепочку — добавить в `Z_FALLBACK_CHAIN` (§11) и
      обновить memory `project_z_infra_and_ai.md`.

---

## 17. Исторический референс — Crossmark

Шаблоны кода в этом playbook выросли из боевого использования в проекте Crossmark.
Если нужны исходники для копи-пейста (NestJS-обёртки, BullMQ-воркеры, embeddings
с Redis-кешем, KIE Image/Video) — они лежат там в `backend/src/shared/ai-client/*`,
`backend/src/workers/lib/worker-ai-client.ts`, `backend/src/knowledge-base/kb-embeddings.service.ts`.

Также частная заметка: в Crossmark Ollama использовалась для фоновой мульти-агентной
дискуссии под статьями блога (8 ролей × N тредов × N статей). Для Z этот сценарий
не применим — у нас другая бизнес-модель, — но факт того, что qwen хватает для
коротких реплик «по теме», полезен как ориентир по нижней планке качества.
