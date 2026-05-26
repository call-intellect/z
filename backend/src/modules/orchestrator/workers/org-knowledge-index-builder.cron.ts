import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { OrgKnowledgeIndexService } from '../services/org-knowledge-index.service';

/**
 * SBA δ-1 — `org-knowledge-index-builder` cron (`0 3 * * *`).
 *
 * Каждую ночь в 03:00 пересобирает OrgKnowledgeSummary для всех активных
 * Org-ов и кладёт в Redis (TTL 24h).
 *
 * Не real-time — слишком cost. Если в течение дня будет cache miss
 * (например, новый Org), `OrgKnowledgeIndexService.getSummary()`
 * автоматически пересчитает на лету и закэширует.
 */
@Injectable()
export class OrgKnowledgeIndexBuilderCron {
  private readonly logger = new Logger(OrgKnowledgeIndexBuilderCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrgKnowledgeIndexService)
    private readonly index: OrgKnowledgeIndexService,
  ) {}

  @Cron('0 3 * * *', { name: 'org-knowledge-index-builder' })
  async run(): Promise<void> {
    const start = Date.now();
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let ok = 0;
    let failed = 0;
    for (const o of orgs) {
      try {
        await this.index.rebuild(o.id);
        ok++;
      } catch (err) {
        failed++;
        this.logger.warn(
          { tenantId: o.id, err: err instanceof Error ? err.message : String(err) },
          'org-knowledge-index rebuild failed',
        );
      }
    }
    this.logger.log(
      `org-knowledge-index-builder: total=${orgs.length} ok=${ok} failed=${failed} duration_ms=${Date.now() - start}`,
    );
  }
}
