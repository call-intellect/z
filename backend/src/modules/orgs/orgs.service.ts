import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  MembershipRole,
  Org,
  OrgVisibilityMode,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { SubscriptionService } from '../billing/services/subscription.service';
import { PersonsService } from '../persons/services/persons.service';
import { RbacService } from '../rbac/rbac.service';
import { TablesAutoProvisionService } from '../tables/services/tables-auto-provision.service';

import type { TeamRosterItem } from './dto/team-roster.dto';

/**
 * Бизнес-сервис Org / Membership.
 *
 * Слой DomainModel — простые DTO-объекты с camelCase, без внутренних полей
 * Prisma. Отдаются наружу через `OrgsController`.
 */

export interface OrgDomain {
  id: string;
  name: string;
  slug: string;
  visibilityMode: OrgVisibilityMode;
  tier: 'basic' | 'pro' | 'enterprise';
  ownerId: string;
  createdAt: string;
  industry?: string | null;
  isReferenceDemo: boolean;
}

export interface MembershipDomain {
  userId: string;
  email: string;
  name: string;
  role: MembershipRole;
  joinedAt: string;
  invitedBy: string | null;
}

const SLUG_RANDOM_LEN = 6;

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
    @Inject(TablesAutoProvisionService)
    private readonly tablesAutoProvision: TablesAutoProvisionService,
    @Inject(PersonsService) private readonly persons: PersonsService,
  ) {}

  /**
   * Создать Org + Membership(owner) для текущего юзера.
   * Используется и в endpoint'е POST /orgs, и в хуке регистрации.
   *
   * Также создаёт дефолтный `Source(type=meeting, name='Встречи Z')` —
   * единый канал ingest для встреч (knowledge-core Фаза 1). Управление
   * другими источниками (telegram/email/...) — Фаза 10.
   */
  async createForOwner(
    input: { name: string; ownerId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Org> {
    const client = tx ?? this.prisma;
    const slug = await this.generateUniqueSlug(input.name, client);
    const org = await client.org.create({
      data: {
        name: input.name.trim(),
        slug,
        ownerId: input.ownerId,
        visibilityMode: 'open',
        tier: 'basic',
      },
    });
    await client.membership.create({
      data: {
        orgId: org.id,
        userId: input.ownerId,
        role: 'owner',
        invitedBy: null,
      },
    });
    // Ф9 (no_person): сразу создаём Person владельца и проставляем
    // Membership.personId — иначе `me/promises` отдаёт 403, а dump уходит в
    // legacy-ветку без provenance. Идемпотентно (ensurePersonForUser сначала
    // ищет по userId). Внутри того же транзакционного клиента `client`.
    const ownerPerson = await this.persons.ensurePersonForUser(
      { tenantId: org.id, userId: input.ownerId },
      client,
    );
    await client.membership.update({
      where: { orgId_userId: { orgId: org.id, userId: input.ownerId } },
      data: { personId: ownerPerson.id },
    });
    // knowledge-core Фаза 1: дефолтный Source для встреч.
    // Канонический name берётся из MeetingIngestAdapter.DEFAULT_SOURCE_NAME,
    // но импортировать его здесь нельзя (циклическая зависимость orgs↔ingest).
    // Дублируем строковую константу — единственное место, где это допустимо.
    await client.source.create({
      data: {
        tenantId: org.id,
        type: 'meeting',
        name: 'Встречи Z',
        dataClass: 'internal',
        isActive: true,
      },
    });
    // ТЗ paywall-no-trial §3 — для каждой новой Org создаём запись
    // Subscription со status=DEMO, чтобы SubscriptionGuard работал детерминированно.
    await this.subscriptions.ensureDemo(org.id, tx);
    // Smart-tables Фаза 0 — 10 системных таблиц (пустых), видны в /tables сразу.
    await this.tablesAutoProvision.provisionDefaults(org.id, input.ownerId, tx);
    this.rbac.invalidate(input.ownerId, org.id);
    return org;
  }

  /** Список Org текущего юзера. */
  async listForUser(userId: string): Promise<OrgDomain[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, org: { deletedAt: null } },
      include: { org: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => this.toOrgDomain(m.org));
  }

  /** Получить Org по id, если у юзера есть membership. */
  async getById(orgId: string, userId: string): Promise<OrgDomain> {
    const ctx = await this.rbac.loadContext(userId, orgId);
    if (!ctx) throw new ForbiddenException({ ok: false, error: { code: 'no_membership' } });
    const org = await this.prisma.org.findFirst({
      where: { id: orgId, deletedAt: null },
    });
    if (!org) throw new NotFoundException({ ok: false, error: { code: 'org_not_found' } });
    return this.toOrgDomain(org);
  }

  /** Обновить Org (name / visibilityMode). Только owner. */
  async update(
    orgId: string,
    userId: string,
    patch: { name?: string; visibilityMode?: OrgVisibilityMode },
  ): Promise<OrgDomain> {
    const canManage = await this.rbac.canManageOrg(userId, orgId);
    if (!canManage) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Только владелец Org может менять настройки' },
      });
    }

    const data: Prisma.OrgUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.visibilityMode !== undefined) data.visibilityMode = patch.visibilityMode;

    const updated = await this.prisma.org.update({
      where: { id: orgId },
      data,
    });
    // Инвалидируем кэш всех membership'ов этой Org (visibilityMode мог поменяться).
    this.rbac.invalidateAll();
    return this.toOrgDomain(updated);
  }

  /** Список членов Org. Доступно member'у любой роли. */
  async listMembers(orgId: string, userId: string): Promise<MembershipDomain[]> {
    const ctx = await this.rbac.loadContext(userId, orgId);
    if (!ctx) throw new ForbiddenException({ ok: false, error: { code: 'no_membership' } });

    const members = await this.prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      invitedBy: m.invitedBy,
    }));
  }

  /**
   * ТЗ «Команда + доступы» Фаза 2 — объединённый ростер: все Person Org ⊕
   * участники без связанной карточки (Person.userId). Видит любой участник
   * Org (действия гейтятся ролью на уровне отдельных эндпоинтов). Логика
   * текущей должности зеркалит persons.service (appointment → personRole).
   */
  async listTeamRoster(orgId: string, userId: string): Promise<TeamRosterItem[]> {
    const ctx = await this.rbac.loadContext(userId, orgId);
    if (!ctx) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'no_membership', message: 'Нет доступа к этой компании' },
      });
    }

    const [persons, memberships] = await Promise.all([
      this.prisma.person.findMany({
        where: { tenantId: orgId, deletedAt: null },
        orderBy: [{ name: 'asc' }],
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
            select: { id: true, status: true },
          },
        },
      }),
      this.prisma.membership.findMany({
        where: { orgId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
    ]);

    const membershipByUserId = new Map(memberships.map((m) => [m.userId, m]));

    const userIds = [
      ...new Set([
        ...persons.flatMap((p) => (p.userId ? [p.userId] : [])),
        ...memberships.map((m) => m.userId),
      ]),
    ];
    const tgBindings = userIds.length
      ? await this.prisma.channelBinding.findMany({
          where: { userId: { in: userIds }, channel: { kind: 'telegram_bot' } },
          select: { userId: true },
        })
      : [];
    const tgLinked = new Set(tgBindings.map((b) => b.userId));

    const rows: TeamRosterItem[] = [];
    const coveredUserIds = new Set<string>();

    for (const p of persons) {
      const currentRole =
        p.appointments?.[0]?.role ?? p.personRoles[0]?.role ?? null;
      if (p.userId) coveredUserIds.add(p.userId);
      const membership = p.userId
        ? membershipByUserId.get(p.userId) ?? null
        : null;
      rows.push({
        personId: p.id,
        userId: p.userId,
        fullName: p.name,
        email: p.email || null,
        roleId: currentRole?.id ?? null,
        roleName: currentRole?.name ?? null,
        departmentId: p.primaryDepartmentId,
        departmentName: p.primaryDepartment?.name ?? null,
        invitationStatus: membership ? 'accepted' : (p.invitations[0]?.status ?? 'none'),
        invitationId: p.invitations[0]?.id ?? null,
        systemRole: membership?.role ?? null,
        telegramLinked: p.userId ? tgLinked.has(p.userId) : false,
        hasPersonCard: true,
      });
    }

    for (const m of memberships) {
      if (coveredUserIds.has(m.userId)) continue;
      rows.push({
        personId: null,
        userId: m.userId,
        fullName: m.user.name,
        email: m.user.email,
        roleId: null,
        roleName: null,
        departmentId: null,
        departmentName: null,
        invitationStatus: 'accepted',
        invitationId: null,
        systemRole: m.role,
        telegramLinked: tgLinked.has(m.userId),
        hasPersonCard: false,
      });
    }

    return this.dedupRosterByEmail(rows);
  }

  /**
   * ТЗ 2026-06-10 meeting-stuck-and-team-roster Ф1 — дедуп ростера по email на чтении
   * (страховка; реальные дубли Person убирает backfill Ф3). Схлопывает строки с
   * одинаковым непустым нормализованным email в одну. База — строка с userId
   * (носитель аккаунта/системной роли); должность/отдел/человеческое имя/карточка
   * дополняются из «ручной» строки. Порядок первого появления сохраняется.
   * Два аккаунта на один email (обе строки с userId) — НЕ схлопываются (аномалия видна).
   */
  private dedupRosterByEmail(rows: TeamRosterItem[]): TeamRosterItem[] {
    const indexByEmail = new Map<string, number>();
    const result: TeamRosterItem[] = [];
    for (const row of rows) {
      const norm = (row.email ?? '').trim().toLowerCase();
      if (!norm) {
        result.push(row);
        continue;
      }
      const idx = indexByEmail.get(norm);
      const existing = idx === undefined ? undefined : result[idx];
      if (idx === undefined || existing === undefined) {
        indexByEmail.set(norm, result.length);
        result.push(row);
      } else if (existing.userId && row.userId) {
        // два аккаунта на один email — не схлопываем (Ф3 backfill тоже не сольёт)
        result.push(row);
      } else {
        result[idx] = this.mergeRosterRows(existing, row);
      }
    }
    return result;
  }

  /** Слить две строки ростера с одним email: база — носитель userId, обогащение из второй. */
  private mergeRosterRows(a: TeamRosterItem, b: TeamRosterItem): TeamRosterItem {
    const base = a.userId ? a : b.userId ? b : a;
    const other = base === a ? b : a;
    const liveInv = [base, other].find(
      (r) => r.invitationStatus === 'pending' || r.invitationStatus === 'expired',
    );
    const isAccepted = [base, other].some(
      (r) => !!r.systemRole || r.invitationStatus === 'accepted',
    );
    const fullName =
      this.isWeakDisplayName(base.fullName, base.email) &&
      !this.isWeakDisplayName(other.fullName, other.email)
        ? other.fullName
        : base.fullName;
    return {
      ...base,
      personId: base.personId ?? other.personId,
      fullName,
      roleId: base.roleId ?? other.roleId,
      roleName: base.roleName ?? other.roleName,
      departmentId: base.departmentId ?? other.departmentId,
      departmentName: base.departmentName ?? other.departmentName,
      invitationStatus: isAccepted ? 'accepted' : base.invitationStatus,
      invitationId: liveInv?.invitationId ?? base.invitationId ?? other.invitationId,
      systemRole: base.systemRole ?? other.systemRole,
      telegramLinked: base.telegramLinked || other.telegramLinked,
      hasPersonCard: base.hasPersonCard || other.hasPersonCard,
    };
  }

  /** «Слабое» имя = логин/локальная часть email (ASCII без пробелов) → можно заменить человеческим. */
  private isWeakDisplayName(name: string, email: string | null): boolean {
    const n = (name ?? '').trim();
    if (!n) return true;
    const local = (email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
    if (local && n.toLowerCase() === local) return true;
    return /^[A-Za-z0-9._+-]+$/.test(n);
  }

  /** Сменить роль участника. Только owner/admin. */
  async updateMember(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
    newRole: MembershipRole,
  ): Promise<MembershipDomain> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    // Только owner может назначать owner-роль.
    if (newRole === 'owner' && ctx.role !== 'owner' && !ctx.isSuperAdmin) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'only_owner_can_promote_owner' },
      });
    }
    const target = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      include: { user: true },
    });
    if (!target) {
      throw new NotFoundException({ ok: false, error: { code: 'membership_not_found' } });
    }
    // Защищаем последнего owner'а — нельзя понизить.
    if (target.role === 'owner' && newRole !== 'owner') {
      const owners = await this.prisma.membership.count({
        where: { orgId, role: 'owner' },
      });
      if (owners <= 1) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'cannot_demote_last_owner' },
        });
      }
    }
    const updated = await this.prisma.membership.update({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      data: { role: newRole },
      include: { user: true },
    });
    this.rbac.invalidate(targetUserId, orgId);
    return {
      userId: updated.userId,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      joinedAt: updated.joinedAt.toISOString(),
      invitedBy: updated.invitedBy,
    };
  }

  /** Удалить участника из Org. Только owner/admin. */
  async removeMember(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<void> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({ ok: false, error: { code: 'forbidden' } });
    }
    const target = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException({ ok: false, error: { code: 'membership_not_found' } });
    }
    if (target.role === 'owner') {
      const owners = await this.prisma.membership.count({
        where: { orgId, role: 'owner' },
      });
      if (owners <= 1) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'cannot_remove_last_owner' },
        });
      }
    }
    await this.prisma.membership.delete({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    this.rbac.invalidate(targetUserId, orgId);
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private toOrgDomain(o: Org): OrgDomain {
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      visibilityMode: o.visibilityMode,
      tier: o.tier,
      ownerId: o.ownerId,
      createdAt: o.createdAt.toISOString(),
      industry: o.industry ?? null,
      isReferenceDemo: o.isReferenceDemo,
    };
  }

  private async generateUniqueSlug(
    name: string,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const base = slugify(name) || 'org';
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = randomBytes(SLUG_RANDOM_LEN).toString('hex').slice(0, 6);
      const slug = `${base}-${suffix}`;
      const exists = await client.org.findUnique({ where: { slug } });
      if (!exists) return slug;
    }
    throw new ConflictException({
      ok: false,
      error: { code: 'slug_collision', message: 'Не удалось сгенерировать уникальный slug' },
    });
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
