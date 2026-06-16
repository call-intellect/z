import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, User, UserVerificationToken, VerificationPurpose } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class AccountsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findStandaloneByEmail(email: string, tx?: Prisma.TransactionClient): Promise<User | null> {
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

  findVerificationTokenByHash(tokenHash: string): Promise<UserVerificationToken | null> {
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
