import { assertNotProd, readConfig } from '../_lib/combat-harness';

import { runJudge } from './judge';
import { matchAll } from './match';
import { runReport } from './report';
import { build, prepare } from './seed-reg-feed';

type Mode = 'prepare' | 'build' | 'match' | 'judge' | 'report' | 'all';
const MODES: readonly Mode[] = ['prepare', 'build', 'match', 'judge', 'report', 'all'];

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

async function dispatch(mode: Mode, stamp: string): Promise<void> {
  switch (mode) {
    case 'prepare':
      await prepare();
      break;
    case 'build':
      await build(stamp);
      break;
    case 'match':
      matchAll(stamp);
      break;
    case 'judge':
      await runJudge(stamp);
      break;
    case 'report':
      runReport(stamp);
      break;
    case 'all':
      await build(stamp);
      matchAll(stamp);
      await runJudge(stamp);
      runReport(stamp);
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
  const stamp = process.argv[3] ?? new Date().toISOString().replace(/[:.]/g, '-');
  log(`regulation-stand[A5]: ${mode} (stamp=${stamp})`);
  await dispatch(mode, stamp);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    process.stderr.write(`regulation-stand FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
