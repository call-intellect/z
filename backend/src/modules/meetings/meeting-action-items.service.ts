import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

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
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listForMeeting(args: {
    meetingId: string;
    tenantId: string;
    userId?: string;
  }): Promise<MeetingActionItem[]> {
    return this.listIssuesForMeeting(args);
  }

  async searchTitlesForUser(args: {
    tenantId: string;
    userId: string;
    query: string;
    limit: number;
  }): Promise<MeetingActionItemSearchRow[]> {
    return this.searchMeetingIssues(args);
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
