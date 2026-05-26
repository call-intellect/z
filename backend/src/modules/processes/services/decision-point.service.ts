import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateDecisionPointBody,
  DecisionPointDto,
  ListDecisionPointsQuery,
  ListDecisionPointsResponse,
  UpdateDecisionPointBody,
} from '../dto/processes.dto';

/**
 * SBA α-7 wave 2 — DecisionPointService.
 *
 * CRUD для `DecisionPoint`. DecisionPoint всегда привязан к
 * `ProcessTemplate.id` (а не к конкретной версии — версия — это snapshot
 * definition'а; DecisionPoint живёт «поверх» template'а и видим всем версиям).
 * См. §3.3 sub-TZ.
 *
 * Не бросает на «нет данных» — отдаёт пустой список.
 */
@Injectable()
export class DecisionPointService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async list(args: {
    tenantId: string;
    query: ListDecisionPointsQuery;
  }): Promise<ListDecisionPointsResponse> {
    const q = args.query;
    const where: Prisma.DecisionPointWhereInput = {
      tenantId: args.tenantId,
    };
    if (q.templateId) where.templateId = q.templateId;
    // templateVersionId — в текущей schema DecisionPoint живёт на templateId,
    // не на versionId (см. §3.3). Параметр оставлен для будущего расширения;
    // на α-7 wave 2 — игнорируем без ошибки.
    void q.templateVersionId;

    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      this.prisma.decisionPoint.findMany({
        where,
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: q.limit,
      }),
      this.prisma.decisionPoint.count({ where }),
    ]);

    return {
      items: items.map((dp) => this.toDto(dp)),
      total,
    };
  }

  async create(args: {
    tenantId: string;
    body: CreateDecisionPointBody;
  }): Promise<DecisionPointDto> {
    // Проверяем, что template принадлежит этому tenant'у.
    const t = await this.prisma.processTemplate.findFirst({
      where: { id: args.body.templateId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!t) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'template_not_found',
          message: 'Шаблон процесса не найден.',
        },
      });
    }
    const created = await this.prisma.decisionPoint.create({
      data: {
        tenantId: args.tenantId,
        templateId: args.body.templateId,
        name: args.body.name,
        condition: args.body.condition ?? null,
        branchesJson: args.body.branches as unknown as Prisma.InputJsonValue,
        decidedByRoleId: args.body.decidedByRoleId ?? null,
        order: args.body.order ?? 0,
      },
    });
    return this.toDto(created);
  }

  async update(args: {
    tenantId: string;
    id: string;
    body: UpdateDecisionPointBody;
  }): Promise<DecisionPointDto> {
    const dp = await this.prisma.decisionPoint.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!dp) throw this.notFound(args.id);

    const data: Prisma.DecisionPointUpdateInput = {};
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.condition !== undefined)
      data.condition = args.body.condition ?? null;
    if (args.body.branches !== undefined)
      data.branchesJson = args.body.branches as unknown as Prisma.InputJsonValue;
    if (args.body.decidedByRoleId !== undefined) {
      data.decidedByRole = args.body.decidedByRoleId
        ? { connect: { id: args.body.decidedByRoleId } }
        : { disconnect: true };
    }
    if (args.body.order !== undefined) data.order = args.body.order;

    const updated = await this.prisma.decisionPoint.update({
      where: { id: args.id },
      data,
    });
    return this.toDto(updated);
  }

  async delete(args: { tenantId: string; id: string }): Promise<{ ok: true }> {
    const dp = await this.prisma.decisionPoint.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!dp) throw this.notFound(args.id);
    await this.prisma.decisionPoint.delete({ where: { id: args.id } });
    return { ok: true };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private toDto(dp: {
    id: string;
    templateId: string | null;
    name: string;
    condition: string | null;
    branchesJson: Prisma.JsonValue;
    decidedByRoleId: string | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): DecisionPointDto {
    return {
      id: dp.id,
      templateId: dp.templateId,
      name: dp.name,
      condition: dp.condition,
      branches: Array.isArray(dp.branchesJson)
        ? (dp.branchesJson as Array<{
            name: string;
            description?: string;
            leadsToStepOrder?: number;
          }>)
        : [],
      decidedByRoleId: dp.decidedByRoleId,
      order: dp.order,
      createdAt: dp.createdAt.toISOString(),
      updatedAt: dp.updatedAt.toISOString(),
    };
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      ok: false,
      error: {
        code: 'decision_point_not_found',
        message: `Точка принятия решения ${id} не найдена.`,
      },
    });
  }
}
