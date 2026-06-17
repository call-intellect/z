import { createPublicKey, type KeyObject } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';

import { TypedConfigService } from '../../../../common/config/index';
import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { WebhookEvent } from '../billing-provider.port';

interface TochkaWebhookPayload {
  webhookType?: string;
  operationId?: string;
  transactionId?: string;
  paymentLinkId?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  paidAt?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
  jti?: string;
  customerCode?: string;
  [key: string]: unknown;
}

const JWK_CACHE_TTL_MS = 60 * 60 * 1000;
const JWT_MAX_AGE = '5m';
const JWT_CLOCK_TOLERANCE_SEC = 30;

@Injectable()
export class TochkaWebhookVerifierService {
  private readonly logger = new Logger(TochkaWebhookVerifierService.name);
  private publicKeyPromise: Promise<KeyObject> | null = null;
  private publicKeyFetchedAt = 0;
  private publicKeyKid: string | null = null;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async verify(_headers: Record<string, string>, body: unknown): Promise<boolean> {
    try {
      const token = this.extractToken(body);
      const kid = this.extractKidFromHeader(token);
      const key = await this.getPublicKey(kid);
      jwt.verify(token, key, {
        algorithms: ['RS256'],
        maxAge: JWT_MAX_AGE,
        clockTolerance: JWT_CLOCK_TOLERANCE_SEC,
      });
      return true;
    } catch (err) {
      const reason = this.classifyVerifyError(err);
      this.metrics.incTochkaWebhookReplay({ reason });
      this.logger.warn(
        `Tochka webhook verification failed [reason=${reason}]: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  parseWebhookEvent(headers: Record<string, string>, body: unknown): WebhookEvent {
    const token = this.extractToken(body);
    const [, payloadPart] = token.split('.');
    if (!payloadPart) {
      throw new Error('Invalid Tochka webhook JWT — нет payload-секции');
    }
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const raw = JSON.parse(json) as TochkaWebhookPayload;

    const eventId = [
      raw.webhookType ?? 'tochka',
      raw.operationId ?? raw.transactionId ?? raw.paymentLinkId ?? 'unknown',
      raw.status ?? 'unknown',
    ].join(':');

    const amountKopecks = raw.amount != null ? Math.round(Number(raw.amount) * 100) : undefined;

    return {
      eventId,
      eventType: String(raw.webhookType ?? 'unknown'),
      providerInvoiceId: String(raw.operationId ?? raw.paymentLinkId ?? 'unknown'),
      status: String(raw.status ?? 'unknown'),
      amountKopecks,
      currency: raw.currency ?? 'RUB',
      paidAt: raw.paidAt ? new Date(String(raw.paidAt)) : undefined,
      jti: typeof raw.jti === 'string' && raw.jti.length > 0 ? raw.jti : null,
      customerCode:
        typeof raw.customerCode === 'string' && raw.customerCode.length > 0
          ? raw.customerCode
          : null,
      rawPayload: { ...raw, _headers: headers },
    };
  }

  resetKeyCache(): void {
    this.publicKeyPromise = null;
    this.publicKeyFetchedAt = 0;
    this.publicKeyKid = null;
  }

  private extractToken(body: unknown): string {
    if (typeof body === 'string') return body.trim();
    if (body instanceof Buffer) return body.toString('utf8').trim();
    if (body && typeof body === 'object') {
      const candidate =
        (body as { token?: string }).token ??
        (body as { jwt?: string }).jwt ??
        (body as { body?: string }).body;
      if (typeof candidate === 'string') return candidate.trim();
    }
    throw new Error(
      'Tochka webhook body должен быть JWT-строкой (text/plain) либо объектом с {token|jwt|body}',
    );
  }

  private extractKidFromHeader(token: string): string | null {
    try {
      const [headerPart] = token.split('.');
      if (!headerPart) return null;
      const json = Buffer.from(headerPart, 'base64url').toString('utf8');
      const obj = JSON.parse(json) as { kid?: string };
      return typeof obj.kid === 'string' && obj.kid.length > 0 ? obj.kid : null;
    } catch {
      return null;
    }
  }

  private classifyVerifyError(
    err: unknown,
  ): 'expired' | 'not_before' | 'signature' | 'missing_iat' | 'other' {
    if (err instanceof Error) {
      if (err.name === 'TokenExpiredError') return 'expired';
      if (err.name === 'NotBeforeError') return 'not_before';
      if (err.name === 'JsonWebTokenError') {
        if (err.message.includes('iat')) return 'missing_iat';
        if (err.message.includes('maxAge')) return 'expired';
        return 'signature';
      }
    }
    return 'other';
  }

  private async getPublicKey(expectedKid: string | null): Promise<KeyObject> {
    const cacheValid =
      this.publicKeyPromise !== null && Date.now() - this.publicKeyFetchedAt < JWK_CACHE_TTL_MS;
    const kidMismatch =
      this.publicKeyPromise !== null &&
      expectedKid !== null &&
      this.publicKeyKid !== null &&
      this.publicKeyKid !== expectedKid;

    if (cacheValid && !kidMismatch) {
      return this.publicKeyPromise as Promise<KeyObject>;
    }

    if (kidMismatch) {
      this.logger.warn(
        `Tochka JWK kid mismatch (cached=${this.publicKeyKid}, expected=${expectedKid}) — refetch`,
      );
    }

    const fetchPromise = (async () => {
      const url = this.cfg.billing.tochka.webhookPublicKeyUrl;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Tochka webhook public key fetch failed: ${response.status}`);
      }
      const jwk = (await response.json()) as Record<string, unknown>;
      this.publicKeyKid = typeof jwk['kid'] === 'string' ? (jwk['kid'] as string) : expectedKid;
      return createPublicKey({ key: jwk as never, format: 'jwk' });
    })();
    this.publicKeyPromise = fetchPromise;
    this.publicKeyFetchedAt = Date.now();
    return fetchPromise;
  }
}
