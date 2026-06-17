import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type RoleProfileStatus } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import type {
  RoleProfileBuildStatusDto,
  RoleProfileDetailDto,
  RoleProfileListItemDto,
  RoleProfileRebuildResponseDto,
} from '../dto/role-profiles.dto';

const DEFAULT_MIN_BLOCKS = 5;

function readMinBlocks(): number {
  const raw = process.env.ROLE_PROFILE_MIN_BLOCKS;
  if (!raw) return DEFAULT_MIN_BLOCKS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_BLOCKS;
}

@Injectable()
export class RoleProfilesService {
  private readonly logger = new Logger(RoleProfilesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  async list(args: {
    tenantId: string;
    status: 'forming' | 'ready' | 'stale' | 'error' | 'all';
    limit: number;
  }): Promise<{ items: RoleProfileListItemDto[]; total: number }> {
    const where: Prisma.RoleProfileWhereInput = {
      tenantId: args.tenantId,
      ...(args.status === 'all' ? {} : { status: args.status as RoleProfileStatus }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.roleProfile.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: args.limit,
        include: {
          role: {
            select: {
              id: true,
              name: true,
              departmentId: true,
              department: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.roleProfile.count({ where }),
    ]);
    return {
      items: rows.map((rp) => this.toListItem(rp)),
      total,
    };
  }

  async getByRoleId(args: { tenantId: string; roleId: string }): Promise<RoleProfileDetailDto> {
    const rp = await this.prisma.roleProfile.findUnique({
      where: { roleId: args.roleId },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            tenantId: true,
            departmentId: true,
            department: { select: { name: true } },
          },
        },
      },
    });
    if (!rp || rp.tenantId !== args.tenantId || rp.role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'role_profile_not_found',
          message: 'Карта должности не найдена',
        },
      });
    }
    const currentBlocks = await this.prisma.ideaBlock.count({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        roleRelevant: true,
      },
    });
    return {
      ...this.toListItem(rp),
      summary: rp.summaryCache,
      minBlocks: readMinBlocks(),
      currentBlocks,
    };
  }

  async rebuild(args: {
    tenantId: string;
    userId: string;
    roleId: string;
  }): Promise<RoleProfileRebuildResponseDto> {
    const rp = await this.prisma.roleProfile.findUnique({
      where: { roleId: args.roleId },
      select: { tenantId: true, buildVersion: true },
    });
    if (!rp || rp.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'role_profile_not_found',
          message: 'Карта должности не найдена',
        },
      });
    }

    const existing = await this.coreQueue.findActiveRoleProfileJob(args.roleId);
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'rebuild_in_progress',
          message: 'Карта уже собирается',
        },
        status: existing.status,
        since: existing.since,
      });
    }

    const { jobId } = await this.coreQueue.enqueueRoleProfile({
      tenantId: args.tenantId,
      roleId: args.roleId,
      buildVersion: rp.buildVersion,
      triggerReason: 'on-demand',
      triggeredByUserId: args.userId,
    });

    this.logger.log(
      { tenantId: args.tenantId, roleId: args.roleId, userId: args.userId, jobId },
      'role-profile.rebuild: enqueued on-demand build',
    );
    return {
      status: 'queued',
      jobId,
    };
  }

  async buildStatus(args: {
    tenantId: string;
    roleId: string;
  }): Promise<RoleProfileBuildStatusDto> {
    const rp = await this.prisma.roleProfile.findUnique({
      where: { roleId: args.roleId },
      select: { tenantId: true, status: true, lastBuildAt: true },
    });
    if (!rp || rp.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'role_profile_not_found',
          message: 'Карта должности не найдена',
        },
      });
    }

    const active = await this.coreQueue.findActiveRoleProfileJob(args.roleId);
    if (active) {
      return {
        status: active.status,
        since: active.since,
        ...(rp.lastBuildAt ? { lastBuildAt: rp.lastBuildAt.toISOString() } : {}),
      };
    }

    return {
      status: 'idle',
      ...(rp.lastBuildAt ? { lastBuildAt: rp.lastBuildAt.toISOString() } : {}),
    };
  }

  private toListItem(rp: {
    id: string;
    roleId: string;
    status: RoleProfileStatus;
    buildVersion: number;
    lastBuildAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    role: {
      id: string;
      name: string;
      departmentId: string | null;
      department: { name: string } | null;
    };
  }): RoleProfileListItemDto {
    return {
      id: rp.id,
      roleId: rp.roleId,
      roleName: rp.role.name,
      departmentId: rp.role.departmentId,
      departmentName: rp.role.department?.name ?? null,
      status: rp.status,
      buildVersion: rp.buildVersion,
      lastBuildAt: rp.lastBuildAt ? rp.lastBuildAt.toISOString() : null,
      createdAt: rp.createdAt.toISOString(),
      updatedAt: rp.updatedAt.toISOString(),
    };
  }
}
