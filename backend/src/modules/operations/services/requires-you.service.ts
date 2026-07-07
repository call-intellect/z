import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface RequiresYouDto {
  decisionsWithoutTask: Array<{
    id: string;
    statement: string;
    rationale: string | null;
    cite: string | null;
  }>;
  commitmentsOverdue: Array<{
    id: string;
    text: string;
    counterpartName: string | null;
    dueLabel: string | null;
    ageDays: number;
  }>;
  counts: { decisionsWithoutTask: number; commitmentsOverdue: number };
}

@Injectable()
export class RequiresYouService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getForPerson(args: {
    tenantId: string;
    personId: string | null;
    now: Date;
  }): Promise<RequiresYouDto> {
    const { tenantId, personId, now } = args;
    if (!personId) {
      return {
        decisionsWithoutTask: [],
        commitmentsOverdue: [],
        counts: { decisionsWithoutTask: 0, commitmentsOverdue: 0 },
      };
    }

    const [decisions, commitments] = await Promise.all([
      this.prisma.decision.findMany({
        where: {
          tenantId,
          deletedAt: null,
          impliesAction: true,
          linkedTaskCount: 0,
          actionExtractedAt: null,
          decidedByPersonIds: { has: personId },
        },
        select: {
          id: true,
          statement: true,
          rationale: true,
          previewQuote: true,
          decidedAt: true,
          createdAt: true,
        },
        orderBy: [{ decidedAt: 'desc' }],
        take: 25,
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId,
          signalType: 'commitment',
          commitmentAuthorPersonId: personId,
          status: { not: 'archived' },
          supersededById: null,
          mergedIntoId: null,
          commitmentDueDate: { lt: now },
        },
        select: {
          id: true,
          name: true,
          trustedAnswer: true,
          criticalQuestion: true,
          commitmentDueDate: true,
          commitmentRecipientPersonId: true,
        },
        orderBy: [{ commitmentDueDate: 'asc' }],
        take: 25,
      }),
    ]);

    const recipientIds = [
      ...new Set(
        commitments.map((c) => c.commitmentRecipientPersonId).filter((v): v is string => !!v),
      ),
    ];
    const nameById = new Map<string, string>();
    if (recipientIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, id: { in: recipientIds } },
        select: { id: true, name: true },
      });
      for (const p of persons) nameById.set(p.id, p.name);
    }

    return {
      decisionsWithoutTask: decisions.map((d) => ({
        id: d.id,
        statement: (d.statement ?? 'Решение без задачи').slice(0, 300),
        rationale: d.rationale ? d.rationale.slice(0, 300) : null,
        cite: d.previewQuote ? d.previewQuote.slice(0, 200) : null,
      })),
      commitmentsOverdue: commitments.map((c) => ({
        id: c.id,
        text: (c.trustedAnswer?.trim() || c.name || c.criticalQuestion || 'Обещание').slice(0, 200),
        counterpartName: c.commitmentRecipientPersonId
          ? (nameById.get(c.commitmentRecipientPersonId) ?? null)
          : null,
        dueLabel: c.commitmentDueDate ? c.commitmentDueDate.toISOString().slice(0, 10) : null,
        ageDays: c.commitmentDueDate
          ? Math.floor((now.getTime() - c.commitmentDueDate.getTime()) / 86_400_000)
          : 0,
      })),
      counts: {
        decisionsWithoutTask: decisions.length,
        commitmentsOverdue: commitments.length,
      },
    };
  }
}
