import { generateKeyPairSync, type KeyObject } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import type { TypedConfigService } from '../../../../common/config/index';

import { TochkaWebhookVerifierService } from './tochka-webhook-verifier.service';

function makeCfg(): TypedConfigService {
  return {
    billing: {
      tochka: {
        webhookPublicKeyUrl: 'https://example.test/key',
      },
    },
  } as unknown as TypedConfigService;
}

function makeMetrics(): BusinessMetricsService & {
  incTochkaWebhookReplay: ReturnType<typeof vi.fn>;
} {
  return {
    incTochkaWebhookReplay: vi.fn(),
  } as unknown as BusinessMetricsService & {
    incTochkaWebhookReplay: ReturnType<typeof vi.fn>;
  };
}

describe('TochkaWebhookVerifierService.extractToken / parseWebhookEvent', () => {
  let svc: TochkaWebhookVerifierService;

  beforeEach(() => {
    svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
  });

  function payloadBase64(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.sig`;
  }

  it('extractToken: string', () => {
    const token = payloadBase64({
      webhookType: 'acquiringInternetPayment',
      operationId: 'op-1',
      status: 'APPROVED',
    });
    const event = svc.parseWebhookEvent({}, token);
    expect(event.eventType).toBe('acquiringInternetPayment');
    expect(event.providerInvoiceId).toBe('op-1');
    expect(event.status).toBe('APPROVED');
    expect(event.eventId).toBe('acquiringInternetPayment:op-1:APPROVED');
  });

  it('extractToken: Buffer', () => {
    const token = payloadBase64({ webhookType: 't', operationId: 'op', status: 's' });
    const event = svc.parseWebhookEvent({}, Buffer.from(token, 'utf8'));
    expect(event.providerInvoiceId).toBe('op');
  });

  it('extractToken: {token: string}', () => {
    const token = payloadBase64({ webhookType: 't', operationId: 'op', status: 's' });
    const event = svc.parseWebhookEvent({}, { token });
    expect(event.providerInvoiceId).toBe('op');
  });

  it('extractToken: {jwt: string}', () => {
    const token = payloadBase64({ webhookType: 't', operationId: 'op-jwt', status: 's' });
    const event = svc.parseWebhookEvent({}, { jwt: token });
    expect(event.providerInvoiceId).toBe('op-jwt');
  });

  it('extractToken: {body: string}', () => {
    const token = payloadBase64({ webhookType: 't', operationId: 'op-body', status: 's' });
    const event = svc.parseWebhookEvent({}, { body: token });
    expect(event.providerInvoiceId).toBe('op-body');
  });

  it('extractToken: invalid body → throw', () => {
    expect(() => svc.parseWebhookEvent({}, 42)).toThrow(/JWT-строкой/);
    expect(() => svc.parseWebhookEvent({}, null)).toThrow(/JWT-строкой/);
    expect(() => svc.parseWebhookEvent({}, { foo: 'bar' })).toThrow(/JWT-строкой/);
  });

  it('parseWebhookEvent: amountKopecks = rub × 100', () => {
    const token = payloadBase64({
      webhookType: 'acquiringInternetPayment',
      operationId: 'op',
      status: 'APPROVED',
      amount: 1500,
    });
    const event = svc.parseWebhookEvent({}, token);
    expect(event.amountKopecks).toBe(150_000);
  });

  it('parseWebhookEvent: fallback на unknown при missing полях', () => {
    const token = payloadBase64({});
    const event = svc.parseWebhookEvent({}, token);
    expect(event.eventType).toBe('unknown');
    expect(event.status).toBe('unknown');
    expect(event.providerInvoiceId).toBe('unknown');
    expect(event.eventId).toBe('tochka:unknown:unknown');
  });

  it('parseWebhookEvent: paymentLinkId fallback если нет operationId', () => {
    const token = payloadBase64({
      webhookType: 't',
      paymentLinkId: 'pay-link-1',
      status: 'APPROVED',
    });
    const event = svc.parseWebhookEvent({}, token);
    expect(event.providerInvoiceId).toBe('pay-link-1');
  });

  it('parseWebhookEvent: JWT без payload-секции → throw', () => {
    expect(() => svc.parseWebhookEvent({}, 'header.')).toThrow(/payload-секции/);
  });
});

describe('TochkaWebhookVerifierService.verify', () => {
  let publicKey: KeyObject;
  let privateKey: KeyObject;

  beforeAll(() => {
    const keypair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keypair.privateKey;
    publicKey = keypair.publicKey;
  });

  function injectKey(svc: TochkaWebhookVerifierService): void {
    (svc as unknown as { publicKeyPromise: Promise<KeyObject> }).publicKeyPromise =
      Promise.resolve(publicKey);
    (svc as unknown as { publicKeyFetchedAt: number }).publicKeyFetchedAt = Date.now();
  }

  it('valid signature → true', async () => {
    const svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
    injectKey(svc);

    const token = jwt.sign(
      { webhookType: 't', operationId: 'op', status: 'APPROVED' },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256' },
    );

    const result = await svc.verify({}, token);
    expect(result).toBe(true);
  });

  it('invalid signature → false (не throw)', async () => {
    const svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
    injectKey(svc);

    const anotherKeypair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = jwt.sign(
      { webhookType: 't', operationId: 'op', status: 'APPROVED' },
      anotherKeypair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256' },
    );

    const result = await svc.verify({}, token);
    expect(result).toBe(false);
  });

  it('not a JWT → false', async () => {
    const svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
    injectKey(svc);

    const result = await svc.verify({}, 'not-a-jwt');
    expect(result).toBe(false);
  });

  it('fetch JWK failed → false (graceful)', async () => {
    const svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));

    const result = await svc.verify({}, 'header.body.sig');
    expect(result).toBe(false);
    vi.unstubAllGlobals();
  });

  it('expired (iat старше 5 минут) → false + метрика reason=expired', async () => {
    const metrics = makeMetrics();
    const svc = new TochkaWebhookVerifierService(makeCfg(), metrics);
    injectKey(svc);

    const tenMinAgoSec = Math.floor(Date.now() / 1000) - 10 * 60;
    const manualToken = jwt.sign(
      {
        webhookType: 't',
        operationId: 'op',
        status: 'APPROVED',
        iat: tenMinAgoSec,
      },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', mutatePayload: true } as jwt.SignOptions,
    );

    const result = await svc.verify({}, manualToken);
    expect(result).toBe(false);
    expect(metrics.incTochkaWebhookReplay).toHaveBeenCalledWith({ reason: 'expired' });
  });

  it('valid с iat в пределах 5 минут → true', async () => {
    const svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
    injectKey(svc);

    const token = jwt.sign(
      { webhookType: 't', operationId: 'op', status: 'APPROVED' },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256' },
    );

    expect(await svc.verify({}, token)).toBe(true);
  });

  it('parseWebhookEvent выставляет jti из JWT', () => {
    const svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
    const token = jwt.sign(
      {
        webhookType: 't',
        operationId: 'op',
        status: 'APPROVED',
        jti: 'jti-12345',
      },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256' },
    );
    const event = svc.parseWebhookEvent({}, token);
    expect(event.jti).toBe('jti-12345');
  });

  it('parseWebhookEvent: jti=null если в JWT нет jti', () => {
    const svc = new TochkaWebhookVerifierService(makeCfg(), makeMetrics());
    const token = jwt.sign(
      { webhookType: 't', operationId: 'op', status: 'APPROVED' },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256' },
    );
    const event = svc.parseWebhookEvent({}, token);
    expect(event.jti).toBeNull();
  });
});
