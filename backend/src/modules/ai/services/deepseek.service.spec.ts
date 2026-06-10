import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

/**
 * DeepSeekService unit-тесты.
 *
 * Probe 2026-06-03 + офиц. дока: DeepSeek-V4 (ВСЕ модели, включая flash) НЕ
 * поддерживает response_format=json_schema. Поэтому:
 *   1. flash + json_schema (без tools) → авто-конверт в tool + tool_choice='auto',
 *      НЕТ response_format, hint в user, метрика инкрементируется (как и pro).
 *   2. pro + json_schema (без tools) → то же.
 *   3. flash/pro + caller передал tools + json_schema → json_schema снят
 *      (strict-stripped), остаются tools + tool_choice='auto'.
 *   4. json_object → response_format: json_object + гарантия слова «json» в
 *      промпте (дописывается в хвост user, если его нет).
 *
 * Mocking SDK по образцу anthropic.service.spec.ts — mock-класс `OpenAI`,
 * сохраняющий ссылку на последний созданный инстанс в `lastSdkInstance`.
 */

interface FakeChatCompletions {
  create: ReturnType<typeof vi.fn>;
}

let lastSdkInstance: { chat: { completions: FakeChatCompletions } } | null =
  null;

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat: { completions: FakeChatCompletions };
      constructor(_opts: unknown) {
        this.chat = { completions: { create: vi.fn() } };
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- mock-паттерн: сохраняем ссылку на инстанс SDK для теста.
        lastSdkInstance = this;
      }
    },
  };
});

// Импорт после vi.mock, иначе мок не подхватится.
import { DeepSeekService } from './deepseek.service';

function makeCfg(opts?: { forceToolChoiceEnabled?: boolean }): TypedConfigService {
  return {
    ai: {
      deepseek: {
        apiKey: 'sk-deepseek-test',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-v4-flash',
        // ТЗ-3 Фаза 3 — дефолт OFF (поведение не меняется). Тесты включают явно.
        forceToolChoiceEnabled: opts?.forceToolChoiceEnabled ?? false,
      },
    },
  } as unknown as TypedConfigService;
}

function makeMetricsMock(): {
  metrics: BusinessMetricsService;
  inc: ReturnType<typeof vi.fn>;
  guard: ReturnType<typeof vi.fn>;
} {
  const inc = vi.fn();
  const guard = vi.fn();
  const metrics = {
    incDeepseekSchemaToToolConversion: inc,
    incLlmThinkingModelGuard: guard,
  } as unknown as BusinessMetricsService;
  return { metrics, inc, guard };
}

