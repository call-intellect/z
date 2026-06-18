import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import type { MeetingExtractActionsContext } from './prompts/tasks';

export type OrgContext = MeetingExtractActionsContext &
  Required<Pick<MeetingExtractActionsContext, 'meetingDateIso'>>;

@Injectable()
export class OrgContextService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async load(tenantId: string, meetingStartedAt: Date | null): Promise<OrgContext> {
    const [projects, goals, people] = await Promise.all([
      this.prisma.project.findMany({
        where: { tenantId, deletedAt: null, archivedAt: null },
        select: { identifier: true, name: true },
        take: 40,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.goal.findMany({
        where: {
          tenantId,
          archivedAt: null,
          status: 'active',
        },
        select: { name: true },
        take: 30,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.person.findMany({
        where: { tenantId, deletedAt: null, relationship: 'employee' },
        select: { name: true },
        take: 60,
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      projects,
      goals,
      people: people.map((p) => ({ name: p.name, role: null })),
      meetingDateIso: meetingStartedAt
        ? meetingStartedAt.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
    };
  }
}
