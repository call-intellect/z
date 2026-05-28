import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  IssueChecklist,
  IssueChecklistItem,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  BulkCreateChecklistItemsDto,
  ChecklistItemResponseDto,
  ChecklistResponseDto,
  CreateChecklistDto,
  CreateChecklistItemDto,
  UpdateChecklistDto,
  UpdateChecklistItemDto,
} from '../dto/checklists/checklist.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';
import { TrackerEventsService } from './tracker-events.service';

/**
 * ChecklistsService — чек-листы внутри задачи (2026-05-27).
 *
 * Контракт: plans/tz/2026-05-27-tracker-checklists.md.
 *
 * Ключевые правила:
 *   - Чек-листы и пункты привязаны к Issue; RBAC наследуется от Issue
 *     (нет отдельного ResourceType).
 *   - При любом CRUD по пунктам — `recountCounters(issueId)` пересчитывает
 *     `Issue.checklistTotalCount` / `checklistDoneCount` (денормализованные).
 *   - Активность пишется только на «все пункты выполнены» (verb=checklist_completed).
 *     Мелкие события «item done/undone» не пишем — забивают feed.
 *   - WS-события — через TrackerEventsService (fire-and-forget).
 */
@Injectable()
export class ChecklistsService {
  private readonly logger = new Logger(ChecklistsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ── Checklists CRUD ────────────────────────────────────────────────────

  /** Все чек-листы задачи (без удалённых) с items inline. */
  async listForIssue(
    issueId: string,
    tenantId: string,
  ): Promise<ChecklistResponseDto[]> {
    await this.issues.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueChecklist.findMany({
      where: { issueId, tenantId, deletedAt: null },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
      include: {
        items: { orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    return rows.map((r) => this.toChecklistResponse(r, r.items));
  }

  /** Создать чек-лист на задаче. */
  async createChecklist(
    issueId: string,
    dto: CreateChecklistDto,
    tenantId: string,
  ): Promise<ChecklistResponseDto> {
    const issue = await this.issues.requireIssue(issueId, tenantId);
    // sequence = max+1 (стабильный порядок).
    const max = await this.prisma.issueChecklist.aggregate({
      where: { issueId, tenantId, deletedAt: null },
      _max: { sequence: true },
    });
    const nextSeq = (max._max.sequence ?? -1) + 1;
    const created = await this.prisma.issueChecklist.create({
      data: {
        tenantId,
        issueId,
        title: dto.title ?? 'Чек-лист',
        sequence: nextSeq,
      },
    });
    this.metrics.incChecklistCreated({
      tenant: tenantId,
      project: issue.projectId,
    });
    const response = this.toChecklistResponse(created, []);
    this.events.publishChecklistCreated(response, tenantId);
    return response;
  }

  /** PATCH чек-листа (только title). */
  async updateChecklist(
    checklistId: string,
    dto: UpdateChecklistDto,
    tenantId: string,
  ): Promise<ChecklistResponseDto> {
    await this.requireChecklist(checklistId, tenantId);
    const updated = await this.prisma.issueChecklist.update({
      where: { id: checklistId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
      },
      include: {
        items: { orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    const response = this.toChecklistResponse(updated, updated.items);
    this.events.publishChecklistUpdated(response, tenantId);
    return response;
  }

  /** Soft-delete чек-листа (deletedAt). Items уйдут вместе по cascade на read. */
  async deleteChecklist(
    checklistId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    const existing = await this.requireChecklist(checklistId, tenantId);
    await this.prisma.issueChecklist.update({
      where: { id: checklistId },
      data: { deletedAt: new Date() },
    });
    await this.recountCounters(existing.issueId, tenantId);
    this.events.publishChecklistDeleted({
      tenantId,
      issueId: existing.issueId,
      checklistId,
    });
    return { ok: true };
  }

  /** Reorder чек-листов внутри одной задачи (массив id в нужном порядке). */
  async reorderChecklists(args: {
    issueId: string;
    checklistIds: string[];
    tenantId: string;
  }): Promise<ChecklistResponseDto[]> {
    await this.issues.requireIssue(args.issueId, args.tenantId);
    // Проверяем, что все id из этой задачи.
    const existing = await this.prisma.issueChecklist.findMany({
      where: {
        id: { in: args.checklistIds },
        issueId: args.issueId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing.length !== args.checklistIds.length) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'checklists_reorder_mismatch',
          message: 'Список чек-листов не совпадает с задачей',
        },
      });
    }
    await this.prisma.$transaction(
      args.checklistIds.map((id, idx) =>
        this.prisma.issueChecklist.update({
          where: { id },
          data: { sequence: idx },
        }),
      ),
    );
    return this.listForIssue(args.issueId, args.tenantId);
  }

  // ── Checklist items CRUD ───────────────────────────────────────────────

  /** Создать один пункт. */
  async createItem(
    checklistId: string,
    dto: CreateChecklistItemDto,
    tenantId: string,
  ): Promise<ChecklistItemResponseDto> {
    const checklist = await this.requireChecklist(checklistId, tenantId);
    const issue = await this.issues.requireIssue(checklist.issueId, tenantId);
    const max = await this.prisma.issueChecklistItem.aggregate({
      where: { checklistId, tenantId },
      _max: { sequence: true },
    });
    const nextSeq = (max._max.sequence ?? -1) + 1;
    const created = await this.prisma.issueChecklistItem.create({
      data: {
        tenantId,
        checklistId,
        text: dto.text,
        sequence: nextSeq,
      },
    });
    await this.recountCounters(checklist.issueId, tenantId);
    this.metrics.incChecklistItemAdded({
      tenant: tenantId,
      project: issue.projectId,
      viaBulk: false,
    });
    const response = this.toItemResponse(created);
    this.events.publishChecklistItemCreated({
      tenantId,
      issueId: checklist.issueId,
      checklistId,
      item: response,
    });
    return response;
  }

  /** Bulk-create пунктов (до 50 строк). */
  async bulkCreateItems(
    checklistId: string,
    dto: BulkCreateChecklistItemsDto,
    tenantId: string,
  ): Promise<ChecklistItemResponseDto[]> {
    const checklist = await this.requireChecklist(checklistId, tenantId);
    const issue = await this.issues.requireIssue(checklist.issueId, tenantId);
    if (dto.lines.length === 0) return [];
    const max = await this.prisma.issueChecklistItem.aggregate({
      where: { checklistId, tenantId },
      _max: { sequence: true },
    });
    const startSeq = (max._max.sequence ?? -1) + 1;
    // createMany не возвращает строки в Postgres — используем последовательные create в транзакции.
    const created = await this.prisma.$transaction(
      dto.lines.map((text, idx) =>
        this.prisma.issueChecklistItem.create({
          data: {
            tenantId,
            checklistId,
            text,
            sequence: startSeq + idx,
          },
        }),
      ),
    );
    await this.recountCounters(checklist.issueId, tenantId);
    for (let i = 0; i < created.length; i += 1) {
      this.metrics.incChecklistItemAdded({
        tenant: tenantId,
        project: issue.projectId,
        viaBulk: true,
      });
    }
    const responses = created.map((c) => this.toItemResponse(c));
    for (const item of responses) {
      this.events.publishChecklistItemCreated({
        tenantId,
        issueId: checklist.issueId,
        checklistId,
        item,
      });
    }
    return responses;
  }

  /** PATCH пункта (text/isDone/sequence). */
  async updateItem(
    itemId: string,
    dto: UpdateChecklistItemDto,
    tenantId: string,
    userId: string,
  ): Promise<ChecklistItemResponseDto> {
    const existing = await this.requireItem(itemId, tenantId);
    const checklist = await this.requireChecklist(existing.checklistId, tenantId);
    const issue = await this.issues.requireIssue(checklist.issueId, tenantId);

    const willToggleDone =
      dto.isDone !== undefined && dto.isDone !== existing.isDone;
    const willBecomeDone = willToggleDone && dto.isDone === true;

    const updated = await this.prisma.issueChecklistItem.update({
      where: { id: itemId },
      data: {
        ...(dto.text !== undefined && { text: dto.text }),
        ...(dto.sequence !== undefined && { sequence: dto.sequence }),
        ...(dto.isDone !== undefined && {
          isDone: dto.isDone,
          completedAt: dto.isDone ? new Date() : null,
          completedById: dto.isDone ? userId : null,
        }),
      },
    });

    if (willBecomeDone) {
      this.metrics.incChecklistItemCompleted({
        tenant: tenantId,
        project: issue.projectId,
      });
    }

    // recount + activity на all-completed.
    if (willToggleDone) {
      await this.maybeMarkChecklistCompleted({
        tenantId,
        issueId: checklist.issueId,
        actorUserId: userId,
      });
    }
    await this.recountCounters(checklist.issueId, tenantId);

    const response = this.toItemResponse(updated);
    this.events.publishChecklistItemUpdated({
      tenantId,
      issueId: checklist.issueId,
      checklistId: checklist.id,
      item: response,
    });
    return response;
  }

  /** Удалить пункт. */
  async deleteItem(
    itemId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    const existing = await this.requireItem(itemId, tenantId);
    const checklist = await this.requireChecklist(existing.checklistId, tenantId);
    await this.prisma.issueChecklistItem.delete({ where: { id: itemId } });
    await this.recountCounters(checklist.issueId, tenantId);
    this.events.publishChecklistItemDeleted({
      tenantId,
      issueId: checklist.issueId,
      checklistId: checklist.id,
      itemId,
    });
    return { ok: true };
  }

  /** Reorder пунктов внутри одного чек-листа. */
  async reorderItems(args: {
    checklistId: string;
    itemIds: string[];
    tenantId: string;
  }): Promise<ChecklistItemResponseDto[]> {
    const checklist = await this.requireChecklist(args.checklistId, args.tenantId);
    const existing = await this.prisma.issueChecklistItem.findMany({
      where: {
        id: { in: args.itemIds },
        checklistId: args.checklistId,
        tenantId: args.tenantId,
      },
      select: { id: true },
    });
    if (existing.length !== args.itemIds.length) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'checklist_items_reorder_mismatch',
          message: 'Список пунктов не совпадает с чек-листом',
        },
      });
    }
    await this.prisma.$transaction(
      args.itemIds.map((id, idx) =>
        this.prisma.issueChecklistItem.update({
          where: { id },
          data: { sequence: idx },
        }),
      ),
    );
    const refreshed = await this.prisma.issueChecklistItem.findMany({
      where: { checklistId: args.checklistId, tenantId: args.tenantId },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
    });
    // emit updates (мелкие — один батч-евент, но проще много).
    for (const item of refreshed) {
      this.events.publishChecklistItemUpdated({
        tenantId: args.tenantId,
        issueId: checklist.issueId,
        checklistId: checklist.id,
        item: this.toItemResponse(item),
      });
    }
    return refreshed.map((r) => this.toItemResponse(r));
  }

  // ── Counters ───────────────────────────────────────────────────────────

  /**
   * Пересчёт денормализованных счётчиков `Issue.checklistTotalCount` /
   * `checklistDoneCount` по фактическим item'ам активных (deletedAt=null)
   * чек-листов. Эмитит `issue.checklist_progress_changed` для оптимистичного
   * обновления карточек на канбане.
   */
  async recountCounters(issueId: string, tenantId: string): Promise<void> {
    const totals = await this.prisma.issueChecklistItem.groupBy({
      by: ['isDone'],
      where: {
        tenantId,
        checklist: { issueId, deletedAt: null },
      },
      _count: { _all: true },
    });
    let total = 0;
    let done = 0;
    for (const row of totals) {
      total += row._count._all;
      if (row.isDone) done += row._count._all;
    }
    const updated = await this.prisma.issue.update({
      where: { id: issueId },
      data: {
        checklistTotalCount: total,
        checklistDoneCount: done,
      },
      select: { id: true, projectId: true, tenantId: true },
    });
    this.events.publishIssueChecklistProgressChanged({
      tenantId: updated.tenantId,
      projectId: updated.projectId,
      issueId: updated.id,
      total,
      done,
    });
  }

  // ── internal ──────────────────────────────────────────────────────────

  /**
   * Если после пересчёта все активные пункты задачи выполнены (total>0 и
   * total==done) — пишем IssueActivity verb='checklist_completed'.
   *
   * NB: должен вызываться ДО recountCounters; читает свежие данные напрямую.
   */
  private async maybeMarkChecklistCompleted(args: {
    tenantId: string;
    issueId: string;
    actorUserId: string;
  }): Promise<void> {
    const totals = await this.prisma.issueChecklistItem.groupBy({
      by: ['isDone'],
      where: {
        tenantId: args.tenantId,
        checklist: { issueId: args.issueId, deletedAt: null },
      },
      _count: { _all: true },
    });
    let total = 0;
    let done = 0;
    for (const row of totals) {
      total += row._count._all;
      if (row.isDone) done += row._count._all;
    }
    if (total === 0 || total !== done) return;
    // Защита от дублей: если предыдущая запись с verb=checklist_completed
    // была за последние ~5 секунд — пропускаем (анти-флэппинг при быстром
    // toggle done/undone/done).
    const recent = await this.prisma.issueActivity.findFirst({
      where: {
        issueId: args.issueId,
        verb: 'checklist_completed',
        createdAt: { gt: new Date(Date.now() - 5_000) },
      },
      select: { id: true },
    });
    if (recent) return;
    await this.activity.record({
      tenantId: args.tenantId,
      issueId: args.issueId,
      actorUserId: args.actorUserId,
      actorType: 'user',
      verb: 'checklist_completed',
      metadata: { totalItems: total },
    });
  }

  private async requireChecklist(
    id: string,
    tenantId: string,
  ): Promise<IssueChecklist> {
    const c = await this.prisma.issueChecklist.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!c) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'checklist_not_found',
          message: 'Чек-лист не найден',
        },
      });
    }
    return c;
  }

  private async requireItem(
    id: string,
    tenantId: string,
  ): Promise<IssueChecklistItem> {
    const i = await this.prisma.issueChecklistItem.findFirst({
      where: { id, tenantId },
    });
    if (!i) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'checklist_item_not_found',
          message: 'Пункт чек-листа не найден',
        },
      });
    }
    return i;
  }

  private toChecklistResponse(
    c: IssueChecklist,
    items: IssueChecklistItem[],
  ): ChecklistResponseDto {
    let total = 0;
    let done = 0;
    for (const it of items) {
      total += 1;
      if (it.isDone) done += 1;
    }
    return {
      id: c.id,
      tenantId: c.tenantId,
      issueId: c.issueId,
      title: c.title,
      sequence: c.sequence,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      deletedAt: c.deletedAt?.toISOString() ?? null,
      items: items.map((it) => this.toItemResponse(it)),
      totalCount: total,
      doneCount: done,
    };
  }

  private toItemResponse(i: IssueChecklistItem): ChecklistItemResponseDto {
    return {
      id: i.id,
      tenantId: i.tenantId,
      checklistId: i.checklistId,
      text: i.text,
      isDone: i.isDone,
      sequence: i.sequence,
      completedAt: i.completedAt?.toISOString() ?? null,
      completedById: i.completedById,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }
}

