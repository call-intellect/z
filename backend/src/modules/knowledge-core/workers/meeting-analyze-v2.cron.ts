import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

/**
 * MeetingAnalyzeV2Cron — каждые 10 минут сканирует встречи, которые подходят
 * под v2-агентов (Tasks-2.0/Chapters-2.0/Summary-2.0), и enqueue'ит jobs в
 * `core.meeting-analyze-v2`. Идемпотентность через jobId=
 * `meeting_analyze_v2_<meetingId>`.
 *
 * Условия enqueue:
 *   - master-флаг ENV `KNOWLEDGE_CORE_V2_AGENTS_ENABLED=true` (иначе skip);
 *   - meeting.status='ai_ready' (legacy AI-pipeline закончил);
 *   - meeting.tenantId IS NOT NULL (без backfill — пропускаем);
 *   - aiResult существует (значит legacy summary уже есть, и есть куда писать
 *     summaryV2);
 *   - analyzeV2Status IS NULL ИЛИ ('failed' AND updatedAt > now - 1d
 *     — даём шанс retry, но не зацикливаемся);
 *   - meeting.updatedAt > now - 7d (не обрабатываем старьё bulk).
 *
 * NB: cron-выражение в декораторе литералом ('*\/10 * * * *') — декоратор
 * вычисляется до DI, ENV-значение используется только для логов.
 */
@Injectable()
export class MeetingAnalyzeV2Cron {
  private readonly logger = new Logger(MeetingAnalyzeV2Cron.name);
  private static readonly TICK_LIMIT = 50;
  private static readonly LOOKBACK_DAYS = 7;
  private static readonly RETRY_AFTER_DAYS = 1;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  @Cron('*/10 * * * *')
  async sweep(): Promise<void> {
    if (!this.cfg.knowledgeCore.v2AgentsEnabled) {
      this.logger.debug(
        'meeting-analyze-v2-cron: KNOWLEDGE_CORE_V2_AGENTS_ENABLED=false — skip',
      );
      return;
    }
    try {
      const enqueued = await this.scanAndEnqueue();
      if (enqueued > 0) {
        this.logger.log(
          { enqueued },
          'meeting-analyze-v2-cron: enqueue завершён',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'meeting-analyze-v2-cron: непойманная ошибка — повтор через 10 мин',
      );
    }
  }

  /** Public для возможного админ-эндпоинта / ручного запуска. */
  async scanAndEnqueue(): Promise<number> {
    const now = Date.now();
    const lookbackSince = new Date(
      now - MeetingAnalyzeV2Cron.LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const failedRetryBefore = new Date(
      now - MeetingAnalyzeV2Cron.RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    // Используем raw SQL: Prisma where не умеет лаконично выразить
    // (analyzeV2Status IS NULL OR (analyzeV2Status='failed' AND updatedAt > X))
    // через own AST без дублирования.
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      SELECT m.id
        FROM "Meeting" m
        JOIN "AiResult" a ON a."meetingId" = m.id
       WHERE m.status = 'ai_ready'
         AND m."tenantId" IS NOT NULL
         AND m."deletedAt" IS NULL
         AND m."updatedAt" > $1
         AND (
              m."analyzeV2Status" IS NULL
              OR (m."analyzeV2Status" = 'failed' AND m."updatedAt" > $2)
         )
       ORDER BY m."updatedAt" DESC
       LIMIT $3
      `,
      lookbackSince,
      failedRetryBefore,
      MeetingAnalyzeV2Cron.TICK_LIMIT,
    );

    let enqueued = 0;
    for (const r of rows) {
      try {
        await this.coreQueue.enqueueMeetingAnalyzeV2(r.id);
        enqueued += 1;
      } catch (err) {
        this.logger.warn(
          {
            meetingId: r.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'meeting-analyze-v2-cron: enqueue упал — пропускаем',
        );
      }
    }
    return enqueued;
  }
}
