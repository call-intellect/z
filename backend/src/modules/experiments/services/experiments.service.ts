import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Experiment, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateExperimentBody,
  ExperimentDetailDto,
  ExperimentLessonDto,
  ExperimentLessonTypeDto,
  ExperimentListItemDto,
  ExperimentStatusDto,
  ListExperimentsQuery,
  ListExperimentsResponse,
  TransitionExperimentBody,
  UpdateExperimentBody,
} from '../dto/experiments.dto';

@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(args: {
    tenantId: string;
    query: ListExperimentsQuery;
  }): Promise<ListExperimentsResponse> {
    const q = args.query;
    const where: Prisma.ExperimentWhereInput = {
      tenantId: args.tenantId,
    };
    if (q.status) where.status = q.status;
    if (q.owner_entity_id) where.ownerEntityId = q.owner_entity_id;
    if (q.q && q.q.length > 0) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { hypothesisText: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.experiment.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.experiment.count({ where }),
    ]);
    return {
      items: items.map((e) => this.toListItem(e)),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, q.limit))),
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<ExperimentDetailDto> {
    const exp = await this.prisma.experiment.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!exp) this.notFound(args.id);
    return this.toDetail(exp);
  }

  async create(args: {
    tenantId: string;
    body: CreateExperimentBody;
  }): Promise<ExperimentDetailDto> {
    const now = new Date();
    const status: ExperimentStatusDto = args.body.status ?? 'hypothesis';
    const startedAt =
      status === 'running' || status === 'completed' || status === 'dropped' ? now : null;
    const completedAt = status === 'completed' || status === 'dropped' ? now : null;

    const created = await this.prisma.experiment.create({
      data: {
        tenantId: args.tenantId,
        name: args.body.name,
        hypothesisText: args.body.hypothesisText,
        ownerEntityId: args.body.ownerEntityId ?? null,
        status,
        sourceBlockIds: args.body.sourceBlockIds ?? [],
        startedAt,
        completedAt,
        lastConfirmedAt: now,
        confidence: new Prisma.Decimal(0.9),
      },
    });
    await this.writeVersion(created, 'manual_create');
    return this.toDetail(created);
  }

  async update(args: {
    tenantId: string;
    id: string;
    body: UpdateExperimentBody;
  }): Promise<ExperimentDetailDto> {
    const existing = await this.prisma.experiment.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    const data: Prisma.ExperimentUpdateInput = {
      lastConfirmedAt: new Date(),
    };
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.hypothesisText !== undefined) {
      data.hypothesisText = args.body.hypothesisText;
    }
    if (args.body.ownerEntityId !== undefined) {
      data.ownerEntityId = args.body.ownerEntityId;
    }
    if (args.body.currentResult !== undefined) {
      data.currentResult = args.body.currentResult;
    }
    if (args.body.lessons !== undefined) {
      const sanitized = args.body.lessons.map((l) => ({
        text: l.text,
        type: l.type,
        sourceBlockId: l.sourceBlockId ?? null,
      }));
      data.lessonsJson =
        sanitized.length > 0 ? (sanitized as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
    }

    const updated = await this.prisma.experiment.update({
      where: { id: existing.id },
      data,
    });
    await this.writeVersion(updated, 'manual_update');
    return this.toDetail(updated);
  }

  async transition(args: {
    tenantId: string;
    id: string;
    body: TransitionExperimentBody;
  }): Promise<ExperimentDetailDto> {
    const existing = await this.prisma.experiment.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    const now = new Date();
    const status: ExperimentStatusDto = args.body.to;
    const data: Prisma.ExperimentUpdateInput = {
      status,
      lastConfirmedAt: now,
    };
    if (
      (status === 'running' || status === 'completed' || status === 'dropped') &&
      !existing.startedAt
    ) {
      data.startedAt = now;
    }
    if ((status === 'completed' || status === 'dropped') && !existing.completedAt) {
      data.completedAt = now;
    }
    const updated = await this.prisma.experiment.update({
      where: { id: existing.id },
      data,
    });
    await this.writeVersion(updated, `manual_transition_to_${args.body.to}`);
    return this.toDetail(updated);
  }

  async softDelete(args: { tenantId: string; id: string }): Promise<{ ok: true }> {
    const existing = await this.prisma.experiment.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);
    await this.prisma.experiment.update({
      where: { id: existing.id },
      data: {
        status: 'dropped',
        completedAt: existing.completedAt ?? new Date(),
        lastConfirmedAt: new Date(),
      },
    });
    return { ok: true };
  }

  private async writeVersion(exp: Experiment, changeReason: string): Promise<void> {
    try {
      const last = await this.prisma.experimentVersion.findFirst({
        where: { experimentId: exp.id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const next = (last?.versionNumber ?? 0) + 1;
      const created = await this.prisma.experimentVersion.create({
        data: {
          experimentId: exp.id,
          tenantId: exp.tenantId,
          versionNumber: next,
          snapshotJson: this.snapshotPayload(exp),
          changeReason: changeReason.slice(0, 120),
        },
      });
      await this.prisma.experiment.update({
        where: { id: exp.id },
        data: { currentVersionId: created.id },
      });
    } catch (err) {
      this.logger.warn(
        {
          experimentId: exp.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'experiments.writeVersion: пропускаю (best-effort)',
      );
    }
  }

  private snapshotPayload(exp: Experiment): Prisma.InputJsonValue {
    return {
      name: exp.name,
      hypothesisText: exp.hypothesisText,
      status: exp.status,
      currentResult: exp.currentResult,
      lessonsJson: exp.lessonsJson ?? null,
      sourceBlockIds: exp.sourceBlockIds,
      personSubjectIds: exp.personSubjectIds,
      ownerEntityId: exp.ownerEntityId,
      startedAt: exp.startedAt ? exp.startedAt.toISOString() : null,
      completedAt: exp.completedAt ? exp.completedAt.toISOString() : null,
      confidence: Number(exp.confidence),
    } as Prisma.InputJsonValue;
  }

  private toListItem(exp: Experiment): ExperimentListItemDto {
    const lessons = this.parseLessons(exp.lessonsJson);
    return {
      id: exp.id,
      name: exp.name,
      hypothesisText: exp.hypothesisText,
      status: exp.status as ExperimentStatusDto,
      ownerEntityId: exp.ownerEntityId,
      currentResult: exp.currentResult,
      lessonsCount: lessons.length,
      startedAt: exp.startedAt ? exp.startedAt.toISOString() : null,
      completedAt: exp.completedAt ? exp.completedAt.toISOString() : null,
      confidence: Number(exp.confidence),
      sourceBlocksCount: exp.sourceBlockIds.length,
      updatedAt: exp.updatedAt.toISOString(),
      createdAt: exp.createdAt.toISOString(),
    };
  }

  private toDetail(exp: Experiment): ExperimentDetailDto {
    const lessons = this.parseLessons(exp.lessonsJson);
    return {
      ...this.toListItem(exp),
      lessons,
      sourceBlockIds: exp.sourceBlockIds,
      personSubjectIds: exp.personSubjectIds,
      entityId: exp.entityId,
      currentVersionId: exp.currentVersionId,
      lastConfirmedAt: exp.lastConfirmedAt ? exp.lastConfirmedAt.toISOString() : null,
    };
  }

  private parseLessons(raw: Prisma.JsonValue | null): ExperimentLessonDto[] {
    if (!Array.isArray(raw)) return [];
    const result: ExperimentLessonDto[] = [];
    for (const item of raw as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as {
        text?: unknown;
        type?: unknown;
        sourceBlockId?: unknown;
      };
      if (typeof obj.text !== 'string' || typeof obj.type !== 'string') {
        continue;
      }
      const type = obj.type as ExperimentLessonTypeDto;
      if (!['what_worked', 'what_failed', 'next_time'].includes(type)) continue;
      result.push({
        text: obj.text,
        type,
        sourceBlockId: typeof obj.sourceBlockId === 'string' ? obj.sourceBlockId : null,
      });
    }
    return result;
  }

  private notFound(id: string): never {
    throw new NotFoundException({
      ok: false,
      error: {
        code: 'experiment_not_found',
        message: `Эксперимент ${id} не найден.`,
      },
    });
  }
}
