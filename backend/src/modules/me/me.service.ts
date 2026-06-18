import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';

import { TypedConfigService } from '../../common/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isValidTimezone } from '../operations/utils/local-date';
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

export interface MeWorkProfileDto {
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  workingDays: number[];
  timezoneIsCustom: boolean;
  hoursAreCustom: boolean;
}

export interface MeWorkProfilePatch {
  timezone?: string;
  workStartHour?: number;
  workEndHour?: number;
  workingDays?: number[];
}

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(RoleMapBuilderService)
    private readonly roleMapBuilder: RoleMapBuilderService | null = null,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
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

  async getWorkProfile(args: {
    tenantId: string;
    userId: string;
  }): Promise<MeWorkProfileDto> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: {
        timezone: true,
        workStartHour: true,
        workEndHour: true,
        workingDays: true,
      },
    });

    const defaults = await this.workProfileDefaults();

    const orgTimezone =
      person?.timezone == null
        ? (
            await this.prisma.org.findUnique({
              where: { id: args.tenantId },
              select: { timezone: true },
            })
          )?.timezone ?? null
        : null;
    const timezone = person?.timezone ?? orgTimezone ?? defaults.timezone;

    const workStartHour = person?.workStartHour ?? defaults.startHour;
    const workEndHour = person?.workEndHour ?? defaults.endHour;
    const workingDays =
      person?.workingDays && person.workingDays.length > 0
        ? person.workingDays
        : defaults.days;

    const timezoneIsCustom = Boolean(person?.timezone);
    const hoursAreCustom =
      person?.workStartHour != null ||
      person?.workEndHour != null ||
      (person?.workingDays?.length ?? 0) > 0;

    return {
      timezone,
      workStartHour,
      workEndHour,
      workingDays,
      timezoneIsCustom,
      hoursAreCustom,
    };
  }

  async updateWorkProfile(args: {
    tenantId: string;
    userId: string;
    patch: MeWorkProfilePatch;
  }): Promise<MeWorkProfileDto> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { id: true, workStartHour: true, workEndHour: true },
    });
    if (!person) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Не найден Person для текущего пользователя в этой Org',
        },
      });
    }

    const { patch } = args;

    if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_timezone',
          message: `Некорректная таймзона: ${patch.timezone}`,
        },
      });
    }

    const effStart =
      patch.workStartHour !== undefined
        ? patch.workStartHour
        : person.workStartHour;
    const effEnd =
      patch.workEndHour !== undefined ? patch.workEndHour : person.workEndHour;
    if (
      effStart != null &&
      effEnd != null &&
      effEnd <= effStart
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_work_hours',
          message: 'Конец рабочего дня должен быть позже начала',
        },
      });
    }

    let workingDays: number[] | undefined;
    if (patch.workingDays !== undefined) {
      const unique = Array.from(new Set(patch.workingDays));
      if (unique.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'invalid_working_days',
            message: 'Рабочие дни — целые числа 0..6 (0=вс..6=сб)',
          },
        });
      }
      workingDays = unique.sort((a, b) => a - b);
    }

    await this.prisma.person.update({
      where: { id: person.id },
      data: {
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.workStartHour !== undefined
          ? { workStartHour: patch.workStartHour }
          : {}),
        ...(patch.workEndHour !== undefined
          ? { workEndHour: patch.workEndHour }
          : {}),
        ...(workingDays !== undefined ? { workingDays } : {}),
      },
    });

    return this.getWorkProfile({
      tenantId: args.tenantId,
      userId: args.userId,
    });
  }

  private async workProfileDefaults(): Promise<{
    timezone: string;
    startHour: number;
    endHour: number;
    days: number[];
  }> {
    const read = async <T>(key: string, fallback: T): Promise<T> => {
      if (!this.cfg) return fallback;
      try {
        return await this.cfg.getDynamic<T>(key, undefined, fallback);
      } catch {
        return fallback;
      }
    };
    const [timezone, startHour, endHour, days] = await Promise.all([
      read<string>('default_timezone', 'Europe/Moscow'),
      read<number>('work_hours_default_start', 9),
      read<number>('work_hours_default_end', 18),
      read<number[]>('work_days_default', [1, 2, 3, 4, 5]),
    ]);
    return { timezone, startHour, endHour, days };
  }
}
