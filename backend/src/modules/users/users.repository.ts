import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Тонкая обёртка над Prisma для модели `User`.
 *
 * Здесь нет бизнес-логики — только запросы к БД. Все транзакции и решения
 * («создавать или обновлять?», «что обновлять?») принимаются в `UsersService`.
 *
 * Для работы внутри транзакции каждый метод принимает опциональный
 * `tx: Prisma.TransactionClient`. Если не передан — используется корневой
 * `PrismaService`.
 */
@Injectable()
export class UsersRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  findByExternalId(
    externalId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<User | null> {
    const client = tx ?? this.prisma;
    return client.user.findUnique({ where: { externalId } });
  }

  findById(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<User | null> {
    const client = tx ?? this.prisma;
    return client.user.findUnique({ where: { id: userId } });
  }

  create(
    data: {
      externalId: string;
      email: string;
      name: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.create({
      data: {
        externalId: data.externalId,
        email: data.email,
        name: data.name,
      },
    });
  }

  update(
    userId: string,
    data: { email?: string; name?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<User> {
    const client = tx ?? this.prisma;
    return client.user.update({
      where: { id: userId },
      data,
    });
  }

  touchLastSeen(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });
  }
}
