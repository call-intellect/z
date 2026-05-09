import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { WebhookSigningService } from './webhook-signing.service';

describe('WebhookSigningService.sign', () => {
  it('формат t=<unix>,v1=<hex>', () => {
    const svc = new WebhookSigningService();
    const result = svc.sign({
      secret: 'wsk_secret',
      rawBody: '{"hello":"world"}',
      timestampSec: 1_700_000_000,
    });
    expect(result).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/u);
  });

  it('значение HMAC корректное', () => {
    const svc = new WebhookSigningService();
    const t = 1_700_000_000;
    const body = '{"a":1}';
    const expected = createHmac('sha256', 'sec').update(`${t}.${body}`).digest('hex');
    const got = svc.sign({ secret: 'sec', rawBody: body, timestampSec: t });
    expect(got).toBe(`t=${t},v1=${expected}`);
  });

  it('одинаковый ввод — одинаковая подпись', () => {
    const svc = new WebhookSigningService();
    const a = svc.sign({ secret: 'k', rawBody: 'b', timestampSec: 1 });
    const b = svc.sign({ secret: 'k', rawBody: 'b', timestampSec: 1 });
    expect(a).toBe(b);
  });
});
