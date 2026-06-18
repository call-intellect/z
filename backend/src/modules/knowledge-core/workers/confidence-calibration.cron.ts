import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Gauge, register } from 'prom-client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfidenceCalibrationService } from '../services/confidence-calibration.service';

const MIN_SAMPLES_PER_TASK = 30;

const METRIC_LOSS = 'kc_confidence_calibration_loss';

function extractRawConfidence(sample: {
  inputContext: unknown;
  modelOutput: unknown;
}): number | null {
  const out = sample.modelOutput as Record<string, unknown> | null;
  if (out && typeof out === 'object') {
    const c = out.confidence;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  const inp = sample.inputContext as Record<string, unknown> | null;
  if (inp && typeof inp === 'object') {
    const c = inp.confidence;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

@Injectable()
export class ConfidenceCalibrationCron {
  private readonly logger = new Logger(ConfidenceCalibrationCron.name);
  private readonly lossGauge: Gauge<'task_type'>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ConfidenceCalibrationService)
    private readonly calibration: ConfidenceCalibrationService,
  ) {
    this.lossGauge = this.getOrCreateGauge();
  }

  @Cron('0 4 * * 0')
  async run(): Promise<void> {
    try {
      if (!this.cfg.confidenceCalibration.enabled) {
        this.logger.debug('confidence-calibration.cron: ENABLED=false, skip');
        return;
      }
      await this.runOnce();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'confidence-calibration.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(): Promise<{ updatedTasks: number; skippedTasks: number }> {
    const rows = await this.prisma.llmPreferenceSample.groupBy({
      by: ['taskType'],
      where: { label: { in: ['correct', 'wrong'] } },
      _count: { _all: true },
    });

    let updatedTasks = 0;
    let skippedTasks = 0;
    for (const r of rows) {
      const taskType = r.taskType;
      if (r._count._all < MIN_SAMPLES_PER_TASK) {
        skippedTasks++;
        this.logger.debug(
          { taskType, count: r._count._all, min: MIN_SAMPLES_PER_TASK },
          'confidence-calibration: недостаточно сэмплов, skip taskType',
        );
        continue;
      }
      const samples = await this.prisma.llmPreferenceSample.findMany({
        where: { taskType, label: { in: ['correct', 'wrong'] } },
        select: { inputContext: true, modelOutput: true, label: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
      const dataset: Array<{ rawConfidence: number; label: 0 | 1 }> = [];
      for (const s of samples) {
        const raw = extractRawConfidence({
          inputContext: s.inputContext,
          modelOutput: s.modelOutput,
        });
        if (raw === null) continue;
        dataset.push({
          rawConfidence: raw,
          label: s.label === 'correct' ? 1 : 0,
        });
      }
      if (dataset.length < MIN_SAMPLES_PER_TASK) {
        skippedTasks++;
        continue;
      }
      const fit = ConfidenceCalibrationService.platt(dataset);
      await this.calibration.setParams(taskType, fit.params);
      this.lossGauge.set({ task_type: taskType }, fit.brier);
      updatedTasks++;
      this.logger.debug(
        { taskType, n: fit.n, a: fit.params.a, b: fit.params.b, brier: fit.brier },
        'confidence-calibration: параметры обновлены',
      );
    }

    this.logger.debug(
      { updatedTasks, skippedTasks },
      'confidence-calibration: weekly проход завершён',
    );
    return { updatedTasks, skippedTasks };
  }

  private getOrCreateGauge(): Gauge<'task_type'> {
    const existing = register.getSingleMetric(METRIC_LOSS);
    if (existing instanceof Gauge) {
      return existing as Gauge<'task_type'>;
    }
    return new Gauge<'task_type'>({
      name: METRIC_LOSS,
      help: 'W2.2: Brier score Platt-калибровки по taskType (ниже = точнее).',
      labelNames: ['task_type'],
    });
  }
}
