import bcrypt from 'bcrypt';
import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { PasswordService } from './password.service';

function makeCfg(): TypedConfigService {
  return {
    argon: { memoryKb: 1024, iterations: 2, parallelism: 1 },
  } as unknown as TypedConfigService;
}

describe('PasswordService', () => {
  it('hash и verify — round-trip', async () => {
    const svc = new PasswordService(makeCfg());
    const hash = await svc.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await svc.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await svc.verify(hash, 'wrong')).toBe(false);
  });

  it('hash от одного и того же пароля — разные (salt)', async () => {
    const svc = new PasswordService(makeCfg());
    const a = await svc.hash('pw-12345');
    const b = await svc.hash('pw-12345');
    expect(a).not.toBe(b);
    expect(await svc.verify(a, 'pw-12345')).toBe(true);
    expect(await svc.verify(b, 'pw-12345')).toBe(true);
  });

  it('verify на битом hash — возвращает false (а не throw)', async () => {
    const svc = new PasswordService(makeCfg());
    expect(await svc.verify('not-a-hash', 'anything')).toBe(false);
    expect(await svc.verify('', 'anything')).toBe(false);
  });

  it('verify принимает легаси bcrypt-hash без перевыпуска пароля', async () => {
    const svc = new PasswordService(makeCfg());
    const bcryptHash = await bcrypt.hash('legacy-admin-pw', 4);
    expect(await svc.verify(bcryptHash, 'legacy-admin-pw')).toBe(true);
    expect(await svc.verify(bcryptHash, 'wrong')).toBe(false);
  });

  it('needsRehash: true для bcrypt и битых, false для актуального argon2id', async () => {
    const svc = new PasswordService(makeCfg());
    const bcryptHash = await bcrypt.hash('x', 4);
    expect(svc.needsRehash(bcryptHash)).toBe(true);
    expect(svc.needsRehash('not-a-hash')).toBe(true);
    const argonHash = await svc.hash('x');
    expect(svc.needsRehash(argonHash)).toBe(false);
  });

  it('needsRehash: true когда параметры argon2 устарели', async () => {
    const weak = new PasswordService({
      argon: { memoryKb: 1024, iterations: 2, parallelism: 1 },
    } as unknown as TypedConfigService);
    const oldHash = await weak.hash('x');
    const strong = new PasswordService({
      argon: { memoryKb: 4096, iterations: 3, parallelism: 1 },
    } as unknown as TypedConfigService);
    expect(strong.needsRehash(oldHash)).toBe(true);
  });
});
