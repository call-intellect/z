import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { AdminSettingsService } from '../../admin/settings/admin-settings.service';

export type CalibrationParams = { a: number; b: number };

const A_MIN = -10;
const A_MAX = 10;
const B_MIN = -10;
const B_MAX = 10;

@Injectable()
export class ConfidenceCalibrationService {
  private readonly logger = new Logger(ConfidenceCalibrationService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
  ) {}

  async calibrate(rawConfidence: number, taskType: string): Promise<number> {
    if (!Number.isFinite(rawConfidence)) return 0;
    if (!this.cfg.confidenceCalibration.enabled) return clamp01(rawConfidence);

    const params = await this.getParams(taskType);
    if (!params) return clamp01(rawConfidence);

    const z = params.a * rawConfidence + params.b;
    const s = sigmoid(z);
    if (!Number.isFinite(s)) {
      this.logger.warn(
        { taskType, params, raw: rawConfidence },
        'ConfidenceCalibrationService.calibrate: получили non-finite, fallback на raw',
      );
      return clamp01(rawConfidence);
    }
    return clamp01(s);
  }

  async getParams(taskType: string): Promise<CalibrationParams | null> {
    const key = `confidence_calibration:${taskType}`;
    const raw = await this.settings.get<unknown>(key).catch(() => undefined);
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const a = Number(obj.a);
    const b = Number(obj.b);
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      a < A_MIN ||
      a > A_MAX ||
      b < B_MIN ||
      b > B_MAX
    ) {
      this.logger.warn(
        { taskType, params: obj },
        'ConfidenceCalibrationService.getParams: невалидные параметры калибровки',
      );
      return null;
    }
    return { a, b };
  }

  async setParams(taskType: string, params: CalibrationParams): Promise<void> {
    const key = `confidence_calibration:${taskType}`;
    const a = clamp(params.a, A_MIN, A_MAX);
    const b = clamp(params.b, B_MIN, B_MAX);
    await this.settings.set(
      key,
      { a, b, updatedAt: new Date().toISOString() },
      { reason: 'confidence-calibration cron — Platt fit on golden-set' },
    );
  }

  static platt(
    samples: ReadonlyArray<{ rawConfidence: number; label: 0 | 1 }>,
    options?: { iterations?: number; learningRate?: number },
  ): { params: CalibrationParams; brier: number; n: number } {
    const n = samples.length;
    if (n === 0) {
      return { params: { a: 1, b: 0 }, brier: 0, n: 0 };
    }
    const positives = samples.filter((s) => s.label === 1).length;
    if (positives === 0 || positives === n) {
      const brier = mean(samples.map((s) => (clamp01(s.rawConfidence) - s.label) ** 2));
      return { params: { a: 1, b: 0 }, brier, n };
    }

    let a = 1;
    let b = 0;
    const iterations = options?.iterations ?? 200;
    const lr = options?.learningRate ?? 0.01;

    for (let i = 0; i < iterations; i++) {
      let gradA = 0;
      let gradB = 0;
      for (const s of samples) {
        const x = clamp01(s.rawConfidence);
        const y = s.label;
        const p = sigmoid(a * x + b);
        const err = p - y;
        gradA += err * x;
        gradB += err;
      }
      gradA /= n;
      gradB /= n;
      a -= lr * gradA;
      b -= lr * gradB;
      a = clamp(a, A_MIN, A_MAX);
      b = clamp(b, B_MIN, B_MAX);
    }

    const brier = mean(
      samples.map((s) => {
        const p = sigmoid(a * clamp01(s.rawConfidence) + b);
        return (p - s.label) ** 2;
      }),
    );

    return { params: { a, b }, brier, n };
  }
}

export function sigmoid(z: number): number {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function clamp01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
