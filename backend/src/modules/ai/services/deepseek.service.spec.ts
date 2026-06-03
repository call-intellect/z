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

  it('flash + json_schema (без tools) → авто-конверт в tool + tool_choice=auto + hint + метрика', async () => {
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
    // flash теперь конвертит так же, как pro — DeepSeek не умеет json_schema.
    expect(inc).toHaveBeenCalledWith({ model: 'deepseek-v4-flash' });
    expect(guard).toHaveBeenCalledWith({
      kind: 'schema-to-tool',
      model: 'deepseek-v4-flash',
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

  it('flash + caller передал tools + json_schema → json_schema снят (DeepSeek его не умеет), tool_choice=auto, guard.strict-stripped', async () => {
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
    // json_schema снят так же, как на pro — DeepSeek не поддерживает его нигде.
    expect(guard).toHaveBeenCalledWith({
      kind: 'strict-stripped',
      model: 'deepseek-v4-flash',
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.tool_choice).toBe('auto');
    // strict json_schema снят — НЕ передаём response_format.
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

  it('json_object без слова «json» в промпте → дописывается в хвост user', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: '{"ok":true}' }),
    );

    await svc.complete({
      system: { text: 'ты ассистент' },
      user: 'верни данные клиента',
      model: 'deepseek-v4-flash',
      responseFormat: { type: 'json_object' },
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    // исходный текст сохранён + слово «json» гарантировано присутствует.
    expect(userMsg.content).toContain('верни данные клиента');
    expect(userMsg.content.toLowerCase()).toContain('json');
  });

  it('json_object со словом «json» уже в system → user НЕ модифицируется', async () => {
    const { metrics } = makeMetricsMock();
    const svc = new DeepSeekService(makeCfg(), metrics);
    if (!lastSdkInstance) throw new Error('sdk not constructed');
    lastSdkInstance.chat.completions.create.mockResolvedValueOnce(
      okResponse({ content: '{"ok":true}' }),
    );

    await svc.complete({
      system: { text: 'верни ответ строго в формате JSON' },
      user: 'u',
      model: 'deepseek-v4-flash',
      responseFormat: { type: 'json_object' },
    });

    const callArgs =
      lastSdkInstance.chat.completions.create.mock.calls[0]![0];
    const userMsg = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toBe('u');
  });
});
