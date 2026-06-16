import { describe, expect, it } from 'vitest';

function simpleHash(s: string): number {
  let h = 0x811c_9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193);
    h >>>= 0;
  }
  return h >>> 0;
}

function pick(
  trafficShare: number,
  taskType: string,
  tenantId: string | null,
  seed: string,
): boolean {
  const hash = simpleHash(`${taskType}::${tenantId ?? 'null'}::${seed}`);
  const bucket = hash % 100;
  const threshold = Math.round(trafficShare * 100);
  return bucket < threshold;
}

describe('GEPA A/B deterministic hashing distribution', () => {
  it('trafficShare=0.1 → ~10% инвокаций попадают на candidate (N=1000, tol ±5%)', () => {
    let picked = 0;
    for (let i = 0; i < 1000; i++) {
      if (pick(0.1, 'meeting-report-fast', 'org-1', `seed-${i}`)) {
        picked += 1;
      }
    }
    const ratio = picked / 1000;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });

  it('trafficShare=0.5 → ~50% инвокаций (N=1000, tol ±10%)', () => {
    let picked = 0;
    for (let i = 0; i < 1000; i++) {
      if (pick(0.5, 'meeting-report-fast', 'org-1', `seed-${i}`)) {
        picked += 1;
      }
    }
    const ratio = picked / 1000;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('trafficShare=0 → 0 picks', () => {
    let picked = 0;
    for (let i = 0; i < 200; i++) {
      if (pick(0, 'meeting-report-fast', 'org-1', `seed-${i}`)) {
        picked += 1;
      }
    }
    expect(picked).toBe(0);
  });

  it('detericMinism: same seed дважды → same result', () => {
    const a = pick(0.5, 'task', 'org-1', 'same-seed');
    const b = pick(0.5, 'task', 'org-1', 'same-seed');
    expect(a).toBe(b);
  });

  it('different tenantId → разные распределения (не должны быть синхронизированы)', () => {
    let same = 0;
    for (let i = 0; i < 100; i++) {
      const seed = `s-${i}`;
      const a = pick(0.5, 'task', 'org-1', seed);
      const b = pick(0.5, 'task', 'org-2', seed);
      if (a === b) same += 1;
    }
    expect(same).toBeGreaterThan(20);
    expect(same).toBeLessThan(80);
  });
});
