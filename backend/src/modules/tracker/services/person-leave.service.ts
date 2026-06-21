import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class PersonLeaveService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async isOnLeave(args: { tenantId: string; personId: string; date: Date }): Promise<boolean> {
    const day = PersonLeaveService.normalizeUtcDate(args.date);
    const row = await this.prisma.personLeave.findFirst({
      where: {
        tenantId: args.tenantId,
        personId: args.personId,
        fromDate: { lte: day },
        toDate: { gte: day },
      },
      select: { id: true },
    });
    return row !== null;
  }

  private static normalizeUtcDate(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
    );
  }
}
