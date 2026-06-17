import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  BatchCreatePersonsDto,
  CreatePersonDto,
  PersonDto,
  PersonListItemDto,
  QuickCreatePersonDto,
  QuickCreatePersonResponseDto,
  UpdatePersonDto,
} from '../dto/persons.dto';

@Injectable()
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  private readonly useAppointment: boolean;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {
    this.useAppointment = this.cfg.persons.useAppointment;
  }

  async ensurePersonForUser(
    args: { tenantId: string; userId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const db = tx ?? this.prisma;

    const existing = await db.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { id: true },
    });
    if (existing) return { id: existing.id };

    const membership = await db.membership.findUnique({
      where: { orgId_userId: { orgId: args.tenantId, userId: args.userId } },
      select: { personId: true },
    });
    if (membership?.personId) {
      const orphan = await db.person.findFirst({
        where: {
          id: membership.personId,
          tenantId: args.tenantId,
          userId: null,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (orphan) {
        await db.person.update({
          where: { id: orphan.id },
          data: { userId: args.userId },
        });
        return { id: orphan.id };
      }
    }

    const user = await db.user.findUnique({
      where: { id: args.userId },
      select: { email: true, name: true },
    });
    const email = user?.email ?? '';
    try {
      const created = await db.person.create({
        data: {
          tenantId: args.tenantId,
          userId: args.userId,
          name: user?.name ?? '',
          email,
          relationship: 'employee',
        },
        select: { id: true },
      });
      return { id: created.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await db.person.findFirst({
          where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
          select: { id: true },
        });
        if (raced) return { id: raced.id };
        if (email) {
          const byEmail = await db.person.findFirst({
            where: { tenantId: args.tenantId, email, deletedAt: null },
            select: { id: true, userId: true },
          });
          if (byEmail && byEmail.userId === null) {
            await db.person.update({
              where: { id: byEmail.id },
              data: { userId: args.userId },
            });
            return { id: byEmail.id };
          }
        }
      }
      throw err;
    }
  }

  async list(args: {
    tenantId: string;
    q?: string;
    departmentId?: string;
    roleId?: string;
    invitationStatus?: 'pending' | 'accepted' | 'revoked' | 'expired' | 'none';
    includeDeleted: boolean;
    limit: number;
  }): Promise<{ items: PersonListItemDto[]; total: number }> {
    const where: Prisma.PersonWhereInput = {
      tenantId: args.tenantId,
      ...(args.includeDeleted ? {} : { deletedAt: null }),
      ...(args.departmentId ? { primaryDepartmentId: args.departmentId } : {}),
      ...(args.q
        ? {
            OR: [
              { name: { contains: args.q, mode: 'insensitive' as const } },
              { email: { contains: args.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(args.roleId
        ? this.useAppointment
          ? {
              appointments: {
                some: {
                  roleId: args.roleId,
                  validTo: null,
                  status: { not: 'former' },
                },
              },
            }
          : {
              personRoles: {
                some: { roleId: args.roleId, validTo: null },
              },
            }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.person.findMany({
        where,
        orderBy: [{ name: 'asc' }],
        take: args.limit,
        include: {
          primaryDepartment: { select: { id: true, name: true } },
          personRoles: {
            where: { validTo: null },
            include: { role: { select: { id: true, name: true } } },
            orderBy: { validFrom: 'desc' },
            take: 1,
          },
          appointments: {
            where: { validTo: null, status: { not: 'former' } },
            include: { role: { select: { id: true, name: true } } },
            orderBy: { validFrom: 'desc' },
            take: 1,
          },
          invitations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true },
          },
        },
      }),
      this.prisma.person.count({ where }),
    ]);

    const items = rows
      .map((p) => this.toListItem(p))
      .filter((p) => {
        if (!args.invitationStatus) return true;
        return p.invitationStatus === args.invitationStatus;
      });

    return { items, total };
  }

  async get(args: { tenantId: string; id: string }): Promise<PersonDto> {
    const p = await this.prisma.person.findUnique({
      where: { id: args.id },
      include: {
        primaryDepartment: { select: { id: true, name: true } },
        personRoles: {
          where: { validTo: null },
          include: { role: { select: { id: true, name: true } } },
          orderBy: { validFrom: 'desc' },
          take: 1,
        },
        appointments: {
          where: { validTo: null, status: { not: 'former' } },
          include: { role: { select: { id: true, name: true } } },
          orderBy: { validFrom: 'desc' },
          take: 1,
        },
        invitations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    });
    if (!p || p.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'person_not_found', message: 'Сотрудник не найден' },
      });
    }
    return this.toListItem(p);
  }

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreatePersonDto;
  }): Promise<PersonDto> {
    if (args.body.primaryDepartmentId) {
      await this.assertDepartmentExists(args.tenantId, args.body.primaryDepartmentId);
    }
    if (args.body.roleId) {
      await this.assertRoleExists(args.tenantId, args.body.roleId);
    }
    if (args.body.linkUserId) {
      const membership = await this.prisma.membership.findUnique({
        where: {
          orgId_userId: { orgId: args.tenantId, userId: args.body.linkUserId },
        },
        select: { userId: true },
      });
      if (!membership) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'member_not_found', message: 'Участник не найден в этой компании' },
        });
      }
      const existing = await this.prisma.person.findFirst({
        where: { tenantId: args.tenantId, userId: args.body.linkUserId, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'person_already_linked',
            message: 'У этого участника уже есть карточка сотрудника',
          },
        });
      }
    }
    const dedupEmail = args.body.email?.trim();
    if (dedupEmail) {
      const byEmailRows = await this.prisma.$queryRaw<Array<{ id: string; userId: string | null }>>`
        SELECT "id", "userId" FROM "persons"
        WHERE "tenantId" = ${args.tenantId}
          AND "deletedAt" IS NULL
          AND lower("email") = lower(${dedupEmail})
        LIMIT 1
      `;
      const byEmail = byEmailRows[0] ?? null;
      if (byEmail) {
        if (args.body.linkUserId && byEmail.userId === null) {
          await this.prisma.person.update({
            where: { id: byEmail.id },
            data: { userId: args.body.linkUserId },
          });
          void this.audit.log({
            userId: args.userId,
            action: 'person.linked_by_email',
            resourceId: byEmail.id,
            metadata: {
              tenantId: args.tenantId,
              email: dedupEmail,
              linkUserId: args.body.linkUserId,
            },
          });
          return this.get({ tenantId: args.tenantId, id: byEmail.id });
        }
        throw new ConflictException({
          ok: false,
          error: {
            code: 'person_email_taken',
            message: 'Сотрудник с таким email уже есть в компании',
          },
        });
      }
    }
    const now = new Date();
    try {
      const personId = await this.prisma.$transaction(async (tx) => {
        const person = await tx.person.create({
          data: {
            tenantId: args.tenantId,
            userId: args.body.linkUserId ?? null,
            name: args.body.name,
            email: args.body.email ?? '',
            primaryDepartmentId: args.body.primaryDepartmentId ?? null,
          },
        });

        if (args.body.roleId) {
          await tx.personRole.create({
            data: {
              tenantId: args.tenantId,
              personId: person.id,
              roleId: args.body.roleId,
              validFrom: now,
              validTo: null,
            },
          });
          await tx.appointment.create({
            data: {
              tenantId: args.tenantId,
              personId: person.id,
              roleId: args.body.roleId,
              departmentId: args.body.primaryDepartmentId ?? null,
              loadPercent: 100,
              status: 'active',
              validFrom: now,
              validTo: null,
              sourceBlockIds: [],
              confidence: new Prisma.Decimal('1.000'),
            },
          });
          await this.upsertActiveLink(tx, {
            tenantId: args.tenantId,
            fromEntityId: person.id,
            toEntityId: args.body.roleId,
            fromType: 'person',
            toType: 'role',
            relationType: 'executes_role',
            explanation: 'Сотрудник назначен на должность вручную',
          });
        }

        if (args.body.primaryDepartmentId) {
          await this.upsertActiveLink(tx, {
            tenantId: args.tenantId,
            fromEntityId: person.id,
            toEntityId: args.body.primaryDepartmentId,
            fromType: 'person',
            toType: 'department',
            relationType: 'member_of',
            explanation: 'Сотрудник прикреплён к отделу вручную',
          });
        }

        return person.id;
      });

      void this.audit.log({
        userId: args.userId,
        action: 'person.created',
        resourceId: personId,
        metadata: {
          tenantId: args.tenantId,
          email: args.body.email,
          roleId: args.body.roleId ?? null,
        },
      });

      return this.get({ tenantId: args.tenantId, id: personId });
    } catch (err) {
      this.handleUniqueViolation(err, args.body.email);
      throw err;
    }
  }

  async createBatch(args: {
    tenantId: string;
    userId: string;
    body: BatchCreatePersonsDto;
  }): Promise<{ items: PersonDto[]; created: number; skipped: number }> {
    const items: PersonDto[] = [];
    let skipped = 0;
    for (const it of args.body.items) {
      try {
        items.push(await this.create({ tenantId: args.tenantId, userId: args.userId, body: it }));
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
    body: UpdatePersonDto;
  }): Promise<PersonDto> {
    const existing = await this.prisma.person.findUnique({
      where: { id: args.id },
      include: {
        personRoles: {
          where: { validTo: null },
          take: 1,
          orderBy: { validFrom: 'desc' },
        },
      },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'person_not_found', message: 'Сотрудник не найден' },
      });
    }

    if (args.body.primaryDepartmentId !== undefined && args.body.primaryDepartmentId !== null) {
      await this.assertDepartmentExists(args.tenantId, args.body.primaryDepartmentId);
    }
    if (args.body.roleId !== undefined && args.body.roleId !== null) {
      await this.assertRoleExists(args.tenantId, args.body.roleId);
    }

    const now = new Date();
    const currentRoleId = existing.personRoles[0]?.roleId ?? null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const data: Prisma.PersonUpdateInput = {};
        if (args.body.name !== undefined) data.name = args.body.name;
        if (args.body.email !== undefined) data.email = args.body.email;
        if (args.body.primaryDepartmentId !== undefined) {
          if (args.body.primaryDepartmentId === null) {
            data.primaryDepartment = { disconnect: true };
          } else {
            data.primaryDepartment = {
              connect: { id: args.body.primaryDepartmentId },
            };
          }
        }
        await tx.person.update({
          where: { id: args.id },
          data,
        });

        if (
          args.body.primaryDepartmentId !== undefined &&
          args.body.primaryDepartmentId !== existing.primaryDepartmentId
        ) {
          await tx.entityLink.updateMany({
            where: {
              tenantId: args.tenantId,
              fromEntityId: args.id,
              fromType: 'person',
              relationType: 'member_of',
              deletedAt: null,
            },
            data: {
              status: 'archived',
              deletedAt: now,
              validTo: now,
              deletedBy: args.userId,
            },
          });
          if (args.body.primaryDepartmentId) {
            await this.upsertActiveLink(tx, {
              tenantId: args.tenantId,
              fromEntityId: args.id,
              toEntityId: args.body.primaryDepartmentId,
              fromType: 'person',
              toType: 'department',
              relationType: 'member_of',
              explanation: 'Сотрудник переведён в другой отдел вручную',
            });
          }
        }

        if (args.body.roleId !== undefined && args.body.roleId !== currentRoleId) {
          if (currentRoleId) {
            await tx.personRole.updateMany({
              where: {
                tenantId: args.tenantId,
                personId: args.id,
                roleId: currentRoleId,
                validTo: null,
              },
              data: { validTo: now },
            });
            await tx.appointment.updateMany({
              where: {
                tenantId: args.tenantId,
                personId: args.id,
                roleId: currentRoleId,
                validTo: null,
              },
              data: { validTo: now, status: 'former' },
            });
            await tx.entityLink.updateMany({
              where: {
                tenantId: args.tenantId,
                fromEntityId: args.id,
                fromType: 'person',
                toEntityId: currentRoleId,
                relationType: 'executes_role',
                deletedAt: null,
              },
              data: {
                status: 'archived',
                deletedAt: now,
                validTo: now,
                deletedBy: args.userId,
              },
            });
          }
          if (args.body.roleId) {
            await tx.personRole.create({
              data: {
                tenantId: args.tenantId,
                personId: args.id,
                roleId: args.body.roleId,
                validFrom: now,
                validTo: null,
              },
            });
            await tx.appointment.create({
              data: {
                tenantId: args.tenantId,
                personId: args.id,
                roleId: args.body.roleId,
                departmentId: args.body.primaryDepartmentId ?? existing.primaryDepartmentId ?? null,
                loadPercent: 100,
                status: 'active',
                validFrom: now,
                validTo: null,
                sourceBlockIds: [],
                confidence: new Prisma.Decimal('1.000'),
              },
            });
            await this.upsertActiveLink(tx, {
              tenantId: args.tenantId,
              fromEntityId: args.id,
              toEntityId: args.body.roleId,
              fromType: 'person',
              toType: 'role',
              relationType: 'executes_role',
              explanation: 'Сотрудник переназначен на новую должность вручную',
            });
          }
        }
      });

      void this.audit.log({
        userId: args.userId,
        action: 'person.updated',
        resourceId: args.id,
        metadata: {
          tenantId: args.tenantId,
          changedFields: Object.keys(args.body),
        },
      });
    } catch (err) {
      this.handleUniqueViolation(err, args.body.email);
      throw err;
    }

    return this.get({ tenantId: args.tenantId, id: args.id });
  }

  async softDelete(args: {
    tenantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; deletedAt: string }> {
    const existing = await this.prisma.person.findUnique({
      where: { id: args.id },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'person_not_found', message: 'Сотрудник не найден' },
      });
    }
    if (existing.deletedAt) {
      return { id: existing.id, deletedAt: existing.deletedAt.toISOString() };
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: args.id },
        data: { deletedAt: now },
      });
      await tx.personRole.updateMany({
        where: {
          tenantId: args.tenantId,
          personId: args.id,
          validTo: null,
        },
        data: { validTo: now },
      });
      await tx.appointment.updateMany({
        where: {
          tenantId: args.tenantId,
          personId: args.id,
          validTo: null,
        },
        data: { validTo: now, status: 'former' },
      });
      await tx.entityLink.updateMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          OR: [
            { fromEntityId: args.id, fromType: 'person' },
            { toEntityId: args.id, toType: 'person' },
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
      action: 'person.deleted',
      resourceId: args.id,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    return { id: args.id, deletedAt: now.toISOString() };
  }

  async quickCreate(args: {
    tenantId: string;
    userId: string;
    body: QuickCreatePersonDto;
  }): Promise<QuickCreatePersonResponseDto> {
    const trimmedName = args.body.name.trim();
    const normalizedEmail = args.body.email?.trim().toLowerCase() ?? null;

    if (normalizedEmail) {
      const existing = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          email: normalizedEmail,
          deletedAt: null,
        },
        select: { id: true, name: true, email: true },
      });
      if (existing) {
        return {
          personId: existing.id,
          name: existing.name,
          email: existing.email ? existing.email : null,
        };
      }
    } else {
      const existingByName = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          name: { equals: trimmedName, mode: 'insensitive' },
          email: '',
          deletedAt: null,
        },
        select: { id: true, name: true, email: true },
      });
      if (existingByName) {
        return {
          personId: existingByName.id,
          name: existingByName.name,
          email: existingByName.email ? existingByName.email : null,
        };
      }
    }

    try {
      const created = await this.prisma.person.create({
        data: {
          tenantId: args.tenantId,
          userId: null,
          name: trimmedName,
          email: normalizedEmail ?? '',
          relationship: 'external',
        },
        select: { id: true, name: true, email: true },
      });

      void this.audit.log({
        userId: args.userId,
        action: 'person.quick_created',
        resourceId: created.id,
        metadata: {
          tenantId: args.tenantId,
          email: normalizedEmail,
          source: 'calendar_participant_picker',
        },
      });

      return {
        personId: created.id,
        name: created.name,
        email: created.email ? created.email : null,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        normalizedEmail
      ) {
        const existing = await this.prisma.person.findFirst({
          where: {
            tenantId: args.tenantId,
            email: normalizedEmail,
            deletedAt: null,
          },
          select: { id: true, name: true, email: true },
        });
        if (existing) {
          return {
            personId: existing.id,
            name: existing.name,
            email: existing.email ? existing.email : null,
          };
        }
      }
      throw err;
    }
  }

  async findOrCreateExternal(
    args: {
      tenantId: string;
      name: string;
      company?: string | null;
      jobTitle?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const db = tx ?? this.prisma;
    const name = args.name.trim();
    const company = args.company?.trim() || null;
    const jobTitle = args.jobTitle?.trim() || null;

    const candidates = await db.person.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true, company: true, jobTitle: true },
    });
    const norm = (v: string | null): string => (v ?? '').trim().toLowerCase();
    const match = candidates.find((c) => norm(c.company) === norm(company));
    if (match) {
      const data: Prisma.PersonUpdateInput = {};
      if (company && !match.company) data.company = company;
      if (jobTitle && !match.jobTitle) data.jobTitle = jobTitle;
      if (Object.keys(data).length > 0) {
        await db.person.update({ where: { id: match.id }, data });
      }
      return { id: match.id };
    }

    const created = await db.person.create({
      data: {
        tenantId: args.tenantId,
        userId: null,
        name,
        email: '',
        relationship: 'external',
        company,
        jobTitle,
      },
      select: { id: true },
    });
    return { id: created.id };
  }

  private async assertDepartmentExists(tenantId: string, departmentId: string): Promise<void> {
    const dep = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!dep || dep.tenantId !== tenantId || dep.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'department_not_found',
          message: 'Указанный отдел не найден или удалён',
        },
      });
    }
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
          message: 'Указанная должность не найдена или удалена',
        },
      });
    }
  }

  private async upsertActiveLink(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: string;
      fromEntityId: string;
      toEntityId: string;
      fromType: string;
      toType: string;
      relationType: 'executes_role' | 'member_of';
      explanation: string;
    },
  ): Promise<void> {
    const existing = await tx.entityLink.findFirst({
      where: {
        fromEntityId: args.fromEntityId,
        fromType: args.fromType,
        toEntityId: args.toEntityId,
        toType: args.toType,
        relationType: args.relationType,
      },
      select: { id: true },
    });
    const now = new Date();
    if (existing) {
      await tx.entityLink.update({
        where: { id: existing.id },
        data: {
          status: 'active',
          deletedAt: null,
          deletedBy: null,
          validFrom: now,
          validTo: null,
          confidence: new Prisma.Decimal('1.000'),
          explanation: args.explanation,
          createdBy: 'manual',
        },
      });
      return;
    }
    await tx.entityLink.create({
      data: {
        tenantId: args.tenantId,
        fromEntityId: args.fromEntityId,
        toEntityId: args.toEntityId,
        fromType: args.fromType,
        toType: args.toType,
        relationType: args.relationType,
        confidence: new Prisma.Decimal('1.000'),
        explanation: args.explanation,
        createdBy: 'manual',
        status: 'active',
        validFrom: now,
        properties: {},
      },
    });
  }

  private handleUniqueViolation(err: unknown, email: string | undefined): void {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'person_email_taken',
          message: `Сотрудник с email «${email ?? ''}» уже существует`,
        },
      });
    }
  }

  private toListItem(p: {
    id: string;
    name: string;
    email: string;
    userId: string | null;
    primaryDepartmentId: string | null;
    primaryDepartment: { id: string; name: string } | null;
    personRoles: { roleId: string; role: { id: string; name: string } }[];
    appointments?: { roleId: string; role: { id: string; name: string } }[];
    invitations: { status: 'pending' | 'accepted' | 'revoked' | 'expired' }[];
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): PersonListItemDto {
    const currentRole = this.useAppointment
      ? (p.appointments?.[0]?.role ?? p.personRoles[0]?.role ?? null)
      : (p.personRoles[0]?.role ?? null);
    const lastInvitation = p.invitations[0]?.status ?? null;
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      userId: p.userId,
      primaryDepartmentId: p.primaryDepartmentId,
      primaryDepartmentName: p.primaryDepartment?.name ?? null,
      currentRoleId: currentRole?.id ?? null,
      currentRoleName: currentRole?.name ?? null,
      invitationStatus: lastInvitation ?? 'none',
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    };
  }
}
