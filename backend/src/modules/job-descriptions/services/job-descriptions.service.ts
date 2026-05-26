import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  BatchCreateJobDescriptionsDto,
  CreateJobDescriptionDto,
  JobDescriptionDto,
  JobDescriptionListItemDto,
  UpdateJobDescriptionDto,
} from '../dto/job-descriptions.dto';

/**
 * Сервис должностных инструкций (JobDescription — declared-форма).
 *
 * Бизнес-правила:
 *   - Все записи tenant-scoped.
 *   - PATCH увеличивает `version` (+1).
 *   - При создании, если sourceDocumentId передан — EntityLink
 *     `from=job-description, to=document, relationType=derived_from`.
 *   - Также пишем EntityLink `from=role, to=job-description,
 *     relationType=described_by`.
 *   - DELETE — soft.
 */
@Injectable()
export class JobDescriptionsService {
  private readonly logger = new Logger(JobDescriptionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  // ─────────────────────────── list / get ───────────────────────────

  async list(args: {
    tenantId: string;
    roleId?: string;
    includeDeleted: boolean;
    limit: number;
  }): Promise<{ items: JobDescriptionListItemDto[]; total: number }> {
    const where: Prisma.JobDescriptionWhereInput = {
      tenantId: args.tenantId,
      ...(args.includeDeleted ? {} : { deletedAt: null }),
      ...(args.roleId ? { roleId: args.roleId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.jobDescription.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: args.limit,
        include: { role: { select: { name: true } } },
      }),
      this.prisma.jobDescription.count({ where }),
    ]);
    return {
      items: rows.map((j) => this.toListItem(j, j.role.name)),
      total,
    };
  }

