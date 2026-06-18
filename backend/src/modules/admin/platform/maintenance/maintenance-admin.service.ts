import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../common/prisma/prisma.service';

@Injectable()
export class MaintenanceAdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getStatus(): Promise<{
    lastBackupAt: string | null;
    maintenanceWindows: Array<{
      id: string;
      severity: string;
      body: string;
      startsAt: string | null;
      endsAt: string | null;
    }>;
  }> {
    const lastBackupAt: string | null = null;

    const now = new Date();
    const windows = await this.prisma.systemMessage.findMany({
      where: {
        type: 'maintenance',
        isActive: true,
        OR: [
          {
            startsAt: { lte: now },
            endsAt: { gte: now },
          },
          {
            startsAt: { lte: now },
            endsAt: null,
          },
          {
            startsAt: null,
            endsAt: { gte: now },
          },
          {
            startsAt: null,
            endsAt: null,
          },
        ],
      },
      orderBy: { startsAt: 'asc' },
    });

    return {
      lastBackupAt,
      maintenanceWindows: windows.map((w) => ({
        id: w.id,
        severity: w.severity,
        body: w.body,
        startsAt: w.startsAt ? w.startsAt.toISOString() : null,
        endsAt: w.endsAt ? w.endsAt.toISOString() : null,
      })),
    };
  }

  backupNow(): never {
    throw new HttpException(
      {
        ok: false,
        error: {
          code: 'not_implemented',
          message: 'Manual бэкап не реализован — выполняется на инфра-уровне через pg_dump.',
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  reindexNow(): never {
    throw new HttpException(
      {
        ok: false,
        error: {
          code: 'not_implemented',
          message: 'Manual реиндекс не реализован. Будет в Фазе 9 через воркеры реиндексации.',
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
