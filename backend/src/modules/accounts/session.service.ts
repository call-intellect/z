import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, UserSession } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async issue(input: {
    userId: string;
    email: string;
    role: 'user' | 'admin';
    userAgent?: string | null;
    ip?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<{ session: UserSession; token: string }> {
    const jti = nanoid(32);
    const expiresAt = new Date(Date.now() + this.cfg.auth.sessionTtlSeconds * 1000);
    const client = input.tx ?? this.prisma;

    const session = await client.userSession.create({
      data: {
        userId: input.userId,
        jti,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
        expiresAt,
      },
    });

    const token = this.jwt.signSession({
      sub: input.userId,
      email: input.email,
      role: input.role,
      jti,
    });

    return { session, token };
  }

  async revokeByJti(jti: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeAllExcept(userId: string, keepJti: string): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null, NOT: { jti: keepJti } },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async findActiveByJti(jti: string): Promise<UserSession | null> {
    const session = await this.prisma.userSession.findUnique({ where: { jti } });
    if (!session) return null;
    if (session.revokedAt !== null) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  }
}