function okResponse(opts?: {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: string }>;
}): unknown {
  return {
    choices: [
      {
        message: {
          content: opts?.content ?? '',
          tool_calls: opts?.toolCalls?.map((tc) => ({
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

const FACTS_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: { type: 'array', items: { type: 'string' } },
  },
};

describe('DeepSeekService.buildParams — формат вывода', () => {
  beforeEach(() => {
    lastSdkInstance = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Фикс 2026-06-03 — прокси отдаёт «This response_format type is unavailable
  // now» для json_schema на ВСЕХ deepseek-моделях (включая flash), поэтому
  // json_schema → synthetic tool для любой модели, не только thinking-pro.
  it('flash + json_schema → автоконверт в tool (прокси не поддерживает json_schema на flash)', async () => {
    const { metrics, inc, guard } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    const out = await svc.complete({
      system: { text: 'sys' },
      user: 'извлеки факты',
      model: 'deepseek-v4-flash',
      responseFormat: {
        type: 'json_schema',
        name: 'facts',
        schema: FACTS_SCHEMA,
        strict: true,
      },
    });

    // text восстановлен из tool_calls[0].input стрингификацией.
    expect(out.text).toBe('{"facts":["a"]}');
    expect(out.provider).toBe('deepseek');
    expect(inc).toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith({
      kind: 'schema-to-tool',
      model: 'deepseek-v4-flash',
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    // json_schema снят, ответ через synthetic tool.
    expect(callArgs.response_format).toBeUndefined();
    expect(callArgs.tool_choice).toBe('auto');
    expect(callArgs.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'submit_facts',
          description: expect.stringContaining('facts'),
          parameters: FACTS_SCHEMA,
        },
      },
    ]);
    // hint в user-сообщении подмешиваем для любой модели.
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toContain('submit_facts');
  });

  it('pro + json_schema (без tools) → автоконверт в tool + tool_choice=auto + hint + метрика', async () => {
    const { metrics, inc, guard } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [
          {
            name: 'submit_facts',
            arguments: '{"facts":["x","y"]}',
          },
        ],
      }),
    );

    const out = await svc.complete({
      system: { text: 'sys' },
      user: 'извлеки факты',
      model: 'deepseek-v4-pro',
      responseFormat: {
        type: 'json_schema',
        name: 'facts',
        schema: FACTS_SCHEMA,
        strict: true,
      },
    });

    // text восстановлен из tool_calls[0].input стрингификацией.
    expect(out.text).toBe('{"facts":["x","y"]}');
    expect(out.toolCalls).toEqual([
      { name: 'submit_facts', input: { facts: ['x', 'y'] } },
    ]);

    expect(inc).toHaveBeenCalledTimes(1);
    expect(inc).toHaveBeenCalledWith({ model: 'deepseek-v4-pro' });
    // ТЗ 2026-05-25 Фаза 1 — универсальный guard-counter тоже инкрементируется.
    expect(guard).toHaveBeenCalledWith({
      kind: 'schema-to-tool',
      model: 'deepseek-v4-pro',
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.response_format).toBeUndefined();
    expect(callArgs.tool_choice).toBe('auto');
    expect(callArgs.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'submit_facts',
          description: expect.stringContaining('facts'),
          parameters: FACTS_SCHEMA,
        },
      },
    ]);
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toContain('извлеки факты');
    expect(userMsg.content).toContain('submit_facts');
  });

  it('pro + caller передал tools + json_schema → strict json_schema снят (Pro его не поддерживает), tool_choice=auto, guard.strict-stripped', async () => {
    const { metrics, inc, guard } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: 'ответ' }),
    );

    await svc.complete({
      system: { text: 'sys' },
      user: 'u',
      model: 'deepseek-v4-pro',
      tools: [
        {
          name: 'my_tool',
          description: 'desc',
          input_schema: {
            type: 'object',
            properties: { x: { type: 'string' } },
          },
        },
      ],
      // ТЗ 2026-05-25 Фаза 1 — caller передал и tools, и strict json_schema.
      // Pro+thinking не поддерживает strict json_schema → снимаем тихо.
      responseFormat: {
        type: 'json_schema',
        name: 'irrelevant',
        schema: FACTS_SCHEMA,
        strict: true,
      },
    });

    // schema-to-tool не растёт (это другой kind — был caller-tools).
    expect(inc).not.toHaveBeenCalled();
    // guard.strict-stripped инкрементирован.
    expect(guard).toHaveBeenCalledWith({
      kind: 'strict-stripped',
      model: 'deepseek-v4-pro',
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
    expect(callArgs.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'my_tool',
          description: 'desc',
          parameters: {
            type: 'object',
            properties: { x: { type: 'string' } },
          },
        },
      },
    ]);
    // strict json_schema снят — НЕ передаём response_format на Pro.
    expect(callArgs.response_format).toBeUndefined();
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toBe('u');
  });

  // Фикс 2026-06-03 — strict json_schema снимается на любой deepseek-модели
  // (flash тоже), если caller уже передал tools: оставляем tools + 'auto',
  // без response_format. guard.strict-stripped инкрементирован.
  it('flash + caller передал tools + json_schema → strict json_schema снят (прокси не поддерживает), guard.strict-stripped', async () => {
    const { metrics, inc, guard } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: 'ответ' }),
    );

    await svc.complete({
      system: { text: 'sys' },
      user: 'u',
      model: 'deepseek-v4-flash',
      tools: [
        {
          name: 'my_tool',
          description: 'desc',
          input_schema: { type: 'object', properties: {} },
        },
      ],
      responseFormat: {
        type: 'json_schema',
        name: 'irrelevant',
        schema: FACTS_SCHEMA,
        strict: true,
      },
    });

    // schema-to-tool не растёт (это другой kind — был caller-tools).
    expect(inc).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith({
      kind: 'strict-stripped',
      model: 'deepseek-v4-flash',
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
    // strict json_schema снят — response_format не выставляется.
    expect(callArgs.response_format).toBeUndefined();
    expect(callArgs.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'my_tool',
          description: 'desc',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });

  it('pro + json_object → response_format: json_object без автоконвертации', async () => {
    const { metrics, inc } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: '{"ok":true}' }),
    );

    const out = await svc.complete({
      system: { text: 's' },
      user: 'u',
      model: 'deepseek-v4-pro',
      responseFormat: { type: 'json_object' },
    });

    expect(out.text).toBe('{"ok":true}');
    expect(inc).not.toHaveBeenCalled();

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
    expect(callArgs.tools).toBeUndefined();
    expect(callArgs.tool_choice).toBeUndefined();
  });

  it('json_object + промпт без слова "json" → слово в ХВОСТ USER, SYSTEM не тронут (cache-guard #56)', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: '{"ok":true}' }),
    );

    const systemText = 'Сделай отчёт по встрече.'; // нет слова json
    await svc.complete({
      system: { text: systemText },
      user: 'Транскрипт...',
      model: 'deepseek-v4-pro',
      responseFormat: { type: 'json_object' },
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
    // Cache-safety: SYSTEM-сообщение байт-в-байт неизменно (кэш не ломается).
    expect(callArgs.messages[0]!.content).toBe(systemText);
    // Слово «json» дописано в хвост ПОСЛЕДНЕГО user-сообщения.
    const lastMsg = callArgs.messages[callArgs.messages.length - 1]!;
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content.toLowerCase()).toContain('json');
    expect(lastMsg.content.startsWith('Транскрипт...')).toBe(true);
  });

  it('json_object + промпт уже содержит "json" → не дублируем подсказку', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: '{"ok":true}' }),
    );

    await svc.complete({
      system: { text: 'Верни ответ в JSON.' },
      user: 'u',
      model: 'deepseek-v4-pro',
      responseFormat: { type: 'json_object' },
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
    expect(callArgs.messages[0]!.content).toBe('Верни ответ в JSON.');
  });
});

