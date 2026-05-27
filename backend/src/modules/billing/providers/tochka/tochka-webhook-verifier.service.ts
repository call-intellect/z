/**
 * TochkaWebhookVerifierService — парсинг и верификация JWT-webhook'ов Точки.
 *
 * Точка шлёт webhook **JWT-строкой** в теле (не JSON). Алгоритм:
 *   1. Извлекаем токен из body (может быть string либо `{token|jwt|body: string}`).
 *   2. Загружаем публичный JWK с TOCHKA_WEBHOOK_PUBLIC_KEY_URL (кэшируем на инстанс).
 *   3. Через `crypto.createPublicKey({key: jwk, format: 'jwk'})` получаем
 *      Node KeyObject → передаём в `jsonwebtoken.verify(token, key, {algorithms:['RS256']})`.
 *   4. Если подпись валидна — парсим payload и формируем `WebhookEvent`.
 *
 * Используем нативный `node:crypto` + уже подключённый `jsonwebtoken` —
 * не тащим дополнительную зависимость `jose`.
 *
 * `eventId` для дедупа = `<webhookType>:<operationId|paymentLinkId>:<status>`.
 *
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §7.4 + port-brief §13.
 */

import { createPublicKey, type KeyObject } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';

import { TypedConfigService } from '../../../../common/config/index';
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
  [key: string]: unknown;
}

@Injectable()
export class TochkaWebhookVerifierService {
  private readonly logger = new Logger(TochkaWebhookVerifierService.name);
  /** Lazy-кэш загруженного JWK → Node KeyObject. */
  private publicKeyPromise: Promise<KeyObject> | null = null;

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

  /**
   * Verify подпись + парсинг. Возвращает true/false вместо throw —
   * webhook-контроллер должен ответить 200 даже на невалидный signature
   * (чтобы Точка не ретраила), но не запускать `finalizePaidInvoice`.
   */
  async verify(_headers: Record<string, string>, body: unknown): Promise<boolean> {
    try {
      const token = this.extractToken(body);
      const key = await this.getPublicKey();
      jwt.verify(token, key, { algorithms: ['RS256'] });
      return true;
    } catch (err) {
      this.logger.warn(
        `Tochka webhook verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Разобрать webhook-payload (после `verify`). Возвращает `WebhookEvent`
   * с детерминированным `eventId` для дедупа в `BillingEventLog`.
   */
  parseWebhookEvent(
    headers: Record<string, string>,
    body: unknown,
  ): WebhookEvent {
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

    // Tochka возвращает amount в рублях → в копейки для единства Z.
    const amountKopecks =
      raw.amount != null ? Math.round(Number(raw.amount) * 100) : undefined;

    return {
      eventId,
      eventType: String(raw.webhookType ?? 'unknown'),
      providerInvoiceId: String(
        raw.operationId ?? raw.paymentLinkId ?? 'unknown',
      ),
      status: String(raw.status ?? 'unknown'),
      amountKopecks,
      currency: raw.currency ?? 'RUB',
      paidAt: raw.paidAt ? new Date(String(raw.paidAt)) : undefined,
      rawPayload: { ...raw, _headers: headers },
    };
  }

  /** Только для тестов: сбросить кэш publicKey (например после rotation'а). */
  resetKeyCache(): void {
    this.publicKeyPromise = null;
  }

  // ────────────────────────── private ──────────────────────────

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

  private async getPublicKey(): Promise<KeyObject> {
    if (this.publicKeyPromise) return this.publicKeyPromise;
    this.publicKeyPromise = (async () => {
      const url = this.cfg.billing.tochka.webhookPublicKeyUrl;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Tochka webhook public key fetch failed: ${response.status}`,
        );
      }
      const jwk = (await response.json()) as Record<string, unknown>;
      // Node 20+ умеет принимать JWK напрямую. Алгоритм определяется по `kty`/`alg`.
      return createPublicKey({ key: jwk as never, format: 'jwk' });
    })();
    return this.publicKeyPromise;
  }
}
