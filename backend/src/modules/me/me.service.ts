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
  /**
   * Полная карта должности текущего пользователя (self-scoped, без RBAC
   * role-profile — пользователь смотрит СВОЮ роль). Формат идентичен
   * `GET /api/v1/roles/:id/map` (RoleMapDto). `null` — нет primaryRole,
   * сервис карты недоступен или произошла ошибка (мягкая деградация).
   */
  roleMap: RoleMapDto | null;
}

export interface MeProfileDto {
  person: MeProfilePersonDto | null;
  primaryRole: MeProfileRoleDto | null;
  primaryDepartment: MeProfileDepartmentDto | null;
  roleProfile: MeProfileRoleProfileDto | null;
}

/**
 * ТЗ 2026-06-18 (assistant-calendar-master) Ф4 — рабочий профиль пользователя:
 * «когда и в каком поясе человек работает». Поля живут на `Person` (NULL/[] =
 * брать дефолт из AdminSetting); эффективные значения собираются здесь.
 */
export interface MeWorkProfileDto {
  /** Эффективная таймзона (Person ?? Org ?? AdminSetting default). */
  timezone: string;
  /** Эффективный час начала рабочего дня 0..23 (Person ?? default 9). */
  workStartHour: number;
  /** Эффективный час конца рабочего дня 0..23 (Person ?? default 18). */
  workEndHour: number;
  /** Эффективные рабочие дни (Person ?? default [1..5]); 0=вс..6=сб. */
  workingDays: number[];
  /** Задана ли таймзона пользователем явно (UX: «моё» vs «дефолт»). */
  timezoneIsCustom: boolean;
  /** Заданы ли рабочие часы/дни пользователем явно. */
  hoursAreCustom: boolean;
}

/** Частичный патч рабочего профиля (любое поле опционально). */
export interface MeWorkProfilePatch {
  timezone?: string;
  workStartHour?: number;
  workEndHour?: number;
  workingDays?: number[];
}

/**
 * Сервис «обо мне» в контексте текущей Org. Возвращает связанный Person,
 * активную должность и карту должности — для UI ЛК.
 */
@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // @Optional — кросс-модульный инжект (MeModule импортирует RoleMapModule).
    // Если по какой-то причине провайдер не зарезолвился, /me/profile
    // продолжает работать без карты (roleMap=null), не падая.
    @Optional()
    @Inject(RoleMapBuilderService)
    private readonly roleMapBuilder: RoleMapBuilderService | null = null,
    // @Optional — TypedConfigService @Global, но в unit-тестах getProfile его
    // не передают. Ф4 (рабочий профиль) читает дефолты через getDynamic; при
    // отсутствии cfg падаем на code-fallback (см. workProfileDefaults).
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
  ) {}

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
    const roleMap = link
      ? await this.loadRoleMap({ tenantId: args.tenantId, roleId: link.role.id })
      : null;
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
            roleMap,
          }
        : null,
    };
  }

  /**
   * Self-scoped загрузка полной карты должности через RoleMapBuilderService
   * (тот же источник, что `GET /api/v1/roles/:id/map`). RBAC живёт в
   * RoleMapController, а не в сервисе — поэтому прямой вызов из MeService для
   * СВОЕЙ роли пользователя безопасен. Мягкая деградация: любой сбой (сервис
   * недоступен / роль не найдена / иная ошибка) → `null`, /me/profile не падает.
   */
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

  // ─────────────────── Ф4 (2026-06-18) — рабочий профиль ───────────────────

  /**
   * Эффективный рабочий профиль текущего пользователя: личные поля Person
   * перекрывают дефолты из AdminSetting (с code-fallback, если cfg/админка
   * недоступны). Таймзона: Person ?? Org ?? default. `*IsCustom`-флаги нужны
   * UI, чтобы отличить «заданное пользователем» от дефолта.
   */
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

    // Таймзона: Person → Org → дефолт.
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

  /**
   * Сохранить рабочий профиль (частично). Person обязан существовать в этой Org
   * (как в upsertConsent — иначе BadRequest `person_not_found`). Валидация:
   * таймзона через `isValidTimezone`, часы 0..23 и `workEndHour > workStartHour`
   * (если оба заданы), `workingDays` — уникальные int 0..6. Возвращает свежий
   * эффективный профиль.
   */
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

    // Эффективные часы для проверки «конец > начало»: берём из патча, иначе
    // из уже сохранённого значения Person (нельзя сохранить заведомо
    // противоречивую пару, даже если в патче только одно поле).
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

  /**
   * Дефолты рабочего профиля из AdminSetting (calendar/work_hours), с
   * code-fallback. Каждый ключ читается в своём try/catch — сбой одного не
   * рушит остальные; при отсутствии cfg (unit-тесты) сразу code-fallback.
   */
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
