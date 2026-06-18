import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { HmacService } from './hmac.service';

function makeCfg(windowSeconds: number): TypedConfigService {
  return {
    crossmark: { hmacTimestampWindowSeconds: windowSeconds },
  } as unknown as TypedConfigService;
}

function sign(key: string, timestamp: string, body: string): string {
  return createHmac('sha256', key).update(`${timestamp}.${body}`).digest('hex');
}

describe('HmacService', () => {
  const KEY = 'a'.repeat(64);
  const BODY = '{"foo":"bar","n":42}';
  const WINDOW = 300;

  it('принимает валидную подпись со свежим timestamp', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = sign(KEY, ts, BODY);

    const ok = svc.verify({
      body: Buffer.from(BODY),
      signature,
      timestamp: ts,
      key: KEY,
    });
    expect(ok).toBe(true);
  });

  it('отклоняет подпись если тело изменено', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = sign(KEY, ts, BODY);

    const ok = svc.verify({
      body: Buffer.from('{"foo":"BAR"}'),
      signature,
      timestamp: ts,
      key: KEY,
    });
    expect(ok).toBe(false);
  });

  it('отклоняет подпись со старым timestamp (за окном)', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const oldTs = String(Math.floor(Date.now() / 1000) - WINDOW - 60);
    const signature = sign(KEY, oldTs, BODY);

    const ok = svc.verify({
      body: Buffer.from(BODY),
      signature,
      timestamp: oldTs,
      key: KEY,
    });
    expect(ok).toBe(false);
  });

  it('отклоняет подпись с timestamp из будущего (за окном)', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const futureTs = String(Math.floor(Date.now() / 1000) + WINDOW + 60);
    const signature = sign(KEY, futureTs, BODY);

    const ok = svc.verify({
      body: Buffer.from(BODY),
      signature,
      timestamp: futureTs,
      key: KEY,
    });
    expect(ok).toBe(false);
  });

  it('отклоняет невалидный hex в подписи и не падает', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const ts = String(Math.floor(Date.now() / 1000));
    const ok = svc.verify({
      body: Buffer.from(BODY),
      signature: 'не-hex-вовсе',
      timestamp: ts,
      key: KEY,
    });
    expect(ok).toBe(false);
  });

  it('отклоняет пустые поля без throw', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    expect(svc.verify({ body: Buffer.alloc(0), signature: '', timestamp: '0', key: KEY })).toBe(
      false,
    );
    expect(svc.verify({ body: Buffer.alloc(0), signature: 'a', timestamp: '', key: KEY })).toBe(
      false,
    );
  });

  it('отклоняет подпись разной длины (не падает на timingSafeEqual)', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const ts = String(Math.floor(Date.now() / 1000));
    const ok = svc.verify({
      body: Buffer.from(BODY),
      signature: 'aabb',
      timestamp: ts,
      key: KEY,
    });
    expect(ok).toBe(false);
  });

  it('hashKey возвращает sha256 в hex (64 символа, детерминирован)', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const h1 = svc.hashKey('plain-key-1');
    const h2 = svc.hashKey('plain-key-1');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.hashKey('plain-key-2')).not.toBe(h1);
  });

  it('generateKey даёт 64-hex случайный ключ', () => {
    const svc = new HmacService(makeCfg(WINDOW));
    const k1 = svc.generateKey();
    const k2 = svc.generateKey();
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    expect(k2).toMatch(/^[0-9a-f]{64}$/);
    expect(k1).not.toBe(k2);
  });
});
