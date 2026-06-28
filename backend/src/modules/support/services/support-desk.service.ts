import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MessageService } from '../../messaging/services/message.service';
import type { DeskListQueryDto } from '../dto/desk-list-query.dto';

import { SupportAccessService } from './support-access.service';
import { SupportLearningService } from './support-learning.service';

const DESK_PAGE_SIZE = 50;

export const TICKET_STATUSES = [
  'new',
  'in_progress',
  'waiting',
  'resolved',
  'closed',
  'spam',
] as const;

type TicketStatus = (typeof TICKET_STATUSES)[number];

const CLOSED_STATUSES: TicketStatus[] = ['resolved', 'closed'];

export interface DeskMetaState {
  id: string;
  name: string;
  category: string;
}

export interface DeskMetaAgent {
  userId: string;
  name: string;
}

export interface DeskMeta {
  states: DeskMetaState[];
  agents: DeskMetaAgent[];
}

export interface DeskTicketListItem {
  ticketId: string;
  subject: string;
  status: string;
  customerContact: string | null;
  assigneeUserIds: string[];
  firstResponseDueAt: string | null;
  slaBreachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeskTicketMessage {
  id: string;
  authorId: string;
  authorType: string;
  access: string;
  content: string;
  createdAt: string;
}

export interface DeskTicketDetail {
  ticketId: string;
  subject: string;
  status: string;
  customerOrgId: string | null;
  customerUserId: string | null;
  customerContact: string | null;
  assigneeUserIds: string[];
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  firstRespondedAt: string | null;
  slaBreachedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: DeskTicketMessage[];
}

const STATUS_LABELS: Record<TicketStatus, { name: string; category: string }> = {
  new: { name: 'Новое', category: 'backlog' },
  in_progress: { name: 'В работе', category: 'started' },
  waiting: { name: 'Ожидание', category: 'started' },
  resolved: { name: 'Решено', category: 'completed' },
  closed: { name: 'Закрыто', category: 'completed' },
  spam: { name: 'Спам', category: 'cancelled' },
};

@Injectable()
export class SupportDeskService {
  private readonly logger = new Logger(SupportDeskService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(SupportLearningService)
    private readonly learning: SupportLearningService,
  ) {}

