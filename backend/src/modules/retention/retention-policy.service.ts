import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OrgRetentionPolicy } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class RetentionPolicyService {
  private readonly logger = new Logger(RetentionPolicyService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getOrInit(tenantId: string): Promise<OrgRetentionPolicy> {
    const existing = await this.prisma.orgRetentionPolicy.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;

    try {
      const created = await this.prisma.orgRetentionPolicy.create({
        data: { tenantId },
      });
      this.logger.log({ tenantId }, 'OrgRetentionPolicy: lazy-init с дефолтами');
      return created;
    } catch (err) {
      const second = await this.prisma.orgRetentionPolicy.findUnique({
        where: { tenantId },
      });
      if (second) return second;
      throw err;
    }
  }

  async update(
    tenantId: string,
    patch: {
      rawEventDays?: number;
      archivedBlockDays?: number;
      chatMessageDays?: number;
      auditLogDays?: number;
      archivedBlockAction?: string;
    },
  ): Promise<OrgRetentionPolicy> {
    await this.getOrInit(tenantId);
    return this.prisma.orgRetentionPolicy.update({
      where: { tenantId },
      data: patch,
    });
  }

  async markSwept(tenantId: string): Promise<void> {
    await this.prisma.orgRetentionPolicy.update({
      where: { tenantId },
      data: { lastSweepAt: new Date() },
    });
  }
}
