import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { type AgentRun, saveRun } from './_lib/agent-runs';
import { type ProviderName, computeDirectCost, directLlmCall } from './_lib/llm-direct';

interface Args {
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { flags };
}

function str(a: Args, k: string): string | undefined {
  return typeof a.flags[k] === 'string' ? (a.flags[k] as string) : undefined;
}
function num(a: Args, k: string): number | undefined {
  const v = str(a, k);
  return v === undefined ? undefined : Number(v);
}
function has(a: Args, k: string): boolean {
  return k in a.flags;
}

function die(msg: string): never {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function readMaybeFile(
  a: Args,
  inlineKey: string,
  fileKey: string,
): Promise<string | undefined> {
  const file = str(a, fileKey);
  if (file) return fs.readFile(path.resolve(file), 'utf8');
  return str(a, inlineKey);
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const HELP = `agent-replay — прогнать ОДИН агент (taskType) на заданном входе через реальный LLM-вызов.
Режим: прямой вызов провайдера (без БД/Docker). Печатает вход-хэш, выход, токены, цену.

Флаги:
  --task <LlmTaskType>          метка задачи (по умолчанию custom-prompt)
  --system <str> | --system-file <path>   system-prompt (боевой)
  --prompt-file <path>          ОВЕРРАЙД system-prompt кандидатом (И-3), приоритетнее --system*
  --user <str> | --user-file <path>       вход (транскрипт/текст), обязателен
  --schema-file <path>          JSON-схема → structured output (tool у deepseek, json_schema у proxy)
  --tool-name <name>            имя tool/schema (по умолчанию submit_result)
  --provider deepseek|openai-proxy   (по умолчанию deepseek)
  --model <model>               (по умолчанию deepseek-v4-pro)
  --max-tokens <n>              (по умолчанию 4000)
  --reasoning-effort <e>        для proxy gpt-* (по умолчанию medium)
  --out <path>                  записать полный прогон в JSON
  --save <agentDir>             записать прогон в run-store test/eval/<agentDir>/runs/
  --json                        печатать сырой JSON прогона
Ключи LLM — из env (запускать с --env-file=c:/work/z/.env).`;

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (has(a, 'help')) {
    process.stdout.write(HELP + '\n');
    return;
  }

  const task = str(a, 'task') ?? 'custom-prompt';
  const override = str(a, 'prompt-file');
  const system = override
    ? await fs.readFile(path.resolve(override), 'utf8')
    : await readMaybeFile(a, 'system', 'system-file');
  const user = await readMaybeFile(a, 'user', 'user-file');
  if (!system) die('Нужен system-prompt: --system / --system-file / --prompt-file.');
  if (!user) die('Нужен вход: --user / --user-file.');

  const schemaPath = str(a, 'schema-file');
  const schema = schemaPath
    ? (JSON.parse(await fs.readFile(path.resolve(schemaPath), 'utf8')) as Record<string, unknown>)
    : null;
  const toolName = str(a, 'tool-name') ?? 'submit_result';
  const provider = (str(a, 'provider') ?? 'deepseek') as ProviderName;
  const model = str(a, 'model') ?? 'deepseek-v4-pro';
  const maxTokens = num(a, 'max-tokens') ?? 4000;
  const reasoningEffort = str(a, 'reasoning-effort') ?? 'medium';

  const result = await directLlmCall({
    provider,
    model,
    system,
    user,
    schema,
    schemaName: toolName,
    toolName,
    maxTokens,
    reasoningEffort,
  });

  const cost = computeDirectCost(model, result);
  const promptHash = sha256(system).slice(0, 12);
  const inputHash = sha256(user).slice(0, 12);
  const cachePct = result.tokensIn > 0 ? Math.round((result.cachedTokens / result.tokensIn) * 100) : 0;

  const run: AgentRun = {
    task,
    inputHash,
    promptHash,
    provider: result.provider,
    model: result.model,
    output: result.toolCallArgs ?? result.text,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    cachedTokens: result.cachedTokens,
    costUsd: cost,
    ms: result.ms,
    error: result.error,
    ts: new Date().toISOString(),
  };

  const outPath = str(a, 'out');
  if (outPath) {
    await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await fs.writeFile(path.resolve(outPath), JSON.stringify(run, null, 2) + '\n', 'utf8');
  }
  const saveDir = str(a, 'save');
  let savedTo: string | null = null;
  if (saveDir) savedTo = await saveRun(path.resolve('test/eval'), saveDir, run);

  if (has(a, 'json')) {
    process.stdout.write(JSON.stringify(run, null, 2) + '\n');
    if (result.error) process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n=== agent-replay: ${task} (${result.provider}:${result.model}) ===\n`);
  process.stdout.write(
    `promptHash=${promptHash}${override ? ' (ОВЕРРАЙД)' : ''}  inputHash=${inputHash}  schema=${schema ? 'да' : 'нет'}\n`,
  );
  if (result.error) {
    process.stderr.write(`✗ ОШИБКА: ${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `вход=${result.tokensIn} (кэш=${result.cachedTokens}, ${cachePct}%)  выход=${result.tokensOut}  ` +
      `цена=${cost === null ? 'н/д (нет тарифа для ' + model + ')' : '$' + cost.toFixed(5)}  ${result.ms}мс\n`,
  );
  if (outPath) process.stdout.write(`out: ${outPath}\n`);
  if (savedTo) process.stdout.write(`run-store: ${savedTo}\n`);
  process.stdout.write(`\n--- ВЫХОД (${result.toolCallArgs ? 'tool/structured' : 'текст'}) ---\n`);
  process.stdout.write((result.toolCallArgs ?? result.text) + '\n');
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
