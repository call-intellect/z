import { randomBytes } from 'node:crypto';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WebhookDelivery, WebhookSubscription } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { EncryptionService } from '../security/encryption.service';
import { SsrfGuardService } from '../security/ssrf-guard.service';

import type { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsRepository } from './subscriptions.repository';
import type { WebhookEvent } from './webhook-events.types';
import { isValidEvent } from './webhook-events.types';

export interface SubscriptionView {
  id: string;
  url: string;
  events: string[];
  status: WebhookSubscription['status'];
  secretPrefix: string;
  lastDeliveryAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(SubscriptionsRepository) private readonly repo: SubscriptionsRepository,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EncryptionService) private readonly encryption: EncryptionService,
    @Inject(SsrfGuardService) private readonly ssrf: SsrfGuardService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async list(userId: string): Promise<SubscriptionView[]> {
    const items = await this.repo.listByUser(userId);
    return items.map((s) => this.toView(s));
  }

  async create(
    userId: string,
    dto: CreateSubscriptionDto,
  ): Promise<{ subscription: SubscriptionView; secret: string }> {
    const max = this.cfg.workspace.maxWebhookSubscriptionsPerUser;
    const count = await this.repo.countByUser(userId);
    if (count >= max) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'webhook_subscriptions_limit_reached',
          message: `Достигнут лимит подписок (${max})`,
        },
      });
    }

    await this.ssrf.assertSafeOutboundUrl(dto.url);

    for (const e of dto.events) {
      if (!isValidEvent(e)) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'invalid_event',
            message: `Неизвестное событие: ${e}`,
          },
        });
      }
    }

    const secret = `wsk_${randomBytes(24).toString('base64url')}`;
    const secretEncrypted = this.encryption.encrypt(secret);
    const secretPrefix = secret.slice(0, 8);

    const subscription = await this.repo.create({
      userId,
      url: dto.url,
      events: dto.events,
      secretEncrypted,
      secretPrefix,
    });

    await this.audit.log({
      userId,
      action: AUDIT.WEBHOOK_SUBSCRIPTION_CREATE,
      resourceId: subscription.id,
      metadata: { url: dto.url, events: dto.events },
    });

    return { subscription: this.toView(subscription), secret };
  }

  async delete(id: string, userId: string): Promise<void> {
    const sub = await this.repo.findById(id);
    if (!sub || sub.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'subscription_not_found', message: 'Подписка не найдена' },
      });
    }
    await this.repo.delete(id);
    await this.audit.log({
      userId,
      action: AUDIT.WEBHOOK_SUBSCRIPTION_DELETE,
      resourceId: id,
    });
  }

  async listDeliveries(
    id: string,
    userId: string,
    limit: number,
    offset: number,
  ): Promise<WebhookDelivery[]> {
    const sub = await this.repo.findById(id);
    if (!sub || sub.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'subscription_not_found', message: 'Подписка не найдена' },
      });
    }
    return this.repo.listDeliveries({
      subscriptionId: id,
      limit: Math.min(limit, 100),
      offset,
    });
  }

  async findOwned(id: string, userId: string): Promise<WebhookSubscription> {
    const sub = await this.repo.findById(id);
    if (!sub || sub.userId !== userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'subscription_not_found', message: 'Подписка не найдена' },
      });
    }
    return sub;
  }

  buildTestPayload(event: WebhookEvent | string): Record<string, unknown> {
    return {
      type: event,
      test: true,
      sentAt: new Date().toISOString(),
    };
  }

  private toView(s: WebhookSubscription): SubscriptionView {
    return {
      id: s.id,
      url: s.url,
      events: s.events,
      status: s.status,
      secretPrefix: s.secretPrefix,
      lastDeliveryAt: s.lastDeliveryAt,
      createdAt: s.createdAt,
    };
  }
}