/**
 * ТЗ-3 Фаза 3 — forced tool_choice за флагом
 * `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` (дефолт OFF).
 *
 * Для НЕ-thinking deepseek-моделей при autoConvert (json_schema → synthetic
 * tool) форсим `tool_choice:{type:'function',function:{name}}` вместо 'auto',
 * чтобы flash возвращал структуру, а не прозу. Thinking-модели НЕ форсим.
 * Guard в complete() откатывает на 'auto' при format-400 прокси и повторяет раз.
 */
describe('DeepSeekService.buildParams — forced tool_choice (ТЗ-3 Фаза 3)', () => {
  beforeEach(() => {
    lastSdkInstance = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  const JSON_SCHEMA_INPUT = {
    system: { text: 'sys' },
    user: 'извлеки факты',
    responseFormat: {
      type: 'json_schema' as const,
      name: 'facts',
      schema: FACTS_SCHEMA,
      strict: true,
    },
  };

  /** Имитация ошибки прокси формата (OpenAI SDK кладёт код в `.status`). */
  function formatError(message: string): Error & { status: number } {
    const e = new Error(message) as Error & { status: number };
    e.status = 400;
    return e;
  }

  it('флаг OFF (дефолт) + non-thinking + json_schema → tool_choice="auto" (поведение не изменилось)', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics); // forceToolChoiceEnabled=false
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-v4-flash' });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
  });

  it('флаг ON + non-thinking + json_schema → tool_choice форсится на synthetic-tool', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(
      makeCfg({ forceToolChoiceEnabled: true }),
      metrics,
    );
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-v4-flash' });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toEqual(
      expect.objectContaining({
        type: 'function',
        function: { name: 'submit_facts' },
      }),
    );
  });

  it('флаг ON + thinking-модель → tool_choice="auto" (thinking не форсим)', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(
      makeCfg({ forceToolChoiceEnabled: true }),
      metrics,
    );
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-v4-pro' });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
  });

  it('флаг ON + форс + прокси бросает format-400 → откат на auto, guard tool-choice-relaxed, повтор; вторая модель сразу auto', async () => {
    const { metrics, guard } = makeMetricsMock();
    const svc = new DeepSeekService(
      makeCfg({ forceToolChoiceEnabled: true }),
      metrics,
    );
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    const create = lastSdkInstance.chat.completions.create;
    // 1-й вызов — форс tool_choice, прокси 400 «tool_choice ... function»;
    // 2-й вызов (после отката) — успех.
    create
      .mockRejectedValueOnce(
        formatError('tool_choice with type function is not supported'),
      )
      .mockResolvedValueOnce(
        okResponse({
          toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
        }),
      );

    const out = await svc.complete({
      ...JSON_SCHEMA_INPUT,
      model: 'deepseek-v4-flash',
    });

    expect(out.text).toBe('{"facts":["a"]}');
    // повтор был — ровно 2 вызова прокси.
    expect(create).toHaveBeenCalledTimes(2);
    // первый — форс, второй — откат на 'auto'.
    expect(create.mock.calls[0]![0].tool_choice).toEqual(
      expect.objectContaining({ type: 'function' }),
    );
    expect(create.mock.calls[1]![0].tool_choice).toBe('auto');
    // guard зафиксировал откат.
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool-choice-relaxed',
        model: 'deepseek-v4-flash',
      }),
    );

    // Вторая отправка на ТУ ЖЕ модель — сразу 'auto' (модель в
    // forceUnsupportedModels), без форса и без второго отката.
    create.mockReset();
    create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["b"]}' }],
      }),
    );
    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-v4-flash' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].tool_choice).toBe('auto');
  });
});
