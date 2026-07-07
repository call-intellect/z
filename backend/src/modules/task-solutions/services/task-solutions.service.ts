import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { AUDIT } from '../../audit/audit.types';
import {
  type ProvenancePreviewRef,
  ProvenanceService,
  type ProvenanceSourceRef,
} from '../../knowledge-core/services/provenance.service';
import type {
  ListTaskSolutionsQuery,
  ListTaskSolutionsResponse,
  TaskSolutionDetailDto,
  TaskSolutionHistoryResponse,
  TaskSolutionListItemDto,
  TaskSolutionSourcesResponse,
  TaskSolutionSummaryResponse,
} from '../dto/task-solutions.dto';

const TASK_DESCRIPTION_LIST_LIMIT = 280;

type TaskSolutionRow = NonNullable<
  Awaited<ReturnType<PrismaService['taskSolution']['findFirst']>>
>;

@Injectable()
export class TaskSolutionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(ProvenanceService)
    private readonly provenance: ProvenanceService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly audit: AuditLogService | null = null,
  ) {}

  async list(args: {
    tenantId: string;
    query: ListTaskSolutionsQuery;
  }): Promise<ListTaskSolutionsResponse> {
    const q = args.query;
    const where: Prisma.TaskSolutionWhereInput = {
      tenantId: args.tenantId,
      deletedAt: q.deleted ? { not: null } : null,
    };
    if (q.status) where.status = q.status;
    if (q.ownerPersonId) where.ownerPersonId = q.ownerPersonId;
    if (q.candidateInstruction !== undefined) {
      where.candidateInstruction = q.candidateInstruction;
    }
    if (q.skill) where.skillTags = { has: q.skill };
    if (q.q) {
      where.OR = [
        { title: { contains: q.q, mode: 'insensitive' } },
        { taskDescription: { contains: q.q, mode: 'insensitive' } },
        { solutionMd: { contains: q.q, mode: 'insensitive' } },
      ];
    }

    const skip = (q.page - 1) * q.limit;
    const take = q.limit;
    const [rows, total] = await Promise.all([
      this.prisma.taskSolution.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.taskSolution.count({ where }),
    ]);

    const ownerNameById = await this.resolveOwnerNames(
      args.tenantId,
      rows.map((r) => r.ownerPersonId),
    );
    const repeatGroupSizeByKey = await this.resolveRepeatGroupSizes(
      args.tenantId,
      rows.map((r) => r.repeatGroupKey),
    );

    return {
      items: rows.map((r) =>
        this.toListItem(
          r,
          ownerNameById.get(r.ownerPersonId) ?? null,
          this.repeatSizeFor(r.repeatGroupKey, repeatGroupSizeByKey),
        ),
      ),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<TaskSolutionDetailDto> {
    const row = await this.prisma.taskSolution.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
    });
    if (!row) this.notFound(args.id);

    const sourceIssue = await this.prisma.issue.findFirst({
      where: { id: row.sourceIssueId, tenantId: args.tenantId },
      select: { identifier: true, title: true },
    });
    const ownerNameById = await this.resolveOwnerNames(args.tenantId, [row.ownerPersonId]);
    const repeatGroupSizeByKey = await this.resolveRepeatGroupSizes(args.tenantId, [
      row.repeatGroupKey,
    ]);

    return this.toDetail(
      row,
      ownerNameById.get(row.ownerPersonId) ?? null,
      this.repeatSizeFor(row.repeatGroupKey, repeatGroupSizeByKey),
      sourceIssue,
    );
  }

  async getHistory(args: {
    tenantId: string;
    id: string;
  }): Promise<TaskSolutionHistoryResponse> {
    const versions = await this.prisma.cardVersion.findMany({
      where: {
        tenantId: args.tenantId,
        resourceType: 'task_solution',
        resourceId: args.id,
      },
      orderBy: { version: 'desc' },
      take: 100,
    });
    return {
      items: versions.map((v) => ({
        id: v.id,
        version: v.version,
        previousVersionId: v.previousVersionId,
        payload: (v.payload as Record<string, unknown>) ?? {},
        changeReason: v.changeReason,
        createdAt: v.createdAt.toISOString(),
        createdByUserId: v.createdByUserId,
      })),
    };
  }

  async getSources(args: {
    tenantId: string;
    id: string;
  }): Promise<TaskSolutionSourcesResponse> {
    const rec = await this.prisma.taskSolution.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
      select: { sourceBlockIds: true },
    });
    if (!rec) this.notFound(args.id);
    const sourceBlockIds = rec.sourceBlockIds;
    if (sourceBlockIds.length === 0) return { items: [] };

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: sourceBlockIds }, tenantId: args.tenantId },
      select: { id: true },
    });
    const blockIds = blocks.map((b) => b.id);
    if (blockIds.length === 0) return { items: [] };

    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blockIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        blockId: true,
        quote: true,
        startMs: true,
        rawEventId: true,
      },
    });
    if (evidence.length === 0) return { items: [] };

    const rawEventIds = [...new Set(evidence.map((e) => e.rawEventId))];
    const sourceByRawEvent: Map<string, ProvenanceSourceRef> = this.provenance
      ? await this.provenance.resolveByRawEventIds(args.tenantId, rawEventIds)
      : new Map();

    const meetingIds = new Set<string>();
    for (const ref of sourceByRawEvent.values()) {
      if (ref.type === 'meeting' && ref.refId) meetingIds.add(ref.refId);
    }
    const meetingById = new Map<string, { id: string; title: string; date: string }>();
    if (meetingIds.size > 0) {
      const meetings = await this.prisma.meeting.findMany({
        where: { tenantId: args.tenantId, id: { in: [...meetingIds] } },
        select: { id: true, title: true, startedAt: true, createdAt: true },
      });
      for (const m of meetings) {
        meetingById.set(m.id, {
          id: m.id,
          title: m.title,
          date: (m.startedAt ?? m.createdAt).toISOString(),
        });
      }
    }

    return {
      items: evidence.map((ev) => {
        const ref = sourceByRawEvent.get(ev.rawEventId);
        const meetingId = ref && ref.type === 'meeting' ? ref.refId : null;
        const meeting = meetingId ? (meetingById.get(meetingId) ?? null) : null;
        return {
          blockId: ev.blockId,
          quote: ev.quote,
          startMs: ev.startMs ?? null,
          meeting,
        };
      }),
    };
  }

  async getSummary(tenantId: string): Promise<TaskSolutionSummaryResponse> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, candidates, weekDelta] = await Promise.all([
      this.prisma.taskSolution.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.taskSolution.count({
        where: {
          tenantId,
          deletedAt: null,
          candidateInstruction: true,
          promotedToInstructionId: null,
        },
      }),
      this.prisma.taskSolution.count({
        where: { tenantId, deletedAt: null, createdAt: { gte: weekAgo } },
      }),
    ]);
    return { total, candidates, weekDelta };
  }

  async confirm(args: {
    tenantId: string;
    id: string;
  }): Promise<{ ok: true; lastConfirmedAt: string }> {
    const exists = await this.prisma.taskSolution.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) this.notFound(args.id);
    const now = new Date();
    await this.prisma.taskSolution.update({
      where: { id: args.id },
      data: { lastConfirmedAt: now },
    });
    return { ok: true, lastConfirmedAt: now.toISOString() };
  }

  async softDelete(args: {
    tenantId: string;
    id: string;
    actorUserId: string;
  }): Promise<{ ok: true }> {
    const exists = await this.prisma.taskSolution.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) this.notFound(args.id);
    await this.prisma.taskSolution.update({
      where: { id: args.id },
      data: { deletedAt: new Date(), deletedById: args.actorUserId },
    });
    await this.audit?.log({
      action: AUDIT.TASK_SOLUTION_DELETE,
      userId: args.actorUserId,
      resourceId: args.id,
    });
    return { ok: true };
  }

  async restore(args: {
    tenantId: string;
    id: string;
    actorUserId: string;
  }): Promise<{ ok: true }> {
    const rec = await this.prisma.taskSolution.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true, deletedAt: true },
    });
    if (!rec) this.notFound(args.id);
    if (rec.deletedAt === null) return { ok: true };
    await this.prisma.taskSolution.update({
      where: { id: args.id },
      data: { deletedAt: null, deletedById: null },
    });
    await this.audit?.log({
      action: AUDIT.TASK_SOLUTION_RESTORE,
      userId: args.actorUserId,
      resourceId: args.id,
    });
    return { ok: true };
  }

  private async resolveOwnerNames(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, string | null>> {
    const uniq = [...new Set(ids.filter((id) => id.length > 0))];
    if (uniq.length === 0) return new Map();
    const persons = await this.prisma.person.findMany({
      where: { id: { in: uniq }, tenantId },
      select: { id: true, name: true },
    });
    return new Map(persons.map((p) => [p.id, p.name]));
  }

  private async resolveRepeatGroupSizes(
    tenantId: string,
    keys: (string | null)[],
  ): Promise<Map<string, number>> {
    const uniq = [...new Set(keys.filter((k): k is string => k !== null && k.length > 0))];
    if (uniq.length === 0) return new Map();
    const grouped = await this.prisma.taskSolution.groupBy({
      by: ['repeatGroupKey'],
      where: { tenantId, deletedAt: null, repeatGroupKey: { in: uniq } },
      _count: { _all: true },
    });
    const out = new Map<string, number>();
    for (const g of grouped) {
      if (g.repeatGroupKey) out.set(g.repeatGroupKey, g._count._all);
    }
    return out;
  }

  private repeatSizeFor(key: string | null, sizes: Map<string, number>): number {
    if (!key) return 0;
    return sizes.get(key) ?? 0;
  }

  private toListItem(
    r: TaskSolutionRow,
    ownerName: string | null,
    repeatGroupSize: number,
  ): TaskSolutionListItemDto {
    const description =
      r.taskDescription.length > TASK_DESCRIPTION_LIST_LIMIT
        ? r.taskDescription.slice(0, TASK_DESCRIPTION_LIST_LIMIT)
        : r.taskDescription;
    return {
      id: r.id,
      title: r.title,
      taskDescription: description,
      ownerPersonId: r.ownerPersonId,
      ownerName,
      skillTags: r.skillTags,
      status: r.status,
      sourceIssueId: r.sourceIssueId,
      repeatGroupKey: r.repeatGroupKey ?? null,
      repeatGroupSize,
      candidateInstruction: r.candidateInstruction,
      promotedToInstructionId: r.promotedToInstructionId ?? null,
      previewQuote: r.previewQuote ?? null,
      previewSourceRef: (r.previewSourceRef as ProvenancePreviewRef | null) ?? null,
      lastConfirmedAt: r.lastConfirmedAt ? r.lastConfirmedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toDetail(
    r: TaskSolutionRow,
    ownerName: string | null,
    repeatGroupSize: number,
    sourceIssue: { identifier: string; title: string } | null,
  ): TaskSolutionDetailDto {
    const base = this.toListItem(r, ownerName, repeatGroupSize);
    return {
      ...base,
      taskDescription: r.taskDescription,
      solutionMd: r.solutionMd,
      sourceBlockIds: r.sourceBlockIds,
      personSubjectIds: r.personSubjectIds,
      currentVersionId: r.currentVersionId ?? null,
      version: r.version,
      dataClass: r.dataClass,
      sourceIssueIdentifier: sourceIssue?.identifier ?? null,
      sourceIssueTitle: sourceIssue?.title ?? null,
    };
  }

  private notFound(id: string): never {
    throw new NotFoundException({
      ok: false,
      error: {
        code: 'task_solution_not_found',
        message: `Решение задачи ${id} не найдено в этой организации.`,
      },
    });
  }
}
