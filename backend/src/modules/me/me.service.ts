import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

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
}

export interface MeProfileDto {
  person: MeProfilePersonDto | null;
  primaryRole: MeProfileRoleDto | null;
  primaryDepartment: MeProfileDepartmentDto | null;
  roleProfile: MeProfileRoleProfileDto | null;
}

/**
 * Сервис «обо мне» в контексте текущей Org. Возвращает связанный Person,
 * активную должность и карту должности — для UI ЛК.
 */
@Injectable()
export class MeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getProfile(args: {
    tenantId: string;
    userId: string;
  }): Promise<MeProfileDto> {
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
    return {
      person: {
        id: person.id,
        name: person.name,
        email: person.email,
      },
      primaryRole: link
        ? { id: link.role.id, name: link.role.name }
        : null,
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
          }
        : null,
    };
  }
}
