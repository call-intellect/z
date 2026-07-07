import { assertNotProd, readConfig } from '../_lib/combat-harness';
import { runAssert } from './assert';
import { inject } from './inject';
import { runJudge } from './judge';
import { runReport } from './report';
import { prepare, seed } from './seed-task-feed';
import type { RunOpts } from './types';

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

export function parseRunOpts(argv: string[]): RunOpts {
  const limitRaw = argValue(argv, '--limit');
  const idsRaw = argValue(argv, '--ids');
  const catsRaw = argValue(argv, '--cat');
  const stampRaw = argValue(argv, '--stamp');
  const opts: RunOpts = { stamp: stampRaw ?? new Date().toISOString().replace(/[:.]/g, '-') };
  if (limitRaw !== undefined) {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n > 0) opts.limit = n;
  }
  if (idsRaw) opts.ids = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (catsRaw) opts.cats = catsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  return opts;
}

type Mode = 'prepare' | 'seed' | 'inject' | 'run' | 'judge' | 'report' | 'report:nollm' | 'all';

const MODES: readonly Mode[] = ['prepare', 'seed', 'inject', 'run', 'judge', 'report', 'report:nollm', 'all'];

async function dispatch(mode: Mode, opts: RunOpts): Promise<void> {
  switch (mode) {
    case 'prepare':
      await prepare();
      break;
    case 'seed':
      await seed();
      break;
    case 'inject':
      await inject(opts);
      break;
    case 'run':
      await inject(opts);
      await runAssert(opts.stamp);
      break;
    case 'report:nollm':
      await runAssert(opts.stamp);
      break;
    case 'judge':
      await runJudge(opts.stamp);
      break;
    case 'report':
      await runReport(opts.stamp);
      break;
    case 'all':
      await inject(opts);
      await runAssert(opts.stamp);
      await runJudge(opts.stamp);
      await runReport(opts.stamp);
      break;
  }
}

async function main(): Promise<void> {
  assertNotProd(readConfig());
  const raw = process.argv[2] ?? 'prepare';
  if (!MODES.includes(raw as Mode)) {
    throw new Error(`режим: ${MODES.join(' | ')} (дано ${raw})`);
  }
  const mode = raw as Mode;
  const opts = parseRunOpts(process.argv.slice(3));
  log(`task-stand: ${mode} (stamp=${opts.stamp}${opts.limit ? `, limit=${opts.limit}` : ''}${opts.ids ? `, ids=${opts.ids.join(',')}` : ''}${opts.cats ? `, cats=${opts.cats.join(',')}` : ''})`);
  await dispatch(mode, opts);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    process.stderr.write(`task-stand FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
