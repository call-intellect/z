import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { FunctionalDomainService } from '../services/functional-domain.service';
import { tenantTopLabel } from '../utils/tenant-top';

@Injectable()
export class DomainExpanderCron {
  private readonly logger = new Logger(DomainExpanderCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(FunctionalDomainService)
    private readonly domains: FunctionalDomainService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 4 * * *')
  async run(): Promise<void> {
    if (!this.cfg.companyFoundation.domainExpanderEnabled) {
      this.logger.debug('DomainExpanderCron disabled (DOMAIN_EXPANDER_ENABLED=false)');
      return;
    }
    try {
      const orgs = await this.prisma.org.findMany({ select: { id: true } });
      let totalCreated = 0;
      for (const org of orgs) {
        const created = await this.runForTenant(org.id);
        totalCreated += created;
      }
      this.logger.debug(
        { orgsScanned: orgs.length, newDomainsCreated: totalCreated },
        'domain-expander.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'domain-expander.cron: непойманная ошибка',
      );
    }
  }

  private async runForTenant(tenantId: string): Promise<number> {
    const minSize = this.cfg.companyFoundation.domainExpanderMinClusterSize;
    const maxNew = this.cfg.companyFoundation.domainExpanderMaxNewPerRun;
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let rows: { theme: string; count: number }[];
    try {
      const raw = await this.prisma.$queryRaw<{ theme: string; count: bigint }[]>`
        SELECT unnest(tags) AS theme, COUNT(*) AS count
        FROM "IdeaBlock"
        WHERE "tenantId" = ${tenantId}
          AND "createdAt" >= ${cutoff}
          AND "mergedIntoId" IS NULL
          AND cardinality(tags) > 0
        GROUP BY theme
        HAVING COUNT(*) >= ${minSize}
        ORDER BY count DESC
        LIMIT ${maxNew * 3}
      `;
      rows = raw.map((r) => ({ theme: r.theme, count: Number(r.count) }));
    } catch (err) {
      this.logger.debug(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'domain-expander.cron: skip (IdeaBlock query failed or empty)',
      );
      return 0;
    }
    if (rows.length === 0) return 0;

    const existing = await this.prisma.functionalDomain.findMany({
      where: { tenantId, deletedAt: null },
      select: { slug: true, name: true },
    });
    const existingSlugs = new Set(existing.map((e) => e.slug));
    const existingNames = new Set(existing.map((e) => e.name.toLowerCase().trim()));

    let created = 0;
    for (const row of rows) {
      if (created >= maxNew) break;
      const name = row.theme.trim();
      if (!name) continue;
      if (existingNames.has(name.toLowerCase())) continue;
      const slug = this.toSlug(name);
      if (!slug || existingSlugs.has(slug)) continue;

      const dedupKey = `domain-expander:${tenantId}:${slug}`;
      const ttlSeconds = 24 * 60 * 60;
      let claimed: boolean;
      try {
        const r = await this.redis.client.set(dedupKey, '1', 'EX', ttlSeconds, 'NX');
        claimed = r === 'OK';
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            slug,
            err: err instanceof Error ? err.message : String(err),
          },
          'domain-expander.cron: redis SETNX failure — пропускаем',
        );
        continue;
      }
      if (!claimed) continue;

      try {
        await this.prisma.functionalDomain.create({
          data: {
            tenantId,
            name,
            slug,
            isSystem: false,
            confidence: 0.55,
            order: 100,
          },
        });
        existingSlugs.add(slug);
        existingNames.add(name.toLowerCase());
        created++;
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            slug,
            err: err instanceof Error ? err.message : String(err),
          },
          'domain-expander.cron: insert failure — пропускаем',
        );
      }
    }

    if (created > 0) {
      const tenantTop = await tenantTopLabel(this.prisma, tenantId);
      this.metrics.incDomainExpanderCreated({ tenantTop, count: created });
      this.logger.debug({ tenantId, created }, 'domain-expander.cron: созданы новые домены');
    }
    return created;
  }

  private toSlug(name: string): string {
    const transliterated = name
      .toLowerCase()
      .replace(/[а-яё]/g, (ch) => RU_LAT[ch] ?? ch)
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    return transliterated;
  }
}

const RU_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};
