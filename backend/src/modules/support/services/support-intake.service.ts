import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { ActivityRecorderService } from '../../tracker/services/activity-recorder.service';
import type { CreateTicketDto } from '../dto/create-ticket.dto';

import { SupportAccessService } from './support-access.service';
import { SupportLearningService } from './support-learning.service';
import { SupportSlaService } from './support-sla.service';

const SUPPORT_PROJECT_IDENTIFIER = 'SUP';

export interface MyTicketListItem {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
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
  ticketNumber: string;
  subject: string;
  status: string | null;
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
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(SupportSlaService) private readonly sla: SupportSlaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(SupportLearningService)
    private readonly learning: SupportLearningService,
  ) {}

  async createTicket(
    callerUserId: string,
    callerOrgId: string | null,
    dto: CreateTicketDto,
  ): Promise<{ ticketId: string; ticketNumber: string }> {
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

    const project = await this.prisma.project.findFirst({
      where: {
        tenantId: vendorOrgId,
        systemGenerated: true,
        identifier: SUPPORT_PROJECT_IDENTIFIER,
      },
      select: { id: true, identifier: true, defaultStateId: true },
    });
    if (!project) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'SUPPORT_DESK_DISABLED',
          message: 'Support-проект не инициализирован (запустите seed)',
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

    const issue = await this.prisma.$transaction(async (tx) => {
      const maxRow = await tx.issue.aggregate({
        where: { projectId: project.id },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      const identifier = `${project.identifier}-${sequenceId}`;

      const created = await tx.issue.create({
        data: {
          tenantId: vendorOrgId,
          projectId: project.id,
          identifier,
          sequenceId,
          title: dto.subject,
          description: dto.message,
          descriptionStripped: dto.message,
          stateId: project.defaultStateId,
          createdById: callerUserId,
          createdManually: true,
          externalSource: 'support_widget',
          supportCustomerOrgId: callerOrgId,
          supportCustomerUserId: callerUserId,
          supportCustomerContact: contact,
          firstResponseDueAt,
          resolutionDueAt,
        },
      });

      await tx.issueComment.create({
        data: {
          issueId: created.id,
          authorId: callerUserId,
          content: dto.message,
          contentStripped: dto.message,
          access: 'external',
          authorType: 'human',
        },
      });

      await this.activity.record({
        tenantId: vendorOrgId,
        issueId: created.id,
        actorUserId: callerUserId,
        actorType: 'user',
        verb: 'created',
        newValue: { title: created.title, identifier: created.identifier },
        tx,
      });
      return created;
    });

    await this.notifyStaff(vendorOrgId, 'support.ticket_created', {
      ticketId: issue.id,
      ticketNumber: issue.identifier,
      subject: issue.title,
      snippet: dto.message.slice(0, 500),
      actionUrl: `/support/desk/tickets/${issue.id}`,
    });

    return { ticketId: issue.id, ticketNumber: issue.identifier };
  }

  async listMyTickets(callerUserId: string): Promise<{ items: MyTicketListItem[] }> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) return { items: [] };

    const rows = await this.prisma.issue.findMany({
      where: {
        tenantId: vendorOrgId,
        supportCustomerUserId: callerUserId,
        deletedAt: null,
      },
      select: {
        id: true,
        identifier: true,
        title: true,
        updatedAt: true,
        state: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      items: rows.map((r) => ({
        ticketId: r.id,
        ticketNumber: r.identifier,
        subject: r.title,
        status: r.state?.name ?? null,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  }

  async getMyTicket(callerUserId: string, ticketId: string): Promise<MyTicketDetail> {
    const issue = await this.requireMyTicket(callerUserId, ticketId);
    const comments = await this.prisma.issueComment.findMany({
      where: { issueId: issue.id, access: 'external', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        authorId: true,
        authorType: true,
        content: true,
        createdAt: true,
      },
    });
    const state = issue.stateId
      ? await this.prisma.issueState.findUnique({
          where: { id: issue.stateId },
          select: { name: true },
        })
      : null;
    return {
      ticketId: issue.id,
      ticketNumber: issue.identifier,
      subject: issue.title,
      status: state?.name ?? null,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      messages: comments.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        authorType: c.authorType,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async addMyMessage(
    callerUserId: string,
    ticketId: string,
    message: string,
  ): Promise<{ ok: true; commentId: string }> {
    const issue = await this.requireMyTicket(callerUserId, ticketId);
    const comment = await this.prisma.issueComment.create({
      data: {
        issueId: issue.id,
        authorId: callerUserId,
        content: message,
        contentStripped: message,
        access: 'external',
        authorType: 'human',
      },
      select: { id: true },
    });
    await this.prisma.issue.update({
      where: { id: issue.id },
      data: { updatedAt: new Date() },
    });

    await this.notifyStaff(issue.tenantId, 'support.ticket_reply', {
      ticketId: issue.id,
      ticketNumber: issue.identifier,
      subject: issue.title,
      snippet: message.slice(0, 500),
      actionUrl: `/support/desk/tickets/${issue.id}`,
    });
    return { ok: true, commentId: comment.id };
  }

  async rateTicket(
    callerUserId: string,
    ticketId: string,
    score: number,
    comment?: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireMyTicket(callerUserId, ticketId);
    await this.prisma.issueRating.upsert({
      where: { issueId: issue.id },
      update: { score, comment: comment ?? null, ratedByUserId: callerUserId },
      create: {
        tenantId: issue.tenantId,
        issueId: issue.id,
        score,
        comment: comment ?? null,
        ratedByUserId: callerUserId,
      },
    });

    try {
      await this.learning.maybePromote(issue.id);
    } catch (err) {
      this.logger.warn(
        {
          ticketId: issue.id,
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
    const issue = await this.prisma.issue.findFirst({
      where: { id: ticketId, tenantId: vendorOrgId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        identifier: true,
        title: true,
        stateId: true,
        createdAt: true,
        updatedAt: true,
        supportCustomerUserId: true,
      },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ticket_not_found', message: 'Обращение не найдено' },
      });
    }
    if (issue.supportCustomerUserId !== callerUserId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_ticket_owner',
          message: 'Это обращение принадлежит другому пользователю',
        },
      });
    }
    return issue;
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
