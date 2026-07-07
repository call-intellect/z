import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { assertNotProd, log } from './_shared';

const STEPS: Record<string, string> = {
  explore: 'explore.ts',
  summarize: 'summarize.ts',
  bakeoff: 'bakeoff.ts',
};

function runStep(file: string): void {
  const path = resolve(process.cwd(), 'scripts/clone-regulations-stand', file);
  log(`\n──────── ${file} ────────`);
  const r = spawnSync('bun', ['run', path], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) throw new Error(`шаг ${file} упал (code ${r.status})`);
}

function main(): void {
  assertNotProd();
  const mode = process.argv[2] ?? 'all';
  if (mode === 'all') {
    runStep(STEPS['explore']!);
    runStep(STEPS['summarize']!);
    runStep(STEPS['bakeoff']!);
    return;
  }
  const file = STEPS[mode];
  if (!file) throw new Error(`режим: explore|summarize|bakeoff|all (дано ${mode})`);
  runStep(file);
}

try {
  main();
  process.exit(0);
} catch (e) {
  process.stderr.write(`stand FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
}
