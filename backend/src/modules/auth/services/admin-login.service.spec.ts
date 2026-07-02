import bcrypt from 'bcrypt';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { PasswordService } from '../../accounts/password.service';

import { AdminLoginService } from './admin-login.service';
import type { JwtService } from './jwt.service';

function makePasswords(): PasswordService {
  return new PasswordService({
    argon: { memoryKb: 1024, iterations: 2, parallelism: 1 },
  } as unknown as TypedConfigService);
}

function makePrisma(usersByEmail: Array<{
  id: string;
  role: string;
  email: string;
  passwordHash: string | null;
}>): PrismaService {
  return {
    user: {
      findMany: vi.fn(async (args: { where?: { role?: string; email?: { equals?: string; mode?: string } } }) => {
        const wantRole = args.where?.role;
        const wantEmail = args.where?.email?.equals?.toLowerCase();
        return usersByEmail.filter(
          (u) =>
            (!wantRole || u.role === wantRole) &&
            (!wantEmail || u.email.toLowerCase() === wantEmail),
        );
      }),
      update: vi.fn(async () => ({})),
    },
  } as unknown as PrismaService;
}

function makeJwt(): JwtService {
  return {
    signSession: vi.fn(() => 'session-jwt-token'),
  } as unknown as JwtService;
}

describe('AdminLoginService.login', () => {
  it('успех: правильный email/пароль → возвращает user + sessionToken', async () => {
    const passwordHash = await bcrypt.hash('correct-pw', 4);
    const prisma = makePrisma([
      {
        id: 'u-admin',
        role: 'admin',
        email: 'admin@z.app',
        passwordHash,
      },
    ]);
    const jwt = makeJwt();
    const svc = new AdminLoginService(prisma, jwt, makePasswords());

    const result = await svc.login('admin@z.app', 'correct-pw');
    expect(result.user.id).toBe('u-admin');
    expect(result.sessionToken).toBe('session-jwt-token');
    expect(jwt.signSession).toHaveBeenCalledWith({
      sub: 'u-admin',
      email: 'admin@z.app',
      role: 'admin',
    });
  });

  it('неправильный пароль → NotAuthorizedError', async () => {
    const passwordHash = await bcrypt.hash('correct-pw', 4);
    const prisma = makePrisma([
      {
        id: 'u-admin',
        role: 'admin',
        email: 'admin@z.app',
        passwordHash,
      },
    ]);
    const svc = new AdminLoginService(prisma, makeJwt(), makePasswords());

    await expect(svc.login('admin@z.app', 'wrong-pw')).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it('не-админ с правильным паролем → NotAuthorizedError', async () => {
    const prisma = makePrisma([
      {
        id: 'u-1',
        role: 'user',
        email: 'admin@z.app',
        passwordHash: await bcrypt.hash('correct-pw', 4),
      },
    ]);
    const svc = new AdminLoginService(prisma, makeJwt(), makePasswords());

    await expect(svc.login('admin@z.app', 'correct-pw')).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it('email с разным регистром — нормализуется', async () => {
    const passwordHash = await bcrypt.hash('correct-pw', 4);
    const prisma = makePrisma([
      {
        id: 'u-admin',
        role: 'admin',
        email: 'Admin@Z.app',
        passwordHash,
      },
    ]);
    const svc = new AdminLoginService(prisma, makeJwt(), makePasswords());

    const result = await svc.login('ADMIN@z.app', 'correct-pw');
    expect(result.user.id).toBe('u-admin');
  });

  it('админ без passwordHash → NotAuthorizedError', async () => {
    const prisma = makePrisma([
      {
        id: 'u-admin',
        role: 'admin',
        email: 'admin@z.app',
        passwordHash: null,
      },
    ]);
    const svc = new AdminLoginService(prisma, makeJwt(), makePasswords());

    await expect(svc.login('admin@z.app', 'any-pw')).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );
  });

  it('пустой пароль/email → NotAuthorizedError', async () => {
    const svc = new AdminLoginService(makePrisma([]), makeJwt(), makePasswords());
    await expect(svc.login('', 'pw')).rejects.toBeInstanceOf(NotAuthorizedError);
    await expect(svc.login('a@b.c', '')).rejects.toBeInstanceOf(NotAuthorizedError);
  });
});
