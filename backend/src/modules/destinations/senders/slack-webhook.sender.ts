import { Inject, Injectable } from '@nestjs/common';
import type { IntegrationDestination } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { EncryptionService } from '../../security/encryption.service';
import { SsrfGuardService } from '../../security/ssrf-guard.service';
import type { SlackConfig } from '../dto/destination.dto';

import type { DestinationSender, SenderMessage } from './sender.types';

@Injectable()
export class SlackWebhookSender implements DestinationSender {
  readonly type = 'slack_webhook';

  constructor(
    @Inject(SsrfGuardService) private readonly ssrf: SsrfGuardService,
    @Inject(EncryptionService) private readonly encryption: EncryptionService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async send(destination: IntegrationDestination, message: SenderMessage): Promise<void> {
    const cfg = destination.config as unknown as SlackConfig & { url_encrypted?: string };
    // URL мог быть зашифрован при записи (см. DestinationsService).
    const url = cfg.url_encrypted ? this.encryption.decrypt(cfg.url_encrypted) : cfg.url;
    if (!url) {
      throw new Error('slack sender: пустой url');
    }
    await this.ssrf.assertSafeOutboundUrl(url);
    const body = JSON.stringify({
      text: `*${message.title}*\n${message.body}`,
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
        throw new Error(`slack sender: HTTP ${res.status} ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
