import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';

import { SessionService } from './session.service';

describe('SessionService', () => {
  let prisma: {
    userSession: {
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let jwt: { signSession: ReturnType<typeof vi.fn> };
  let cfg: TypedConfigService;

  beforeEach(() => {
    prisma = {
      userSession: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
          id: 's1',
          ...args.data,
        })),
        updateMany: vi.fn(async () => ({ count: 3 })),
        findUnique: vi.fn(),
      },
    };
    jwt = { signSession: vi.fn(() => 'jwt-token') };
    cfg = {
      auth: { sessionTtlSeconds: 3600 },
    } as unknown as TypedConfigService;
  });

  function make(): SessionService {
    return new SessionService(prisma as unknown as PrismaService, jwt as unknown as JwtService, cfg);
  }

  it('issue: создаёт UserSession с jti и подписывает JWT с тем же jti', async () => {
    const svc = make();
    const result = await svc.issue({
      userId: 'u1',
      email: 'a@b.c',
      role: 'user',
      userAgent: 'UA',
      ip: '1.2.3.4',
    });

    expect(prisma.userSession.create).toHaveBeenCalled();
    const created = prisma.userSession.create.mock.calls[0]?.[0] as { data: { jti: string } };
    expect(typeof created.data.jti).toBe('string');
    expect(created.data.jti.length).toBeGreaterThan(8);

    expect(jwt.signSession).toHaveBeenCalledWith({
      sub: 'u1',
      email: 'a@b.c',
      role: 'user',
      jti: created.data.jti,
    });
    expect(result.token).toBe('jwt-token');
  });

  it('revokeByJti: помечает revokedAt', async () => {
    const svc = make();
    await svc.revokeByJti('jti-xyz');
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { jti: 'jti-xyz', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokeAll: отзывает все активные', async () => {
    const svc = make();
    const count = await svc.revokeAll('u1');
    expect(count).toBe(3);
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokeAllExcept: отзывает все, кроме указанного jti', async () => {
    const svc = make();
    await svc.revokeAllExcept('u1', 'keep-jti');
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null, NOT: { jti: 'keep-jti' } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('findActiveByJti: возвращает null если revoked / expired / отсутствует', async () => {
    const svc = make();

    prisma.userSession.findUnique.mockResolvedValueOnce(null);
    expect(await svc.findActiveByJti('x')).toBeNull();

    prisma.userSession.findUnique.mockResolvedValueOnce({
      id: 's1',
      jti: 'x',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 100_000),
    });
    expect(await svc.findActiveByJti('x')).toBeNull();

    prisma.userSession.findUnique.mockResolvedValueOnce({
      id: 's1',
      jti: 'x',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await svc.findActiveByJti('x')).toBeNull();

    const ok = {
      id: 's1',
      jti: 'x',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    prisma.userSession.findUnique.mockResolvedValueOnce(ok);
    expect(await svc.findActiveByJti('x')).toEqual(ok);
  });
});
