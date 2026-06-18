import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';

const FLAG_KEY = 'knowledge.meetingTasksToTrackerOnly';

export interface MeetingActionItem {
  id: string;
  meetingId: string | null;
  title: string;
  description: string | null;
  status: string;
  assigneeRaw: string | null;
  assigneeUserId: string | null;
  dueDate: Date | null;
  sourceQuote: string | null;
  confidence: number | null;
  extractorVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingActionItemSearchRow {
  id: string;
  title: string;
  status: string;
  meetingId: string | null;
}

function issueCategoryToStatus(category: string | null | undefined): string {
  switch (category) {
    case 'started':
      return 'in_progress';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    case 'backlog':
    case 'unstarted':
    default:
      return 'open';
  }
}

@Injectable()
export class MeetingActionItemsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  private async trackerOnly(): Promise<boolean> {
    return this.cfg.getDynamic<boolean>(FLAG_KEY, undefined, false);
  }

  async isTrackerOnly(): Promise<boolean> {
    return this.trackerOnly();
  }

  async listForMeeting(args: {
    meetingId: string;
    tenantId: string;
    userId?: string;
  }): Promise<MeetingActionItem[]> {
    if (await this.trackerOnly()) {
      return this.listIssuesForMeeting(args);
    }
    return this.listTasksForMeeting(args);
  }

  async searchTitlesForUser(args: {
    tenantId: string;
    userId: string;
    query: string;
    limit: number;
  }): Promise<MeetingActionItemSearchRow[]> {
    if (await this.trackerOnly()) {
      return this.searchMeetingIssues(args);
    }
    return this.searchTasks(args);
  }

  private async listTasksForMeeting(args: {
    meetingId: string;
    tenantId: string;
    userId?: string;
  }): Promise<MeetingActionItem[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        meetingId: args.meetingId,
        ...(args.tenantId ? { tenantId: args.tenantId } : {}),
        ...(args.userId ? { userId: args.userId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((t) => ({
      id: t.id,
      meetingId: t.meetingId,
      title: t.title,
      description: t.description ?? null,
      status: t.status,
      assigneeRaw: t.assigneeRaw ?? null,
      assigneeUserId: t.assigneeUserId ?? null,
      dueDate: t.dueDate ?? null,
      sourceQuote: t.sourceQuote ?? null,
      confidence: t.confidence ?? null,
      extractorVersion: t.extractorVersion ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  private async searchTasks(args: {
    userId: string;
    query: string;
    limit: number;
  }): Promise<MeetingActionItemSearchRow[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        userId: args.userId,
        title: { contains: args.query, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      select: { id: true, title: true, status: true, meetingId: true },
    });
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      meetingId: t.meetingId,
    }));
  }

  private async listIssuesForMeeting(args: {
    meetingId: string;
    tenantId: string;
    userId?: string;
  }): Promise<MeetingActionItem[]> {
    const where: Prisma.IssueWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
      linkedMeetingIds: { has: args.meetingId },
      ...(args.userId
        ? {
            OR: [{ createdById: args.userId }, { assignees: { some: { userId: args.userId } } }],
          }
        : {}),
    };
    const rows = await this.prisma.issue.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        state: { select: { category: true } },
        assignees: {
          select: { userId: true },
          orderBy: { assignedAt: 'asc' },
          take: 1,
        },
      },
    });
    return rows.map((issue) => ({
      id: issue.id,
      meetingId: args.meetingId,
      title: issue.title,
      description: issue.descriptionStripped ?? null,
      status: issueCategoryToStatus(issue.state?.category),
      assigneeRaw: null,
      assigneeUserId: issue.assignees[0]?.userId ?? null,
      dueDate: issue.dueDate ?? null,
      sourceQuote: null,
      confidence: issue.confidence !== null ? Number(issue.confidence) : null,
      extractorVersion: issue.externalSource,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }));
  }

  private async searchMeetingIssues(args: {
    tenantId: string;
    userId: string;
    query: string;
    limit: number;
  }): Promise<MeetingActionItemSearchRow[]> {
    const rows = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        externalSource: 'meeting',
        title: { contains: args.query, mode: 'insensitive' },
        OR: [{ createdById: args.userId }, { assignees: { some: { userId: args.userId } } }],
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      select: {
        id: true,
        title: true,
        linkedMeetingIds: true,
        state: { select: { category: true } },
      },
    });
    return rows.map((issue) => ({
      id: issue.id,
      title: issue.title,
      status: issueCategoryToStatus(issue.state?.category),
      meetingId: issue.linkedMeetingIds[0] ?? '',
    }));
  }
}
