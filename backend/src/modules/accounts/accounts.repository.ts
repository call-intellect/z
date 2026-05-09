import { Inject, Injectable } from '@nestjs/common';
import type {
  Prisma,
  User,
  UserVerificationToken,
  VerificationPurpose,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Тонкая обёртка над Prisma для standalone-таблиц (User-standalone, UserSession,
 * UserVerificationToken). Бизнес-логика — в `AccountsService`.
 */
@Injectable()
export class AccountsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Найти standalone-аккаунт по email. Учитывает `signupSource='standalone'`,
   * чтобы не путать с Crossmark-аккаунтом того же email (они уникальны
   * по `(email, signupSource)`).
   *
   * Email нормализуется снаружи — здесь точное равенство.
   */
  findStandaloneByEmail(
    email: string,
    tx?: Prisma.TransactionClient,
  ): Promise<User | null> {
    const client = tx ?? this.prisma;
    return client.user.findUnique({
      where: {
        email_signupSource: {
          email,
          signupSource: 'standalone',
        },
      },
    });
  }

  /**
   * Найти любой аккаунт по email (case-insensitive), независимо от signupSource.
   * Используется в логине, чтобы вернуть правильный код ошибки если на email
   * только админ-аккаунт.
   */
  findAnyByEmailCaseInsensitive(email: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
      },
      take: 5,
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * upsert по `(email, signupSource='standalone')`. Если standalone-юзер
   * с таким email уже есть — возвращает его (с обновлёнными name/passwordHash).
   * Если нет — создаёт нового.
   */
  async upsertStandalone(
    input: {
      email: string;
      name: string;
      passwordHash: string;
      mustChangePassword: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.upsert({
      where: {
        email_signupSource: {
          email: input.email,
          signupSource: 'standalone',
        },
      },
      create: {
        email: input.email,
        name: input.name,
        signupSource: 'standalone',
        passwordHash: input.passwordHash,
        mustChangePassword: input.mustChangePassword,
        role: 'user',
      },
      update: {
        name: input.name,
        passwordHash: input.passwordHash,
        mustChangePassword: input.mustChangePassword,
      },
    });
  }

  updatePassword(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword,
      },
    });
  }

  updateName(userId: string, name: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });
  }

  // ─────────────── verification tokens ────────────────

  createVerificationToken(
    input: {
      userId: string;
      tokenHash: string;
      purpose: VerificationPurpose;
      expiresAt: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<UserVerificationToken> {
    const client = tx ?? this.prisma;
    return client.userVerificationToken.create({
      data: input,
    });
  }

  findVerificationToken(
    tokenHash: string,
    purpose: VerificationPurpose,
  ): Promise<UserVerificationToken | null> {
    return this.prisma.userVerificationToken.findFirst({
      where: { tokenHash, purpose },
    });
  }

  markVerificationTokenUsed(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserVerificationToken> {
    const client = tx ?? this.prisma;
    return client.userVerificationToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }
}
