import { createHash } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import { IntegrationKeyInvalidError } from '../../common/errors/domain-errors';

import { LivekitSignatureVerifier } from './livekit-signature.verifier';

const SECRET = 'lk-webhook-secret-' + 'x'.repeat(40);

function makeCfg(secret: string = SECRET): TypedConfigService {
  return {
    livekit: { webhookApiSecret: secret },
  } as unknown as TypedConfigService;
}

function makeWebhookJwt(secret: string, claims: Record<string, unknown>): string {
  return jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: 60 });
}

const samplePayload = {
  event: 'room_started',
  id: 'EV_test_1',
  room: { name: 'meeting-id-1' },
};
const sampleBody = Buffer.from(JSON.stringify(samplePayload), 'utf8');
const sampleSha = createHash('sha256').update(sampleBody).digest('base64');

describe('LivekitSignatureVerifier', () => {
  it('принимает валидный JWT с правильным sha256 тела', () => {
    const verifier = new LivekitSignatureVerifier(makeCfg());
    const token = makeWebhookJwt(SECRET, { sha256: sampleSha });
    const event = verifier.verify({ rawBody: sampleBody, authHeader: token });
    expect(event.event).toBe('room_started');
  });

  it('принимает Bearer-префикс если он внезапно появится', () => {
    const verifier = new LivekitSignatureVerifier(makeCfg());
    const token = makeWebhookJwt(SECRET, { sha256: sampleSha });
    const event = verifier.verify({ rawBody: sampleBody, authHeader: `Bearer ${token}` });
    expect(event.event).toBe('room_started');
  });

  it('бросает на изменённое тело (sha mismatch)', () => {
    const verifier = new LivekitSignatureVerifier(makeCfg());
    const token = makeWebhookJwt(SECRET, { sha256: sampleSha });
    const tamperedBody = Buffer.from(JSON.stringify({ ...samplePayload, event: 'room_finished' }));
    expect(() => verifier.verify({ rawBody: tamperedBody, authHeader: token })).toThrow(
      IntegrationKeyInvalidError,
    );
  });

  it('бросает если JWT подписан другим секретом', () => {
    const verifier = new LivekitSignatureVerifier(makeCfg());
    const token = makeWebhookJwt('completely-other-secret-xxxxxxxxxxxxx', {
      sha256: sampleSha,
    });
    expect(() => verifier.verify({ rawBody: sampleBody, authHeader: token })).toThrow(
      IntegrationKeyInvalidError,
    );
  });

  it('бросает если в claims нет sha256', () => {
    const verifier = new LivekitSignatureVerifier(makeCfg());
    const token = makeWebhookJwt(SECRET, { foo: 'bar' });
    expect(() => verifier.verify({ rawBody: sampleBody, authHeader: token })).toThrow(
      IntegrationKeyInvalidError,
    );
  });

  it('бросает если authHeader отсутствует', () => {
    const verifier = new LivekitSignatureVerifier(makeCfg());
    expect(() => verifier.verify({ rawBody: sampleBody, authHeader: undefined })).toThrow(
      IntegrationKeyInvalidError,
    );
  });

  it('бросает на просроченный JWT', () => {
    const verifier = new LivekitSignatureVerifier(makeCfg());
    const expiredToken = jwt.sign({ sha256: sampleSha }, SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
    });
    expect(() => verifier.verify({ rawBody: sampleBody, authHeader: expiredToken })).toThrow(
      IntegrationKeyInvalidError,
    );
  });
});
