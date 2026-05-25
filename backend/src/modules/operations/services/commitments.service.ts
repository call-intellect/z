import {
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
  OpenCommitmentsListDto,
} from '../dto/commitments.dto';

/**
 * SBA β-8.2 — CommitmentsService.
 *
 * Чтения и мутации над IdeaBlock-обещаниями.
 *
 * ВАЖНО: «Мои обещания» строго изолированы между сотрудниками:
 *   - listMine читает только блоки, в которых текущий Person (по userId)
 *     упомянут как subject или mentioned-employee.
 *   - markMine разрешён только если текущий Person — автор блока.
 *
 * Изоляция реализована через JOIN IdeaBlock → IdeaBlockEntity → Entity
 * (type='person') → Person с фильтром `tenantId + userId=currentUserId`.
 */
@Injectable()
export class CommitmentsService {
  private readonly logger = new Logger(CommitmentsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Найти Person текущего user'а в Org. Если нет — 403 (как DailyCheckIn).
   */
  async resolveSelfPerson(args: {
    tenantId: string;
    userId: string;
  }): Promise<{ id: string }> {
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
          message:
            'У пользователя нет Person-записи в этой Org — обещания недоступны',
        },
      });
    }
    return person;
  }

  /**
   * Личный список моих обещаний (`GET /me/promises`).
   *
   * Фильтр по статусу:
   *   - `open` — `commitmentStatus='open'`.
   *   - `asked` — `commitmentStatus='asked'`.
   *   - `all` — любой статус (без терминальных по умолчанию? — отдаём все).
   *
   * Через JOIN IdeaBlockEntity → Entity → Person, чтобы фильтр шёл по
   * `Person.userId = currentUserId`.
   */
  async listMine(args: {
    tenantId: string;
    selfPersonId: string;
    query: ListMyPromisesQuery;
  }): Promise<{ items: CommitmentDto[] }> {
    const statusFilter: { commitmentStatus?: CommitmentStatus | { in: CommitmentStatus[] } } = {};
    if (args.query.status === 'open') {
      statusFilter.commitmentStatus = 'open';
    } else if (args.query.status === 'asked') {
      statusFilter.commitmentStatus = 'asked';
    }
    // 'all' — без фильтра.

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        ...statusFilter,
        // Ключевой фильтр изоляции: блок упоминает Person текущего user'а
        // как subject (автор обещания) или mentioned employee. Без этого
        // условия сотрудник видел бы все обещания Org.
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

    return { items: blocks.map((b) => this.toDto(b, null)) };
  }

  /**
   * Ручное закрытие обещания (`POST /me/promises/:blockId/mark`).
   * Разрешено только если запрашивающий Person — автор обещания (subject)
   * либо просто упомянут как mentioned-employee.
   * Note: ставим в trustedAnswer как дополнительную строку «<status>: <note>».
   */
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

  /**
   * Список обещаний по команде для COO-панели (`GET /dashboard/operations/open-commitments`).
   * Фильтр: signalType='commitment', commitmentStatus ∈ ('open','asked'),
   * createdAt > now - days.
   */
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

  /**
   * Обещания конкретного человека (`GET /personal-relations/commitments?personId=`).
   * Включает исходящие (автор) и входящие (адресат).
   */
  async listForPerson(args: {
    tenantId: string;
    personId: string;
    limit: number;
  }): Promise<{
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

  // ── helpers ──────────────────────────────────────────────────────

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
      commitmentAskedAt: true,
      commitmentEscalatedAt: true,
      createdAt: true,
      commitmentRecipient: {
        select: { id: true, name: true },
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

  /** Из IdeaBlockEntity[] выбираем «лучшего» автора (subject > mentioned). */
  private extractAuthor(
    block: { entities?: unknown },
  ): { personId: string; name: string } | null {
    const list = (block.entities as
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
    },
    author: { personId: string; name: string } | null,
  ): CommitmentDto {
    return {
      id: block.id,
      tenantId: block.tenantId,
      text: block.criticalQuestion,
      status: (block.commitmentStatus as CommitmentStatus | null) ?? null,
      dueDate: block.commitmentDueDate
        ? block.commitmentDueDate.toISOString()
        : null,
      recipientPersonId: block.commitmentRecipientPersonId,
      recipientPersonName: block.commitmentRecipient?.name ?? null,
      authorPersonId: author?.personId ?? null,
      authorPersonName: author?.name ?? null,
      askedAt: block.commitmentAskedAt
        ? block.commitmentAskedAt.toISOString()
        : null,
      escalatedAt: block.commitmentEscalatedAt
        ? block.commitmentEscalatedAt.toISOString()
        : null,
      createdAt: block.createdAt.toISOString(),
    };
  }
}
