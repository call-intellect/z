import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REAL = process.env.GEPA_REAL_TEST === '1';
const PYTHON = process.env.GEPA_PYTHON_PATH ?? 'python3';

describe.skipIf(!REAL)('GepaRunner real subprocess smoke', () => {
  it('python3 runner.py --version → JSON с runner+version', () => {
    const scriptPath = join(process.cwd(), '..', 'infra', 'gepa', 'gepa', 'runner.py');
    const r = spawnSync(PYTHON, [scriptPath, '--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse((r.stdout || '').trim());
    expect(parsed).toHaveProperty('runner', 'gepa-runner');
    expect(parsed).toHaveProperty('version');
    expect(parsed).toHaveProperty('python');
  });

  it('runner.py с пустым stdin → JSON-error gracefully', () => {
    const scriptPath = join(process.cwd(), '..', 'infra', 'gepa', 'gepa', 'runner.py');
    const r = spawnSync(PYTHON, [scriptPath], {
      encoding: 'utf8',
      input: '',
      timeout: 5000,
    });
    const parsed = JSON.parse((r.stdout || '').trim());
    expect(parsed).toHaveProperty('error');
    expect(parsed).toHaveProperty('pareto_frontier');
    expect(Array.isArray(parsed.pareto_frontier)).toBe(true);
  });
});

describe.skipIf(REAL)('GepaRunner real subprocess smoke', () => {
  it('skipped (set GEPA_REAL_TEST=1 to enable)', () => {
    expect(true).toBe(true);
  });
});
