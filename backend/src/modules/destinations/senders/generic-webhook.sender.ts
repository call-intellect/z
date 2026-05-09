import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationDestination } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { EncryptionService } from '../../security/encryption.service';
import { SsrfGuardService } from '../../security/ssrf-guard.service';
import type { GenericWebhookConfig } from '../dto/destination.dto';

import type { DestinationSender, SenderMessage } from './sender.types';

@Injectable()
export class GenericWebhookSender implements DestinationSender {
  readonly type = 'generic_webhook';

  constructor(
    @Inject(SsrfGuardService) private readonly ssrf: SsrfGuardService,
    @Inject(EncryptionService) private readonly encryption: EncryptionService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async send(destination: IntegrationDestination, message: SenderMessage): Promise<void> {
    const cfg = destination.config as unknown as GenericWebhookConfig & {
      url_encrypted?: string;
    };
    const url = cfg.url_encrypted ? this.encryption.decrypt(cfg.url_encrypted) : cfg.url;
    if (!url) {
      throw new Error('generic webhook: пустой url');
    }
    await this.ssrf.assertSafeOutboundUrl(url);
    const body = JSON.stringify({
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      sentAt: new Date().toISOString(),
    });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.cfg.webhooksOut.deliveryTimeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        redirect: 'manual',
        signal: ac.signal,
      });
      if (res.status < 200 || res.status >= 300) {
        const text = (await res.text().catch(() => '')).slice(0, 500);
        throw new Error(`generic webhook: HTTP ${res.status} ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
