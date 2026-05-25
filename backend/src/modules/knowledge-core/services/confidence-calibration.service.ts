import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { AdminSettingsService } from '../../admin/settings/admin-settings.service';

/**
 * W2.2 KC-Temporal (2026-05-25) — `ConfidenceCalibrationService`.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.2.
 *
 * Калиброванная confidence через Platt scaling:
 *   `calibrated = sigmoid(a * raw + b)`
 * Параметры `{ a, b }` per taskType хранятся в AdminSetting под ключом
 * `confidence_calibration:<taskType>`. Идентичность (a=1, b=0) при отсутствии
 * параметров — чтобы выкатить сервис до сбора golden-set без побочных
 * эффектов в triage.
 *
 * Сервис чисто функциональный (без БД) — параметры читает AdminSettings
 * (с in-memory кешем 30s). Hot-path стоимость — 1 hash-lookup + математика.
 */

export type CalibrationParams = { a: number; b: number };

/** Безопасный диапазон параметров, чтобы не убить triage при сбое cron'а. */
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

  /**
   * Калибрует raw confidence через Platt scaling.
   *
   *   - При `cfg.confidenceCalibration.enabled === false` — возвращает raw.
   *   - При отсутствии параметров для taskType — возвращает raw (identity).
   *   - При неваидных параметрах (NaN/inf/out-of-range) — fallback на raw +
   *     warn-лог.
   *
   * Возвращает значение в диапазоне (0..1).
   */
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

  /**
   * Возвращает текущие параметры `{ a, b }` для taskType, либо null если
   * не настроены / невалидные. Кеш — внутри AdminSettingsService.
   */
  async getParams(taskType: string): Promise<CalibrationParams | null> {
    const key = `confidence_calibration:${taskType}`;
    const raw = await this.settings
      .get<unknown>(key)
      .catch(() => undefined);
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

  /**
   * Сохраняет новые параметры калибровки. Вызывается cron'ом после
   * пересчёта на golden-set'е.
   */
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

  /**
   * Платт-скейлинг через gradient descent на cross-entropy loss.
   *
   * `samples` — массив `{ rawConfidence, label }`, где `label ∈ {0,1}`
   * (1 = correct). Минимизируем
   *   `loss = -mean( y * log(p) + (1-y) * log(1-p) )`,
   *   `p = sigmoid(a * x + b)`.
   *
   * Возвращает финальные параметры + Brier score (для метрики).
   * Если выборка пустая или один класс — возвращает identity.
   */
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
      // Один класс — Platt не сходится, возвращаем identity.
      const brier = mean(
        samples.map(
          (s) => (clamp01(s.rawConfidence) - s.label) ** 2,
        ),
      );
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
        // d/da: (p - y) * x; d/db: (p - y).
        const err = p - y;
        gradA += err * x;
        gradB += err;
      }
      gradA /= n;
      gradB /= n;
      a -= lr * gradA;
      b -= lr * gradB;
      // Безопасный клэмп: иначе patological samples могут раздуть параметры.
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

// ─────────────────────────── helpers (pure) ───────────────────────────

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
