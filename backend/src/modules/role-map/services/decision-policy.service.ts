import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CreateDecisionPolicyDto,
  DecisionPolicyDto,
  UpdateDecisionPolicyDto,
} from '../dto/role-map.dto';

import { mergeSourceBlocks } from './responsibility-element.service';

@Injectable()
export class DecisionPolicyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async listByRole(args: { tenantId: string; roleId: string }): Promise<DecisionPolicyDto[]> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    const rows = await this.prisma.decisionPolicy.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        deletedAt: null,
      },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(args: { tenantId: string; id: string }): Promise<DecisionPolicyDto> {
    const row = await this.prisma.decisionPolicy.findUnique({
      where: { id: args.id },
    });
    if (!row || row.tenantId !== args.tenantId || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'decision_policy_not_found',
          message: 'Политика принятия решений не найдена',
        },
      });
    }
    return this.toDto(row);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    roleId: string;
    body: CreateDecisionPolicyDto;
  }): Promise<DecisionPolicyDto> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    if (args.body.regulationId) {
      await this.assertRegulationExists(args.tenantId, args.body.regulationId);
    }
    const created = await this.prisma.decisionPolicy.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        name: args.body.name,
        conditionDescription: args.body.conditionDescription ?? null,
        ruleDescription: args.body.ruleDescription,
        regulationId: args.body.regulationId ?? null,
        sourceBlockIds: args.body.sourceBlockIds ?? [],
        confidence:
          args.body.confidence !== undefined ? new Prisma.Decimal(args.body.confidence) : null,
      },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.decision_policy.created',
      resourceId: created.id,
      metadata: { tenantId: args.tenantId, roleId: args.roleId },
    });
    return this.toDto(created);
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateDecisionPolicyDto;
  }): Promise<DecisionPolicyDto> {
    const existing = await this.prisma.decisionPolicy.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'decision_policy_not_found',
          message: 'Политика принятия решений не найдена',
        },
      });
    }
    if (args.body.regulationId) {
      await this.assertRegulationExists(args.tenantId, args.body.regulationId);
    }
    const data: Prisma.DecisionPolicyUpdateInput = {};
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.conditionDescription !== undefined) {
      data.conditionDescription = args.body.conditionDescription;
    }
    if (args.body.ruleDescription !== undefined) {
      data.ruleDescription = args.body.ruleDescription;
    }
    if (args.body.regulationId !== undefined) {
      data.regulation =
        args.body.regulationId === null
          ? { disconnect: true }
          : { connect: { id: args.body.regulationId } };
    }
    if (args.body.confidence !== undefined) {
      data.confidence = new Prisma.Decimal(args.body.confidence);
    }
    if (args.body.sourceBlockIds !== undefined) {
      data.sourceBlockIds = args.body.sourceBlockIds;
    }
    const updated = await this.prisma.decisionPolicy.update({
      where: { id: args.id },
      data,
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.decision_policy.updated',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        roleId: existing.roleId,
        changedFields: Object.keys(args.body),
      },
    });
    return this.toDto(updated);
  }

  async softDelete(args: { tenantId: string; userId: string; id: string }): Promise<{ ok: true }> {
    const existing = await this.prisma.decisionPolicy.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'decision_policy_not_found',
          message: 'Политика принятия решений не найдена',
        },
      });
    }
    await this.prisma.decisionPolicy.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.decision_policy.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, roleId: existing.roleId },
    });
    return { ok: true };
  }

  async upsertByName(args: {
    tenantId: string;
    roleId: string;
    name: string;
    ruleDescription: string;
    conditionDescription?: string | null;
    sourceBlockIds?: string[];
    confidence?: number | null;
  }): Promise<DecisionPolicyDto> {
    const existing = await this.prisma.decisionPolicy.findFirst({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        name: args.name,
        deletedAt: null,
      },
    });
    if (existing) {
      const updated = await this.prisma.decisionPolicy.update({
        where: { id: existing.id },
        data: {
          ruleDescription: args.ruleDescription,
          conditionDescription:
            args.conditionDescription !== undefined
              ? args.conditionDescription
              : existing.conditionDescription,
          sourceBlockIds: mergeSourceBlocks(existing.sourceBlockIds, args.sourceBlockIds),
          confidence:
            args.confidence !== undefined && args.confidence !== null
              ? new Prisma.Decimal(args.confidence)
              : existing.confidence,
        },
      });
      return this.toDto(updated);
    }
    const created = await this.prisma.decisionPolicy.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        name: args.name,
        ruleDescription: args.ruleDescription,
        conditionDescription: args.conditionDescription ?? null,
        sourceBlockIds: args.sourceBlockIds ?? [],
        confidence:
          args.confidence !== undefined && args.confidence !== null
            ? new Prisma.Decimal(args.confidence)
            : null,
      },
    });
    return this.toDto(created);
  }

  private async assertRoleExists(tenantId: string, roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!role || role.tenantId !== tenantId || role.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'role_not_found',
          message: 'Должность не найдена или удалена',
        },
      });
    }
  }

  private async assertRegulationExists(tenantId: string, regulationId: string): Promise<void> {
    const reg = await this.prisma.regulation.findUnique({
      where: { id: regulationId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!reg || reg.tenantId !== tenantId || reg.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'regulation_not_found',
          message: 'Регламент не найден или удалён',
        },
      });
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    roleId: string;
    name: string;
    conditionDescription: string | null;
    ruleDescription: string;
    regulationId: string | null;
    sourceBlockIds: string[];
    confidence: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
  }): DecisionPolicyDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      name: row.name,
      conditionDescription: row.conditionDescription,
      ruleDescription: row.ruleDescription,
      regulationId: row.regulationId,
      sourceBlockIds: row.sourceBlockIds,
      confidence: row.confidence === null ? null : Number(row.confidence),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
