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
   * с таким email уже есть — возвращает его (с обновлёнными полями).
   * Если нет — создаёт нового.
   */
  async upsertStandalone(
    input: {
      email: string;
      name: string;
      phone?: string;
      passwordHash: string;
      mustChangePassword: boolean;
      consentDataProcessing?: boolean;
      consentMarketing?: boolean;
      consentAcceptedAt?: Date;
      signupRef?: string;
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
        phone: input.phone,
        signupSource: 'standalone',
        passwordHash: input.passwordHash,
        mustChangePassword: input.mustChangePassword,
        consentDataProcessing: input.consentDataProcessing ?? false,
        consentMarketing: input.consentMarketing ?? false,
        consentAcceptedAt: input.consentAcceptedAt,
        signupRef: input.signupRef,
        role: 'user',
      },
      update: {
        name: input.name,
        phone: input.phone,
        passwordHash: input.passwordHash,
        mustChangePassword: input.mustChangePassword,
        consentDataProcessing: input.consentDataProcessing ?? undefined,
        consentMarketing: input.consentMarketing ?? undefined,
        consentAcceptedAt: input.consentAcceptedAt,
        signupRef: input.signupRef,
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

  /**
   * β-9 (2026-05-25) — поиск verification-токена ТОЛЬКО по hash, без purpose.
   * Используется magic-link consume (purpose='magic_link') — caller сам
   * проверяет purpose в результате, чтобы вернуть один общий error code.
   */
  findVerificationTokenByHash(
    tokenHash: string,
  ): Promise<UserVerificationToken | null> {
    return this.prisma.userVerificationToken.findUnique({
      where: { tokenHash },
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
