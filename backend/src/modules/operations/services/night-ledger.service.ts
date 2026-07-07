import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface NightLedgerDto {
  autoDrafts: Array<{ id: string; issueId: string; issueTitle: string; createdAt: string }>;
  meetingTasks: Array<{ id: string; title: string; createdAt: string }>;
  cloneAnswers: Array<{ questionPreview: string; answeredGrounded: boolean; createdAt: string }>;
  counts: { autoDrafts: number; meetingTasks: number; cloneAnswers: number };
}

@Injectable()
export class NightLedgerService {
  private static readonly WINDOW_MS = 24 * 60 * 60 * 1000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getForUser(args: {
    tenantId: string;
    userId: string;
    personId: string | null;
    now: Date;
  }): Promise<NightLedgerDto> {
    const { tenantId, userId, personId, now } = args;
    const since = new Date(now.getTime() - NightLedgerService.WINDOW_MS);

    const [drafts, intake, cloneAnswers] = await Promise.all([
      this.prisma.issueProgressUpdate.findMany({
        where: {
          tenantId,
          authorType: 'ai_agent',
          draftState: 'pending',
          issue: { assignees: { some: { userId } } },
        },
        select: {
          id: true,
          issueId: true,
          createdAt: true,
          issue: { select: { title: true, identifier: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.intakeIssue.findMany({
        where: { tenantId, source: 'meeting', suggestedAssigneeId: userId, status: 'pending' },
        select: { id: true, extractedTitle: true, rawContent: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      personId
        ? this.prisma.cloneQueryLog.findMany({
            where: {
              tenantId,
              cloneScope: 'person',
              cloneTargetId: personId,
              createdAt: { gte: since },
            },
            select: { questionPreview: true, answeredGrounded: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 20,
          })
        : Promise.resolve([]),
    ]);

    return {
      autoDrafts: drafts.map((d) => ({
        id: d.id,
        issueId: d.issueId,
        issueTitle: `${d.issue.identifier}: ${d.issue.title}`.slice(0, 200),
        createdAt: d.createdAt.toISOString(),
      })),
      meetingTasks: intake.map((i) => ({
        id: i.id,
        title: (i.extractedTitle?.trim() || i.rawContent.slice(0, 80)).trim(),
        createdAt: i.createdAt.toISOString(),
      })),
      cloneAnswers: cloneAnswers.map((c) => ({
        questionPreview: c.questionPreview,
        answeredGrounded: c.answeredGrounded,
        createdAt: c.createdAt.toISOString(),
      })),
      counts: {
        autoDrafts: drafts.length,
        meetingTasks: intake.length,
        cloneAnswers: cloneAnswers.length,
      },
    };
  }
}
