import { describe, expect, it } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import { JwtService } from './jwt.service';

/**
 * Юнит-тесты JwtService — round-trip session/deep-link, expired throw.
 */

function makeCfg(opts: {
  sessionSecret?: string;
  deepLinkSecret?: string;
  sessionTtlSeconds?: number;
  deepLinkTtlSeconds?: number;
}): TypedConfigService {
  return {
    auth: {
      sessionSecret: opts.sessionSecret ?? 's'.repeat(64),
      deepLinkSecret: opts.deepLinkSecret ?? 'd'.repeat(64),
      sessionTtlSeconds: opts.sessionTtlSeconds ?? 86_400,
      deepLinkTtlSeconds: opts.deepLinkTtlSeconds ?? 900,
    },
  } as unknown as TypedConfigService;
}

describe('JwtService', () => {
  it('round-trip: signSession → verifySession даёт исходный payload', () => {
    const svc = new JwtService(makeCfg({}));
    const token = svc.signSession({ sub: 'u_1', email: 'a@b.c', role: 'user' });
    const verified = svc.verifySession(token);
    expect(verified.sub).toBe('u_1');
    expect(verified.email).toBe('a@b.c');
    expect(verified.role).toBe('user');
    expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('round-trip: signDeepLink → verifyDeepLink даёт исходный payload', () => {
    const svc = new JwtService(makeCfg({}));
    const token = svc.signDeepLink({ sub: 'u_2', meetingId: 'm_xyz' });
    const verified = svc.verifyDeepLink(token);
    expect(verified.sub).toBe('u_2');
    expect(verified.meetingId).toBe('m_xyz');
    expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('просроченный session-токен — throws', () => {
    // Нулевой TTL → токен сразу expired.
    const svc = new JwtService(makeCfg({ sessionTtlSeconds: -10 }));
    const token = svc.signSession({ sub: 'u_1', email: 'a@b.c', role: 'user' });
    expect(() => svc.verifySession(token)).toThrow();
  });

  it('просроченный deep-link токен — throws', () => {
    const svc = new JwtService(makeCfg({ deepLinkTtlSeconds: -10 }));
    const token = svc.signDeepLink({ sub: 'u_1', meetingId: 'm_xyz' });
    expect(() => svc.verifyDeepLink(token)).toThrow();
  });

  it('session-токен, подписанный другим секретом — throws', () => {
    const issuer = new JwtService(makeCfg({ sessionSecret: 'A'.repeat(64) }));
    const verifier = new JwtService(makeCfg({ sessionSecret: 'B'.repeat(64) }));
    const token = issuer.signSession({ sub: 'u_1', email: 'a@b.c', role: 'user' });
    expect(() => verifier.verifySession(token)).toThrow();
  });

  it('deep-link токен не валидируется как session (разные секреты)', () => {
    const svc = new JwtService(makeCfg({}));
    const dl = svc.signDeepLink({ sub: 'u_1', meetingId: 'm_xyz' });
    expect(() => svc.verifySession(dl)).toThrow();
  });

  it('admin-роль сохраняется в payload', () => {
    const svc = new JwtService(makeCfg({}));
    const token = svc.signSession({ sub: 'u_1', email: 'a@b.c', role: 'admin' });
    expect(svc.verifySession(token).role).toBe('admin');
  });
});
