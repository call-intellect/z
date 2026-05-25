import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

/**
 * DeepSeekService unit-тесты.
 *
 * Главная цель — ТЗ 2026-05-25 (auto json_schema → tool для Pro):
 *   1. flash + json_schema → response_format: json_schema (как было).
 *   2. pro + json_schema (без tools) → tools + tool_choice='auto', НЕТ
 *      response_format, hint в user-сообщении, метрика инкрементируется.
 *   3. pro + caller передал tools → tools от caller'а, без автоконвертации.
 *   4. pro + json_object → response_format: json_object, без автоконвертации.
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

function makeCfg(): TypedConfigService {
  return {
    ai: {
      deepseek: {
        apiKey: 'sk-deepseek-test',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-v4-flash',
      },
    },
  } as unknown as TypedConfigService;
}

function makeMetricsMock(): {
  metrics: BusinessMetricsService;
  inc: ReturnType<typeof vi.fn>;
} {
  const inc = vi.fn();
  const metrics = {
    incDeepseekSchemaToToolConversion: inc,
  } as unknown as BusinessMetricsService;
  return { metrics, inc };
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

  it('flash + json_schema → response_format: json_schema (старый путь)', async () => {
    const { metrics, inc } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: '{"facts":["a"]}' }),
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
    expect(inc).not.toHaveBeenCalled();

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'facts', strict: true, schema: FACTS_SCHEMA },
    });
    expect(callArgs.tools).toBeUndefined();
    expect(callArgs.tool_choice).toBeUndefined();
    // hint в user-сообщении НЕ подмешиваем на flash.
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toBe('извлеки факты');
  });

  it('pro + json_schema (без tools) → автоконверт в tool + tool_choice=auto + hint + метрика', async () => {
    const { metrics, inc } = makeMetricsMock();
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

  it('pro + caller передал tools → автоконверта нет, tool_choice=auto, метрика не растёт', async () => {
    const { metrics, inc } = makeMetricsMock();
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
      // json_schema присутствует, но caller сам управляет tools — не конвертируем.
      responseFormat: {
        type: 'json_schema',
        name: 'irrelevant',
        schema: FACTS_SCHEMA,
        strict: true,
      },
    });

    expect(inc).not.toHaveBeenCalled();

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
    // response_format на этой ветке выставляется по старой логике.
    expect(callArgs.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'irrelevant',
        strict: true,
        schema: FACTS_SCHEMA,
      },
    });
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toBe('u');
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
});
