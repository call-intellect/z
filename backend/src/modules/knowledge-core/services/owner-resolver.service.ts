import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * W2 autonomy (2026-06-12) — OwnerResolverService («лестница владельца»).
 *
 * ТЗ plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md, Фаза W2.
 * Детерминированная лестница для missing_owner-триггеров: вместо «спросить
 * человека» сначала пытаемся вывести владельца сами:
 *
 *   1. `parentOwnerUserId` — владелец родительской сущности → resolved.
 *   2. `roleId` — активные держатели роли (Appointment status='active'
 *      validTo IS NULL; fallback на PersonRole validTo IS NULL) с привязанным
 *      User (person.userId != null): ровно 1 → resolved; >1 → ambiguous
 *      (probe-вопрос-выбор с именами); 0 → следующая ступень.
 *   3. `authorUserId` — автор/создатель сущности → resolved.
 *   4. `candidatePool` — семантические кандидаты (subject'ы, упомянутые
 *      Person'ы): ровно 1 → resolved; >1 → ambiguous.
 *   5. Никого → none (probe идёт как раньше).
 *
 * Resolver НЕ пишет в БД — только отвечает «кто». АВТО-назначение делает
 * вызывающий специалист (и только для сущностей с прямым полем владельца).
 */
export type OwnerResolution =
  | { kind: 'resolved'; userId: string }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'none' };

export interface OwnerResolveArgs {
  tenantId: string;
  /** Владелец родительской сущности (userId), если есть. */
  parentOwnerUserId?: string | null;
  /** Роль-владелец (Role.id) — держатели ищутся по Appointment/PersonRole. */
  roleId?: string | null;
  /** Автор/создатель сущности (userId), если есть. */
  authorUserId?: string | null;
  /** Семантические кандидаты (userId), напр. subject-Person'ы сущности. */
  candidatePool?: string[];
}

@Injectable()
export class OwnerResolverService {
  private readonly logger = new Logger(OwnerResolverService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async resolve(args: OwnerResolveArgs): Promise<OwnerResolution> {
    // 1. Владелец родителя.
    if (args.parentOwnerUserId) {
      return { kind: 'resolved', userId: args.parentOwnerUserId };
    }

    // 2. Держатели роли.
    if (args.roleId) {
      try {
        const holders = await this.roleHolderUserIds(
          args.tenantId,
          args.roleId,
        );
        if (holders.length === 1) {
          return { kind: 'resolved', userId: holders[0]! };
        }
        if (holders.length > 1) {
          return { kind: 'ambiguous', candidates: holders };
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            roleId: args.roleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'owner-resolver: ошибка поиска держателей роли — пропускаю ступень',
        );
      }
    }

    // 3. Автор.
    if (args.authorUserId) {
      return { kind: 'resolved', userId: args.authorUserId };
    }

    // 4. Пул кандидатов.
    const pool = [...new Set(args.candidatePool ?? [])];
    if (pool.length === 1) {
      return { kind: 'resolved', userId: pool[0]! };
    }
    if (pool.length > 1) {
      return { kind: 'ambiguous', candidates: pool };
    }

    // 5. Некому.
    return { kind: 'none' };
  }

  /**
   * Активные держатели роли с привязанным User. Primary — Appointment
   * (status='active', validTo IS NULL); если пусто — fallback на legacy
   * PersonRole (validTo IS NULL). Уникальные userId.
   */
  private async roleHolderUserIds(
    tenantId: string,
    roleId: string,
  ): Promise<string[]> {
    const appointments = await this.prisma.appointment.findMany({
      where: { tenantId, roleId, status: 'active', validTo: null },
      select: {
        person: { select: { userId: true, deletedAt: true } },
      },
      take: 50,
    });
    const fromAppointments = this.collectUserIds(
      appointments.map((a) => a.person),
    );
    if (fromAppointments.length > 0) return fromAppointments;

    const personRoles = await this.prisma.personRole.findMany({
      where: { tenantId, roleId, validTo: null },
      select: {
        person: { select: { userId: true, deletedAt: true } },
      },
      take: 50,
    });
    return this.collectUserIds(personRoles.map((pr) => pr.person));
  }

  private collectUserIds(
    persons: Array<{ userId: string | null; deletedAt?: Date | null }>,
  ): string[] {
    const out = new Set<string>();
    for (const p of persons) {
      if (!p.userId) continue;
      if (p.deletedAt) continue;
      out.add(p.userId);
    }
    return [...out];
  }
}
