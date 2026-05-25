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

## Версионирование code-fallback промтов (F10)

При **изменении существующей** `SYSTEM_PROMPT` константы в `backend/src/modules/**/prompts/**/*.ts` (то есть в code-fallback, до миграции в БД-registry):

- Создавай **новую константу** с суффиксом `_V2` (или `_V3` и т.д.), не правь существующую.
- В jsdoc новой версии указывай дату создания и причину изменения.
- Старую версию **не удаляй сразу** — оставляй на 1-2 деплоя для shadow-run через `PromptResolver`.
- Удаляй только когда есть подтверждение, что новая версия работает стабильнее по метрикам (latency / refusal-rate / judge-rubric SPO).

Это даёт:
- историю изменений промтов прямо в git;
- возможность A/B-сравнения через `PromptResolver` shadow-run;
- безопасный rollback (revert последнего коммита возвращает указатель на старую версию).

**Не применяется** к промтам, уже мигрированным в БД-registry — там version history через `PromptTemplateVersion` (поля `version`, `createdAt`, ссылка `previousVersionId`).

Пример:

```typescript
// 2026-04-15 — исходная версия
export const TASKS_SYSTEM = `...старый текст...`;

// 2026-05-24 — добавили якоря suggestedPriority, нужна на 1-2 деплоя
// параллельно для shadow-run, потом TASKS_SYSTEM убираем.
/**
 * @since 2026-05-24
 * @reason Якоря suggestedPriority + clamp confidence в [0,1].
 */
export const TASKS_SYSTEM_V2 = `...новый текст с якорями...`;
```

`PromptResolver` в коде выбирает версию по ENV-флагу или процентному split'у, метрика `z_prompt_version_used{key, version}` показывает реальный трафик.

---

## Confidence — единая онтология (F16)

В Z/Кора используется **гибридная** confidence-онтология:

- **Новые промты** **обязаны** возвращать `confidence: float ∈ [0, 1]` (continuous). Применять `withConfidenceCalibration(systemBody)` из [`common.ts`](../../../backend/src/modules/ai/services/prompts/common.ts) — он подмешивает единый текст шкалы `CONFIDENCE_CALIBRATION`.
- **Существующие enum-промты** (`skill-trait-detect`, `knowledge-clone-extract`, `helpfulness-detect`) **НЕ мигрируются**: риск регрессии + UI завязан на enum-категории (badge low/medium/high). К ним `withConfidenceCalibration` **не применять** — будет дубль и противоречие.
- **UI всегда отображает confidence через mapper** — `CONFIDENCE_ENUM_TO_FLOAT = { low: 0.3, medium: 0.6, high: 0.85 }`. Пользователь видит единый scale 0–100% или одинаковые badge-цвета, даже если backend вернул enum.

Точечная миграция enum→float — только когда конкретная бизнес-логика этого потребует (например, для агрегации/среднего по traits в дашборде).

Helper'ы в [`backend/src/modules/ai/services/prompts/common.ts`](../../../backend/src/modules/ai/services/prompts/common.ts):

```typescript
export const CONFIDENCE_ENUM_TO_FLOAT = { low: 0.3, medium: 0.6, high: 0.85 } as const;
export type ConfidenceEnum = 'low' | 'medium' | 'high';
export function confidenceEnumToFloat(v: ConfidenceEnum): number;
export function confidenceFloatToEnum(v: number): ConfidenceEnum;
```

**Качественные шкалы** (`severity` / `interest_level` / `churn_risk` / `role_fit`) — это **НЕ** confidence. Якоря для них живут прямо в тексте промта (см. `type-sales`, `type-customer_success`, `type-interview`, `meeting-quality-score`). При добавлении новой качественной шкалы — добавляй якоря в текст промта одним предложением per уровень (формат `- {уровень} — {критерий}`), не подмешивай `CONFIDENCE_CALIBRATION`.

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
