import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * SBA α-9 wave 3 — DepartmentDetectorCron.
 *
 * MVP-эвристика: раз в час пробегает Entity с `type='org_unit'`, у которых ещё
 * нет соответствующего Department.entityId (см. wave 2 расширение Department).
 * Создаёт Department с этим entityId, копируя имя и (если есть в `meta.summary`) —
 * `missionStatement`.
 *
 * Это разгружает руками-CRUD: когда специалисты Слоя 3 распознают «отдел» в
 * блоках встреч (через Entity{type=org_unit}), Department появляется
 * автоматически. Bulk-insert через `createMany skipDuplicates`.
 *
 * NB: «настоящий» BullMQ-воркер `department-detector` (signal-driven) появится
 * на следующей фазе, когда подключим `core.specialist-routing` к Layer 2 для
 * `org_unit`. Текущая cron-реализация — strawman, чтобы фича работала с момента
 * α-9 wave 3.
 */
@Injectable()
export class DepartmentDetectorCron {
  private readonly logger = new Logger(DepartmentDetectorCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

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

      // Какие entityId уже связаны с Department?
      const ids = orgUnits.map((e) => e.id);
      const linked = await this.prisma.department.findMany({
        where: { entityId: { in: ids } },
        select: { entityId: true },
      });
      const linkedSet = new Set(
        linked.map((d) => d.entityId).filter((v): v is string => !!v),
      );

      let created = 0;
      let skipped = 0;
      for (const e of orgUnits) {
        if (linkedSet.has(e.id)) {
          skipped++;
          continue;
        }
        // Проверяем дубль по (tenantId, name) — если Department уже есть с тем
        // же именем (но без entityId), линкуем вместо создания нового.
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
        this.logger.log(
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
