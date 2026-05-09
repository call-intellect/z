import { Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import bcrypt from 'bcrypt';

import { NotAuthorizedError } from '../../../common/errors/domain-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { JwtService } from './jwt.service';

/**
 * Локальный логин админа по email/password (Phase 8.4).
 *
 * Поток:
 *   1. Найти `User` с `role='admin'` по нормализованному email.
 *   2. Проверить bcrypt.compare(password, user.passwordHash).
 *   3. На успехе — выдать session JWT через `JwtService.signSession`.
 *
 * Ошибки — единый `NotAuthorizedError('admin_login_invalid')` (одинаковый
 * текст для «нет такого юзера» и «неверный пароль» — защита от user-enumeration).
 */
@Injectable()
export class AdminLoginService {
  private readonly logger = new Logger(AdminLoginService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; sessionToken: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new NotAuthorizedError('admin_login_invalid');
    }

    // findFirst c case-insensitive поиском.
    const candidates = await this.prisma.user.findMany({
      where: {
        role: 'admin',
        email: { equals: normalizedEmail, mode: 'insensitive' },
      },
      take: 2,
    });
    const user = candidates[0];
    if (!user || !user.passwordHash) {
      // Тратим время на bcrypt.compare с фейковым хешем чтобы не светить timing.
      await bcrypt.compare(password, '$2b$12$CwTycUXWue0Thq9StjUM0uJ8.0p/ENjJC7G29Z4Gwl8aQYj9b3Hxe');
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
