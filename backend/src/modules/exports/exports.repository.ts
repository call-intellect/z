import { Inject, Injectable } from '@nestjs/common';
import type { Export, ExportStatus, ExportType, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ExportsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listByUser(userId: string): Promise<Export[]> {
    return this.prisma.export.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  findById(id: string): Promise<Export | null> {
    return this.prisma.export.findUnique({ where: { id } });
  }

  findInProgress(input: {
    userId: string;
    type: ExportType;
    meetingIds: string[];
  }): Promise<Export | null> {
    return this.prisma.export.findFirst({
      where: {
        userId: input.userId,
        type: input.type,
        status: { in: ['queued', 'processing'] },
        meetingIds: { equals: input.meetingIds },
      },
    });
  }

  countCompletedToday(userId: string, type: ExportType): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return this.prisma.export.count({
      where: {
        userId,
        type,
        createdAt: { gte: start },
      },
    });
  }

  create(input: {
    userId: string;
    type: ExportType;
    meetingIds: string[];
    options: Prisma.InputJsonValue;
  }): Promise<Export> {
    return this.prisma.export.create({
      data: {
        userId: input.userId,
        type: input.type,
        meetingIds: input.meetingIds,
        options: input.options,
      },
    });
  }

  update(id: string, data: Prisma.ExportUpdateInput): Promise<Export> {
    return this.prisma.export.update({ where: { id }, data });
  }

  setStatus(
    id: string,
    status: ExportStatus,
    extra?: Partial<Pick<Export, 's3Key' | 'error' | 'expiresAt' | 'completedAt'>>,
  ): Promise<Export> {
    return this.prisma.export.update({
      where: { id },
      data: {
        status,
        ...(extra?.s3Key !== undefined ? { s3Key: extra.s3Key } : {}),
        ...(extra?.error !== undefined ? { error: extra.error } : {}),
        ...(extra?.expiresAt !== undefined ? { expiresAt: extra.expiresAt } : {}),
        ...(extra?.completedAt !== undefined ? { completedAt: extra.completedAt } : {}),
      },
    });
  }

  delete(id: string): Promise<Export> {
    return this.prisma.export.delete({ where: { id } });
  }
}
