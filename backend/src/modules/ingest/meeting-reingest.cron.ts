import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

import { MeetingIngestAdapter } from './adapters/meeting.adapter';

@Injectable()
export class MeetingReingestCron {
  private readonly logger = new Logger(MeetingReingestCron.name);
  private running = false;

  private static readonly BATCH_SIZE = 50;
  private static readonly LOOKBACK_DAYS = 7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingIngestAdapter) private readonly meetingIngest: MeetingIngestAdapter,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/15 * * * *', { name: 'meeting-reingest' })
  async sweep(): Promise<void> {
    if (this.running) {
      this.logger.debug('meeting-reingest.cron: prev run in progress, skip');
      return;
    }
    this.running = true;
    try {
      const since = new Date(Date.now() - MeetingReingestCron.LOOKBACK_DAYS * 24 * 3600 * 1000);

      const candidates = await this.prisma.meeting.findMany({
        where: {
          createdAt: { gte: since },
          status: 'ai_ready',
          transcript: { is: { turns: { not: Prisma.AnyNull } } },
        },
        select: { id: true, tenantId: true },
        orderBy: { createdAt: 'desc' },
        take: MeetingReingestCron.BATCH_SIZE,
      });

      let reingested = 0;
      let skipped = 0;
      let failed = 0;

      for (const meeting of candidates) {
        const existing = await this.prisma.rawEvent.findFirst({
          where: { sourceExternalId: meeting.id, sourceType: 'meeting' },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }

        try {
          await this.meetingIngest.ingestMeeting(meeting.id);
          reingested++;
          this.logger.debug(
            { meetingId: meeting.id, tenantId: meeting.tenantId },
            'meeting-reingest.cron: встреча переигран в knowledge-core',
          );
        } catch (err) {
          failed++;
          const reason = classifyReingestFailure(err);
          this.metrics.incIngestFailed({ reason });
          this.logger.warn(
            {
              meetingId: meeting.id,
              tenantId: meeting.tenantId,
              reason,
              err: err instanceof Error ? err.message : String(err),
            },
            'meeting-reingest.cron: ingestMeeting упал — продолжаем со следующей',
          );
        }
      }

      if (reingested > 0 || failed > 0) {
        this.logger.debug(
          { candidates: candidates.length, reingested, skipped, failed },
          'meeting-reingest.cron: проход завершён',
        );
      } else {
        this.logger.debug(
          { candidates: candidates.length, skipped },
          'meeting-reingest.cron: нечего переигрывать',
        );
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'meeting-reingest.cron: проход упал',
      );
    } finally {
      this.running = false;
    }
  }
}

function classifyReingestFailure(err: unknown): string {
  const code = extractErrorCode(err);
  switch (code) {
    case 'source_inactive':
      return 'source_inactive';
    case 'meeting_no_merged_transcript':
      return 'no_merged_transcript';
    case 'meeting_without_tenant':
      return 'without_tenant';
    case 'quota_exceeded':
      return 'quota_exceeded';
    default:
      break;
  }
  if (err instanceof Error && err.name === 'QuotaExceededError') {
    return 'quota_exceeded';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('source_inactive') || msg.includes('Source отключён')) return 'source_inactive';
  if (msg.includes('meeting_no_merged_transcript')) return 'no_merged_transcript';
  if (msg.includes('meeting_without_tenant')) return 'without_tenant';
  if (msg.includes('quota_exceeded')) return 'quota_exceeded';
  return 'other';
}

function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const candidates: unknown[] = [];
  const maybeGet = (err as { getResponse?: () => unknown }).getResponse;
  if (typeof maybeGet === 'function') {
    try {
      candidates.push(maybeGet.call(err));
    } catch {}
  }
  candidates.push((err as { response?: unknown }).response);
  for (const body of candidates) {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    if (typeof code === 'string') return code;
  }
  return null;
}
