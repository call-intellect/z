import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateProcessHandoffBody,
  ListProcessHandoffsQuery,
  ListProcessHandoffsResponse,
  ProcessHandoffDto,
  UpdateProcessHandoffBody,
} from '../dto/processes.dto';

/**
 * SBA α-7 wave 2 — ProcessHandoffService.
 *
 * CRUD для `ProcessHandoff`. Handoff — связь между шаблонами (см. §3.4):
 * `sourceTemplateId → targetTemplateId`. Допускаются также role-handoff'ы
 * (без template'ов). traversal: получаем входящие/исходящие handoff'ы
 * конкретного template'а одним запросом.
 */
@Injectable()
export class ProcessHandoffService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async list(args: {
    tenantId: string;
    query: ListProcessHandoffsQuery;
  }): Promise<ListProcessHandoffsResponse> {
    const q = args.query;
    const where: Prisma.ProcessHandoffWhereInput = {
      tenantId: args.tenantId,
    };
    if (q.sourceTemplateId) where.fromTemplateId = q.sourceTemplateId;
    if (q.targetTemplateId) where.toTemplateId = q.targetTemplateId;
    if (q.kind) where.kind = q.kind;

    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      this.prisma.processHandoff.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: q.limit,
      }),
      this.prisma.processHandoff.count({ where }),
    ]);

    return {
      items: items.map((h) => this.toDto(h)),
      total,
    };
  }

  async create(args: {
    tenantId: string;
    body: CreateProcessHandoffBody;
  }): Promise<ProcessHandoffDto> {
    // Проверим что template'ы (если указаны) принадлежат этому tenant'у.
    const checks: Promise<unknown>[] = [];
    if (args.body.fromTemplateId) {
      checks.push(
        this.prisma.processTemplate
          .findFirst({
            where: { id: args.body.fromTemplateId, tenantId: args.tenantId },
            select: { id: true },
          })
          .then((x) => {
            if (!x) throw this.bad('Источник handoff не найден.');
          }),
      );
    }
    if (args.body.toTemplateId) {
      checks.push(
        this.prisma.processTemplate
          .findFirst({
            where: { id: args.body.toTemplateId, tenantId: args.tenantId },
            select: { id: true },
          })
          .then((x) => {
            if (!x) throw this.bad('Получатель handoff не найден.');
          }),
      );
    }
    await Promise.all(checks);

    const created = await this.prisma.processHandoff.create({
      data: {
        tenantId: args.tenantId,
        fromTemplateId: args.body.fromTemplateId ?? null,
        toTemplateId: args.body.toTemplateId ?? null,
        fromRoleId: args.body.fromRoleId ?? null,
        toRoleId: args.body.toRoleId ?? null,
        kind: args.body.kind,
        payloadDescription: args.body.payloadDescription ?? null,
        expectedSlaHours: args.body.expectedSlaHours ?? null,
      },
    });
    return this.toDto(created);
  }

  async update(args: {
    tenantId: string;
    id: string;
    body: UpdateProcessHandoffBody;
  }): Promise<ProcessHandoffDto> {
    const h = await this.prisma.processHandoff.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!h) throw this.notFound(args.id);

    const data: Prisma.ProcessHandoffUpdateInput = {};
    if (args.body.fromTemplateId !== undefined) {
      data.fromTemplate = args.body.fromTemplateId
        ? { connect: { id: args.body.fromTemplateId } }
        : { disconnect: true };
    }
    if (args.body.toTemplateId !== undefined) {
      data.toTemplate = args.body.toTemplateId
        ? { connect: { id: args.body.toTemplateId } }
        : { disconnect: true };
    }
    if (args.body.fromRoleId !== undefined) {
      data.fromRole = args.body.fromRoleId
        ? { connect: { id: args.body.fromRoleId } }
        : { disconnect: true };
    }
    if (args.body.toRoleId !== undefined) {
      data.toRole = args.body.toRoleId
        ? { connect: { id: args.body.toRoleId } }
        : { disconnect: true };
    }
    if (args.body.kind !== undefined) data.kind = args.body.kind;
    if (args.body.payloadDescription !== undefined)
      data.payloadDescription = args.body.payloadDescription ?? null;
    if (args.body.expectedSlaHours !== undefined)
      data.expectedSlaHours = args.body.expectedSlaHours ?? null;

    const updated = await this.prisma.processHandoff.update({
      where: { id: args.id },
      data,
    });
    return this.toDto(updated);
  }

  async delete(args: { tenantId: string; id: string }): Promise<{ ok: true }> {
    const h = await this.prisma.processHandoff.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!h) throw this.notFound(args.id);
    await this.prisma.processHandoff.delete({ where: { id: args.id } });
    return { ok: true };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private toDto(h: {
    id: string;
    fromTemplateId: string | null;
    toTemplateId: string | null;
    fromRoleId: string | null;
    toRoleId: string | null;
    kind: string;
    payloadDescription: string | null;
    expectedSlaHours: number | null;
    knownFrictionCount: number;
    createdAt: Date;
    updatedAt: Date;
  }): ProcessHandoffDto {
    const k = h.kind;
    const kind: ProcessHandoffDto['kind'] =
      k === 'document' ||
      k === 'data' ||
      k === 'decision' ||
      k === 'physical' ||
      k === 'notification'
        ? k
        : 'data';
    return {
      id: h.id,
      fromTemplateId: h.fromTemplateId,
      toTemplateId: h.toTemplateId,
      fromRoleId: h.fromRoleId,
      toRoleId: h.toRoleId,
      kind,
      payloadDescription: h.payloadDescription,
      expectedSlaHours: h.expectedSlaHours,
      knownFrictionCount: h.knownFrictionCount,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    };
  }

  private notFound(id: string) {
    return new NotFoundException({
      ok: false,
      error: {
        code: 'process_handoff_not_found',
        message: `Handoff ${id} не найден.`,
      },
    });
  }

  private bad(message: string) {
    return new NotFoundException({
      ok: false,
      error: { code: 'invalid_handoff_refs', message },
    });
  }
}
