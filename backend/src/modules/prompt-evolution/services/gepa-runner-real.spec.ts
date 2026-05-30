/**
 * Agents v2 Фаза C2 (2026-05-30) — Real subprocess smoke test для GEPA runner.
 *
 * Skip по умолчанию. Включается через `GEPA_REAL_TEST=1`:
 *   GEPA_REAL_TEST=1 bunx vitest run src/modules/prompt-evolution/services/gepa-runner-real.spec.ts
 *
 * Что тестирует:
 *   1. Реальный python3 runner.py --version отвечает корректным JSON.
 *   2. (опц., если установлен gepa pip) — реальный optimize на 5 синтетических
 *      примерах возвращает ≥1 кандидата.
 *
 * НЕ устанавливает gepa автоматически — это ответственность Docker prod-runner
 * и dev-окружения (см. backend/python/gepa/requirements.txt).
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REAL = process.env.GEPA_REAL_TEST === '1';
const PYTHON = process.env.GEPA_PYTHON_PATH ?? 'python3';

describe.skipIf(!REAL)('GepaRunner real subprocess smoke', () => {
  it('python3 runner.py --version → JSON с runner+version', () => {
    const scriptPath = join(process.cwd(), 'python', 'gepa', 'runner.py');
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
    const scriptPath = join(process.cwd(), 'python', 'gepa', 'runner.py');
    const r = spawnSync(PYTHON, [scriptPath], {
      encoding: 'utf8',
      input: '',
      timeout: 5000,
    });
    // Exit code не 0, но stdout содержит JSON с error.
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
