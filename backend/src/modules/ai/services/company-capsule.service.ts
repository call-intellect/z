import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class CompanyCapsuleService {
  private readonly logger = new Logger(CompanyCapsuleService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async load(tenantId: string | null, surface: string): Promise<string> {
    if (!tenantId) return '';
    try {
      const profile = await this.prisma.companyProfile.findUnique({
        where: { tenantId },
        select: {
          displayName: true,
          stage: true,
          summaryJson: true,
          missionJson: true,
        },
      });
      if (!profile) return '';
      const lines: string[] = [];
      const name = profile.displayName?.trim();
      if (name) lines.push(`Название: ${name}`);
      const summary = extractContentMd(profile.summaryJson);
      if (summary) lines.push(`Чем занимается: ${summary}`);
      const stage = profile.stage?.trim();
      if (stage) lines.push(`Стадия: ${stage}`);
      const mission = extractContentMd(profile.missionJson);
      if (mission) lines.push(`Миссия: ${mission}`);
      if (lines.length === 0) return '';
      this.metrics?.incCompanyCapsuleInjected({ surface });
      return ['## О компании', ...lines].join('\n');
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          surface,
          err: err instanceof Error ? err.message : String(err),
        },
        'CompanyCapsuleService.load: чтение CompanyProfile упало — секция опущена',
      );
      return '';
    }
  }
}

function extractContentMd(json: Prisma.JsonValue | null): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).contentMd;
  return typeof v === 'string' ? v.trim() : null;
}
