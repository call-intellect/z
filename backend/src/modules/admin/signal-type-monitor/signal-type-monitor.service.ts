import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * G.2 KC-Temporal — `SignalTypeMonitorService`.
 *
 * Источник: `SignalTypeStatsCron` (`backend/src/modules/knowledge-core/workers/
 * signal-type-stats.cron.ts`) — ежедневно (`0 2 * * *`) пишет в `AdminSetting`
 * под ключом `signal_type_transition_matrix:<orgId>` JSON:
 *
 *   { matrix: Record<from, Record<to, count>>,
 *     distribution7d: Record<signalType, count>,
 *     calculatedAt: string (ISO) }
 *
 * Этот сервис только читает — никаких прав на расчёт у админ-UI нет; чтобы
 * пересчитать «прямо сейчас», нужно вручную дёрнуть `runOnce` из cron-сервиса
 * (отдельная фаза).
 */

const KEY_PREFIX = 'signal_type_transition_matrix:';

export interface SignalTypeMonitorItem {
  tenantId: string;
  tenantName: string | null;
  matrix: Record<string, Record<string, number>>;
  distribution7d: Record<string, number>;
  calculatedAt: string | null;
  /** UTC-время записи в `AdminSetting.updatedAt` (фактический момент cron-прогона). */
  updatedAt: string;
}

@Injectable()
export class SignalTypeMonitorService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Список всех матриц переходов signalType по всем Org (по одной записи на Org).
   * Пустые Org (нет рассчитанных данных) — не возвращаются.
   */
  async listAll(): Promise<SignalTypeMonitorItem[]> {
    const settings = await this.prisma.adminSetting.findMany({
      where: { key: { startsWith: KEY_PREFIX } },
      orderBy: { updatedAt: 'desc' },
    });
    if (settings.length === 0) return [];

    const tenantIds = settings.map((s) => s.key.slice(KEY_PREFIX.length));
    const orgs = await this.prisma.org.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

    return settings.map((s) =>
      this.toItem(s.key, s.value, s.updatedAt, orgNameById),
    );
  }

  /** Одна Org — для drill-down страницы. Если матрицы нет — `null`. */
  async findByTenant(tenantId: string): Promise<SignalTypeMonitorItem | null> {
    const setting = await this.prisma.adminSetting.findUnique({
      where: { key: `${KEY_PREFIX}${tenantId}` },
    });
    if (!setting) return null;
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const orgNameById = new Map([[tenantId, org?.name ?? null]]);
    return this.toItem(setting.key, setting.value, setting.updatedAt, orgNameById);
  }

  private toItem(
    key: string,
    value: unknown,
    updatedAt: Date,
    orgNameById: Map<string, string | null>,
  ): SignalTypeMonitorItem {
    const tenantId = key.slice(KEY_PREFIX.length);
    const parsed = (value ?? {}) as Partial<{
      matrix: Record<string, Record<string, number>>;
      distribution7d: Record<string, number>;
      calculatedAt: string;
    }>;
    return {
      tenantId,
      tenantName: orgNameById.get(tenantId) ?? null,
      matrix: parsed.matrix ?? {},
      distribution7d: parsed.distribution7d ?? {},
      calculatedAt: parsed.calculatedAt ?? null,
      updatedAt: updatedAt.toISOString(),
    };
  }
}
