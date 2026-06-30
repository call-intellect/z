import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import {
  MEMBERSHIP_CREATED,
  MEMBERSHIP_REMOVED,
  type MembershipCreatedPayload,
  type MembershipRemovedPayload,
} from '../messaging.events';
import { ConversationService } from '../services/conversation.service';

@Injectable()
export class HrMembershipListener {
  private readonly logger = new Logger(HrMembershipListener.name);

  constructor(
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @OnEvent(MEMBERSHIP_CREATED, { async: true })
  async onCreated(payload: MembershipCreatedPayload): Promise<void> {
    if (!(await this.isEnabled())) return;

    try {
      const channel = await this.conversations.ensureCompanyChannel(
        payload.tenantId,
        payload.userId,
      );
      await this.conversations.addMember({
        conversationId: channel.id,
        userId: payload.userId,
        source: 'auto',
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: payload.tenantId,
          userId: payload.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'hr-membership: ошибка авто-подписки на канал компании',
      );
    }
  }

  @OnEvent(MEMBERSHIP_REMOVED, { async: true })
  async onRemoved(payload: MembershipRemovedPayload): Promise<void> {
    if (!(await this.isEnabled())) return;

    try {
      const removed = await this.conversations.removeAutoMembershipsForUser(
        payload.tenantId,
        payload.userId,
      );
      if (removed > 0) {
        this.logger.debug(
          { tenantId: payload.tenantId, userId: payload.userId, removed },
          'hr-membership: авто-членства удалены при увольнении',
        );
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: payload.tenantId,
          userId: payload.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'hr-membership: ошибка удаления авто-членств',
      );
    }
  }

  private async isEnabled(): Promise<boolean> {
    return this.cfg.getDynamic<boolean>('hr_auto_subscribe_enabled', undefined, true);
  }
}
