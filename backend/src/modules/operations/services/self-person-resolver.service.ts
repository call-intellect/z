import { ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class SelfPersonResolverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveSelfPerson(args: { tenantId: string; userId: string }): Promise<{ id: string }> {
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!person) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'no_person',
          message: 'У пользователя нет Person-записи в этой Org — персональные данные недоступны',
        },
      });
    }
    return person;
  }
}
