import { assertNotProd, readConfig } from '../_lib/combat-harness';

import { runE2e } from './e2e';
import { runJudge } from './judge';
import { matchAll } from './match';
import { runReport } from './report';
import { build, prepare } from './seed-reg-feed';

type Mode = 'prepare' | 'build' | 'match' | 'judge' | 'report' | 'all' | 'e2e';
const MODES: readonly Mode[] = ['prepare', 'build', 'match', 'judge', 'report', 'all', 'e2e'];

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

async function dispatch(mode: Mode, stamp: string, prevStamp?: string): Promise<void> {
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
      runReport(stamp, prevStamp);
      break;
    case 'all':
      await build(stamp);
      matchAll(stamp);
      await runJudge(stamp);
      runReport(stamp, prevStamp);
      break;
    case 'e2e':
      await runE2e(stamp);
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
  const prevIdx = process.argv.indexOf('--prev');
  const prevStamp = prevIdx !== -1 ? process.argv[prevIdx + 1] : undefined;
  log(`regulation-stand[A5]: ${mode} (stamp=${stamp}${prevStamp ? `, prev=${prevStamp}` : ''})`);
  await dispatch(mode, stamp, prevStamp);
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    process.stderr.write(`regulation-stand FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });
