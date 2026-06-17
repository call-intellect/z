import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsersRepository) private readonly users: UsersRepository,
  ) {}

  async upsertFromCrossmark(input: {
    externalId: string;
    email: string;
    name: string;
  }): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await this.users.findByExternalId(input.externalId, tx);

      if (!existing) {
        const created = await this.users.create(
          {
            externalId: input.externalId,
            email: input.email,
            name: input.name,
          },
          tx,
        );
        this.logger.log(
          `Создан новый пользователь по Crossmark: id=${created.id}, externalId=${input.externalId}`,
        );
        return created;
      }

      const patch: Prisma.UserUpdateInput = {};
      if (existing.email !== input.email) patch.email = input.email;
      if (existing.name !== input.name) patch.name = input.name;

      if (Object.keys(patch).length === 0) {
        return existing;
      }

      return tx.user.update({
        where: { id: existing.id },
        data: patch,
      });
    });
  }

  async touchLastSeen(userId: string): Promise<void> {
    await this.users.touchLastSeen(userId);
  }

  findById(userId: string): Promise<User | null> {
    return this.users.findById(userId);
  }
}
