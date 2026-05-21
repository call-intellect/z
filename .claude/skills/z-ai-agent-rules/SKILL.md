---
name: z-ai-agent-rules
description: Правила AI-агентов и prompt infrastructure в Z (AI-видеовстречи на LiveKit): prompt registry, admin-editable prompts по типу встречи, code fallback, patch scripts для безопасной доставки. Используй этот скилл при создании нового AI-агента (транскрибация, разделение по спикерам, шаблон отчёта по типу), добавлении prompt key, изменении существующего промпта, настройке prompt registry, написании seed/patch для промптов. Обязателен если задача касается ASR (Vox/GigaAM), LLM (DeepSeek/OpenAI через proxy.agent-lia.ru, Ollama qwen3.5:9b), BullMQ AI-jobs, workers, или prompt management.
---

# Z: правила AI-агентов и prompt infrastructure

## Главное правило №0 — выбор LLM-канала

**Перед выбором модели/провайдера всегда сверяйся с [second-brain/01_projects/llm-providers-verified.md](../../../second-brain/01_projects/llm-providers-verified.md)** — это единственный источник правды о том, какие LLM-вызовы реально работают в Z (последний прогон smoke — 2026-05-21).

Жёсткие ограничения (фиксированы решением владельца):
- **Anthropic Claude не используем** ни в каком виде — ни primary, ни fallback, ни A/B. Сервис в коде есть, но в `LlmTaskRoute.providers` его быть не должно.
- **Embeddings — только `text-embedding-3-small` через прокси (dim=1536).** `bge-m3` через Ollama не используем (на инстансе физически нет).
- **Ollama chat — только `qwen3.5:9b`.** `qwen3:30b-a3b-instruct-2507` и `Nanbeige` не использовать.

Подробности по каждой задаче (taskType → primary → fallback chain) — в плейбуке [docs/reference/llm-models-playbook.md §2.1](../../../docs/reference/llm-models-playbook.md). При расхождении плейбука с verified-картой — приоритет у verified.

Переверификация одной командой: `cd backend && bun scripts/smoke-llm-providers.ts`.

## Главное правило про prompt registry

Если промпт не является одноразовым локальным экспериментом — он должен:
1. Быть доступен из БД (через prompt registry)
2. Редактироваться через админку без деплоя
3. Иметь кодовый fallback (на случай, если запись в БД отсутствует)
4. Иметь безопасный путь доставки в production без массового overwrite

В Z отдельный кейс: **на каждый из 9 типов встреч — отдельный промпт-ключ** для AI-отчёта. Не делать «один шаблон на всё».

---

## AI pipeline в Z (поверх медиа)

```
LiveKit Egress → S3 (общая запись + аудиодорожки на участника)
                    ↓
            BullMQ job: process-meeting
                    ↓
   ASR (наш внутренний API, default: Vox/GigaAM на vox.agent-lia.ru)
                    ↓
   Склейка диалога по времени + разделение по спикерам
                    ↓
   LLM через LlmRouterService:
     primary  — DeepSeek V4 (flash/pro) напрямую,
     fallback — gpt-5.4-mini через proxy.agent-lia.ru,
     fallback — qwen3.5:9b через ollama.agent-lia.ru
                    ↓
   Шаблон по meeting.type → AI-отчёт
                    ↓
   DB: ai_results
```

Провайдеры подключаются через ENV (switchable endpoints). Никаких хардкодов. Конкретные модели и образцы вызова — в [second-brain/01_projects/llm-providers-verified.md](../../../second-brain/01_projects/llm-providers-verified.md).

---

## Prompt Registry

### Структура записи

```typescript
interface PromptRegistryEntry {
  key: string;           // уникальный ключ, snake_case
  name: string;          // человекочитаемое название
  description: string;   // для чего используется
  content: string;       // текст промпта (admin-editable)
  variables: string[];   // переменные подстановки: ['transcript', 'participants']
  version: number;       // инкрементируется при изменении
  isActive: boolean;
}
```

### Naming convention для ключей

```
<домен>.<этап>.<тип/цель>

Примеры (Z):
meeting.report.standup
meeting.report.one_on_one
meeting.report.client_call
meeting.report.interview
meeting.report.brainstorm
meeting.report.retrospective
meeting.report.planning
meeting.report.demo
meeting.report.training

asr.diarization.merge_speakers
asr.normalize.fix_timestamps
```

### Code fallback

Каждый агент должен иметь fallback прямо в коде:

```typescript
async getPrompt(key: string): Promise<string> {
  const dbPrompt = await this.promptRegistry.findByKey(key);
  if (dbPrompt?.isActive) return dbPrompt.content;

  // Fallback — промпт из кода
  return PROMPT_FALLBACKS[key] ?? throwMissingPromptError(key);
}

const PROMPT_FALLBACKS: Record<string, string> = {
  'meeting.report.standup': `
    Ты помощник для анализа стендапов.
    Транскрипт: {{transcript}}
    Участники: {{participants}}
    Сформируй отчёт: что сделано, что планируется, блокеры.
  `,
};
```

---

## Создание нового AI-агента

### Шаги

1. **Создай worker** в `backend/src/workers/<domain>/<agent>.worker.ts`
2. **Зарегистрируй job** в `backend/src/ai-jobs/`
3. **Добавь prompt key** в prompt registry (через patch script)
4. **Напиши fallback** в коде агента
5. **Зарегистрируй в baseline seed** (только если это core-агент)
6. **Добавь трейсинг** через `AiTraceService` (input, output, tokens, cost, latency)

