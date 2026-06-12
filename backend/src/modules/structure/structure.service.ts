import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface StructureSummaryDto {
  departments: number;
  roles: number;
  persons: number;
  documents: number;
  roleProfiles: {
    total: number;
    // #85 — ключ статуса RoleProfile = 'forming' (как в БД и на фронте);
    // раньше DTO отдавал 'building' → фронт читал undefined → «undefined формируется».
    forming: number;
    ready: number;
    stale: number;
    error: number;
  };
}

/**
 * Сервис агрегатных счётчиков структуры компании.
 *
 * Все запросы tenant-scoped, считают только активные (deletedAt IS NULL)
 * записи там, где soft-delete поддерживается.
 */
@Injectable()
export class StructureService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async summary(tenantId: string): Promise<StructureSummaryDto> {
    const [
      departments,
      roles,
      persons,
      documents,
      roleProfilesByStatus,
      roleProfilesTotal,
    ] = await Promise.all([
      this.prisma.department.count({
        where: { tenantId, deletedAt: null },
      }),
      this.prisma.role.count({
        where: { tenantId, deletedAt: null },
      }),
      this.prisma.person.count({
        where: { tenantId, deletedAt: null },
      }),
      this.prisma.document.count({
        where: { tenantId, deletedAt: null },
      }),
      this.prisma.roleProfile.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.roleProfile.count({ where: { tenantId } }),
    ]);

    const grouped: Record<string, number> = {
      forming: 0,
      ready: 0,
      stale: 0,
      error: 0,
    };
    for (const g of roleProfilesByStatus) {
      grouped[g.status] = g._count._all;
    }

    return {
      departments,
      roles,
      persons,
      documents,
      roleProfiles: {
        total: roleProfilesTotal,
        forming: grouped.forming ?? 0,
        ready: grouped.ready ?? 0,
        stale: grouped.stale ?? 0,
        error: grouped.error ?? 0,
      },
    };
  }

  async processCount(tenantId: string): Promise<number> {
    return this.prisma.process.count({ where: { tenantId } });
  }

  async regulationCount(tenantId: string): Promise<number> {
    return this.prisma.regulation.count({ where: { tenantId } });
  }

  async policyCount(tenantId: string): Promise<number> {
    return this.prisma.policy.count({ where: { tenantId } });
  }

  async metricCount(tenantId: string): Promise<number> {
    return this.prisma.metric.count({ where: { tenantId } });
  }
}
