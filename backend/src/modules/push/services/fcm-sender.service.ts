import { Inject, Injectable, Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';

import { TypedConfigService } from '../../../common/config/typed-config.service';

import type {
  PushTransport,
  PushTransportPayload,
  PushTransportSendResult,
  PushTransportSender,
} from './push-transport.types';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000;
const FCM_REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class FcmSender implements PushTransportSender {
  readonly transport: PushTransport = 'fcm';
  private readonly logger = new Logger(FcmSender.name);
  private cachedAccessToken: { value: string; issuedAt: number } | null = null;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  isConfigured(): boolean {
    return this.cfg.push.fcm.isConfigured;
  }

  async sendToToken(args: {
    token: string;
    payload: PushTransportPayload;
  }): Promise<PushTransportSendResult> {
    const fcm = this.cfg.push.fcm;
    if (!fcm.isConfigured) {
      this.logger.debug('fcm.sendToToken: креды не настроены — no-op');
      return { ok: false };
    }

    const accessToken = await this.getAccessToken();
    if (!accessToken) return { ok: false };

    const url = `https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`;
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
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      const invalidToken = res.status === 404 || res.status === 400;
      this.logger.warn({ status: res.status }, 'fcm: send non-2xx');
      return { ok: false, invalidToken };
    } catch (err) {
      this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'fcm: send error');
      return { ok: false };
    }
  }

  private async getAccessToken(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedAccessToken && now - this.cachedAccessToken.issuedAt < FCM_ACCESS_TOKEN_TTL_MS) {
      return this.cachedAccessToken.value;
    }
    const fcm = this.cfg.push.fcm;
    const iat = Math.floor(now / 1000);
    const assertion = jwt.sign(
      { scope: FCM_SCOPE, aud: FCM_TOKEN_URL, iat, exp: iat + 3600 },
      fcm.privateKey!,
      { algorithm: 'RS256', issuer: fcm.clientEmail, subject: fcm.clientEmail },
    );

    try {
      const res = await fetch(FCM_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
        signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, 'fcm: token endpoint non-2xx');
        return null;
      }
      const json = (await res.json()) as { access_token?: string };
      if (!json.access_token) return null;
      this.cachedAccessToken = { value: json.access_token, issuedAt: now };
      return json.access_token;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'fcm: token fetch error',
      );
      return null;
    }
  }
}
