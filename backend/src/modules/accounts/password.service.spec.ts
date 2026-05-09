import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';

import { PasswordService } from './password.service';

function makeCfg(): TypedConfigService {
  // argon2: memoryCost min=1024, timeCost min=2. Минимально допустимые
  // значения = быстро в тестах.
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
});
