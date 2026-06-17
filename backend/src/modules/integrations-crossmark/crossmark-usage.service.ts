import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface CrossmarkUsageDto {
  from: string;
  to: string;
  totals: {
    meetings: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  by_model: Array<{ model: string; count: number; costUsd: number }>;
  by_meeting_type: Array<{ type: string; count: number }>;
}

@Injectable()
export class CrossmarkUsageService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getUsage(from: Date, to: Date): Promise<CrossmarkUsageDto> {
    const range = { gte: from, lt: to };

    const totalsRow = await this.prisma.aiUsageLog.aggregate({
      where: { createdAt: range },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });

    const distinctMeetings = await this.prisma.aiUsageLog.findMany({
      where: { createdAt: range, meetingId: { not: null } },
      select: { meetingId: true },
      distinct: ['meetingId'],
    });

    const byModelRows = await this.prisma.aiUsageLog.groupBy({
      by: ['model'],
      where: { createdAt: range },
      _count: { _all: true },
      _sum: { costUsd: true },
    });

    const byTypeRows = await this.prisma.aiResult.groupBy({
      by: ['meetingType'],
      where: { createdAt: range },
      _count: { _all: true },
    });

    const byModel = byModelRows.map((r) => ({
      model: r.model,
      count: r._count._all,
      costUsd: this.decimalToNumber(r._sum.costUsd),
    }));

    const byMeetingType = byTypeRows.map((r) => ({
      type: r.meetingType,
      count: r._count._all,
    }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        meetings: distinctMeetings.length,
        inputTokens: totalsRow._sum.inputTokens ?? 0,
        outputTokens: totalsRow._sum.outputTokens ?? 0,
        costUsd: this.decimalToNumber(totalsRow._sum.costUsd),
      },
      by_model: byModel,
      by_meeting_type: byMeetingType,
    };
  }

  private decimalToNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = Number.parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }
    const obj = value as { toNumber?: () => number; toString?: () => string };
    if (typeof obj.toNumber === 'function') {
      try {
        return obj.toNumber();
      } catch {}
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
}
