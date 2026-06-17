import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CommitmentDto,
  CommitmentStatus,
  ListMyPromisesQuery,
  MarkPromiseBody,
  MyPromisesListDto,
  OpenCommitmentsListDto,
  OpenQuestionDto,
  ReschedulePromiseBody,
} from '../dto/commitments.dto';
import {
  incompleteCommitmentReason,
  incompleteCommitmentReasonText,
  isCompleteCommitment,
} from '../utils/commitment-completeness';

@Injectable()
export class CommitmentsService {
  private readonly logger = new Logger(CommitmentsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveSelfPerson(args: { tenantId: string; userId: string }): Promise<{ id: string }> {
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!person) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'no_person',
          message: 'У пользователя нет Person-записи в этой Org — обещания недоступны',
        },
      });
    }
    return person;
  }

  async listMine(args: {
    tenantId: string;
    selfPersonId: string;
    query: ListMyPromisesQuery;
  }): Promise<MyPromisesListDto> {
    const statusFilter: { commitmentStatus?: CommitmentStatus | { in: CommitmentStatus[] } } = {};
    if (args.query.status === 'open') {
      statusFilter.commitmentStatus = 'open';
    } else if (args.query.status === 'asked') {
      statusFilter.commitmentStatus = 'asked';
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        ...statusFilter,
        entities: {
          some: {
            entity: {
              type: 'person',
              tenantId: args.tenantId,
              persons: {
                some: { id: args.selfPersonId },
              },
            },
          },
        },
      },
      orderBy: [{ commitmentDueDate: 'asc' }, { createdAt: 'desc' }],
      take: args.query.limit,
      select: this.commitmentSelect(),
    });

    const meetingTitles = await this.resolveMeetingTitles(args.tenantId, blocks);

    const items: CommitmentDto[] = [];
    const openQuestions: OpenQuestionDto[] = [];
    for (const b of blocks) {
      if (isCompleteCommitment(b)) {
        items.push(this.toDto(b, null, meetingTitles));
      } else {
        openQuestions.push(this.toOpenQuestion(b, meetingTitles));
      }
    }

    return { items, openQuestions };
  }

  private toOpenQuestion(
    block: {
      id: string;
      criticalQuestion: string;
      commitmentAuthorPersonId: string | null;
      commitmentRecipientPersonId: string | null;
      commitmentDueDate: Date | null;
      createdAt: Date;
      evidence?: Array<{ rawEvent: { sourceExternalId: string | null } }> | null;
    },
    meetingTitles: Map<string, string>,
  ): OpenQuestionDto {
    const reason = incompleteCommitmentReason(block);
    const sourceMeetingId = this.extractSourceMeetingId(block);
    return {
      id: block.id,
      text: block.criticalQuestion,
      sourceMeetingId,
      sourceMeetingTitle: sourceMeetingId ? (meetingTitles.get(sourceMeetingId) ?? null) : null,
      reason: incompleteCommitmentReasonText(reason ?? 'no_recipient_and_due'),
      createdAt: block.createdAt.toISOString(),
    };
  }

  private async resolveMeetingTitles(
    tenantId: string,
    blocks: Array<{
      evidence?: Array<{ rawEvent: { sourceExternalId: string | null } }> | null;
    }>,
  ): Promise<Map<string, string>> {
    const ids = Array.from(
      new Set(
        blocks.map((b) => this.extractSourceMeetingId(b)).filter((id): id is string => id !== null),
      ),
    );
    if (ids.length === 0) return new Map();
    const meetings = await this.prisma.meeting.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, title: true },
    });
    return new Map(meetings.map((m) => [m.id, m.title]));
  }

  async markMine(args: {
    tenantId: string;
    selfPersonId: string;
    blockId: string;
    body: MarkPromiseBody;
  }): Promise<CommitmentDto> {
    const block = await this.prisma.ideaBlock.findFirst({
      where: {
        id: args.blockId,
        tenantId: args.tenantId,
        signalType: 'commitment',
        entities: {
          some: {
            entity: {
              type: 'person',
              tenantId: args.tenantId,
              persons: { some: { id: args.selfPersonId } },
            },
          },
        },
      },
      select: this.commitmentSelect(),
    });
    if (!block) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'commitment_not_found',
          message: 'Обещание не найдено или не доступно',
        },
      });
    }

    const noteSuffix = args.body.note
      ? `\n\n[${args.body.status}] ${args.body.note}`
      : `\n\n[${args.body.status}]`;
    const updated = await this.prisma.ideaBlock.update({
      where: { id: block.id },
      data: {
        commitmentStatus: args.body.status,
        trustedAnswer: `${block.trustedAnswer}${noteSuffix}`.slice(0, 8_000),
      },
      select: this.commitmentSelect(),
    });
    return this.toDto(updated, null);
  }

  async rescheduleMine(args: {
    tenantId: string;
    selfPersonId: string;
    blockId: string;
    body: ReschedulePromiseBody;
  }): Promise<CommitmentDto> {
    const block = await this.prisma.ideaBlock.findFirst({
      where: {
        id: args.blockId,
        tenantId: args.tenantId,
        signalType: 'commitment',
        entities: {
          some: {
            entity: {
              type: 'person',
              tenantId: args.tenantId,
              persons: { some: { id: args.selfPersonId } },
            },
          },
        },
      },
      select: this.commitmentSelect(),
    });
    if (!block) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'commitment_not_found',
          message: 'Обещание не найдено или не доступно',
        },
      });
    }

    const newDue = new Date(args.body.dueDate);
    if (newDue.getTime() <= Date.now()) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'due_date_in_past',
          message: 'Новый срок должен быть в будущем',
        },
      });
    }

    const terminal: ReadonlyArray<string> = ['fulfilled', 'missed', 'cancelled', 'superseded'];
    if (block.commitmentStatus && terminal.includes(block.commitmentStatus)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'commitment_terminal',
          message: 'Нельзя перенести срок у закрытого обещания',
        },
      });
    }

    const noteSuffix = args.body.note
      ? `\n\n[reschedule → ${newDue.toISOString()}] ${args.body.note}`
      : `\n\n[reschedule → ${newDue.toISOString()}]`;
    const updated = await this.prisma.ideaBlock.update({
      where: { id: block.id },
      data: {
        commitmentDueDate: newDue,
        commitmentStatus: 'open',
        trustedAnswer: `${block.trustedAnswer}${noteSuffix}`.slice(0, 8_000),
      },
      select: this.commitmentSelect(),
    });
    return this.toDto(updated, null);
  }

  async listOpenForTenant(args: {
    tenantId: string;
    days: number;
    limit: number;
  }): Promise<OpenCommitmentsListDto> {
    const since = new Date(Date.now() - args.days * 24 * 3600 * 1000);
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentStatus: { in: ['open', 'asked'] },
        createdAt: { gte: since },
      },
      orderBy: [{ commitmentDueDate: 'asc' }, { createdAt: 'desc' }],
      take: args.limit,
      select: this.commitmentSelect({ withAuthor: true }),
    });
    const total = await this.prisma.ideaBlock.count({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentStatus: { in: ['open', 'asked'] },
        createdAt: { gte: since },
      },
    });
    return {
      items: blocks.map((b) => this.toDto(b, this.extractAuthor(b))),
      total,
    };
  }

  async listForPerson(args: { tenantId: string; personId: string; limit: number }): Promise<{
    outgoing: CommitmentDto[];
    incoming: CommitmentDto[];
  }> {
    const [outgoing, incoming] = await Promise.all([
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          entities: {
            some: {
              entity: {
                type: 'person',
                tenantId: args.tenantId,
                persons: { some: { id: args.personId } },
              },
            },
          },
        },
        orderBy: [{ commitmentDueDate: 'asc' }, { createdAt: 'desc' }],
        take: args.limit,
        select: this.commitmentSelect({ withAuthor: true }),
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentRecipientPersonId: args.personId,
        },
        orderBy: [{ commitmentDueDate: 'asc' }, { createdAt: 'desc' }],
        take: args.limit,
        select: this.commitmentSelect({ withAuthor: true }),
      }),
    ]);
    return {
      outgoing: outgoing.map((b) => this.toDto(b, this.extractAuthor(b))),
      incoming: incoming.map((b) => this.toDto(b, this.extractAuthor(b))),
    };
  }

  private commitmentSelect(opts?: { withAuthor?: boolean }) {
    const withAuthor = opts?.withAuthor ?? false;
    return {
      id: true,
      tenantId: true,
      criticalQuestion: true,
      trustedAnswer: true,
      commitmentStatus: true,
      commitmentDueDate: true,
      commitmentRecipientPersonId: true,
      commitmentAuthorPersonId: true,
      commitmentAskedAt: true,
      commitmentEscalatedAt: true,
      createdAt: true,
      commitmentRecipient: {
        select: { id: true, name: true },
      },
      evidence: {
        where: { sourceType: 'meeting' as const },
        orderBy: { sourceTimestamp: 'asc' as const },
        take: 1,
        select: { rawEvent: { select: { sourceExternalId: true } } },
      },
      ...(withAuthor
        ? {
            entities: {
              where: {
                entity: { type: 'person' as const },
              },
              select: {
                role: true,
                entity: {
                  select: {
                    persons: {
                      where: { deletedAt: null },
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
          }
        : {}),
    };
  }

  private extractAuthor(block: { entities?: unknown }): { personId: string; name: string } | null {
    const list =
      (block.entities as
        | Array<{
            role?: string | null;
            entity?: {
              persons?: Array<{ id: string; name: string }>;
            } | null;
          }>
        | undefined) ?? [];
    if (list.length === 0) return null;
    const subjects = list.filter((l) => l.role === 'subject');
    const pool = subjects.length > 0 ? subjects : list;
    for (const l of pool) {
      const p = l.entity?.persons?.[0];
      if (p) return { personId: p.id, name: p.name };
    }
    return null;
  }

  private extractSourceMeetingId(block: {
    evidence?: Array<{ rawEvent: { sourceExternalId: string | null } }> | null;
  }): string | null {
    return block.evidence?.[0]?.rawEvent?.sourceExternalId ?? null;
  }

  private toDto(
    block: {
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentStatus: string | null;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId: string | null;
      commitmentAskedAt: Date | null;
      commitmentEscalatedAt: Date | null;
      createdAt: Date;
      commitmentRecipient: { id: string; name: string } | null;
      evidence?: Array<{ rawEvent: { sourceExternalId: string | null } }> | null;
    },
    author: { personId: string; name: string } | null,
    meetingTitles?: Map<string, string> | null,
  ): CommitmentDto {
    const sourceMeetingId = this.extractSourceMeetingId(block);
    return {
      id: block.id,
      tenantId: block.tenantId,
      text: block.criticalQuestion,
      status: (block.commitmentStatus as CommitmentStatus | null) ?? null,
      dueDate: block.commitmentDueDate ? block.commitmentDueDate.toISOString() : null,
      recipientPersonId: block.commitmentRecipientPersonId,
      recipientPersonName: block.commitmentRecipient?.name ?? null,
      authorPersonId: author?.personId ?? null,
      authorPersonName: author?.name ?? null,
      sourceMeetingId,
      sourceMeetingTitle:
        sourceMeetingId && meetingTitles ? (meetingTitles.get(sourceMeetingId) ?? null) : null,
      askedAt: block.commitmentAskedAt ? block.commitmentAskedAt.toISOString() : null,
      escalatedAt: block.commitmentEscalatedAt ? block.commitmentEscalatedAt.toISOString() : null,
      createdAt: block.createdAt.toISOString(),
    };
  }
}
