import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { IngestService, type IngestResult } from '../ingest.service';

import { mapStructuredToReportFacts, type ReportFact } from './report-fact-mapper';

interface ReportChapterPayload {
  title: string;
  summary: string;
}

@Injectable()
export class ReportIngestAdapter {
  private readonly logger = new Logger(ReportIngestAdapter.name);

  static readonly DEFAULT_SOURCE_NAME = 'Отчёты встреч Z';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  async ingestReport(meetingId: string): Promise<IngestResult | null> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        tenantId: true,
        type: true,
        title: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        aiResult: { select: { summaryFast: true, structuredData: true } },
      },
    });
    if (!meeting) {
      this.logger.debug({ meetingId }, 'report-adapter: meeting не найден — skip');
      return null;
    }
    if (!meeting.tenantId) {
      this.logger.warn({ meetingId }, 'report-adapter: meeting без tenantId — skip');
      return null;
    }
    const tenantId = meeting.tenantId;

    const chapterRows = await this.prisma.meetingChapter.findMany({
      where: { meetingId, extractorVersion: 'fast' },
      orderBy: { order: 'asc' },
      select: { title: true, summary: true },
    });
    const chapters: ReportChapterPayload[] = chapterRows
      .filter((c) => c.title.trim().length > 0)
      .map((c) => ({ title: c.title, summary: c.summary ?? '' }));

    const reportSummaryMarkdown = (meeting.aiResult?.summaryFast ?? '').trim();

    const reportFacts: ReportFact[] = mapStructuredToReportFacts(
      meeting.type,
      meeting.aiResult?.structuredData,
    );

    if (reportFacts.length === 0 && reportSummaryMarkdown.length === 0 && chapters.length === 0) {
      this.logger.debug(
        { meetingId, tenantId },
        'report-adapter: пустой отчёт (нет фактов, summary и глав) — RawEvent не создаём',
      );
      return null;
    }

    const source = await this.upsertDefaultReportSource(tenantId);

    const payload = {
      kind: 'meeting_report' as const,
      meetingId: meeting.id,
      meetingType: meeting.type,
      reportSummaryMarkdown,
      chapters,
      reportFacts,
    };

    const occurredAt = meeting.endedAt ?? meeting.startedAt ?? meeting.createdAt;

    const result = await this.ingest.ingest({
      tenantId,
      sourceId: source.id,
      sourceExternalId: `report_${meeting.id}`,
      occurredAt,
      payload,
      dataClass: 'internal',
    });

    this.logger.log(
      {
        meetingId: meeting.id,
        tenantId,
        rawEventId: result.rawEvent.id,
        idempotent: result.idempotent,
        factsCount: reportFacts.length,
        chaptersCount: chapters.length,
      },
      'report-adapter: ingest завершён',
    );
    return result;
  }

  async upsertDefaultReportSource(tenantId: string) {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'meeting_report',
          name: ReportIngestAdapter.DEFAULT_SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;

    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'meeting_report',
          name: ReportIngestAdapter.DEFAULT_SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch (err) {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'meeting_report',
            name: ReportIngestAdapter.DEFAULT_SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw err;
    }
  }
}
