import { Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PasswordService } from '../../accounts/password.service';

import { JwtService } from './jwt.service';

const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpams$dGVzdHRlc3R0ZXN0dGVzdA';

@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  async login(email: string, password: string): Promise<{ user: User; sessionToken: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new NotAuthorizedError('admin_login_invalid');
    }

    const candidates = await this.prisma.user.findMany({
      where: {
        role: 'admin',
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      take: 2,
    });
    const user = candidates[0];
    if (!user || !user.passwordHash) {
      await this.passwords.verify(DUMMY_ARGON2_HASH, password);
      throw new NotAuthorizedError('admin_login_invalid');
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      this.logger.warn({ userId: user.id }, 'admin login: bad password');
      throw new NotAuthorizedError('admin_login_invalid');
    }

    if (this.passwords.needsRehash(user.passwordHash)) {
      try {
        const rehashed = await this.passwords.hash(password);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: rehashed },
        });
      } catch (err) {
        this.logger.warn({ userId: user.id, err }, 'admin login: lazy rehash failed');
      }
    }

    const sessionToken = this.jwt.signSession({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    this.logger.log({ userId: user.id }, 'admin login: success');

    return { user, sessionToken };
  }
}
