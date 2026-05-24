import { describe, expect, it } from 'vitest';

import { WebhookSigner } from './webhook-signer.service';

describe('WebhookSigner', () => {
  const signer = new WebhookSigner();
  const secret = 'kora_wh_test_secret_0123456789abcdef';
  const body = JSON.stringify({
    event: 'issue.created',
    tenantId: 'org_1',
    data: { id: 'i1', title: 'Hello' },
  });

  it('sign — детерминированно при одинаковых входах', () => {
    const a = signer.sign(body, secret);
    const b = signer.sign(body, secret);
    expect(a).toBe(b);
    expect(a.startsWith('sha256=')).toBe(true);
    // hex длина SHA-256 = 64.
    expect(a.length).toBe('sha256='.length + 64);
  });

  it('sign — разный при разных secret', () => {
    const a = signer.sign(body, secret);
    const b = signer.sign(body, `${secret}x`);
    expect(a).not.toBe(b);
  });

  it('verify — true для совпадающей подписи', () => {
    const sig = signer.sign(body, secret);
    expect(signer.verify(body, secret, sig)).toBe(true);
  });

  it('verify — false при изменении тела (даже на 1 байт)', () => {
    const sig = signer.sign(body, secret);
    const tampered = body + ' ';
    expect(signer.verify(tampered, secret, sig)).toBe(false);
  });

  it('verify — false при неверном secret', () => {
    const sig = signer.sign(body, secret);
    expect(signer.verify(body, `${secret}_wrong`, sig)).toBe(false);
  });

  it('verify — false при подделанной подписи длиной не равной', () => {
    const sig = signer.sign(body, secret);
    expect(signer.verify(body, secret, `${sig}extra`)).toBe(false);
    expect(signer.verify(body, secret, sig.slice(0, sig.length - 1))).toBe(false);
  });
});
