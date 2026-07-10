import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

interface FakeChatCompletions {
  create: ReturnType<typeof vi.fn>;
}

let lastSdkInstance: { chat: { completions: FakeChatCompletions } } | null = null;

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

import { DeepSeekService } from './deepseek.service';

function makeCfg(opts?: { forceToolChoiceEnabled?: boolean }): TypedConfigService {
  return {
    ai: {
      deepseek: {
        apiKey: 'sk-deepseek-test',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-v4-flash',
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

    expect(out.text).toBe('{"facts":["a"]}');
    expect(out.provider).toBe('deepseek');
    expect(inc).toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith({
      kind: 'schema-to-tool',
      model: 'deepseek-v4-flash',
    });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
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
    const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
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

    expect(out.text).toBe('{"facts":["x","y"]}');
    expect(out.toolCalls).toEqual([{ name: 'submit_facts', input: { facts: ['x', 'y'] } }]);

    expect(inc).toHaveBeenCalledTimes(1);
    expect(inc).toHaveBeenCalledWith({ model: 'deepseek-v4-pro' });
    expect(guard).toHaveBeenCalledWith({
      kind: 'schema-to-tool',
      model: 'deepseek-v4-pro',
    });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
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
    const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toContain('извлеки факты');
    expect(userMsg.content).toContain('submit_facts');
  });

  it('pro + caller передал tools + json_schema → strict json_schema снят (Pro его не поддерживает), tool_choice=auto, guard.strict-stripped', async () => {
    const { metrics, inc, guard } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(okResponse({ content: 'ответ' }));

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
      responseFormat: {
        type: 'json_schema',
        name: 'irrelevant',
        schema: FACTS_SCHEMA,
        strict: true,
      },
    });

    expect(inc).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith({
      kind: 'strict-stripped',
      model: 'deepseek-v4-pro',
    });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
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
    expect(callArgs.response_format).toBeUndefined();
    const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toBe('u');
  });

  it('flash + caller передал tools + json_schema → strict json_schema снят (прокси не поддерживает), guard.strict-stripped', async () => {
    const { metrics, inc, guard } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(okResponse({ content: 'ответ' }));

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

    expect(inc).not.toHaveBeenCalled();
    expect(guard).toHaveBeenCalledWith({
      kind: 'strict-stripped',
      model: 'deepseek-v4-flash',
    });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
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

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
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

    const systemText = 'Сделай отчёт по встрече.';
    await svc.complete({
      system: { text: systemText },
      user: 'Транскрипт...',
      model: 'deepseek-v4-pro',
      responseFormat: { type: 'json_object' },
    });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArgs.messages[0]!.content).toBe(systemText);
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

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArgs.messages[0]!.content).toBe('Верни ответ в JSON.');
  });
});

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

  function formatError(message: string): Error & { status: number } {
    const e = new Error(message) as Error & { status: number };
    e.status = 400;
    return e;
  }

  it('флаг OFF (дефолт) + non-thinking + json_schema → tool_choice="auto" (поведение не изменилось)', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-chat' });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
  });

  it('флаг ON + deepseek-v4-flash (thinking) + json_schema → tool_choice="auto" (v4 не форсим)', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg({ forceToolChoiceEnabled: true }), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-v4-flash' });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
  });

  it('флаг ON + non-thinking (deepseek-chat) + json_schema → tool_choice форсится на synthetic-tool', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg({ forceToolChoiceEnabled: true }), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-chat' });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toEqual(
      expect.objectContaining({
        type: 'function',
        function: { name: 'submit_facts' },
      }),
    );
  });

  it('флаг ON + thinking-модель → tool_choice="auto" (thinking не форсим)', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg({ forceToolChoiceEnabled: true }), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
      }),
    );

    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-v4-pro' });

    const callArgs = lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
  });

  it('флаг ON + форс + прокси бросает format-400 → откат на auto, guard tool-choice-relaxed, повтор; вторая модель сразу auto', async () => {
    const { metrics, guard } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg({ forceToolChoiceEnabled: true }), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    const create = lastSdkInstance.chat.completions.create;
    create
      .mockRejectedValueOnce(formatError('tool_choice with type function is not supported'))
      .mockResolvedValueOnce(
        okResponse({
          toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["a"]}' }],
        }),
      );

    const out = await svc.complete({
      ...JSON_SCHEMA_INPUT,
      model: 'deepseek-chat',
    });

    expect(out.text).toBe('{"facts":["a"]}');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].tool_choice).toEqual(
      expect.objectContaining({ type: 'function' }),
    );
    expect(create.mock.calls[1]![0].tool_choice).toBe('auto');
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool-choice-relaxed',
        model: 'deepseek-chat',
      }),
    );

    create.mockReset();
    create.mockResolvedValueOnce(
      okResponse({
        toolCalls: [{ name: 'submit_facts', arguments: '{"facts":["b"]}' }],
      }),
    );
    await svc.complete({ ...JSON_SCHEMA_INPUT, model: 'deepseek-chat' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].tool_choice).toBe('auto');
  });
});
