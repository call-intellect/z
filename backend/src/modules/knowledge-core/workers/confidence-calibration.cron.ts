import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Gauge, register } from 'prom-client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfidenceCalibrationService } from '../services/confidence-calibration.service';

/**
 * W2.2 KC-Temporal (2026-05-25) — ConfidenceCalibrationCron.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.2.
 *
 * Раз в неделю (по умолчанию `0 4 * * 0` — Sun 04:00 UTC):
 *   1) Если `cfg.confidenceCalibration.enabled === false` — skip (cron остаётся
 *      зарегистрированным, но ничего не пишет).
 *   2) Для каждого taskType, по которому есть ≥ MIN_SAMPLES_PER_TASK
 *      LlmPreferenceSample'ов с label ∈ {'correct', 'wrong'}:
 *      - Собираем выборку `{ rawConfidence, label }`.
 *      - Считаем оптимальные `a, b` через Platt scaling.
 *      - Сохраняем в AdminSetting через ConfidenceCalibrationService.setParams.
 *   3) Эмитим gauge `kc_confidence_calibration_loss{task_type}` = Brier score.
 *
 * NB: cron-выражение в декораторе литерально `'0 4 * * 0'`. Если ENV
 * `CONFIDENCE_CALIBRATION_CRON` задан другим выражением — оператор подхватит
 * его через CronManagerService.onModuleInit() (overrides из CronSchedule).
 */

/** Сколько минимум сэмплов на taskType, чтобы пересчитывать параметры. */
const MIN_SAMPLES_PER_TASK = 30;

/** Имя метрики Brier score — стабильно (нельзя переименовывать). */
const METRIC_LOSS = 'kc_confidence_calibration_loss';

/** Извлечение `confidence` из inputContext / modelOutput LlmPreferenceSample. */
function extractRawConfidence(sample: {
  inputContext: unknown;
  modelOutput: unknown;
}): number | null {
  // Сначала проверяем modelOutput.confidence (наиболее типичная структура).
  const out = sample.modelOutput as Record<string, unknown> | null;
  if (out && typeof out === 'object') {
    const c = out.confidence;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  // Fallback: inputContext.confidence (например, для проекций where confidence
  // живёт на input-блоке).
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

  /**
   * Cron: weekly. Литерал в декораторе обязателен — `@nestjs/schedule` парсит
   * статическое выражение на момент DI. Hot-reload расписания живёт в
   * CronManagerService (читает CronSchedule из БД).
   */
  @Cron('0 4 * * 0')
  async run(): Promise<void> {
    try {
      if (!this.cfg.confidenceCalibration.enabled) {
        this.logger.debug(
          'confidence-calibration.cron: ENABLED=false, skip',
        );
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

  /**
   * Чистая логика прохода — вынесена для unit-теста (без @Cron).
   */
  async runOnce(): Promise<{ updatedTasks: number; skippedTasks: number }> {
    // Группируем по taskType, считаем приближённо количество label'ов.
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

  /** Идемпотентная регистрация gauge'а (дубль на hot-reload не падает). */
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
