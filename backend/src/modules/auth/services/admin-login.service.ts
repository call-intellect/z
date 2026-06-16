import { Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import bcrypt from 'bcrypt';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { JwtService } from './jwt.service';

@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
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
      await bcrypt.compare(
        password,
        '$2b$12$CwTycUXWue0Thq9StjUM0uJ8.0p/ENjJC7G29Z4Gwl8aQYj9b3Hxe',
      );
      throw new NotAuthorizedError('admin_login_invalid');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      this.logger.warn({ userId: user.id }, 'admin login: bad password');
      throw new NotAuthorizedError('admin_login_invalid');
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
