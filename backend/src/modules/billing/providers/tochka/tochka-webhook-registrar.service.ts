import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { BillingProviderPort } from '../billing-provider.port';

import { TOCHKA_WEBHOOK_REGISTRATION_KEY, type StoredWebhookRegistration } from './tochka.types';

@Injectable()
export class TochkaWebhookRegistrarService {
  private readonly logger = new Logger(TochkaWebhookRegistrarService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async registerOnce(provider: BillingProviderPort): Promise<void> {
    if (!this.cfg.billing.features.tochka) {
      this.logger.warn('FEATURE_BILLING_TOCHKA=false — auto-register webhook пропущен');
      return;
    }
    if (!this.cfg.billing.tochka.webhookAutoRegister) {
      this.logger.log(
        'TOCHKA_WEBHOOK_AUTO_REGISTER=false — webhook не регистрируется автоматически',
      );
      return;
    }
    if (provider.providerName !== 'tochka') {
      this.logger.warn(
        `Текущий провайдер ${provider.providerName} — auto-register webhook не нужен`,
      );
      return;
    }
    if (!provider.registerWebhooks) {
      this.logger.warn('provider.registerWebhooks не реализован — skip');
      return;
    }

    const url = this.resolveWebhookUrl();
    const events = this.cfg.billing.tochka.webhookEventTypes;

    const existing = await this.getStoredRegistration();
    if (existing && this.isUpToDate(existing, url, events)) {
      this.logger.log(
        `Webhook Точки уже зарегистрирован (${existing.url}, events=${existing.events.join(',')})`,
      );
      return;
    }

    try {
      const result = await provider.registerWebhooks({ url, events });
      const record: StoredWebhookRegistration = {
        url,
        events,
        webhookIds: result.webhookIds ?? [],
        registeredAt: new Date().toISOString(),
      };
      await this.prisma.billingProviderConfig.upsert({
        where: { key: TOCHKA_WEBHOOK_REGISTRATION_KEY },
        update: { valueJson: record as object },
        create: {
          key: TOCHKA_WEBHOOK_REGISTRATION_KEY,
          valueJson: record as object,
        },
      });
      this.logger.log(`Webhook Точки зарегистрирован: ${url} (events=${events.join(',')})`);
    } catch (err) {
      this.logger.error(
        `Auto-register webhook failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private resolveWebhookUrl(): string {
    const explicit = this.cfg.billing.tochka.webhookUrl;
    if (explicit) return explicit;
    const apiUrl = this.cfg.billing.publicApiUrl;
    if (!apiUrl) {
      throw new Error(
        'TOCHKA_WEBHOOK_URL или BILLING_PUBLIC_API_URL должны быть заданы для регистрации webhook',
      );
    }
    return `${apiUrl.replace(/\/+$/, '')}/api/v1/internal/billing/provider-events`;
  }

  private async getStoredRegistration(): Promise<StoredWebhookRegistration | null> {
    const row = await this.prisma.billingProviderConfig.findUnique({
      where: { key: TOCHKA_WEBHOOK_REGISTRATION_KEY },
    });
    return (row?.valueJson as unknown as StoredWebhookRegistration) ?? null;
  }

  private isUpToDate(existing: StoredWebhookRegistration, url: string, events: string[]): boolean {
    if (existing.url !== url) return false;
    if (existing.events.length !== events.length) return false;
    const set = new Set(existing.events);
    return events.every((e) => set.has(e));
  }
}
