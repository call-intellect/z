import { Inject, Injectable } from '@nestjs/common';
import { type Prisma, type UserTemplate } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TemplatesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listByUser(userId: string): Promise<UserTemplate[]> {
    return this.prisma.userTemplate.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findById(id: string): Promise<UserTemplate | null> {
    return this.prisma.userTemplate.findUnique({ where: { id } });
  }

  countByUser(userId: string): Promise<number> {
    return this.prisma.userTemplate.count({ where: { userId } });
  }

  create(data: Prisma.UserTemplateUncheckedCreateInput): Promise<UserTemplate> {
    return this.prisma.userTemplate.create({ data });
  }

  update(id: string, data: Prisma.UserTemplateUpdateInput): Promise<UserTemplate> {
    return this.prisma.userTemplate.update({ where: { id }, data });
  }

  delete(id: string): Promise<UserTemplate> {
    return this.prisma.userTemplate.delete({ where: { id } });
  }
}
