import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmProtocolAdapterRegistry } from '../../ai/services/protocol-adapter/llm-protocol-adapter.registry';
import { ProviderInfoResolver } from '../../ai/services/protocol-adapter/provider-info.resolver';
import { ConversationalService } from '../../conversational/conversational.service';

@Injectable()
export class ProviderSmokeTestCron {
  private readonly logger = new Logger(ProviderSmokeTestCron.name);
  private readonly failStreak = new Map<string, number>();
  private readonly lastAlertAt = new Map<string, number>();
  private static readonly ALERT_COOLDOWN_MS = 2 * 3600 * 1000;
  private static readonly SMOKE_PROMPT = 'Reply with the single word OK.';
  private static readonly SMOKE_MAX_TOKENS = 64;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmProtocolAdapterRegistry)
    private readonly adapters: LlmProtocolAdapterRegistry,
    @Inject(ProviderInfoResolver)
    private readonly providerInfo: ProviderInfoResolver,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/30 * * * *', { name: 'provider-smoke-test' })
  async runScheduled(): Promise<void> {
    if (!this.cfg.budget.providerSmokeTestEnabled) {
      this.logger.debug('provider-smoke-test: disabled by ENV');
      return;
    }
    try {
      const result = await this.runOnce();
      this.logger.debug(result, 'provider-smoke-test.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'provider-smoke-test.cron: непойманная ошибка',
      );
    }
    await this.checkCacheHitRatio();
  }

  async checkCacheHitRatio(): Promise<void> {
    try {
      if (!this.cfg.llm.cacheSmokeEnabled) {
        this.logger.debug('cache-hit-ratio smoke: disabled by setting');
        return;
      }
      const threshold = this.cfg.llm.cacheHitRatioWarnThreshold;
      const { hits, total, ratio } = await this.metrics.getLlmCacheHitRatio('deepseek');

      if (ratio === null) {
        this.logger.debug(
          { provider: 'deepseek', hits, total, threshold },
          'cache-hit-ratio smoke: мало данных — пропускаем (без WARN)',
        );
        return;
      }

      const below = ratio < threshold;
      this.metrics.setLlmCacheHitRatioBelowThreshold({
        provider: 'deepseek',
        below,
      });
      if (below) {
        this.logger.warn(
          { provider: 'deepseek', ratio, threshold, hits, total },
          'cache-hit-ratio ниже порога — возможно taskType ушёл на некэширующий провайдер',
        );
      } else {
        this.logger.debug(
          { provider: 'deepseek', ratio, threshold, hits, total },
          'cache-hit-ratio smoke: норма',
        );
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'cache-hit-ratio smoke: непойманная ошибка (best-effort, игнорируем)',
      );
    }
  }

  async runOnce(): Promise<{
    providersScanned: number;
    successes: number;
    failures: number;
  }> {
    const providers = await this.prisma.llmProvider.findMany({
      where: { isActive: true, deletedAt: null },
    });
    let successes = 0;
    let failures = 0;
    let scanned = 0;
    for (const p of providers) {
      if (!p.baseUrl || p.baseUrl.trim().length === 0) {
        this.logger.debug(`provider-smoke-test: skip ${p.name} — нет baseUrl (не сконфигурирован)`);
        continue;
      }
      scanned++;
      const r = await this.testProvider(p.name);
      if (r.success) successes++;
      else failures++;
    }
    return {
      providersScanned: scanned,
      successes,
      failures,
    };
  }

  async testProvider(providerName: string): Promise<{
    provider: string;
    success: boolean;
    durationSeconds: number;
    error?: string;
  }> {
    const startedAt = Date.now();
    let success: boolean;
    let error: string | undefined;
    try {
      const resolved = await this.providerInfo.resolveByName(providerName);
      if (!resolved) {
        throw new Error(`провайдер ${providerName} не найден`);
      }
      const adapter = this.adapters.resolve(resolved.protocolKind);
      const out = await adapter.complete({
        provider: resolved.info,
        input: {
          system: { text: 'You are a smoke-test responder.' },
          user: ProviderSmokeTestCron.SMOKE_PROMPT,
          maxTokens: ProviderSmokeTestCron.SMOKE_MAX_TOKENS,
        },
      });
      success = typeof out.text === 'string' && out.text.length > 0;
      if (!success) error = 'empty response';
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
    }
    const durationMs = Date.now() - startedAt;
    const durationSeconds = durationMs / 1000;

    this.metrics.setProviderSmokeTestSuccess({
      provider: providerName,
      success,
    });
    this.metrics.observeProviderSmokeTestDuration({
      provider: providerName,
      seconds: durationSeconds,
    });

    try {
      await this.prisma.llmProvider.update({
        where: { name: providerName },
        data: {
          lastSmokeAt: new Date(),
          lastSmokeSuccess: success,
          lastSmokeError: success ? null : (error ?? 'unknown'),
        },
      });
    } catch (err) {
      this.logger.warn(
        `testProvider: persist results failed для ${providerName}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!success) {
      const streak = (this.failStreak.get(providerName) ?? 0) + 1;
      this.failStreak.set(providerName, streak);
      if (streak >= this.cfg.budget.providerSmokeTestFailThreshold) {
        await this.maybeAlertOnCall(providerName, streak, error ?? '?');
      }
    } else {
      const wasFailing =
        (this.failStreak.get(providerName) ?? 0) >= this.cfg.budget.providerSmokeTestFailThreshold;
      this.failStreak.set(providerName, 0);
      if (wasFailing) {
        await this.notifyRecovery(providerName);
      }
    }

    return {
      provider: providerName,
      success,
      durationSeconds,
      ...(error ? { error } : {}),
    };
  }

  private async maybeAlertOnCall(
    providerName: string,
    streak: number,
    error: string,
  ): Promise<void> {
    const now = Date.now();
    const last = this.lastAlertAt.get(providerName) ?? 0;
    if (now - last < ProviderSmokeTestCron.ALERT_COOLDOWN_MS) return;
    this.lastAlertAt.set(providerName, now);

    const recipients = await this.findSuperAdminRecipients();
    for (const r of recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: r.tenantId,
          recipientUserId: r.userId,
          eventType: 'system.message',
          payload: {
            title: `LLM-провайдер ${providerName} недоступен`,
            body: `Провалил ${streak} smoke-теста подряд. Последняя ошибка: ${error}`,
            severity: 'error',
          },
          dataClass: 'internal',
          critical: true,
        });
      } catch (err) {
        this.logger.warn(
          `maybeAlertOnCall: sendNotification failed для ${r.userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async notifyRecovery(providerName: string): Promise<void> {
    const recipients = await this.findSuperAdminRecipients();
    for (const r of recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: r.tenantId,
          recipientUserId: r.userId,
          eventType: 'system.message',
          payload: {
            title: `LLM-провайдер ${providerName} восстановился`,
            body: `Провайдер ${providerName} снова отвечает на smoke-тест.`,
            severity: 'info',
          },
          dataClass: 'internal',
        });
      } catch {}
    }
  }

  private async findSuperAdminRecipients(): Promise<Array<{ userId: string; tenantId: string }>> {
    const admins = await this.prisma.user.findMany({
      where: { isSuperAdmin: true, deletedAt: null },
      select: { id: true, memberships: { select: { orgId: true } } },
      take: 20,
    });
    return admins
      .map((u) => {
        const orgId = u.memberships[0]?.orgId;
        if (!orgId) return null;
        return { userId: u.id, tenantId: orgId };
      })
      .filter((x): x is { userId: string; tenantId: string } => x !== null);
  }
}
