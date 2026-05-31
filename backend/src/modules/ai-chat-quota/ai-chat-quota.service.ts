import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/typed-config.service';
import { QuotaService } from '../quotas/quota.service';
import { RbacService } from '../rbac/rbac.service';

/**
 * Единая per-user квота на AI-общение (Concierge + Clones).
 *
 * ТЗ: plans/tz/2026-05-31-ai-chat-quota-unified-per-user.md.
 *
 * Алгоритм:
 *   1. По (tenantId, userId) определяем роль в Org → лимит:
 *      - если роль в cfg.aiChatQuota.adminRoles → dailyLimitAdmin (50);
 *      - иначе → dailyLimitMember (20). Если членства нет — тоже member-лимит.
 *   2. Делегируем атомарный INCR в `QuotaService.checkAndIncrement`
 *      с quotaName='ai_chat_messages_per_day', windowMs=24h.
 *   3. На превышении QuotaService бросает `QuotaExceededError` (429 +
 *      retryAfterSeconds + audit + метрика). Мы НЕ ловим — пробрасываем.
 *
 * Cron-reset не нужен: TTL Redis-ключа = windowMs+60, snapshot в
 * UserQuotaCounter уже делает QuotaService.
 */
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

  /**
   * Атомарный INCR + проверка лимита. На превышении кидает
   * `QuotaExceededError` (429). На успехе возвращает текущий счётчик,
   * лимит и роль (для логов / SSE-event'ов).
   */
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

  /**
   * Текущее использование без инкремента (для UI: «осталось N сообщений сегодня»).
   */
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
