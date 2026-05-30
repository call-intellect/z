import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { AutoRuleExtractorService } from '../services/autorule-extractor.service';

/**
 * Agents v2 Фаза B1 (2026-05-30) — AutoRule extract cron.
 *
 * Каждый день в 03:00 (после reframing-cron'а в knowledge-core) обходит:
 *   1. Все Org с `cfg.autorule.enabled` (для Фазы B1 — глобальный мастер-флаг
 *      `AUTORULE_ENABLED`, default false).
 *   2. Для каждой Org: каждый `promptKey` с >=10 PromptFeedback за сутки →
 *      `extractForPromptKey(promptKey, tenantId)`.
 *   3. Глобальные правила: `extractForPromptKey(promptKey, null)` поверх
 *      агрегированных feedback'ов всех Org с >=30 feedback'ов.
 *
 * Защита от двойного запуска: per-(tenant, promptKey) Redis SETNX lock с
 * TTL 1 час (`autorule:lock:<tenant>:<promptKey>`).
 *
 * Если `AUTORULE_ENABLED=false` — cron сразу no-op.
 */
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
    this.logger.log('autorule-extract cron: START');

    const minFeedback = this.cfg.autorule.minFeedbackForExtract;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // ── Per-tenant ────────────────────────────────────────────────────
    // Используем raw SQL: Prisma groupBy.having с `_all._count` несовместим
    // с tsc (см. PromptFeedbackScalarWhereWithAggregatesInput не имеет _all).
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

    // ── Global rules ──────────────────────────────────────────────────
    // Порог 3× выше — глобальное правило должно быть подтверждено больше
    // чем одной Org, иначе оно перенасыщает шум одного клиента.
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

    this.logger.log('autorule-extract cron: DONE');
  }

  /**
   * Берёт Redis SETNX lock и зовёт extractor. На ошибке/lock-busy — лог и
   * пропуск (cron повторится завтра).
   */
  private async runOne(tenantId: string | null, promptKey: string): Promise<void> {
    const lockKey = `autorule:lock:${tenantId ?? 'global'}:${promptKey}`;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let locked = false;
    try {
      const ok = await this.redis.client.set(
        lockKey,
        token,
        'EX',
        3600,
        'NX',
      );
      if (ok !== 'OK') {
        this.logger.debug(`autorule-extract: lock busy (${lockKey})`);
        return;
      }
      locked = true;
      const rules = await this.extractor.extractForPromptKey(promptKey, tenantId);
      this.logger.log(
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
        } catch {
          // ignore
        }
      }
    }
  }
}
