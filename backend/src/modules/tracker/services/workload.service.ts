import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { WorkloadResponseDto, WorkloadRowDto } from '../dto/overview/workload-response.dto';

import { ProjectsService } from './projects.service';

@Injectable()
export class WorkloadService {
  private readonly logger = new Logger(WorkloadService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  async getWorkload(args: { projectId: string; tenantId: string }): Promise<WorkloadResponseDto> {
    await this.projects.requireProject(args.projectId, args.tenantId);

    const members = await this.prisma.projectMember.findMany({
      where: { projectId: args.projectId },
      orderBy: { joinedAt: 'asc' },
    });
    if (members.length === 0) {
      return { items: [], avgOpenPerMember: 0 };
    }
    const userIds = members.map((m) => m.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const assignees = await this.prisma.issueAssignee.findMany({
      where: {
        userId: { in: userIds },
        issue: {
          tenantId: args.tenantId,
          projectId: args.projectId,
          deletedAt: null,
        },
      },
      select: {
        userId: true,
        issue: {
          select: {
            id: true,
            dueDate: true,
            completedAt: true,
            state: { select: { category: true } },
          },
        },
      },
    });

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const acc = new Map<
      string,
      {
        open: number;
        inProgress: number;
        overdue: number;
        completed7: number;
      }
    >();
    for (const uid of userIds) {
      acc.set(uid, { open: 0, inProgress: 0, overdue: 0, completed7: 0 });
    }

    for (const a of assignees) {
      const slot = acc.get(a.userId);
      if (!slot) continue;
      const cat = a.issue.state?.category ?? 'backlog';
      const isCompletedOrCancelled = cat === 'completed' || cat === 'cancelled';

      if (!isCompletedOrCancelled) {
        slot.open += 1;
        if (cat === 'started') slot.inProgress += 1;
        if (a.issue.dueDate && a.issue.dueDate < now) slot.overdue += 1;
      }

      if (cat === 'completed' && a.issue.completedAt && a.issue.completedAt >= sevenDaysAgo) {
        slot.completed7 += 1;
      }
    }

    const items: WorkloadRowDto[] = members.map((m) => {
      const u = userById.get(m.userId);
      const slot = acc.get(m.userId) ?? {
        open: 0,
        inProgress: 0,
        overdue: 0,
        completed7: 0,
      };
      return {
        userId: m.userId,
        userName: u?.name ?? null,
        userEmail: u?.email ?? null,
        openCount: slot.open,
        inProgressCount: slot.inProgress,
        overdueCount: slot.overdue,
        completedLast7dCount: slot.completed7,
      };
    });

    const totalOpen = items.reduce((s, r) => s + r.openCount, 0);
    const avgOpenPerMember = items.length ? Math.round((totalOpen / items.length) * 10) / 10 : 0;

    return { items, avgOpenPerMember };
  }
}
