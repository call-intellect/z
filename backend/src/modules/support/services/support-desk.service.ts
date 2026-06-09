import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityRecorderService } from '../../tracker/services/activity-recorder.service';
import type { DeskListQueryDto } from '../dto/desk-list-query.dto';

import { SupportAccessService } from './support-access.service';

/** Максимум тикетов в одной странице очереди (Ф1 — без keyset-cursor). */
const DESK_PAGE_SIZE = 50;

/** Идентификатор Support-проекта (systemGenerated) в вендор-Org. */
const SUPPORT_PROJECT_IDENTIFIER = 'SUP';

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
  ticketNumber: string;
  subject: string;
  status: string | null;
  customerContact: string | null;
  assigneeUserIds: string[];
  firstResponseDueAt: string | null;
  slaBreachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeskTicketComment {
  id: string;
  authorId: string;
  authorType: string;
  access: string;
  content: string;
  createdAt: string;
}

export interface DeskTicketDetail {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string | null;
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
  /** ВСЕ комментарии (internal+external) — деск доверенный. */
  messages: DeskTicketComment[];
}

/**
 * SupportDeskService — сторона сотрудника поддержки. Все операции в scope
 * вендор-Org (guard уже проверил членство и выставил req.tenantId).
 *
 * ТЗ 2026-06-09 support-desk Ф1. Клон/черновики (draft/accept/reject) — Ф3,
 * здесь не реализуются; `fromDraftCommentId` в reply принимается, но
 * draft-outcome логика отложена.
 */
