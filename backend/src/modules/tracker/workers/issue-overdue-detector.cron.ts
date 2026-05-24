import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { TrackerEmitterService } from '../services/tracker-emitter.service';

/**
 * IssueOverdueDetectorCron (Sprint 3 B1-3.1, 2026-05-24).
 *
 * Раз в сутки в 09:00 ищет задачи с истёкшим `dueDate` и эмитит
 * `issue.overdue_detected` (TrackerAdapter → RawEvent(signalType=task_overdue)).
 *
 * Дедупликация:
 *   - Только Issue с `dueDate < now`, `state.category NOT IN ('completed', 'cancelled')`,
 *     `deletedAt IS NULL`.
 *   - Дополнительно: `lastOverdueDetectedAt IS NULL OR lastOverdueDetectedAt < now - 7d`.
 *     Это защищает от спама: одна и та же задача не порождает 30 одинаковых
 *     overdue-блоков в knowledge-core за месяц просрочки.
 *
 * После эмита — обновляем `Issue.lastOverdueDetectedAt = now`. Делаем это
 * прицельно `updateMany({ id: issueId })`, чтобы не задеть updatedAt
 * (Prisma всё равно его обновит). Принимаем компромисс: updatedAt
 * сдвинется на момент cron'а; для трекера это допустимо (не путаем с
 * пользовательской правкой задачи, потому что IssueActivity verb остаётся
 * прежним и tracker UI показывает updatedAt только как fallback).
 *
 * NB: если cron не отрабатывает (упал worker), при следующем тике мы
 * обработаем все накопившиеся — это и есть задумка.
 */
@Injectable()
export class IssueOverdueDetectorCron {
  private readonly logger = new Logger(IssueOverdueDetectorCron.name);

  /** Минимальный интервал между двумя overdue-эмитами на одной задаче (мс). */
  static readonly RE_EMIT_DEBOUNCE_MS = 7 * 24 * 3600 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TrackerEmitterService)
    private readonly emitter: TrackerEmitterService,
  ) {}

  @Cron('0 9 * * *')
  async detectOverdue(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'issue-overdue-detector: непойманная ошибка',
      );
    }
  }

  /** Внутренний публичный метод — удобно вызывать из юнит-тестов. */
  async run(): Promise<{ scanned: number; emitted: number }> {
    const now = new Date();
    const debounceBefore = new Date(
      now.getTime() - IssueOverdueDetectorCron.RE_EMIT_DEBOUNCE_MS,
    );
    const candidates = await this.prisma.issue.findMany({
      where: {
        deletedAt: null,
        dueDate: { lt: now },
        OR: [
          { lastOverdueDetectedAt: null },
          { lastOverdueDetectedAt: { lt: debounceBefore } },
        ],
        state: {
          category: { notIn: ['completed', 'cancelled'] },
        },
      },
      take: 5000, // защита от runaway-загрузки на гигантских tenant'ах
    });
    let emitted = 0;
    for (const issue of candidates) {
      if (!issue.dueDate) continue;
      const daysOverdue = Math.max(
        1,
        Math.floor(
          (now.getTime() - issue.dueDate.getTime()) / (24 * 3600 * 1000),
        ),
      );
      try {
        this.emitter.emitIssueOverdueDetected({ issue, daysOverdue });
        await this.prisma.issue.update({
          where: { id: issue.id },
          data: { lastOverdueDetectedAt: now },
        });
        emitted++;
      } catch (err) {
        this.logger.warn(
          {
            issueId: issue.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'issue-overdue-detector: пропустил задачу — продолжаем',
        );
      }
    }
    this.logger.log(
      { scanned: candidates.length, emitted },
      'issue-overdue-detector: проход завершён',
    );
    return { scanned: candidates.length, emitted };
  }
}
