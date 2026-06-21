import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type IssueWorklog } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateWorklogDto } from '../dto/worklogs/create-worklog.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';

export interface WorklogResponseDto {
  id: string;
  issueId: string;
  userId: string;
  minutes: number;
  description: string | null;
  startedAt: string;
  createdAt: string;
}

export interface WorklogListResponseDto {
  items: WorklogResponseDto[];
  totalMinutes: number;
}

@Injectable()
export class WorklogsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(IssuesService) private readonly issues: IssuesService,
  ) {}

  async listByIssue(
    issueId: string,
    tenantId: string,
  ): Promise<WorklogListResponseDto> {
    await this.requireTimeTrackingEnabled(issueId, tenantId);
    const rows = await this.prisma.issueWorklog.findMany({
      where: { issueId, tenantId },
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const totalMinutes = rows.reduce((sum, r) => sum + r.minutes, 0);
    return { items: rows.map((r) => this.toResponse(r)), totalMinutes };
  }

  async create(
    issueId: string,
    dto: CreateWorklogDto,
    tenantId: string,
    userId: string,
  ): Promise<WorklogResponseDto> {
    await this.requireTimeTrackingEnabled(issueId, tenantId);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.issueWorklog.create({
        data: {
          tenantId,
          issueId,
          userId,
          minutes: dto.minutes,
          description: dto.description ?? null,
          startedAt: new Date(dto.startedAt),
        },
      });
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'time_logged',
        metadata: {
          worklogId: row.id,
          minutes: row.minutes,
          startedAt: row.startedAt.toISOString(),
        },
        tx,
      });
      return row;
    });
    return this.toResponse(created);
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<{ ok: true }> {
    const existing = await this.requireWorklog(id, tenantId);
    await this.requireTimeTrackingEnabled(existing.issueId, tenantId);
    if (existing.userId !== userId && !isAdmin) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Удалить запись может только автор или администратор',
        },
      });
    }
    await this.prisma.issueWorklog.delete({ where: { id } });
    return { ok: true };
  }

  private async requireTimeTrackingEnabled(
    issueId: string,
    tenantId: string,
  ): Promise<void> {
    const issue = await this.issues.requireIssue(issueId, tenantId);
    const project = await this.prisma.project.findUnique({
      where: { id: issue.projectId },
      select: { timeTrackingEnabled: true },
    });
    if (!project?.timeTrackingEnabled) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'time_tracking_disabled',
          message: 'Учёт времени для проекта выключен',
        },
      });
    }
  }

  private async requireWorklog(
    id: string,
    tenantId: string,
  ): Promise<IssueWorklog> {
    const row = await this.prisma.issueWorklog.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'worklog_not_found',
          message: 'Запись учёта времени не найдена',
        },
      });
    }
    return row;
  }

  private toResponse(r: IssueWorklog): WorklogResponseDto {
    return {
      id: r.id,
      issueId: r.issueId,
      userId: r.userId,
      minutes: r.minutes,
      description: r.description,
      startedAt: r.startedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
