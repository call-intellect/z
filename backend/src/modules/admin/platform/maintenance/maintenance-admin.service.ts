import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../../../../common/prisma/prisma.service';

/**
 * Admin-redesign Фаза 8 — `MaintenanceAdminService`.
 *
 * UI `/admin/platform/maintenance`:
 *   - статус последнего бэкапа (если есть в БД, иначе null);
 *   - активные maintenance windows (SystemMessage type='maintenance' где
 *     isActive=true И [startsAt, endsAt] пересекается с NOW).
 *
 * Кнопки «бэкап сейчас» / «реиндекс сейчас» — заглушки 501:
 *   - реальный бэкап через pg_dump на инфра-уровне (вне Z-Admin);
 *   - реиндекс — отдельным ТЗ через существующие воркеры реиндексации
 *     (фаза 9).
 */
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
    // lastBackupAt — пока нет модели/таблицы бэкапов, возвращаем null.
    // В будущей фазе сюда можно подключить чтение из BackupRun-таблицы.
    const lastBackupAt: string | null = null;

    const now = new Date();
    const windows = await this.prisma.systemMessage.findMany({
      where: {
        type: 'maintenance',
        isActive: true,
        OR: [
          // window полностью охватывает now
          {
            startsAt: { lte: now },
            endsAt: { gte: now },
          },
          // window без endsAt — ещё длится
          {
            startsAt: { lte: now },
            endsAt: null,
          },
          // window без startsAt — уже идёт по умолчанию
          {
            startsAt: null,
            endsAt: { gte: now },
          },
          // оба поля пустые — постоянный режим
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

  /**
   * Manual бэкап. Не реализован — pg_dump делается на инфра-уровне.
   */
  backupNow(): never {
    throw new HttpException(
      {
        ok: false,
        error: {
          code: 'not_implemented',
          message:
            'Manual бэкап не реализован — выполняется на инфра-уровне через pg_dump.',
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Manual реиндекс. Будет реализован на Фазе 9 через существующие воркеры
   * реиндексации.
   */
  reindexNow(): never {
    throw new HttpException(
      {
        ok: false,
        error: {
          code: 'not_implemented',
          message:
            'Manual реиндекс не реализован. Будет в Фазе 9 через воркеры реиндексации.',
        },
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
