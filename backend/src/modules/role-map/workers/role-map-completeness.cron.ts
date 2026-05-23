import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RoleMapBuilderService } from '../services/role-map-builder.service';

/**
 * SBA α-8 wave 4 — RoleMapCompletenessCron.
 *
 * Раз в день в 04:00 UTC пересчитывает completeness для всех Role во всех Org.
 * Запускается на час РАНЬШЕ чем `MaturityScorerCron` (05:00 UTC, α-9 wave 3) —
 * чтобы MaturityScorer считал на уже-актуальных completeness.
 *
 * NB: cron не делает LLM-вызовов, только агрегацию из нормализованных таблиц.
 * Дешёвый по cost'у, безопасный по retries (полностью идемпотентный).
 */
@Injectable()
export class RoleMapCompletenessCron {
  private readonly logger = new Logger(RoleMapCompletenessCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RoleMapBuilderService)
    private readonly builder: RoleMapBuilderService,
  ) {}

  /**
   * 04:00 UTC ежедневно. Координируется с MaturityScorerCron (05:00 UTC) —
   * сначала пересчитываем completeness, потом MaturityScorer берёт обновлённые
   * значения.
   */
  @Cron('0 4 * * *')
  async run(): Promise<void> {
    try {
      const startedAt = Date.now();
      const result = await this.runForAllOrgs();
      this.logger.log(
        { ...result, durationMs: Date.now() - startedAt },
        'role-map-completeness.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'role-map-completeness.cron: непойманная ошибка',
      );
    }
  }

  /**
   * Public для admin-эндпоинта (если понадобится ручной запуск).
   */
  async runForAllOrgs(): Promise<{
    orgsScanned: number;
    rolesScanned: number;
    rolesUpdated: number;
    rolesWithNormalizedData: number;
  }> {
    const orgs = await this.prisma.org.findMany({ select: { id: true } });
    let rolesScanned = 0;
    let rolesUpdated = 0;
    let rolesWithData = 0;
    for (const org of orgs) {
      try {
        const r = await this.builder.recomputeAllForTenant({
          tenantId: org.id,
        });
        rolesScanned += r.rolesScanned;
        rolesUpdated += r.rolesUpdated;
        rolesWithData += r.rolesWithNormalizedData;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'role-map-completeness.cron: ошибка для tenant — продолжаю',
        );
      }
    }
    return {
      orgsScanned: orgs.length,
      rolesScanned,
      rolesUpdated,
      rolesWithNormalizedData: rolesWithData,
    };
  }
}