### Структура worker

```typescript
@Processor('ai-jobs')
export class MeetingReportWorker extends WorkerHost {
  constructor(
    private readonly promptRegistry: PromptRegistryService,
    private readonly llm: LlmClient,           // Claude через ENV-конфиг
    private readonly aiTrace: AiTraceService,
  ) { super(); }

  @Process('generate-report')
  async process(job: Job<GenerateReportJobData>): Promise<void> {
    const promptKey = `meeting.report.${job.data.meetingType}`;
    const prompt = await this.promptRegistry.get(promptKey);
    const rendered = this.renderPrompt(prompt, job.data);

    const traceId = await this.aiTrace.start('generate-report', job.data);
    try {
      const result = await this.llm.complete(rendered);
      await this.aiTrace.complete(traceId, result);
    } catch (error) {
      await this.aiTrace.fail(traceId, error);
      throw error;
    }
  }
}
```

---

## Доставка промптов в production

### Baseline (bootstrap) регистрация

Используй `backend/prisma/seed-incremental.ts` для регистрации новых ключей.

Правила:
- Проверяй существование перед вставкой (`upsert` с защитой `content`)
- Не перезаписывай `content` если запись уже существует (она могла быть отредактирована в админке)

```typescript
await prisma.promptRegistry.upsert({
  where: { key: 'meeting.report.standup' },
  create: {
    key: 'meeting.report.standup',
    name: 'Standup meeting report',
    content: DEFAULT_CONTENT,
    variables: ['transcript', 'participants'],
    isActive: true,
  },
  update: {
    // НЕ обновляем content — он мог быть изменён в админке
    name: 'Standup meeting report',
    variables: ['transcript', 'participants'],
  },
});
```

### One-off patch script

Для точечных изменений существующих промптов — отдельный patch script в `backend/scripts/`:

```typescript
// backend/scripts/patches/2026-05-06-update-standup-prompt.ts
const patch = async () => {
  const existing = await prisma.promptRegistry.findUnique({
    where: { key: 'meeting.report.standup' }
  });

  // Только если версия соответствует ожидаемой
  if (existing?.version !== 2) {
    console.log('Skipping: unexpected version');
    return;
  }

  await prisma.promptRegistry.update({
    where: { key: 'meeting.report.standup' },
    data: { content: NEW_CONTENT, version: 3 },
  });
};
```

Запускать через `backend/package.json` script, не через `npx tsx`.

---

## Трейсинг AI

Каждый AI-вызов должен трейситься через `AiTraceService`:

```typescript
const traceId = await this.aiTrace.start(jobName, inputData);
try {
  const result = await this.llm.complete(prompt);
  await this.aiTrace.complete(traceId, {
    tokens: result.usage,
    output: result.content,
    cost: result.cost,
    latencyMs: result.latencyMs,
  });
} catch (error) {
  await this.aiTrace.fail(traceId, error);
  throw error;
}
```

Это нужно для: отладки качества промптов, мониторинга стоимости (ASR + LLM), анализа ошибок.

---

## Асинхронность — обязательно

Никакого синхронного вызова AI из HTTP-эндпоинта:

```typescript
// Правильно — через очередь
await this.bullQueue.add('process-meeting', { meetingId }, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});

// Неправильно
const result = await this.llm.complete({ ... }); // ← из контроллера/сервиса в HTTP-цикле
```

HTTP-хендлер возвращает `202 Accepted` + `jobId`. Клиент поллит статус или получает нотификацию.

---

## Switchable endpoints (важно для Z)

ASR и LLM провайдеры подключены через ENV — переключаемся без кода. Все ENV-имена и дефолты — в [backend/src/common/config/env.schema.ts](../../../backend/src/common/config/env.schema.ts). Реально работающие сейчас (verified 2026-05-21):

```
# ASR — наш self-hosted GigaAM
VOX_API_URL=https://vox.agent-lia.ru
VOX_API_TOKEN=...

# OpenAI через прокси (primary fallback)
OPENAI_API_KEY=sk-proj-...
PROXY_BASE_URL=https://proxy.agent-lia.ru/v1
PROXY_PREFIX=myFeedproxy3128

# DeepSeek (primary)
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_DEFAULT_MODEL=deepseek-v4-flash

# Self-hosted Ollama (secondary fallback)
OLLAMA_BASE_URL=https://ollama.agent-lia.ru/v1
OLLAMA_API_KEY=sk-local-test-20260319

# MiniMax (A/B candidate)
MINIMAX_API_KEY=sk-api-...
MINIMAX_BASE_URL=https://api.minimax.io/anthropic

# Gemini через grsai (A/B candidate)
GRSAI_API_KEY=sk-cc8ea...
```

Никогда не хардкодить URL/ключи в коде агента — только через `TypedConfigService`. См. также memory `feedback_switchable_endpoints` и `project_z_infra_and_ai`.

---

## Чеклист нового AI-агента

- [ ] Worker в правильной директории
- [ ] Prompt key зарегистрирован (patch script или seed-incremental)
- [ ] Code fallback написан
- [ ] Upsert не перезаписывает admin-edited content
- [ ] AiTraceService подключён (с tokens + cost + latency)
- [ ] Job добавлен через очередь, не синхронный вызов
- [ ] Retry/backoff настроен
- [ ] Идемпотентность проверена (повторный запуск не создаёт дубли результатов)
- [ ] Endpoints через ENV, fallback-цепочка настроена
