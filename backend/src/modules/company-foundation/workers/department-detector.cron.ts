import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class DepartmentDetectorCron {
  private readonly logger = new Logger(DepartmentDetectorCron.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Cron('45 * * * *')
  async run(): Promise<void> {
    try {
      const orgUnits = await this.prisma.entity.findMany({
        where: { type: 'org_unit' },
        select: {
          id: true,
          tenantId: true,
          canonicalName: true,
          metadata: true,
        },
        take: 500,
      });
      if (orgUnits.length === 0) return;

      const ids = orgUnits.map((e) => e.id);
      const linked = await this.prisma.department.findMany({
        where: { entityId: { in: ids } },
        select: { entityId: true },
      });
      const linkedSet = new Set(linked.map((d) => d.entityId).filter((v): v is string => !!v));

      let created = 0;
      let skipped = 0;
      for (const e of orgUnits) {
        if (linkedSet.has(e.id)) {
          skipped++;
          continue;
        }
        const existing = await this.prisma.department.findFirst({
          where: {
            tenantId: e.tenantId,
            name: e.canonicalName,
            deletedAt: null,
          },
        });
        if (existing) {
          if (!existing.entityId) {
            await this.prisma.department.update({
              where: { id: existing.id },
              data: { entityId: e.id },
            });
            created++;
          } else {
            skipped++;
          }
          continue;
        }
        try {
          await this.prisma.department.create({
            data: {
              tenantId: e.tenantId,
              name: e.canonicalName,
              entityId: e.id,
              missionStatement: extractSummary(e.metadata),
              confidence: 0.6,
            },
          });
          created++;
        } catch (err) {
          this.logger.debug(
            {
              entityId: e.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'department-detector.cron: insert failure — пропускаем',
          );
          skipped++;
        }
      }
      if (created > 0) {
        this.logger.debug(
          { entitiesScanned: orgUnits.length, created, skipped },
          'department-detector.cron: проход завершён',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'department-detector.cron: непойманная ошибка',
      );
    }
  }
}

function extractSummary(attrs: unknown): string | null {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return null;
  const s = (attrs as Record<string, unknown>).summary;
  return typeof s === 'string' ? s : null;
}
