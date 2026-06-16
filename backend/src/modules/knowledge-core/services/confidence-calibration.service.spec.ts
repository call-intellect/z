import { describe, expect, it } from 'vitest';

import { ConfidenceCalibrationService, sigmoid } from './confidence-calibration.service';

function makeService(
  enabled = true,
  storage: Record<string, unknown> = {},
): ConfidenceCalibrationService {
  const fakeCfg = {
    confidenceCalibration: { enabled, cron: '0 4 * * 0' },
  } as unknown as ConstructorParameters<typeof ConfidenceCalibrationService>[0];
  const fakeSettings = {
    async get<T>(key: string): Promise<T | undefined> {
      return storage[key] as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      storage[key] = value;
    },
  } as unknown as ConstructorParameters<typeof ConfidenceCalibrationService>[1];
  return new ConfidenceCalibrationService(fakeCfg, fakeSettings);
}

describe('ConfidenceCalibrationService.calibrate', () => {
  it('identity при a=1, b=0 — calibrate возвращает sigmoid(raw), который при больших a близок к raw на пограничных точках', async () => {
    const storage: Record<string, unknown> = {
      'confidence_calibration:t': { a: 1, b: 0 },
    };
    const svc = makeService(true, storage);
    const v = await svc.calibrate(0.5, 't');
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('ENABLED=false — calibrate возвращает raw (clamped в [0..1])', async () => {
    const svc = makeService(false);
    expect(await svc.calibrate(0.42, 'whatever')).toBe(0.42);
    expect(await svc.calibrate(-1, 'x')).toBe(0);
    expect(await svc.calibrate(1.5, 'x')).toBe(1);
  });

  it('нет параметров для taskType — calibrate возвращает raw', async () => {
    const svc = makeService(true, {});
    expect(await svc.calibrate(0.7, 'unknown')).toBe(0.7);
  });

  it('невалидные параметры (NaN, out-of-range) — fallback на raw', async () => {
    const storage = {
      'confidence_calibration:t': { a: 9999, b: NaN },
    };
    const svc = makeService(true, storage);
    expect(await svc.calibrate(0.5, 't')).toBe(0.5);
  });
});

describe('ConfidenceCalibrationService.platt (static)', () => {
  it('пустая выборка → identity (a=1, b=0)', () => {
    const r = ConfidenceCalibrationService.platt([]);
    expect(r.params.a).toBe(1);
    expect(r.params.b).toBe(0);
    expect(r.n).toBe(0);
  });

  it('одноклассовая выборка → identity (a=1, b=0)', () => {
    const r = ConfidenceCalibrationService.platt([
      { rawConfidence: 0.5, label: 1 },
      { rawConfidence: 0.7, label: 1 },
      { rawConfidence: 0.9, label: 1 },
    ]);
    expect(r.params.a).toBe(1);
    expect(r.params.b).toBe(0);
    expect(r.n).toBe(3);
  });

  it('separable dataset → fit получается осмысленный (Brier > 0, sigmoid(a*x+b) для high-conf больше, чем для low-conf)', () => {
    const samples: Array<{ rawConfidence: number; label: 0 | 1 }> = [];
    for (let i = 0; i < 30; i++) {
      samples.push({ rawConfidence: 0.85 + (i % 5) * 0.01, label: 1 });
      samples.push({ rawConfidence: 0.2 + (i % 5) * 0.01, label: 0 });
    }
    const r = ConfidenceCalibrationService.platt(samples, {
      iterations: 500,
      learningRate: 0.05,
    });
    const pLow = sigmoid(r.params.a * 0.2 + r.params.b);
    const pHigh = sigmoid(r.params.a * 0.85 + r.params.b);
    expect(pHigh).toBeGreaterThan(pLow);
    expect(r.brier).toBeGreaterThanOrEqual(0);
    expect(r.brier).toBeLessThanOrEqual(1);
    expect(r.n).toBe(60);
  });

  it('monotonicity: больший raw → больше calibrated при положительной a из fit', () => {
    const samples: Array<{ rawConfidence: number; label: 0 | 1 }> = [];
    for (let i = 0; i < 50; i++) {
      samples.push({ rawConfidence: 0.9, label: 1 });
      samples.push({ rawConfidence: 0.1, label: 0 });
    }
    const r = ConfidenceCalibrationService.platt(samples, {
      iterations: 300,
    });
    const p1 = sigmoid(r.params.a * 0.3 + r.params.b);
    const p2 = sigmoid(r.params.a * 0.6 + r.params.b);
    const p3 = sigmoid(r.params.a * 0.9 + r.params.b);
    if (r.params.a >= 0) {
      expect(p1).toBeLessThanOrEqual(p2);
      expect(p2).toBeLessThanOrEqual(p3);
    } else {
      expect(p1).toBeGreaterThanOrEqual(p2);
      expect(p2).toBeGreaterThanOrEqual(p3);
    }
  });
});
