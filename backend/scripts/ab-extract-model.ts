import { readFileSync } from 'node:fs';

import OpenAI from 'openai';

const BASE_URL = process.env.AB_BASE_URL ?? 'https://proxy.agent-lia.ru/v1';
const PROXY_AUTH =
  process.env.PROXY_PREFIX && process.env.OPENAI_API_KEY
    ? `${process.env.PROXY_PREFIX}:${process.env.OPENAI_API_KEY}`
    : undefined;
const API_KEY = process.env.AB_API_KEY ?? PROXY_AUTH ?? process.env.DEEPSEEK_API_KEY ?? '';
const MODELS = (process.env.AB_MODELS ?? 'deepseek-v4-flash,deepseek-v4-pro').split(',');
const PROMPT_FILE = process.env.AB_PROMPT_FILE ?? 'ab-extract-call.json';
const REPEATS = Number(process.env.AB_REPEATS ?? '3');

const TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          assignee: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
          suggestedAssigneeHint: { type: ['string', 'null'] },
          suggestedDueDate: { type: ['string', 'null'] },
          suggestedPriority: {
            type: ['string', 'null'],
            enum: ['urgent', 'high', 'medium', 'low', null],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceQuote: { type: 'string' },
        },
        required: ['title', 'assignee', 'dueDate'],
      },
    },
  },
  required: ['tasks'],
} as const;

function splitPrompt(requestPreview: string): { system: string; user: string } {
  const idx = requestPreview.indexOf('[USER]');
  const sysStart = requestPreview.indexOf('[SYSTEM]');
  const system = requestPreview.slice(sysStart + '[SYSTEM]'.length, idx).trim();
  const user = requestPreview.slice(idx + '[USER]'.length).trim();
  return { system, user };
}

interface ExtractedTask {
  title: string;
  assignee: string | null;
  dueDate: string | null;
  suggestedAssigneeHint?: string | null;
  suggestedDueDate?: string | null;
  confidence?: number;
}

async function callModel(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
): Promise<{
  ok: boolean;
  validJson: boolean;
  tasks: ExtractedTask[];
  inputTokens: number;
  outputTokens: number;
  ms: number;
  error?: string;
}> {
  const toolName = 'submit_extract_tasks';
  const messages = [
    { role: 'system' as const, content: system },
    {
      role: 'user' as const,
      content: `${user}\n\nВажно: верни результат через вызов инструмента ${toolName}.`,
    },
  ];
  const started = Date.now();
  try {
    const resp = await client.chat.completions.create({
      model,
      stream: false,
      messages,
      tools: [
        {
          type: 'function',
          function: {
            name: toolName,
            description: 'Отдать структурированный список задач по схеме.',
            parameters: TASKS_SCHEMA as unknown as Record<string, unknown>,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: toolName } },
    });
    const ms = Date.now() - started;
    const choice = resp.choices?.[0];
    const tc = choice?.message?.tool_calls?.[0];
    const raw = tc?.function?.arguments ?? choice?.message?.content ?? '';
    let parsed: { tasks?: ExtractedTask[] } | null = null;
    let validJson = false;
    try {
      parsed = JSON.parse(raw);
      validJson = true;
    } catch {
      validJson = false;
    }
    return {
      ok: true,
      validJson,
      tasks: parsed?.tasks ?? [],
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      ms,
    };
  } catch (err) {
    return {
      ok: false,
      validJson: false,
      tasks: [],
      inputTokens: 0,
      outputTokens: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarize(tasks: ExtractedTask[]): {
  n: number;
  withOwner: number;
  withDue: number;
  avgConf: number;
} {
  const withOwner = tasks.filter(
    (t) => (t.assignee && t.assignee.trim()) || (t.suggestedAssigneeHint && t.suggestedAssigneeHint.trim()),
  ).length;
  const withDue = tasks.filter(
    (t) => (t.dueDate && t.dueDate.trim()) || (t.suggestedDueDate && t.suggestedDueDate.trim()),
  ).length;
  const confs = tasks.map((t) => t.confidence ?? 0);
  const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { n: tasks.length, withOwner, withDue, avgConf: Math.round(avgConf * 100) / 100 };
}

async function main(): Promise<void> {
  if (!API_KEY) {
    process.stderr.write('Нет API_KEY (AB_API_KEY/DEEPSEEK_API_KEY)\n');
    process.exit(1);
  }
  const payload = JSON.parse(readFileSync(PROMPT_FILE, 'utf8')) as { requestPreview?: string };
  if (!payload.requestPreview) {
    process.stderr.write('В файле нет requestPreview\n');
    process.exit(1);
  }
  const { system, user } = splitPrompt(payload.requestPreview);
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });

  process.stdout.write(`\nA/B extract — base=${BASE_URL} repeats=${REPEATS}\n`);
  process.stdout.write(`system=${system.length}симв user=${user.length}симв\n\n`);

  for (const model of MODELS) {
    process.stdout.write(`=== ${model} ===\n`);
    const runs: Array<Awaited<ReturnType<typeof callModel>>> = [];
    for (let i = 0; i < REPEATS; i++) {
      const r = await callModel(client, model, system, user);
      runs.push(r);
      if (!r.ok) {
        process.stdout.write(`  run${i + 1}: ОШИБКА ${r.error}\n`);
        continue;
      }
      const s = summarize(r.tasks);
      process.stdout.write(
        `  run${i + 1}: validJSON=${r.validJson} задач=${s.n} сОwner=${s.withOwner} сСроком=${s.withDue} avgConf=${s.avgConf} in=${r.inputTokens} out=${r.outputTokens} ${r.ms}ms\n`,
      );
    }
    const okRuns = runs.filter((r) => r.ok);
    const validRate = runs.length ? okRuns.filter((r) => r.validJson).length / runs.length : 0;
    const avgN = okRuns.length ? okRuns.reduce((a, r) => a + r.tasks.length, 0) / okRuns.length : 0;
    const avgOwner = okRuns.length
      ? okRuns.reduce((a, r) => a + summarize(r.tasks).withOwner, 0) / okRuns.length
      : 0;
    process.stdout.write(
      `  ИТОГ: validJSON-rate=${Math.round(validRate * 100)}% avgЗадач=${Math.round(avgN * 10) / 10} avgСOwner=${Math.round(avgOwner * 10) / 10}\n\n`,
    );
  }
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