  async get(args: { tenantId: string; id: string }): Promise<JobDescriptionDto> {
    const j = await this.prisma.jobDescription.findUnique({
      where: { id: args.id },
      include: { role: { select: { name: true } } },
    });
    if (!j || j.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'job_description_not_found',
          message: 'Должностная инструкция не найдена',
        },
      });
    }
    return this.toListItem(j, j.role.name);
  }

  // ─────────────────────────── create / update / delete ─────────────

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateJobDescriptionDto;
  }): Promise<JobDescriptionDto> {
    await this.assertRoleExists(args.tenantId, args.body.roleId);
    if (args.body.sourceDocumentId) {
      await this.assertDocumentExists(args.tenantId, args.body.sourceDocumentId);
    }

    const createdId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.jobDescription.create({
        data: {
          tenantId: args.tenantId,
          roleId: args.body.roleId,
          contentMd: args.body.contentMd,
          sourceDocumentId: args.body.sourceDocumentId ?? null,
          version: 1,
        },
      });

      // Role → JobDescription (described_by).
      await tx.entityLink.create({
        data: {
          tenantId: args.tenantId,
          fromEntityId: args.body.roleId,
          toEntityId: created.id,
          fromType: 'role',
          toType: 'job-description',
          relationType: 'described_by',
          confidence: new Prisma.Decimal('1.000'),
          explanation: 'Должность получила должностную инструкцию вручную',
          createdBy: 'manual',
          status: 'active',
          properties: {},
        },
      });

      // JobDescription → Document (derived_from), если есть источник.
      if (args.body.sourceDocumentId) {
        await tx.entityLink.create({
          data: {
            tenantId: args.tenantId,
            fromEntityId: created.id,
            toEntityId: args.body.sourceDocumentId,
            fromType: 'job-description',
            toType: 'document',
            relationType: 'derived_from',
            confidence: new Prisma.Decimal('1.000'),
            explanation: 'Должностная инструкция извлечена из исходного документа',
            createdBy: 'manual',
            status: 'active',
            properties: {},
          },
        });
      }

      return created.id;
    });

    void this.audit.log({
      userId: args.userId,
      action: 'job_description.created',
      resourceId: createdId,
      metadata: { tenantId: args.tenantId, roleId: args.body.roleId },
    });

    return this.get({ tenantId: args.tenantId, id: createdId });
  }

  async createBatch(args: {
    tenantId: string;
    userId: string;
    body: BatchCreateJobDescriptionsDto;
  }): Promise<{ items: JobDescriptionDto[]; created: number }> {
    const items: JobDescriptionDto[] = [];
    for (const it of args.body.items) {
      items.push(
        await this.create({ tenantId: args.tenantId, userId: args.userId, body: it }),
      );
    }
    return { items, created: items.length };
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateJobDescriptionDto;
  }): Promise<JobDescriptionDto> {
    const existing = await this.prisma.jobDescription.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'job_description_not_found',
          message: 'Должностная инструкция не найдена',
        },
      });
    }
    if (
      args.body.sourceDocumentId !== undefined &&
      args.body.sourceDocumentId !== null
    ) {
      await this.assertDocumentExists(args.tenantId, args.body.sourceDocumentId);
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.JobDescriptionUpdateInput = {
        version: { increment: 1 },
      };
      if (args.body.contentMd !== undefined) data.contentMd = args.body.contentMd;
      if (args.body.sourceDocumentId !== undefined) {
        if (args.body.sourceDocumentId === null) {
          data.sourceDocument = { disconnect: true };
        } else {
          data.sourceDocument = { connect: { id: args.body.sourceDocumentId } };
        }
      }
      await tx.jobDescription.update({
        where: { id: args.id },
        data,
      });

      // EntityLink derived_from синхронизируем при смене source.
      if (
        args.body.sourceDocumentId !== undefined &&
        args.body.sourceDocumentId !== existing.sourceDocumentId
      ) {
        const now = new Date();
        await tx.entityLink.updateMany({
          where: {
            tenantId: args.tenantId,
            fromEntityId: args.id,
            fromType: 'job-description',
            relationType: 'derived_from',
            deletedAt: null,
          },
          data: {
            status: 'archived',
            deletedAt: now,
            validTo: now,
            deletedBy: args.userId,
          },
        });
        if (args.body.sourceDocumentId) {
          await tx.entityLink.create({
            data: {
              tenantId: args.tenantId,
              fromEntityId: args.id,
              toEntityId: args.body.sourceDocumentId,
              fromType: 'job-description',
              toType: 'document',
              relationType: 'derived_from',
              confidence: new Prisma.Decimal('1.000'),
              explanation:
                'Должностная инструкция перепривязана к новому исходному документу',
              createdBy: 'manual',
              status: 'active',
              properties: {},
            },
          });
        }
      }
    });

    void this.audit.log({
      userId: args.userId,
      action: 'job_description.updated',
      resourceId: args.id,
      metadata: {
        tenantId: args.tenantId,
        changedFields: Object.keys(args.body),
      },
    });

    return this.get({ tenantId: args.tenantId, id: args.id });
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.prisma.jobDescription.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'job_description_not_found',
          message: 'Должностная инструкция не найдена',
        },
      });
    }
    if (existing.deletedAt) {
      return { id: existing.id, deletedAt: existing.deletedAt.toISOString() };
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.jobDescription.update({
        where: { id: args.id },
        data: { deletedAt: now },
      });
      await tx.entityLink.updateMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          OR: [
            { fromEntityId: args.id, fromType: 'job-description' },
            { toEntityId: args.id, toType: 'job-description' },
          ],
        },
        data: {
          status: 'archived',
          deletedAt: now,
          validTo: now,
          deletedBy: args.userId,
        },
      });
    });
    void this.audit.log({
      userId: args.userId,
      action: 'job_description.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    return { id: args.id, deletedAt: now.toISOString() };
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
          message: 'Указанная должность не найдена',
        },
      });
    }
  }

  private async assertDocumentExists(
    tenantId: string,
    documentId: string,
  ): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!doc || doc.tenantId !== tenantId || doc.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'document_not_found',
          message: 'Указанный документ не найден',
        },
      });
    }
  }

  private toListItem(
    j: {
      id: string;
      roleId: string;
      contentMd: string;
      sourceDocumentId: string | null;
      version: number;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    },
    roleName: string,
  ): JobDescriptionListItemDto {
    return {
      id: j.id,
      roleId: j.roleId,
      roleName,
      contentMd: j.contentMd,
      sourceDocumentId: j.sourceDocumentId,
      version: j.version,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
      deletedAt: j.deletedAt ? j.deletedAt.toISOString() : null,
    };
  }
}
