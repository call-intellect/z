import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { RoleMapDto } from '../role-map/dto/role-map.dto';
import { RoleMapBuilderService } from '../role-map/services/role-map-builder.service';

export interface MeProfilePersonDto {
  id: string;
  name: string;
  email: string;
}

export interface MeProfileRoleDto {
  id: string;
  name: string;
}

export interface MeProfileDepartmentDto {
  id: string;
  name: string;
}

export interface MeProfileRoleProfileDto {
  id: string;
  status: 'forming' | 'ready' | 'stale' | 'error';
  buildVersion: number;
  lastBuildAt: string | null;
  roleMap: RoleMapDto | null;
}

export interface MeProfileDto {
  person: MeProfilePersonDto | null;
  primaryRole: MeProfileRoleDto | null;
  primaryDepartment: MeProfileDepartmentDto | null;
  roleProfile: MeProfileRoleProfileDto | null;
}

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(RoleMapBuilderService)
    private readonly roleMapBuilder: RoleMapBuilderService | null = null,
  ) {}

  async getProfile(args: { tenantId: string; userId: string }): Promise<MeProfileDto> {
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
      include: {
        primaryDepartment: { select: { id: true, name: true } },
        personRoles: {
          where: { validTo: null },
          include: {
            role: {
              select: {
                id: true,
                name: true,
                roleProfile: {
                  select: {
                    id: true,
                    status: true,
                    buildVersion: true,
                    lastBuildAt: true,
                  },
                },
              },
            },
          },
          orderBy: { validFrom: 'desc' },
          take: 1,
        },
      },
    });
    if (!person) {
      return {
        person: null,
        primaryRole: null,
        primaryDepartment: null,
        roleProfile: null,
      };
    }
    const link = person.personRoles[0] ?? null;
    const roleMap = link
      ? await this.loadRoleMap({ tenantId: args.tenantId, roleId: link.role.id })
      : null;
    return {
      person: {
        id: person.id,
        name: person.name,
        email: person.email,
      },
      primaryRole: link ? { id: link.role.id, name: link.role.name } : null,
      primaryDepartment: person.primaryDepartment
        ? {
            id: person.primaryDepartment.id,
            name: person.primaryDepartment.name,
          }
        : null,
      roleProfile: link?.role.roleProfile
        ? {
            id: link.role.roleProfile.id,
            status: link.role.roleProfile.status,
            buildVersion: link.role.roleProfile.buildVersion,
            lastBuildAt: link.role.roleProfile.lastBuildAt
              ? link.role.roleProfile.lastBuildAt.toISOString()
              : null,
            roleMap,
          }
        : null,
    };
  }

  private async loadRoleMap(args: {
    tenantId: string;
    roleId: string;
  }): Promise<RoleMapDto | null> {
    if (!this.roleMapBuilder) return null;
    try {
      return await this.roleMapBuilder.getMap({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
    } catch (err) {
      this.logger.warn(
        { tenantId: args.tenantId, roleId: args.roleId, err: String(err) },
        'me.profile: не удалось собрать карту должности (мягкая деградация → null)',
      );
      return null;
    }
  }
}
