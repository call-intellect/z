import {
  BadRequestException,
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
  DepartmentDomainLinkDto,
  LinkDepartmentDomainDto,
} from '../dto/department-domain-link.dto';

@Injectable()
export class DepartmentDomainLinkService {
  private readonly logger = new Logger(DepartmentDomainLinkService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async listByDepartment(args: {
    tenantId: string;
    departmentId: string;
  }): Promise<DepartmentDomainLinkDto[]> {
    await this.assertDepartmentExists(args.tenantId, args.departmentId);
    const rows = await this.prisma.departmentDomainLink.findMany({
      where: { tenantId: args.tenantId, departmentId: args.departmentId },
      include: {
        domain: {
          select: { id: true, name: true, slug: true, iconName: true },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async listByDomain(args: {
    tenantId: string;
    domainId: string;
  }): Promise<DepartmentDomainLinkDto[]> {
    const rows = await this.prisma.departmentDomainLink.findMany({
      where: { tenantId: args.tenantId, domainId: args.domainId },
      include: {
        domain: {
          select: { id: true, name: true, slug: true, iconName: true },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async link(args: {
    tenantId: string;
    userId: string;
    departmentId: string;
    body: LinkDepartmentDomainDto;
  }): Promise<DepartmentDomainLinkDto> {
    await this.assertDepartmentExists(args.tenantId, args.departmentId);
    await this.assertDomainExists(args.tenantId, args.body.domainId);
    try {
      const created = await this.prisma.departmentDomainLink.create({
        data: {
          tenantId: args.tenantId,
          departmentId: args.departmentId,
          domainId: args.body.domainId,
          role: args.body.role,
          ...(args.body.coverageRatio !== undefined
            ? { coverageRatio: new Prisma.Decimal(args.body.coverageRatio) }
            : {}),
        },
        include: {
          domain: {
            select: { id: true, name: true, slug: true, iconName: true },
          },
        },
      });
      void this.audit.log({
        userId: args.userId,
        action: 'department_domain_link.created',
        resourceId: created.id,
        metadata: {
          tenantId: args.tenantId,
          departmentId: args.departmentId,
          domainId: args.body.domainId,
          role: args.body.role,
        },
      });
      return this.toDto(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'link_already_exists',
            message: 'Связь между отделом и доменом уже существует',
          },
        });
      }
      throw err;
    }
  }

  async unlink(args: {
    tenantId: string;
    userId: string;
    departmentId: string;
    domainId: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.departmentDomainLink.findUnique({
      where: {
        departmentId_domainId: {
          departmentId: args.departmentId,
          domainId: args.domainId,
        },
      },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'link_not_found', message: 'Связь не найдена' },
      });
    }
    await this.prisma.departmentDomainLink.delete({
      where: { id: existing.id },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'department_domain_link.deleted',
      resourceId: existing.id,
      metadata: {
        tenantId: args.tenantId,
        departmentId: args.departmentId,
        domainId: args.domainId,
      },
    });
    return { ok: true };
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
          message: 'Отдел не найден или удалён',
        },
      });
    }
  }

  private async assertDomainExists(tenantId: string, domainId: string): Promise<void> {
    const dom = await this.prisma.functionalDomain.findUnique({
      where: { id: domainId },
      select: { tenantId: true, deletedAt: true },
    });
    if (!dom || dom.tenantId !== tenantId || dom.deletedAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'domain_not_found',
          message: 'Домен не найден или удалён',
        },
      });
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    departmentId: string;
    domainId: string;
    role: string;
    coverageRatio: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
    domain?: { id: string; name: string; slug: string; iconName: string | null };
  }): DepartmentDomainLinkDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      departmentId: row.departmentId,
      domainId: row.domainId,
      role: row.role,
      coverageRatio: row.coverageRatio ? Number(row.coverageRatio) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.domain
        ? {
            domain: {
              id: row.domain.id,
              name: row.domain.name,
              slug: row.domain.slug,
              iconName: row.domain.iconName,
            },
          }
        : {}),
    };
  }
}
