import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { MessageService } from '../../messaging/services/message.service';
import type { CreateTicketDto } from '../dto/create-ticket.dto';

import { SupportAccessService } from './support-access.service';
import { SupportLearningService } from './support-learning.service';
import { SupportSlaService } from './support-sla.service';

export interface MyTicketListItem {
  ticketId: string;
  subject: string;
  status: string;
  updatedAt: string;
}

export interface MyTicketMessage {
  id: string;
  authorId: string;
  authorType: string;
  content: string;
  createdAt: string;
}

export interface MyTicketDetail {
  ticketId: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: MyTicketMessage[];
}

@Injectable()
export class SupportIntakeService {
  private readonly logger = new Logger(SupportIntakeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(SupportSlaService) private readonly sla: SupportSlaService,
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(SupportLearningService)
    private readonly learning: SupportLearningService,
  ) {}

  async createTicket(
    callerUserId: string,
    callerOrgId: string | null,
    dto: CreateTicketDto,
  ): Promise<{ ticketId: string }> {
    if (!this.cfg.supportDesk.enabled) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'SUPPORT_DESK_DISABLED',
          message: 'Служба поддержки временно недоступна',
        },
      });
    }
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'SUPPORT_DESK_DISABLED',
          message: 'Служба поддержки не настроена',
        },
      });
    }

    const caller = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      select: { email: true, name: true },
    });
    const contact = caller ? `${caller.name ?? ''} <${caller.email ?? ''}>`.trim() : null;

    const createdAt = new Date();
    const { firstResponseDueAt, resolutionDueAt } = await this.sla.computeDueDates(
      vendorOrgId,
      createdAt,
    );

    const conversation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          tenantId: vendorOrgId,
          kind: 'ticket',
          title: dto.subject,
          createdByUserId: callerUserId,
          feedsGraph: true,
        },
        select: { id: true },
      });
      await tx.supportTicket.create({
        data: {
          tenantId: vendorOrgId,
          conversationId: created.id,
          status: 'new',
          customerOrgId: callerOrgId,
          customerUserId: callerUserId,
          customerContact: contact,
          firstResponseDueAt,
          resolutionDueAt,
        },
      });
      return created;
    });

    await this.messages.appendTicketMessage({
      tenantId: vendorOrgId,
      conversationId: conversation.id,
      authorUserId: callerUserId,
      content: dto.message,
      access: 'external',
      authorType: 'human',
    });

    await this.notifyStaff(vendorOrgId, 'support.ticket_created', {
      ticketId: conversation.id,
      subject: dto.subject,
      snippet: dto.message.slice(0, 500),
      actionUrl: `/support/desk/tickets/${conversation.id}`,
    });

    return { ticketId: conversation.id };
  }

  async listMyTickets(callerUserId: string): Promise<{ items: MyTicketListItem[] }> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) return { items: [] };

    const rows = await this.prisma.supportTicket.findMany({
      where: { tenantId: vendorOrgId, customerUserId: callerUserId },
      select: {
        conversationId: true,
        status: true,
        updatedAt: true,
        conversation: { select: { title: true, lastMessageAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      items: rows.map((r) => ({
        ticketId: r.conversationId,
        subject: r.conversation.title ?? '',
        status: r.status,
        updatedAt: (r.conversation.lastMessageAt ?? r.updatedAt).toISOString(),
      })),
    };
  }

  async getMyTicket(callerUserId: string, ticketId: string): Promise<MyTicketDetail> {
    const ticket = await this.requireMyTicket(callerUserId, ticketId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: ticket.conversationId, access: 'external', deletedAt: null },
      orderBy: { seq: 'asc' },
      select: {
        id: true,
        authorUserId: true,
        authorType: true,
        content: true,
        createdAt: true,
      },
    });
    return {
      ticketId: ticket.conversationId,
      subject: ticket.conversation.title ?? '',
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      messages: messages.map((m) => ({
        id: m.id,
        authorId: m.authorUserId,
        authorType: m.authorType,
        content: this.crypto.decrypt(m.content),
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async addMyMessage(
    callerUserId: string,
    ticketId: string,
    message: string,
  ): Promise<{ ok: true; messageId: string }> {
    const ticket = await this.requireMyTicket(callerUserId, ticketId);
    const { messageId } = await this.messages.appendTicketMessage({
      tenantId: ticket.tenantId,
      conversationId: ticket.conversationId,
      authorUserId: callerUserId,
      content: message,
      access: 'external',
      authorType: 'human',
    });

    await this.notifyStaff(ticket.tenantId, 'support.ticket_reply', {
      ticketId: ticket.conversationId,
      subject: ticket.conversation.title ?? '',
      snippet: message.slice(0, 500),
      actionUrl: `/support/desk/tickets/${ticket.conversationId}`,
    });
    return { ok: true, messageId };
  }

  async rateTicket(
    callerUserId: string,
    ticketId: string,
    score: number,
    comment?: string,
  ): Promise<{ ok: true }> {
    const ticket = await this.requireMyTicket(callerUserId, ticketId);
    await this.prisma.issueRating.upsert({
      where: { conversationId: ticket.conversationId },
      update: { score, comment: comment ?? null, ratedByUserId: callerUserId },
      create: {
        tenantId: ticket.tenantId,
        conversationId: ticket.conversationId,
        score,
        comment: comment ?? null,
        ratedByUserId: callerUserId,
      },
    });

    try {
      await this.learning.maybePromote(ticket.conversationId);
    } catch (err) {
      this.logger.warn(
        {
          ticketId: ticket.conversationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'rateTicket: maybePromote упал — оценка сохранена, продолжаю',
      );
    }

    return { ok: true };
  }

  private async requireMyTicket(callerUserId: string, ticketId: string) {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ticket_not_found', message: 'Обращение не найдено' },
      });
    }
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { conversationId: ticketId, tenantId: vendorOrgId },
      select: {
        conversationId: true,
        tenantId: true,
        status: true,
        customerUserId: true,
        createdAt: true,
        updatedAt: true,
        conversation: { select: { title: true } },
      },
    });
    if (!ticket) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ticket_not_found', message: 'Обращение не найдено' },
      });
    }
    if (ticket.customerUserId !== callerUserId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_ticket_owner',
          message: 'Это обращение принадлежит другому пользователю',
        },
      });
    }
    return ticket;
  }

  private async notifyStaff(
    vendorOrgId: string,
    eventType: 'support.ticket_created' | 'support.ticket_reply',
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const groupId = await this.access.getSupportGroupId(vendorOrgId);
      if (!groupId) return;
      const members = await this.prisma.knowledgeGroupMember.findMany({
        where: { groupId },
        select: { personId: true },
      });
      if (members.length === 0) return;

      const persons = await this.prisma.person.findMany({
        where: {
          id: { in: members.map((m) => m.personId) },
          userId: { not: null },
          deletedAt: null,
        },
        select: { userId: true },
      });
      const userIds = Array.from(
        new Set(persons.map((p) => p.userId).filter((id): id is string => typeof id === 'string')),
      );

      for (const uid of userIds) {
        try {
          await this.conversational.sendNotification({
            tenantId: vendorOrgId,
            recipientUserId: uid,
            eventType,
            payload,
            dataClass: 'internal',
            preferredChannelKinds: ['telegram_bot', 'email_smtp', 'in_app'],
          });
        } catch (err) {
          this.logger.warn(
            {
              uid,
              eventType,
              err: err instanceof Error ? err.message : String(err),
            },
            'notifyStaff: дублирование сотруднику упало — продолжаю',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'notifyStaff: подбор получателей упал — пропускаю дублирование',
      );
    }
  }
}
