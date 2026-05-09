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

const ExpiringQuerySchema = z.object({
  within_hours: z.coerce.number().int().min(1).max(24 * 30).default(48),
});
type ExpiringQuery = z.infer<typeof ExpiringQuerySchema>;

@ApiExcludeController()
@Controller('admin/api/v1/recordings')
@UseGuards(CookieAuthGuard, AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class RecordingsAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('expiring')
  async expiring(
    @Query(new ZodValidationPipe(ExpiringQuerySchema)) q: ExpiringQuery,
  ): Promise<{
    items: Array<{
      id: string;
      meetingId: string;
      meetingTitle: string;
      status: string;
      retentionDays: number;
      expiresAt: string;
      durationSeconds: number | null;
      bytesTotal: string | null;
    }>;
    withinHours: number;
  }> {
    const cutoff = new Date(Date.now() + q.within_hours * 60 * 60 * 1000);

    const rows = await this.prisma.recording.findMany({
      where: {
        expiresAt: { lt: cutoff },
        status: { not: 'deleted' },
      },
      orderBy: { expiresAt: 'asc' },
      include: {
        meeting: { select: { title: true } },
      },
      take: 200,
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        meetingId: r.meetingId,
        meetingTitle: r.meeting.title,
        status: r.status,
        retentionDays: r.retentionDays,
        expiresAt: r.expiresAt.toISOString(),
        durationSeconds: r.durationSeconds ?? null,
        bytesTotal: r.bytesTotal !== null ? r.bytesTotal.toString() : null,
      })),
      withinHours: q.within_hours,
    };
  }
}