  async listTickets(
    userId: string,
    query: DeskListQueryDto,
  ): Promise<{ items: DeskTicketListItem[]; nextCursor: string | null }> {
    const vendorOrgId = await this.requireVendorOrg();
    const where: Prisma.SupportTicketWhereInput = { tenantId: vendorOrgId };
    const view = query.view ?? 'all';
    if (view === 'unassigned') {
      where.conversation = { members: { none: { role: 'agent' } } };
    } else if (view === 'mine') {
      where.conversation = { members: { some: { role: 'agent', userId } } };
    } else if (view === 'closed') {
      where.status = { in: CLOSED_STATUSES };
    } else if (view === 'spam') {
      where.status = 'spam';
    }
    const rows = await this.prisma.supportTicket.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: DESK_PAGE_SIZE,
      select: {
        conversationId: true,
        status: true,
        customerContact: true,
        firstResponseDueAt: true,
        slaBreachedAt: true,
        createdAt: true,
        updatedAt: true,
        conversation: {
          select: {
            title: true,
            members: { where: { role: 'agent' }, select: { userId: true } },
          },
        },
      },
    });
    return {
      items: rows.map((r) => ({
        ticketId: r.conversationId,
        subject: r.conversation.title ?? '',
        status: r.status,
        customerContact: r.customerContact,
        assigneeUserIds: r.conversation.members.map((m) => m.userId),
        firstResponseDueAt: r.firstResponseDueAt?.toISOString() ?? null,
        slaBreachedAt: r.slaBreachedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      nextCursor: null,
    };
  }

  async getTicket(ticketId: string): Promise<DeskTicketDetail> {
    const ticket = await this.requireTicket(ticketId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: ticket.conversationId, deletedAt: null },
      orderBy: { seq: 'asc' },
      select: {
        id: true,
        authorUserId: true,
        authorType: true,
        access: true,
        content: true,
        createdAt: true,
      },
    });
    const agents = await this.prisma.conversationMember.findMany({
      where: { conversationId: ticket.conversationId, role: 'agent' },
      select: { userId: true },
    });
    return {
      ticketId: ticket.conversationId,
      subject: ticket.conversation.title ?? '',
      status: ticket.status,
      customerOrgId: ticket.customerOrgId,
      customerUserId: ticket.customerUserId,
      customerContact: ticket.customerContact,
      assigneeUserIds: agents.map((a) => a.userId),
      firstResponseDueAt: ticket.firstResponseDueAt?.toISOString() ?? null,
      resolutionDueAt: ticket.resolutionDueAt?.toISOString() ?? null,
      firstRespondedAt: ticket.firstRespondedAt?.toISOString() ?? null,
      slaBreachedAt: ticket.slaBreachedAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      messages: messages.map((m) => ({
        id: m.id,
        authorId: m.authorUserId,
        authorType: m.authorType,
        access: m.access,
        content: this.crypto.decrypt(m.content),
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async reply(
    ticketId: string,
    userId: string,
    message: string,
    fromDraftMessageId?: string,
  ): Promise<{ ok: true; messageId: string }> {
    const ticket = await this.requireTicket(ticketId);
    const { messageId } = await this.messages.appendTicketMessage({
      tenantId: ticket.tenantId,
      conversationId: ticket.conversationId,
      authorUserId: userId,
      content: message,
      access: 'external',
      authorType: 'human',
    });

    if (!ticket.firstRespondedAt) {
      await this.prisma.supportTicket.update({
        where: { conversationId: ticket.conversationId },
        data: { firstRespondedAt: new Date() },
      });
    }

    if (fromDraftMessageId) {
      try {
        await this.learning.recordEdit(fromDraftMessageId, message, userId);
      } catch (err) {
        this.logger.warn(
          {
            fromDraftMessageId,
            err: err instanceof Error ? err.message : String(err),
          },
          'reply: recordEdit упал — ответ уже отправлен, продолжаю',
        );
      }
    }

    return { ok: true, messageId };
  }

  async note(
    ticketId: string,
    userId: string,
    message: string,
  ): Promise<{ ok: true; messageId: string }> {
    const ticket = await this.requireTicket(ticketId);
    const { messageId } = await this.messages.appendTicketMessage({
      tenantId: ticket.tenantId,
      conversationId: ticket.conversationId,
      authorUserId: userId,
      content: message,
      access: 'internal',
      authorType: 'human',
    });
    return { ok: true, messageId };
  }

  async assign(
    ticketId: string,
    assigneeUserId: string,
    _actorUserId: string,
  ): Promise<{ ok: true }> {
    const ticket = await this.requireTicket(ticketId);
    await this.prisma.conversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId: ticket.conversationId,
          userId: assigneeUserId,
        },
      },
      update: { role: 'agent' },
      create: {
        conversationId: ticket.conversationId,
        userId: assigneeUserId,
        role: 'agent',
        source: 'support_assign',
      },
    });
    return { ok: true };
  }

  async transition(ticketId: string, _userId: string, status: string): Promise<{ ok: true }> {
    const ticket = await this.requireTicket(ticketId);
    if (!isTicketStatus(status)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_status', message: 'Недопустимый статус тикета' },
      });
    }
    if (ticket.status === status) return { ok: true };
    await this.prisma.supportTicket.update({
      where: { conversationId: ticket.conversationId },
      data: { status },
    });
    return { ok: true };
  }

  async getMeta(): Promise<DeskMeta> {
    const vendorOrgId = await this.requireVendorOrg();

    const states: DeskMetaState[] = TICKET_STATUSES.map((status) => ({
      id: status,
      name: STATUS_LABELS[status].name,
      category: STATUS_LABELS[status].category,
    }));

    const agents: DeskMetaAgent[] = [];
    const groupId = await this.access.getSupportGroupId(vendorOrgId);
    if (groupId) {
      const members = await this.prisma.knowledgeGroupMember.findMany({
        where: { groupId },
        select: { personId: true },
      });
      if (members.length > 0) {
        const persons = await this.prisma.person.findMany({
          where: {
            id: { in: members.map((m) => m.personId) },
            userId: { not: null },
            deletedAt: null,
          },
          select: { userId: true, name: true },
        });
        const seen = new Set<string>();
        for (const p of persons) {
          if (!p.userId || seen.has(p.userId)) continue;
          seen.add(p.userId);
          agents.push({ userId: p.userId, name: p.name });
        }
      }
    }

    return { states, agents };
  }

  private async requireVendorOrg(): Promise<string> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'SUPPORT_DESK_DISABLED',
          message: 'Деск поддержки не настроен',
        },
      });
    }
    return vendorOrgId;
  }

  private async requireTicket(ticketId: string) {
    const vendorOrgId = await this.requireVendorOrg();
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { conversationId: ticketId, tenantId: vendorOrgId },
      select: {
        conversationId: true,
        tenantId: true,
        status: true,
        customerOrgId: true,
        customerUserId: true,
        customerContact: true,
        firstResponseDueAt: true,
        resolutionDueAt: true,
        firstRespondedAt: true,
        slaBreachedAt: true,
        createdAt: true,
        updatedAt: true,
        conversation: { select: { title: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ticket_not_found', message: 'Тикет не найден' },
      });
    }
    return ticket;
  }
}

function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}
