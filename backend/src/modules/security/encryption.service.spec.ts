import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { EncryptionService, EncryptionTamperError } from './encryption.service';

function makeCfg(): TypedConfigService {
  return {
    webhooksOut: {
      encryptionKey: randomBytes(32).toString('base64'),
    },
  } as unknown as TypedConfigService;
}

describe('EncryptionService', () => {
  it('encrypt → decrypt round-trip', () => {
    const svc = new EncryptionService(makeCfg());
    const pt = 'wsk_super_secret_value_42';
    const ct = svc.encrypt(pt);
    expect(ct).not.toBe(pt);
    expect(ct.split('.').length).toBe(3);
    expect(svc.decrypt(ct)).toBe(pt);
  });

  it('одинаковый plaintext с одним ключом → разные шифры (IV случайный)', () => {
    const svc = new EncryptionService(makeCfg());
    const a = svc.encrypt('hello');
    const b = svc.encrypt('hello');
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe('hello');
    expect(svc.decrypt(b)).toBe('hello');
  });

  it('tamper: подмена ciphertext → EncryptionTamperError', () => {
    const svc = new EncryptionService(makeCfg());
    const ct = svc.encrypt('hello');
    const parts = ct.split('.');
    // Меняем последний байт ciphertext.
    const ctRaw = Buffer.from(parts[1] as string, 'base64');
    const lastByte = ctRaw[ctRaw.length - 1] ?? 0;
    ctRaw[ctRaw.length - 1] = lastByte ^ 0xff;
    const tampered = `${parts[0]}.${ctRaw.toString('base64')}.${parts[2]}`;
    expect(() => svc.decrypt(tampered)).toThrow(EncryptionTamperError);
  });

  it('tamper: подмена auth tag → EncryptionTamperError', () => {
    const svc = new EncryptionService(makeCfg());
    const ct = svc.encrypt('payload');
    const parts = ct.split('.');
    const tagRaw = Buffer.from(parts[2] as string, 'base64');
    tagRaw[0] = (tagRaw[0] ?? 0) ^ 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${tagRaw.toString('base64')}`;
    expect(() => svc.decrypt(tampered)).toThrow(EncryptionTamperError);
  });

  it('некорректный формат → EncryptionTamperError', () => {
    const svc = new EncryptionService(makeCfg());
    expect(() => svc.decrypt('not.valid')).toThrow(EncryptionTamperError);
    expect(() => svc.decrypt('a.b')).toThrow(EncryptionTamperError);
  });

  it('конструктор: невалидный ключ — выкидывает', () => {
    const cfg = {
      webhooksOut: { encryptionKey: Buffer.alloc(16).toString('base64') },
    } as unknown as TypedConfigService;
    expect(() => new EncryptionService(cfg)).toThrow(/32 байта/u);
  });
});
