import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import type { AuditLogInput, AuditLogQuery } from './audit.types';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      const data: Prisma.AuditLogUncheckedCreateInput = {
        action: input.action,
        userId: input.userId ?? null,
        resourceId: input.resourceId ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ?? null,
      };
      await this.prisma.auditLog.create({ data });
    } catch (err) {
      this.logger.warn(
        {
          action: input.action,
          err: err instanceof Error ? err.message : String(err),
        },
        'AuditLog: ошибка записи (не пробрасываем)',
      );
    }
  }

  async query(q: AuditLogQuery): Promise<{ items: AuditLog[]; total: number }> {
    const limit = Math.min(q.limit ?? 100, 500);
    const offset = q.offset ?? 0;
    const where: Prisma.AuditLogWhereInput = {};
    if (q.userId !== undefined) where.userId = q.userId;
    if (q.action !== undefined) where.action = q.action;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = q.from;
      if (q.to) where.createdAt.lte = q.to;
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
