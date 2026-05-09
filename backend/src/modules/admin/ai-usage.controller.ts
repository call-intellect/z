import {
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { AdminAuditInterceptor } from './admin.audit.interceptor';

const QuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  group_by: z.enum(['day', 'model', 'meeting_type']).default('day'),
});
type AiUsageQuery = z.infer<typeof QuerySchema>;

@ApiExcludeController()
@Controller('admin/api/v1/ai-usage')
@UseGuards(CookieAuthGuard, AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AiUsageAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async query(
    @Query(new ZodValidationPipe(QuerySchema)) q: AiUsageQuery,
  ): Promise<{
    from: string;
    to: string;
    group_by: 'day' | 'model' | 'meeting_type';
    items: Array<{ key: string; count: number; costUsd: number }>;
  }> {
    const range = { gte: q.from, lt: q.to };

    if (q.group_by === 'model') {
      const rows = await this.prisma.aiUsageLog.groupBy({
        by: ['model'],
        where: { createdAt: range },
        _count: { _all: true },
        _sum: { costUsd: true },
      });
      return {
        from: q.from.toISOString(),
        to: q.to.toISOString(),
        group_by: 'model',
        items: rows.map((r) => ({
          key: r.model,
          count: r._count._all,
          costUsd: this.decimalToNumber(r._sum.costUsd),
        })),
      };
    }

    if (q.group_by === 'meeting_type') {
      // Тип встречи — только в AiResult, поэтому сводим по нему.
      const rows = await this.prisma.aiResult.groupBy({
        by: ['meetingType'],
        where: { createdAt: range },
        _count: { _all: true },
      });
      return {
        from: q.from.toISOString(),
        to: q.to.toISOString(),
        group_by: 'meeting_type',
        items: rows.map((r) => ({
          key: r.meetingType,
          count: r._count._all,
          costUsd: 0,
        })),
      };
    }

    // group_by === 'day' — групировка через date_trunc на стороне Postgres.
    type DayRow = { day: Date; count: bigint; cost_sum: string | null };
    const rows = await this.prisma.$queryRaw<DayRow[]>`
      SELECT date_trunc('day', "createdAt") AS day,
             COUNT(*)::bigint AS count,
             COALESCE(SUM("costUsd"), 0)::text AS cost_sum
      FROM "AiUsageLog"
      WHERE "createdAt" >= ${q.from} AND "createdAt" < ${q.to}
      GROUP BY day
      ORDER BY day ASC
    `;

    return {
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      group_by: 'day',
      items: rows.map((r) => ({
        key: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
        count: Number(r.count),
        costUsd: r.cost_sum ? Number.parseFloat(r.cost_sum) || 0 : 0,
      })),
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
      } catch {
        // fallback ниже
      }
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
}
