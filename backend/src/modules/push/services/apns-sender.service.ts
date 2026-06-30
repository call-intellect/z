import http2 from 'node:http2';

import { Inject, Injectable, Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';

import { TypedConfigService } from '../../../common/config/typed-config.service';

import type {
  PushTransport,
  PushTransportPayload,
  PushTransportSendResult,
  PushTransportSender,
} from './push-transport.types';

const APNS_JWT_TTL_MS = 50 * 60 * 1000;
const APNS_REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class ApnsSender implements PushTransportSender {
  readonly transport: PushTransport = 'apns';
  private readonly logger = new Logger(ApnsSender.name);
  private cachedToken: { value: string; issuedAt: number } | null = null;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  isConfigured(): boolean {
    return this.cfg.push.apns.isConfigured;
  }

  async sendToToken(args: {
    token: string;
    payload: PushTransportPayload;
  }): Promise<PushTransportSendResult> {
    const apns = this.cfg.push.apns;
    if (!apns.isConfigured) {
      this.logger.debug('apns.sendToToken: креды не настроены — no-op');
      return { ok: false };
    }

    const authToken = this.buildAuthToken();
    const host = apns.useSandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    const body = JSON.stringify({
      aps: { alert: { title: args.payload.title, body: args.payload.body }, sound: 'default' },
      ...args.payload.data,
    });

    return this.sendViaHttp2({ host, authToken, deviceToken: args.token, body, topic: apns.bundleId! });
  }

  private buildAuthToken(): string {
    const now = Date.now();
    if (this.cachedToken && now - this.cachedToken.issuedAt < APNS_JWT_TTL_MS) {
      return this.cachedToken.value;
    }
    const apns = this.cfg.push.apns;
    const value = jwt.sign({ iss: apns.teamId, iat: Math.floor(now / 1000) }, apns.privateKey!, {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: apns.keyId! },
    });
    this.cachedToken = { value, issuedAt: now };
    return value;
  }

  private sendViaHttp2(args: {
    host: string;
    authToken: string;
    deviceToken: string;
    body: string;
    topic: string;
  }): Promise<PushTransportSendResult> {
    return new Promise<PushTransportSendResult>((resolve) => {
      const client = http2.connect(`https://${args.host}`);
      let settled = false;
      const finish = (result: PushTransportSendResult): void => {
        if (settled) return;
        settled = true;
        client.close();
        resolve(result);
      };

      client.on('error', (err) => {
        this.logger.warn({ err: err.message }, 'apns: http2 connection error');
        finish({ ok: false });
      });

      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${args.deviceToken}`,
        authorization: `bearer ${args.authToken}`,
        'apns-topic': args.topic,
        'apns-push-type': 'alert',
        'content-type': 'application/json',
      });

      let status = 0;
      req.on('response', (headers) => {
        status = Number(headers[':status'] ?? 0);
      });
      req.setTimeout(APNS_REQUEST_TIMEOUT_MS, () => {
        req.close();
        finish({ ok: false });
      });
      req.on('error', (err) => {
        this.logger.warn({ err: err.message }, 'apns: request error');
        finish({ ok: false });
      });
      req.on('end', () => {
        if (status >= 200 && status < 300) {
          finish({ ok: true });
          return;
        }
        finish({ ok: false, invalidToken: status === 410 || status === 400 });
      });
      req.on('data', () => undefined);
      req.end(args.body);
    });
  }
}
