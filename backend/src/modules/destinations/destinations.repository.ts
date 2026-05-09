import { Inject, Injectable } from '@nestjs/common';
import type { DestinationType, IntegrationDestination, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DestinationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  countByUser(userId: string): Promise<number> {
    return this.prisma.integrationDestination.count({ where: { userId } });
  }

  listByUser(userId: string): Promise<IntegrationDestination[]> {
    return this.prisma.integrationDestination.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<IntegrationDestination | null> {
    return this.prisma.integrationDestination.findUnique({ where: { id } });
  }

  create(input: {
    userId: string;
    type: DestinationType;
    name: string;
    config: Prisma.InputJsonValue;
  }): Promise<IntegrationDestination> {
    return this.prisma.integrationDestination.create({
      data: {
        userId: input.userId,
        type: input.type,
        name: input.name,
        config: input.config,
      },
    });
  }

  update(
    id: string,
    data: { name?: string; config?: Prisma.InputJsonValue },
  ): Promise<IntegrationDestination> {
    return this.prisma.integrationDestination.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.config !== undefined ? { config: data.config } : {}),
      },
    });
  }

  delete(id: string): Promise<IntegrationDestination> {
    return this.prisma.integrationDestination.delete({ where: { id } });
  }
}
