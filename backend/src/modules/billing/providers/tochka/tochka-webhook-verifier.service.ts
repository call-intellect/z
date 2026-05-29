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
  /** audit Б4 (2026-05-29): стандартные JWT-claim'ы, проверяем при verify. */
  iat?: number;
  exp?: number;
  nbf?: number;
  jti?: string;
  /** audit В3 (2026-05-29): customerCode для сверки тенантности webhook. */
  customerCode?: string;
  [key: string]: unknown;
}

/** TTL JWK-кэша. После протухания при следующем вызове перетягиваем заново. */
const JWK_CACHE_TTL_MS = 60 * 60 * 1000; // 1 час
/** Максимальный возраст JWT (claim iat). */
const JWT_MAX_AGE = '5m';
/** Допуск на расхождение часов сервера/Точки. */
const JWT_CLOCK_TOLERANCE_SEC = 30;

@Injectable()
export class TochkaWebhookVerifierService {
  private readonly logger = new Logger(TochkaWebhookVerifierService.name);
  /** Lazy-кэш загруженного JWK → Node KeyObject. */
  private publicKeyPromise: Promise<KeyObject> | null = null;
  /** Когда был успешно загружен текущий ключ (для TTL). */
  private publicKeyFetchedAt = 0;
  /** kid, под который кэширован ключ. При mismatch — refetch. */
  private publicKeyKid: string | null = null;

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Verify подпись + базовые claim'ы (iat/exp/nbf через jsonwebtoken).
   * Возвращает true/false вместо throw — webhook-контроллер должен ответить
   * 200 даже на невалидный signature (чтобы Точка не ретраила), но не
   * запускать `finalizePaidInvoice`.
   *
   * audit Б4 (2026-05-29):
   *   - `maxAge: '5m'` — токен старше 5 минут отвергается (защита от replay).
   *   - `clockTolerance: 30` — погрешность часов 30 секунд.
   *   - При `kid mismatch` (поменялся header.kid) — refetch JWK один раз.
   *   - Метрика `tochka_webhook_replay_total{reason}` (expired/signature/missing_iat).
   */
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
      // audit Б4: jti для replay-защиты на уровне БД (BillingEventLog.jti unique).
      // Если Точка по какой-то причине не положила jti — webhook всё равно
      // принимается, но дедуп идёт только по eventId (legacy-путь).
      jti: typeof raw.jti === 'string' && raw.jti.length > 0 ? raw.jti : null,
      // audit В3: customerCode для сверки с конфигом нашего merchant'а.
      customerCode:
        typeof raw.customerCode === 'string' && raw.customerCode.length > 0
          ? raw.customerCode
          : null,
      rawPayload: { ...raw, _headers: headers },
    };
  }

  /** Только для тестов: сбросить кэш publicKey (например после rotation'а). */
  resetKeyCache(): void {
    this.publicKeyPromise = null;
    this.publicKeyFetchedAt = 0;
    this.publicKeyKid = null;
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

  /**
   * audit Б4: классифицирует ошибку verify для метрик. jsonwebtoken
   * выбрасывает TokenExpiredError / NotBeforeError / JsonWebTokenError.
   */
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

  /**
   * audit Б4: JWK-кэш с TTL=1ч. Если в JWT новый `kid` — один refetch.
   * При TTL — refetch при следующем вызове. При ошибке fetch — НЕ
   * перезаписываем существующий ключ (отказоустойчивость).
   */
  private async getPublicKey(expectedKid: string | null): Promise<KeyObject> {
    const cacheValid =
      this.publicKeyPromise !== null &&
      Date.now() - this.publicKeyFetchedAt < JWK_CACHE_TTL_MS;
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
        throw new Error(
          `Tochka webhook public key fetch failed: ${response.status}`,
        );
      }
      const jwk = (await response.json()) as Record<string, unknown>;
      this.publicKeyKid = typeof jwk['kid'] === 'string' ? (jwk['kid'] as string) : expectedKid;
      // Node 20+ умеет принимать JWK напрямую. Алгоритм определяется по `kty`/`alg`.
      return createPublicKey({ key: jwk as never, format: 'jwk' });
    })();
    this.publicKeyPromise = fetchPromise;
    this.publicKeyFetchedAt = Date.now();
    return fetchPromise;
  }
}