@Injectable()
export class SupportDeskService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
  ) {}

  /** Очередь тикетов вендор-деска по выбранному view. */
  async listTickets(
    userId: string,
    query: DeskListQueryDto,
  ): Promise<{ items: DeskTicketListItem[]; nextCursor: string | null }> {
    const vendorOrgId = await this.requireVendorOrg();
    const where: Prisma.IssueWhereInput = {
      tenantId: vendorOrgId,
      supportCustomerUserId: { not: null },
      deletedAt: null,
    };
    const view = query.view ?? 'all';
    if (view === 'unassigned') {
      where.assignees = { none: {} };
    } else if (view === 'mine') {
      where.assignees = { some: { userId } };
    } else if (view === 'closed') {
      where.state = { category: { in: ['completed', 'cancelled'] } };
    } else if (view === 'spam') {
      where.state = { name: 'Спам' };
    }
    const rows = await this.prisma.issue.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: DESK_PAGE_SIZE,
      select: {
        id: true,
        identifier: true,
        title: true,
        supportCustomerContact: true,
        firstResponseDueAt: true,
        slaBreachedAt: true,
        createdAt: true,
        updatedAt: true,
        state: { select: { name: true } },
        assignees: { select: { userId: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        ticketId: r.id,
        ticketNumber: r.identifier,
        subject: r.title,
        status: r.state?.name ?? null,
        customerContact: r.supportCustomerContact,
        assigneeUserIds: r.assignees.map((a) => a.userId),
        firstResponseDueAt: r.firstResponseDueAt?.toISOString() ?? null,
        slaBreachedAt: r.slaBreachedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      // Ф1 — keyset-пагинация не реализована (страница до 50). См. ТЗ.
      nextCursor: null,
    };
  }

  /** Детали тикета + ВСЕ комментарии (internal+external). */
  async getTicket(ticketId: string): Promise<DeskTicketDetail> {
    const issue = await this.requireTicket(ticketId);
    const comments = await this.prisma.issueComment.findMany({
      where: { issueId: issue.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        authorId: true,
        authorType: true,
        access: true,
        content: true,
        createdAt: true,
      },
    });
    const assignees = await this.prisma.issueAssignee.findMany({
      where: { issueId: issue.id },
      select: { userId: true },
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
      customerOrgId: issue.supportCustomerOrgId,
      customerUserId: issue.supportCustomerUserId,
      customerContact: issue.supportCustomerContact,
      assigneeUserIds: assignees.map((a) => a.userId),
      firstResponseDueAt: issue.firstResponseDueAt?.toISOString() ?? null,
      resolutionDueAt: issue.resolutionDueAt?.toISOString() ?? null,
      firstRespondedAt: issue.firstRespondedAt?.toISOString() ?? null,
      slaBreachedAt: issue.slaBreachedAt?.toISOString() ?? null,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      messages: comments.map((c) => ({
        id: c.id,
        authorId: c.authorId,
        authorType: c.authorType,
        access: c.access,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Ответ сотрудника клиенту (access='external', authorType='human').
   * Первый ответ проставляет `firstRespondedAt`. `fromDraftCommentId` —
   * Ф3-задел (DIFF/outcome не реализованы в Ф1), сохраняется в метаданные
   * активности.
   */
  async reply(
    ticketId: string,
    userId: string,
    message: string,
    fromDraftCommentId?: string,
  ): Promise<{ ok: true; commentId: string }> {
    const issue = await this.requireTicket(ticketId);
    let commentId = '';
    await this.prisma.$transaction(async (tx) => {
      const comment = await tx.issueComment.create({
        data: {
          issueId: issue.id,
          authorId: userId,
          content: message,
          contentStripped: message,
          access: 'external',
          authorType: 'human',
        },
        select: { id: true },
      });
      commentId = comment.id;
      const data: Prisma.IssueUpdateInput = { updatedAt: new Date() };
      if (!issue.firstRespondedAt) {
        data.firstRespondedAt = new Date();
      }
      await tx.issue.update({ where: { id: issue.id }, data });
      await this.activity.record({
        tenantId: issue.tenantId,
        issueId: issue.id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'commented',
        newValue: { access: 'external' },
        metadata: fromDraftCommentId ? { fromDraftCommentId } : null,
        tx,
      });
    });
    return { ok: true, commentId };
  }

  /** Внутренняя заметка (access='internal', не видна клиенту). */
  async note(
    ticketId: string,
    userId: string,
    message: string,
  ): Promise<{ ok: true; commentId: string }> {
    const issue = await this.requireTicket(ticketId);
    const comment = await this.prisma.issueComment.create({
      data: {
        issueId: issue.id,
        authorId: userId,
        content: message,
        contentStripped: message,
        access: 'internal',
        authorType: 'human',
      },
      select: { id: true },
    });
    return { ok: true, commentId: comment.id };
  }

  /** Назначить сотрудника на тикет (reuse IssueAssignee M:M). Идемпотентно. */
  async assign(
    ticketId: string,
    assigneeUserId: string,
    actorUserId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireTicket(ticketId);
    const existing = await this.prisma.issueAssignee.findUnique({
      where: { issueId_userId: { issueId: issue.id, userId: assigneeUserId } },
      select: { id: true },
    });
    if (existing) return { ok: true };
    await this.prisma.$transaction(async (tx) => {
      await tx.issueAssignee.create({
        data: {
          issueId: issue.id,
          userId: assigneeUserId,
          assignedById: actorUserId,
        },
      });
      await this.activity.record({
        tenantId: issue.tenantId,
        issueId: issue.id,
        actorUserId,
        actorType: 'user',
        verb: 'assigned',
        newValue: { userId: assigneeUserId },
        tx,
      });
    });
    return { ok: true };
  }

  /** Сменить статус тикета. Валидирует, что state принадлежит Support-проекту. */
  async transition(
    ticketId: string,
    userId: string,
    stateId: string,
  ): Promise<{ ok: true }> {
    const issue = await this.requireTicket(ticketId);
    const state = await this.prisma.issueState.findFirst({
      where: { id: stateId, projectId: issue.projectId },
      select: { id: true, category: true },
    });
    if (!state) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_state_id',
          message: 'Статус не найден или принадлежит другому проекту',
        },
      });
    }
    if (issue.stateId === stateId) return { ok: true };
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.IssueUpdateInput = {
        state: { connect: { id: stateId } },
      };
      if (state.category === 'completed' && !issue.completedAt) {
        data.completedAt = new Date();
      } else if (state.category !== 'completed' && issue.completedAt) {
        data.completedAt = null;
      }
      await tx.issue.update({ where: { id: issue.id }, data });
      await this.activity.record({
        tenantId: issue.tenantId,
        issueId: issue.id,
        actorUserId: userId,
        actorType: 'user',
        verb: 'status_changed',
        field: 'stateId',
        oldValue: issue.stateId,
        newValue: stateId,
        tx,
      });
    });
    return { ok: true };
  }

  /**
   * Справочники деска для UI: статусы Support-проекта (для смены статуса) и
   * сотрудники контура поддержки (для назначения). Всё в scope вендор-Org.
   */
  async getMeta(): Promise<DeskMeta> {
    const vendorOrgId = await this.requireVendorOrg();

    // Статусы Support-проекта, по порядку (sequence).
    const project = await this.prisma.project.findFirst({
      where: {
        tenantId: vendorOrgId,
        systemGenerated: true,
        identifier: SUPPORT_PROJECT_IDENTIFIER,
      },
      select: { id: true },
    });
    const states: DeskMetaState[] = project
      ? (
          await this.prisma.issueState.findMany({
            where: { projectId: project.id },
            orderBy: { sequence: 'asc' },
            select: { id: true, name: true, category: true },
          })
        ).map((s) => ({ id: s.id, name: s.name, category: s.category }))
      : [];

    // Сотрудники контура поддержки → {userId,name} (только с привязанным User).
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

  // ─────────────────────────── internal ───────────────────────────

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

  /** Загрузить support-тикет в scope вендор-Org. 404 если не support/чужой. */
  private async requireTicket(ticketId: string) {
    const vendorOrgId = await this.requireVendorOrg();
    const issue = await this.prisma.issue.findFirst({
      where: {
        id: ticketId,
        tenantId: vendorOrgId,
        supportCustomerUserId: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        projectId: true,
        identifier: true,
        title: true,
        stateId: true,
        completedAt: true,
        supportCustomerOrgId: true,
        supportCustomerUserId: true,
        supportCustomerContact: true,
        firstResponseDueAt: true,
        resolutionDueAt: true,
        firstRespondedAt: true,
        slaBreachedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ticket_not_found', message: 'Тикет не найден' },
      });
    }
    return issue;
  }
}
