import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/typed-config.service';

import type {
  PushTransport,
  PushTransportPayload,
  PushTransportSendResult,
  PushTransportSender,
} from './push-transport.types';

const RUSTORE_API_BASE = 'https://vkpns.rustore.ru/v1';
const RUSTORE_REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class RustoreSender implements PushTransportSender {
  readonly transport: PushTransport = 'rustore';
  private readonly logger = new Logger(RustoreSender.name);

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  isConfigured(): boolean {
    return this.cfg.push.rustore.isConfigured;
  }

  async sendToToken(args: {
    token: string;
    payload: PushTransportPayload;
  }): Promise<PushTransportSendResult> {
    const rustore = this.cfg.push.rustore;
    if (!rustore.isConfigured) {
      this.logger.debug('rustore.sendToToken: креды не настроены — no-op');
      return { ok: false };
    }

    const url = `${RUSTORE_API_BASE}/projects/${rustore.projectId}/messages:send`;
    const message = {
      message: {
        token: args.token,
        notification: { title: args.payload.title, body: args.payload.body },
        data: args.payload.data,
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${rustore.serviceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(RUSTORE_REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      const invalidToken = res.status === 404 || res.status === 400;
      this.logger.warn({ status: res.status }, 'rustore: send non-2xx');
      return { ok: false, invalidToken };
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'rustore: send error',
      );
      return { ok: false };
    }
  }
}
