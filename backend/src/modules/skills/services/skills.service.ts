import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  BatchCreateSkillsDto,
  CreateSkillDto,
  SkillDto,
  SkillListItemDto,
  UpdateSkillDto,
} from '../dto/skills.dto';

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async list(args: {
    tenantId: string;
    q?: string;
    includeDeleted: boolean;
    limit: number;
  }): Promise<{ items: SkillListItemDto[]; total: number }> {
    const where: Prisma.SkillWhereInput = {
      tenantId: args.tenantId,
      ...(args.includeDeleted ? {} : { deletedAt: null }),
      ...(args.q
        ? { name: { contains: args.q, mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.skill.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: args.limit,
      }),
      this.prisma.skill.count({ where }),
    ]);
    return {
      items: rows.map((s) => this.toListItem(s)),
      total,
    };
  }

  async get(args: { tenantId: string; id: string }): Promise<SkillDto> {
    const s = await this.prisma.skill.findUnique({ where: { id: args.id } });
    if (!s || s.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'skill_not_found', message: 'Компетенция не найдена' },
      });
    }
    return this.toListItem(s);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateSkillDto;
  }): Promise<SkillDto> {
    try {
      const created = await this.prisma.skill.create({
        data: {
          tenantId: args.tenantId,
          name: args.body.name,
          description: args.body.description ?? null,
        },
      });
      void this.audit.log({
        userId: args.userId,
        action: 'skill.created',
        resourceId: created.id,
        metadata: { tenantId: args.tenantId, name: created.name },
      });
      return this.toListItem(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'skill_name_taken',
            message: `Компетенция с именем «${args.body.name}» уже существует`,
          },
        });
      }
      throw err;
    }
  }

  async createBatch(args: {
    tenantId: string;
    userId: string;
    body: BatchCreateSkillsDto;
  }): Promise<{ items: SkillDto[]; created: number; skipped: number }> {
    const items: SkillDto[] = [];
    let skipped = 0;
    for (const it of args.body.items) {
      try {
        items.push(
          await this.create({ tenantId: args.tenantId, userId: args.userId, body: it }),
        );
      } catch (err) {
        if (err instanceof ConflictException) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
    return { items, created: items.length, skipped };
  }

  async update(args: {
    tenantId: string;
    userId: string;
    id: string;
    body: UpdateSkillDto;
  }): Promise<SkillDto> {
    const existing = await this.prisma.skill.findUnique({ where: { id: args.id } });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'skill_not_found', message: 'Компетенция не найдена' },
      });
    }
    try {
      const data: Prisma.SkillUpdateInput = {};
      if (args.body.name !== undefined) data.name = args.body.name;
      if (args.body.description !== undefined) {
        data.description = args.body.description;
      }
      const updated = await this.prisma.skill.update({
        where: { id: args.id },
        data,
      });
      void this.audit.log({
        userId: args.userId,
        action: 'skill.updated',
        resourceId: args.id,
        metadata: {
          tenantId: args.tenantId,
          changedFields: Object.keys(args.body),
        },
      });
      return this.toListItem(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'skill_name_taken',
            message: 'Компетенция с таким именем уже существует',
          },
        });
      }
      throw err;
    }
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.prisma.skill.findUnique({ where: { id: args.id } });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'skill_not_found', message: 'Компетенция не найдена' },
      });
    }
    if (existing.deletedAt) {
      return { id: existing.id, deletedAt: existing.deletedAt.toISOString() };
    }
    const now = new Date();
    await this.prisma.skill.update({
      where: { id: args.id },
      data: { deletedAt: now },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'skill.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    return { id: args.id, deletedAt: now.toISOString() };
  }

  private toListItem(s: {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): SkillListItemDto {
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      deletedAt: s.deletedAt ? s.deletedAt.toISOString() : null,
    };
  }
}
