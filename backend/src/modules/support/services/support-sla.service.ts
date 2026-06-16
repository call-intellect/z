import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { SupportAccessService } from './support-access.service';

const DEFAULT_FIRST_RESPONSE_MINS = 60;
const DEFAULT_RESOLUTION_MINS = 480;

@Injectable()
export class SupportSlaService {
  private readonly logger = new Logger(SupportSlaService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
  ) {}

  async computeDueDates(
    vendorOrgId: string,
    createdAt: Date,
  ): Promise<{ firstResponseDueAt: Date; resolutionDueAt: Date }> {
    let firstResponseMins = DEFAULT_FIRST_RESPONSE_MINS;
    let resolutionMins = DEFAULT_RESOLUTION_MINS;
    try {
      const policy = await this.prisma.supportSlaPolicy.findUnique({
        where: { tenantId: vendorOrgId },
        select: { firstResponseMins: true, resolutionMins: true },
      });
      if (policy) {
        firstResponseMins = policy.firstResponseMins;
        resolutionMins = policy.resolutionMins;
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'computeDueDates: чтение SupportSlaPolicy упало — дефолты 60/480',
      );
    }
    const base = createdAt.getTime();
    return {
      firstResponseDueAt: new Date(base + firstResponseMins * 60_000),
      resolutionDueAt: new Date(base + resolutionMins * 60_000),
    };
  }

  async markBreaches(now: Date): Promise<number> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) return 0;

    const overdue = await this.prisma.issue.findMany({
      where: {
        tenantId: vendorOrgId,
        supportCustomerUserId: { not: null },
        slaBreachedAt: null,
        firstRespondedAt: null,
        firstResponseDueAt: { lt: now },
        deletedAt: null,
        OR: [{ stateId: null }, { state: { category: { notIn: ['completed', 'cancelled'] } } }],
      },
      select: { id: true },
    });
    if (overdue.length === 0) return 0;

    const res = await this.prisma.issue.updateMany({
      where: { id: { in: overdue.map((i) => i.id) } },
      data: { slaBreachedAt: now },
    });
    return res.count;
  }
}
