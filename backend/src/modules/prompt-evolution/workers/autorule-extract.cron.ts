import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { AutoRuleExtractorService } from '../services/autorule-extractor.service';

@Injectable()
export class AutoRuleExtractCron {
  private readonly logger = new Logger(AutoRuleExtractCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(AutoRuleExtractorService)
    private readonly extractor: AutoRuleExtractorService,
  ) {}

  @Cron('0 3 * * *')
  async tick(): Promise<void> {
    if (!this.cfg.autorule.enabled) {
      this.logger.debug('autorule-extract cron: disabled (AUTORULE_ENABLED=false)');
      return;
    }
    this.logger.debug('autorule-extract cron: START');

    const minFeedback = this.cfg.autorule.minFeedbackForExtract;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      const perTenantRows = await this.prisma.$queryRawUnsafe<
        Array<{ tenantId: string; promptKey: string; cnt: bigint }>
      >(
        `SELECT "tenantId", "promptKey", COUNT(*)::bigint AS cnt
         FROM "PromptFeedback"
         WHERE "editedOutput" IS NOT NULL AND "createdAt" >= $1
         GROUP BY "tenantId", "promptKey"
         HAVING COUNT(*) >= $2`,
        since,
        minFeedback,
      );
      for (const row of perTenantRows) {
        await this.runOne(row.tenantId, row.promptKey);
      }
    } catch (err) {
      this.logger.warn(
        `autorule-extract cron per-tenant: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const globalMin = minFeedback * 3;
    try {
      const globalRows = await this.prisma.$queryRawUnsafe<
        Array<{ promptKey: string; cnt: bigint }>
      >(
        `SELECT "promptKey", COUNT(*)::bigint AS cnt
         FROM "PromptFeedback"
         WHERE "editedOutput" IS NOT NULL AND "createdAt" >= $1
         GROUP BY "promptKey"
         HAVING COUNT(*) >= $2`,
        since,
        globalMin,
      );
      for (const row of globalRows) {
        await this.runOne(null, row.promptKey);
      }
    } catch (err) {
      this.logger.warn(
        `autorule-extract cron global: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.debug('autorule-extract cron: DONE');
  }

  private async runOne(tenantId: string | null, promptKey: string): Promise<void> {
    const lockKey = `autorule:lock:${tenantId ?? 'global'}:${promptKey}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let locked = false;
    try {
      const ok = await this.redis.client.set(lockKey, token, 'EX', 3600, 'NX');
      if (ok !== 'OK') {
        this.logger.debug(`autorule-extract: lock busy (${lockKey})`);
        return;
      }
      locked = true;
      const rules = await this.extractor.extractForPromptKey(promptKey, tenantId);
      this.logger.debug(
        `autorule-extract: promptKey=${promptKey} tenant=${tenantId ?? 'global'} new rules=${rules.length}`,
      );
    } catch (err) {
      this.logger.warn(
        `autorule-extract: promptKey=${promptKey} tenant=${tenantId ?? 'global'} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (locked) {
        try {
          const cur = await this.redis.client.get(lockKey);
          if (cur === token) await this.redis.client.del(lockKey);
        } catch {}
      }
    }
  }
}
