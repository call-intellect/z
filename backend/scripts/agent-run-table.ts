import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { AGENT_REGISTRY } from './agent-registry';
import { type AgentRun, aggregate, diffRuns, formatRunDiff, saveRun } from './_lib/agent-runs';
import { computeDirectCost, directLlmCall } from './_lib/llm-direct';

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
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { flags };
}
function str(a: Args, k: string): string | undefined {
  return typeof a.flags[k] === 'string' ? (a.flags[k] as string) : undefined;
}
function has(a: Args, k: string): boolean {
  return k in a.flags;
}
function die(msg: string): never {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(1);
}
function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const EVAL_ROOT = path.resolve('test/eval');

interface Fixture {
  id: string;
  variant?: string;
}

async function loadFixtures(agent: string, filter?: string): Promise<Fixture[]> {
  const dir = path.join(EVAL_ROOT, agent, 'fixtures');
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    die(`Нет каталога фикстур: ${dir}. Создай ${agent}.<variant>.json там.`);
  }
  if (filter) files = files.filter((f) => f.includes(filter));
  files.sort();
  const out: Fixture[] = [];
  for (const f of files) {
    out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as Fixture);
  }
  return out;
}

function parseOutput(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (has(a, 'list') || !str(a, 'agent')) {
    process.stdout.write('Агенты в реестре:\n');
    for (const [k, v] of Object.entries(AGENT_REGISTRY)) {
      process.stdout.write(`  ${k.padEnd(24)} ${v.label} (${v.provider}:${v.model})\n`);
    }
    process.stdout.write(
      '\nЗапуск: agent-run-table --agent <name> [--prompt-file <override>] [--model <m>] [--fixtures <substr>] [--no-diff]\n',
    );
    if (!str(a, 'agent')) return;
  }

  const agent = str(a, 'agent')!;
  const spec = AGENT_REGISTRY[agent];
  if (!spec) die(`Неизвестный агент «${agent}». См. --list.`);

  const overridePath = str(a, 'prompt-file');
  const rawSystem = overridePath
    ? await fs.readFile(path.resolve(overridePath), 'utf8')
    : spec.systemPrompt;
  const system = spec.wrapSystem ? spec.wrapSystem(rawSystem) : rawSystem;
  const model = str(a, 'model') ?? spec.model;
  const promptHash = sha256(system).slice(0, 12);

  const fixtures = await loadFixtures(agent, str(a, 'fixtures'));
  process.stdout.write(
    `\n=== ${spec.label} (${spec.provider}:${model}) ===\n` +
      `промпт=${promptHash}${overridePath ? ` (ОВЕРРАЙД: ${overridePath})` : ' (боевой)'}  фикстур=${fixtures.length}\n\n`,
  );

  const ts0 = new Date().toISOString();
  const current: AgentRun[] = [];

  for (const fx of fixtures) {
    const rawUser = spec.buildUser(fx);
    const user = spec.wrapUser ? spec.wrapUser(rawUser) : rawUser;
    const result = await directLlmCall({
      provider: spec.provider,
      model,
      system,
      user,
      schema: spec.schema,
      schemaName: spec.schemaName,
      toolName: spec.schemaName,
      maxTokens: spec.maxTokens ?? 4000,
    });
    const raw = result.toolCallArgs ?? result.text;
    const parsed = parseOutput(raw);
    const ev = result.error
      ? { score: 0, pass: false, perCriterion: {}, explain: result.error, costUsd: 0 }
      : spec.evaluate(fx, parsed, raw);

    const run: AgentRun = {
      task: spec.taskType,
      fixtureId: fx.id,
      promptHash,
      provider: result.provider,
      model: result.model,
      output: raw,
      score: ev.score,
      pass: ev.pass,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      cachedTokens: result.cachedTokens,
      costUsd: computeDirectCost(model, result),
      ms: result.ms,
      error: result.error,
      ts: new Date().toISOString(),
    };
    current.push(run);
    await saveRun(EVAL_ROOT, agent, run);

    const flag = ev.pass ? '✓' : '✗';
    const cost = run.costUsd === null ? 'н/д' : `$${run.costUsd.toFixed(5)}`;
    process.stdout.write(
      `  ${flag} ${(fx.id + (fx.variant ? `/${fx.variant}` : '')).padEnd(30)} score=${ev.score.toFixed(2)} ` +
        `${cost} ${result.ms}мс${ev.pass ? '' : ` — ${ev.explain}`}\n`,
    );
  }

  const agg = aggregate(current);
  process.stdout.write(
    `\n--- Итог ---\n` +
      `  passRate=${agg.passRate === null ? '—' : agg.passRate.toFixed(3)} ` +
      `avgScore=${agg.avgScore === null ? '—' : agg.avgScore.toFixed(3)} ` +
      `стоимость=$${agg.totalCostUsd.toFixed(5)} ошибок=${agg.errors}\n`,
  );

  if (!has(a, 'no-diff')) {
    const dir = path.join(EVAL_ROOT, agent, 'runs');
    let prior: AgentRun[] = [];
    try {
      const files = (await fs.readdir(dir)).filter(
        (f) => f.endsWith('.json') && !f.startsWith(promptHash),
      );
      for (const f of files) {
        const r = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as AgentRun;
        if (r.ts < ts0) prior.push(r);
      }
    } catch {
      prior = [];
    }
    if (prior.length > 0) {
      process.stdout.write('\n' + formatRunDiff(`${agent}: предыдущая версия → текущая`, diffRuns(prior, current)) + '\n');
    } else {
      process.stdout.write('\n(нет прошлых прогонов другой версии промпта — diff пропущен)\n');
    }
  }
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
