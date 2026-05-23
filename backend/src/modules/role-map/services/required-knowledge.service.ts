import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CreateRequiredKnowledgeDto,
  KnowledgeImportance,
  KnowledgeLevel,
  RequiredKnowledgeDto,
  UpdateRequiredKnowledgeDto,
} from '../dto/role-map.dto';

import { mergeSourceBlocks } from './responsibility-element.service';

/**
 * SBA α-8 wave 4 — CRUD-сервис RequiredKnowledge.
 *
 * γ-1 SkillProfile сверяется с этим для gap-detection
 * (mandatory знания, которых у сотрудника нет — кандидаты на обучение).
 */
@Injectable()
export class RequiredKnowledgeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async listByRole(args: {
    tenantId: string;
    roleId: string;
    importance?: KnowledgeImportance;
  }): Promise<RequiredKnowledgeDto[]> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    const rows = await this.prisma.requiredKnowledge.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        deletedAt: null,
        ...(args.importance ? { importance: args.importance } : {}),
      },
      orderBy: [{ importance: 'asc' }, { topic: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(args: {
    tenantId: string;
    id: string;
  }): Promise<RequiredKnowledgeDto> {
    const row = await this.prisma.requiredKnowledge.findUnique({
      where: { id: args.id },
    });
    if (!row || row.tenantId !== args.tenantId || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'knowledge_not_found',
          message: 'Требование к знаниям не найдено',
        },
      });
    }
    return this.toDto(row);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    roleId: string;
    body: CreateRequiredKnowledgeDto;
  }): Promise<RequiredKnowledgeDto> {
    await this.assertRoleExists(args.tenantId, args.roleId);
    const created = await this.prisma.requiredKnowledge.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        topic: args.body.topic,
        description: args.body.description ?? null,
        importance: args.body.importance,
        expectedLevel: args.body.expectedLevel ?? null,
        sourceBlockIds: args.body.sourceBlockIds ?? [],
        confidence:
          args.body.confidence !== undefined
            ? new Prisma.Decimal(args.body.confidence)
            : null,
      },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.knowledge.created',
      resourceId: created.id,
      metadata: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        importance: args.body.importance,
      },
    });
    return this.toDto(created);
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateRequiredKnowledgeDto;
  }): Promise<RequiredKnowledgeDto> {
    const existing = await this.prisma.requiredKnowledge.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'knowledge_not_found',
          message: 'Требование к знаниям не найдено',
        },
      });
    }
    const data: Prisma.RequiredKnowledgeUpdateInput = {};
    if (args.body.topic !== undefined) data.topic = args.body.topic;
    if (args.body.description !== undefined) data.description = args.body.description;
    if (args.body.importance !== undefined) data.importance = args.body.importance;
    if (args.body.expectedLevel !== undefined) {
      data.expectedLevel = args.body.expectedLevel;
    }
    if (args.body.confidence !== undefined) {
      data.confidence = new Prisma.Decimal(args.body.confidence);
    }
    if (args.body.sourceBlockIds !== undefined) {
      data.sourceBlockIds = args.body.sourceBlockIds;
    }
    const updated = await this.prisma.requiredKnowledge.update({
      where: { id: args.id },
      data,
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.knowledge.updated',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        roleId: existing.roleId,
        changedFields: Object.keys(args.body),
      },
    });
    return this.toDto(updated);
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.requiredKnowledge.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'knowledge_not_found',
          message: 'Требование к знаниям не найдено',
        },
      });
    }
    await this.prisma.requiredKnowledge.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'role_map.knowledge.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, roleId: existing.roleId },
    });
    return { ok: true };
  }

  async upsertByTopic(args: {
    tenantId: string;
    roleId: string;
    topic: string;
    importance: KnowledgeImportance;
    description?: string | null;
    expectedLevel?: KnowledgeLevel | null;
    sourceBlockIds?: string[];
    confidence?: number | null;
  }): Promise<RequiredKnowledgeDto> {
    const existing = await this.prisma.requiredKnowledge.findFirst({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        topic: args.topic,
        deletedAt: null,
      },
    });
    if (existing) {
      const updated = await this.prisma.requiredKnowledge.update({
        where: { id: existing.id },
        data: {
          importance: args.importance,
          description:
            args.description !== undefined ? args.description : existing.description,
          expectedLevel:
            args.expectedLevel !== undefined
              ? args.expectedLevel
              : existing.expectedLevel,
          sourceBlockIds: mergeSourceBlocks(
            existing.sourceBlockIds,
            args.sourceBlockIds,
          ),
          confidence:
            args.confidence !== undefined && args.confidence !== null
              ? new Prisma.Decimal(args.confidence)
              : existing.confidence,
        },
      });
      return this.toDto(updated);
    }
    const created = await this.prisma.requiredKnowledge.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        topic: args.topic,
        importance: args.importance,
        description: args.description ?? null,
        expectedLevel: args.expectedLevel ?? null,
        sourceBlockIds: args.sourceBlockIds ?? [],
        confidence:
          args.confidence !== undefined && args.confidence !== null
            ? new Prisma.Decimal(args.confidence)
            : null,
      },
    });
    return this.toDto(created);
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private async assertRoleExists(
    tenantId: string,
    roleId: string,
  ): Promise<void> {
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

  private toDto(row: {
    id: string;
    tenantId: string;
    roleId: string;
    topic: string;
    description: string | null;
    importance: string;
    expectedLevel: string | null;
    sourceBlockIds: string[];
    confidence: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
  }): RequiredKnowledgeDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      roleId: row.roleId,
      topic: row.topic,
      description: row.description,
      importance: row.importance as KnowledgeImportance,
      expectedLevel: row.expectedLevel as KnowledgeLevel | null,
      sourceBlockIds: row.sourceBlockIds,
      confidence: row.confidence === null ? null : Number(row.confidence),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
