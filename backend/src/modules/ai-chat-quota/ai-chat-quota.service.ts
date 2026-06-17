import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/typed-config.service';
import { QuotaService } from '../quotas/quota.service';
import { RbacService } from '../rbac/rbac.service';

@Injectable()
export class AiChatQuotaService {
  private static readonly QUOTA_NAME = 'ai_chat_messages_per_day';
  private static readonly WINDOW_MS = 24 * 60 * 60 * 1000;

  private readonly logger = new Logger(AiChatQuotaService.name);

  constructor(
    @Inject(QuotaService) private readonly quota: QuotaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async tryConsume(input: { tenantId: string; userId: string }): Promise<{
    current: number;
    remaining: number;
    limit: number;
    role: string;
  }> {
    const { limit, role } = await this.resolveLimit(input.tenantId, input.userId);
    const r = await this.quota.checkAndIncrement({
      userId: input.userId,
      quotaName: AiChatQuotaService.QUOTA_NAME,
      max: limit,
      windowMs: AiChatQuotaService.WINDOW_MS,
    });
    return {
      current: r.current,
      remaining: r.remaining,
      limit,
      role,
    };
  }

  async getUsage(input: { tenantId: string; userId: string }): Promise<{
    dailyUsed: number;
    dailyLimit: number;
    role: string;
  }> {
    const { limit, role } = await this.resolveLimit(input.tenantId, input.userId);
    const dailyUsed = await this.quota.peek({
      userId: input.userId,
      quotaName: AiChatQuotaService.QUOTA_NAME,
      windowMs: AiChatQuotaService.WINDOW_MS,
    });
    return { dailyUsed, dailyLimit: limit, role };
  }

  private async resolveLimit(
    tenantId: string,
    userId: string,
  ): Promise<{ limit: number; role: string }> {
    const role = (await this.rbac.getMembershipRole(tenantId, userId)) ?? 'member';
    const isAdmin = this.cfg.aiChatQuota.adminRoles.includes(role);
    const limit = isAdmin
      ? this.cfg.aiChatQuota.dailyLimitAdmin
      : this.cfg.aiChatQuota.dailyLimitMember;
    return { limit, role };
  }
}
