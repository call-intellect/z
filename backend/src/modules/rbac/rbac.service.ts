import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { CloneAccessGrant, MembershipRole, OrgVisibilityMode, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * RBAC-сервис Z (Фаза 0 knowledge-core).
 *
 * Реализован как in-house engine с Casbin-совместимым форматом policy.csv:
 * текущий код — собственная реализация, но policy.csv использует Casbin-style
 * строки `p, role, visibility, owner_match, obj, act`. Это даёт путь миграции
 * на @nestjs/casbin позже (просто заменить evaluate() на enforcer.enforce()).
 *
 * Решения:
 *   - super_admin (User.isSuperAdmin = true) — bypass всех проверок (на Фазе 0
 *     просто разрешаем; SuperAdminAccessLog — Фаза 7).
 *   - owner/admin Org — read/write на всё в Org.
 *   - manager:
 *       - в `visibilityMode = open` — read всех ресурсов Org, write только своих.
 *       - в `visibilityMode = strict` — read/write только своих.
 *
 * `ownerUserId` для ресурса (Meeting.ownerId, Card.ownerId, Task.userId)
 * определяется в caller'е и передаётся в check().
 *
 * Кэш membership'ов — на 60 секунд. Достаточно: смена роли — редкая операция,
 * 60s окна риска допустимы. Cache size — 10k записей (cleanup LRU).
 */

interface PolicyRule {
  role: MembershipRole;
  visibility: OrgVisibilityMode | '*';
  ownerMatch: 'self' | '*';
  obj: ResourceType;
  act: Action;
}

// Единый источник правды для RBAC-ресурсов.
// isResourceType() АВТОМАТИЧЕСКИ синхронизирован с этим массивом —
// добавлять новые ресурсы ТОЛЬКО ЗДЕСЬ.
export const RESOURCE_TYPES = [
  'org',
  'meeting',
  'card',
  'task',
  'chapter',
  'highlight',
  'chat-message',
  'tag',
  'audit-log',
  'ai-usage',
  'block',
  'entity',
  'theme',
  'goal',
  'source',
  // Фаза 11: «персона» как отдельный ресурс RBAC
  'person',
  // Фаза 0a — структура компании (группа А)
  'department',
  'role',
  'job-description',
  'skill',
  'document',
  'role-profile',
  // Фаза 0a — каркас 5 уровней (группа Б)
  'mission',
  'vision',
  'strategy',
  'process',
  'process-step',
  'regulation',
  'policy',
  'tool',
  'metric',
  'decision',
  // Фаза A.2 — шаблоны промптов AI-отчёта
  'prompt_template',
  // SBA α-3 — Layer 2 ontology extension
  'vendor',
  'event_card',
  // SBA α-4 — Layer 4 Curation Foundation
  'curation_item',
  'curation_decision',
  'conflict_item',
  'card_version',
  'curator_assignment',
  // SBA α-4 wave 2 — CompletenessSlot
  'completeness_slot',
  // SBA α-5 — Layer 5 Chat-v2 Omnichannel
  'chat_v2_conversation',
  // SBA β-2 — Knowledge Clone
  'knowledge_profile',
  // SBA β-4 — Insights Radar
  'insight',
  // SBA β-5 — Ideas Collector + Probe-Agent
  'idea',
  'probe_event',
  // SBA γ-1 — SkillProfile + Clone API
  'skill_profile',
  'clone_persona',
  // SBA γ-1 — SkillTraitCategory
  'skill_category',
  // SBA α-7 wave 2 — ProcessTemplate
  'process_template',
  // SBA α-9 wave 3 — Company Foundation
  'company_profile',
  'functional_domain',
  'maturity',
  // SBA α-8 wave 3 — Appointment + KPI
  'appointment',
  'kpi',
  // SBA β-7 — Brand Voice Curator
  'brand_voice',
  // SBA β-6 — Experiment Tracker
  'experiment',
  // SBA β-8 — Operations Dashboard + DailyCheckIn + PersonalRelation
  'dashboard_operations',
  'dashboard_operations_temperature',
  'dashboard_operations_weekly',
  'daily_checkin',
  'personal_relation',
  // SBA δ-3 — VoiceChannelAdapter
  'voice',
  // SBA γ-2 — Concierge Agent
  'concierge',
  // SBA δ-1 — Orchestrator
  'orchestrator',
  // SBA δ-2 — ProactiveWatcher
  'proactive_notification',
  // Tracker Phase 1
  'project',
  'issue',
  'cycle',
  'intake_issue',
  'team_template',
  'issue_webhook',
  // Tracker Phase 5 part 1
  'import_tracker',
  // Wave 2 Поток D — Activity Feeds
  'activity_feed_item',
  // Wave 2 Поток D — Helpfulness Agent
  'helpfulness_trait',
  'helpfulness_spotlight',
  'social_contribution_profile',
  // SBA β-8.2 — Promise Keeper
  'commitment',
  // Tracker Boards (2026-05-27) — несколько досок per project (Weeek/Kaiten-паритет).
  // ТЗ: plans/tz/2026-05-27-tracker-boards.md.
  'board',
  // Tracker Project Documents (2026-05-27) — rich-text документы внутри проекта.
  // ТЗ: plans/tz/2026-05-27-tracker-project-documents.md.
  'project_document',
  // Sprints (2026-05-27) — подсказки помощника по спринтам (Specialist 3-13).
  // ТЗ: plans/tz/2026-05-27-sprints.md §1.5.
  'sprint_hint',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Action: read / write / delete / manage / erase.
 * `erase` (Фаза 11) — отдельное действие для 152-ФЗ (право на удаление
 * личных данных). Разрешено только owner'у Org через policy.csv;
 * super_admin — bypass.
 */
export type Action = 'read' | 'write' | 'delete' | 'manage' | 'erase';

export interface CheckParams {
  userId: string;
  tenantId: string;
  obj: ResourceType;
  act: Action;
  /** ID владельца ресурса (Meeting.ownerId, Card.ownerId, Task.userId).
   *  Для action='read'/'write'/'delete' нужен. Для tenant-scope-only можно null. */
  resourceOwnerId?: string | null;
}

interface MembershipCacheEntry {
  role: MembershipRole;
  visibility: OrgVisibilityMode;
  isSuperAdmin: boolean;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 10_000;

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);
  private policies: PolicyRule[] = [];
  private membershipCache = new Map<string, MembershipCacheEntry>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.policies = this.loadPolicies();
    this.logger.log(`RbacService готов: загружено ${this.policies.length} правил`);
  }

  /**
   * ТЗ 2026-05-26 §3.5 — единый фильтр «активности» гранта (`CloneAccessGrant`).
   *
   * Грант считается активным, если:
   *  - `revokedAt IS NULL` — админ его не отзывал, И
   *  - `expiresAt IS NULL OR expiresAt > now()` — срок не истёк (или бессрочный).
   *
   * Используется в `canAccessPersonClone` / `canAccessRoleClone` и в admin-сервисе
   * (фильтр `isActive=true`). Вынесено в helper, чтобы не дублировать where-условия
   * между разными запросами и не разъехались семантика SQL и in-memory проверки
   * (`isGrantActive`).
   */
  static buildActiveGrantWhere(now: Date): Prisma.CloneAccessGrantWhereInput {
    return {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
  }

  /**
   * In-memory вариант `buildActiveGrantWhere` — для уже загруженного гранта.
   * Семантика идентична SQL-фильтру: revokedAt пустой И срок не вышел.
   */
  static isGrantActive(
    grant: Pick<CloneAccessGrant, 'revokedAt' | 'expiresAt'>,
    now: Date,
  ): boolean {
    if (grant.revokedAt !== null) return false;
    if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) {
      return false;
    }
    return true;
  }

  /**
   * Главный метод проверки. Возвращает true если действие разрешено.
   *
   * Алгоритм:
   *   1. Загрузить membership (кэш) + isSuperAdmin.
   *   2. super_admin → true.
   *   3. Если membership нет — false.
   *   4. Найти подходящее правило в policies (с учётом visibility и ownerMatch).
   */
  async check(params: CheckParams): Promise<boolean> {
    const ctx = await this.loadContext(params.userId, params.tenantId);
    if (ctx === null) {
      // Нет membership — отказ.
      return false;
    }
    if (ctx.isSuperAdmin) return true;

    return this.evaluate({
      role: ctx.role,
      visibility: ctx.visibility,
      obj: params.obj,
      act: params.act,
      isSelfOwner:
        params.resourceOwnerId !== undefined &&
        params.resourceOwnerId !== null &&
        params.resourceOwnerId === params.userId,
    });
  }

  /** Удобный shortcut. */
  async canRead(
    userId: string,
    tenantId: string,
    obj: ResourceType,
    resourceOwnerId?: string | null,
  ): Promise<boolean> {
    return this.check({ userId, tenantId, obj, act: 'read', resourceOwnerId: resourceOwnerId ?? null });
  }

  /** Удобный shortcut. */
  async canWrite(
    userId: string,
    tenantId: string,
    obj: ResourceType,
    resourceOwnerId?: string | null,
  ): Promise<boolean> {
    return this.check({ userId, tenantId, obj, act: 'write', resourceOwnerId: resourceOwnerId ?? null });
  }

  /** Может ли пользователь управлять Org (owner-only действия — change settings, delete). */
  async canManageOrg(userId: string, orgId: string): Promise<boolean> {
    const ctx = await this.loadContext(userId, orgId);
    if (ctx === null) return false;
    if (ctx.isSuperAdmin) return true;
    return ctx.role === 'owner';
  }

  /**
   * Может ли пользователь видеть директорский дашборд Org (Фаза 8).
   *
   * Партнёрская/руководящая роль `admin` видит дашборд директора так же,
   * как `owner`. `manager` — нет (видит свой менеджерский дашборд).
   * `super_admin` — bypass.
   */
  async canViewDirectorDashboard(
    userId: string,
    orgId: string,
  ): Promise<boolean> {
    const ctx = await this.loadContext(userId, orgId);
    if (ctx === null) return false;
    if (ctx.isSuperAdmin) return true;
    return ctx.role === 'owner' || ctx.role === 'admin';
  }

  /**
   * SBA β-8 — может ли пользователь видеть COO operations dashboard
   * (`GET /api/v1/dashboard/operations/*`). Доступ: owner / admin / coo /
   * super_admin (bypass). Manager — нет (видит только свой манагерский /me).
   */
  async canViewOperationsDashboard(
    userId: string,
    orgId: string,
  ): Promise<boolean> {
    const ctx = await this.loadContext(userId, orgId);
    if (ctx === null) return false;
    if (ctx.isSuperAdmin) return true;
    return (
      ctx.role === 'owner' || ctx.role === 'admin' || ctx.role === 'coo'
    );
  }

  /**
   * Получить контекст (роль + visibility + isSuperAdmin) для пары (user, org).
   * Использует in-memory кэш на 60s, чтобы не бить БД на каждый запрос.
   */
  async loadContext(
    userId: string,
    tenantId: string,
  ): Promise<MembershipCacheEntry | null> {
    const key = `${userId}:${tenantId}`;
    const cached = this.membershipCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached;
    }

    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      }),
      this.prisma.membership.findUnique({
        where: { orgId_userId: { orgId: tenantId, userId } },
        select: { role: true, org: { select: { visibilityMode: true } } },
      }),
    ]);

    if (!user) return null;
    // super_admin может работать с любым tenant'ом без membership'а.
    if (user.isSuperAdmin) {
      // Берём visibility из Org (если есть), иначе фейковую open.
      const org = membership?.org ?? (await this.prisma.org.findUnique({
        where: { id: tenantId },
        select: { visibilityMode: true },
      }));
      const entry: MembershipCacheEntry = {
        role: membership?.role ?? 'admin',
        visibility: org?.visibilityMode ?? 'open',
        isSuperAdmin: true,
        fetchedAt: Date.now(),
      };
      this.cacheSet(key, entry);
      return entry;
    }

    if (!membership) return null;

    const entry: MembershipCacheEntry = {
      role: membership.role,
      visibility: membership.org.visibilityMode,
      isSuperAdmin: false,
      fetchedAt: Date.now(),
    };
    this.cacheSet(key, entry);
    return entry;
  }

  /**
   * ТЗ 2026-05-25 §9 (clone-respond эволюция, Фаза 7) — доступ к клону Person.
   *
   * Два режима:
   *  - `cloneV2Enabled=false` (default) — legacy: owner/admin Org / сам носитель /
   *    direct manager в той же primaryDepartment. Эта же логика остаётся внутри
   *    `ClonesService.canAccessPersonClone` (private) — здесь дублируем для
   *    единообразия и unit-тестов.
   *  - `cloneV2Enabled=true` — ТОЛЬКО `CloneAccessGrant` (галочка админа). Все
   *    legacy-исключения отключены, носитель свой клон по умолчанию не видит.
   *    Главный админ может выдать галочку себе сам.
   *
   * Возвращает details (`relation` + сам verdict), чтобы caller мог отделить
   * «носитель» от «manager» для UI (например, кнопка mark-misleading).
   */
  async canAccessPersonClone(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
    cloneV2Enabled: boolean;
  }): Promise<{
    allowed: boolean;
    relation: 'owner_admin' | 'self' | 'manager' | 'grant' | 'none';
  }> {
    if (args.cloneV2Enabled) {
      // ТЗ 2026-05-26 §3.5 — учитываем soft-revoke и expiresAt: findFirst
      // с активным фильтром (revokedAt IS NULL AND (expiresAt IS NULL OR > now)).
      // Раньше тут был findUnique — отозванный/просроченный грант ошибочно давал
      // доступ.
      const grant = await this.prisma.cloneAccessGrant.findFirst({
        where: {
          tenantId: args.tenantId,
          grantedToUserId: args.requesterUserId,
          cloneType: 'person',
          cloneRefId: args.personId,
          ...RbacService.buildActiveGrantWhere(new Date()),
        },
        select: { id: true },
      });
      return grant
        ? { allowed: true, relation: 'grant' }
        : { allowed: false, relation: 'none' };
    }
    return this.canAccessPersonCloneLegacy(args);
  }

  /**
   * ТЗ 2026-05-25 §9 — доступ к role-клону.
   *
   *  - `cloneV2Enabled=false` — legacy: `rbac.check({obj:'role', act:'read'})`.
   *  - `cloneV2Enabled=true` — только `CloneAccessGrant` (галочка админа).
   */
  async canAccessRoleClone(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    cloneV2Enabled: boolean;
  }): Promise<{ allowed: boolean; relation: 'grant' | 'role_read' | 'none' }> {
    if (args.cloneV2Enabled) {
      // ТЗ 2026-05-26 §3.5 — учитываем soft-revoke и expiresAt: findFirst
      // с активным фильтром. Раньше findUnique игнорировал revokedAt/expiresAt.
      const grant = await this.prisma.cloneAccessGrant.findFirst({
        where: {
          tenantId: args.tenantId,
          grantedToUserId: args.requesterUserId,
          cloneType: 'role',
          cloneRefId: args.roleId,
          ...RbacService.buildActiveGrantWhere(new Date()),
        },
        select: { id: true },
      });
      return grant
        ? { allowed: true, relation: 'grant' }
        : { allowed: false, relation: 'none' };
    }
    const allowed = await this.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    return allowed
      ? { allowed: true, relation: 'role_read' }
      : { allowed: false, relation: 'none' };
  }

  /**
   * Legacy-логика доступа к person-клону (до §9). Сохранена для обратной
   * совместимости при выключенном `CLONE_V2_ENABLED` и для unit-тестов.
   *
   *  - owner/admin Org;
   *  - сам носитель (Person.userId === requesterUserId);
   *  - direct manager (Membership.role='manager' в той же primaryDepartment).
   */
  private async canAccessPersonCloneLegacy(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<{
    allowed: boolean;
    relation: 'owner_admin' | 'self' | 'manager' | 'none';
  }> {
    // 1. owner/admin?
    const adminAllowed = await this.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'knowledge_profile',
      act: 'read',
      resourceOwnerId: null,
    });
    if (adminAllowed) {
      const ctx = await this.loadContext(args.requesterUserId, args.tenantId);
      const role = ctx?.isSuperAdmin ? 'owner' : ctx?.role;
      if (role === 'owner' || role === 'admin') {
        return { allowed: true, relation: 'owner_admin' };
      }
    }
    // 2. self?
    const target = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: {
        id: true,
        userId: true,
        primaryDepartmentId: true,
        tenantId: true,
      },
    });
    if (!target || target.tenantId !== args.tenantId) {
      return { allowed: false, relation: 'none' };
    }
    if (target.userId && target.userId === args.requesterUserId) {
      return { allowed: true, relation: 'self' };
    }
    // 3. direct manager?
    if (target.primaryDepartmentId) {
      const requesterPerson = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          userId: args.requesterUserId,
          deletedAt: null,
        },
        select: { id: true, primaryDepartmentId: true },
      });
      if (
        requesterPerson?.primaryDepartmentId === target.primaryDepartmentId
      ) {
        const isManager = await this.prisma.membership.findFirst({
          where: {
            orgId: args.tenantId,
            userId: args.requesterUserId,
            role: 'manager',
          },
          select: { id: true },
        });
        if (isManager) return { allowed: true, relation: 'manager' };
      }
    }
    return { allowed: false, relation: 'none' };
  }

  /** Очистить кэш для конкретной пары — например, после изменения роли. */
  invalidate(userId: string, tenantId: string): void {
    this.membershipCache.delete(`${userId}:${tenantId}`);
  }

  /** Очистить кэш целиком (миграции, тесты). */
  invalidateAll(): void {
    this.membershipCache.clear();
  }

  // ─────────────────────────── private ──────────────────────────────

  private cacheSet(key: string, entry: MembershipCacheEntry): void {
    if (this.membershipCache.size >= CACHE_MAX_SIZE) {
      // Простая еviction: убираем самые старые (Map сохраняет insertion order).
      const firstKey = this.membershipCache.keys().next().value;
      if (firstKey) this.membershipCache.delete(firstKey);
    }
    this.membershipCache.set(key, entry);
  }

  /**
   * Чистая функция: на основе загруженных policy'ев + контекста запроса —
   * есть ли разрешающее правило?
   */
  private evaluate(args: {
    role: MembershipRole;
    visibility: OrgVisibilityMode;
    obj: ResourceType;
    act: Action;
    isSelfOwner: boolean;
  }): boolean {
    for (const p of this.policies) {
      if (p.role !== args.role) continue;
      if (p.visibility !== '*' && p.visibility !== args.visibility) continue;
      if (p.obj !== args.obj) continue;
      if (p.act !== args.act) continue;
      // ownerMatch: 'self' разрешает только если ресурс пользователя.
      // '*' разрешает любые.
      if (p.ownerMatch === 'self' && !args.isSelfOwner) continue;
      return true;
    }
    return false;
  }

  private loadPolicies(): PolicyRule[] {
    const path = join(__dirname, 'policies', 'policy.csv');
    const raw = readFileSync(path, 'utf8');
    const result: PolicyRule[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Формат: p, role, visibility, owner_match, obj, act
      const parts = trimmed.split(',').map((s) => s.trim());
      if (parts.length < 6) continue;
      const [tag, role, visibility, ownerMatch, obj, act] = parts;
      if (tag !== 'p') continue;
      if (!role || !visibility || !ownerMatch || !obj || !act) continue;
      if (!isMembershipRole(role)) continue;
      if (visibility !== '*' && !isVisibility(visibility)) continue;
      if (ownerMatch !== 'self' && ownerMatch !== '*') continue;
      if (!isResourceType(obj)) continue;
      if (!isAction(act)) continue;
      result.push({
        role,
        visibility: visibility as OrgVisibilityMode | '*',
        ownerMatch,
        obj,
        act,
      });
    }
    return result;
  }
}

function isMembershipRole(s: string): s is MembershipRole {
  return s === 'owner' || s === 'admin' || s === 'manager' || s === 'coo';
}
function isVisibility(s: string): s is OrgVisibilityMode {
  return s === 'open' || s === 'strict';
}
function isResourceType(s: string): s is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(s);
}
function isAction(s: string): s is Action {
  return (
    s === 'read' ||
    s === 'write' ||
    s === 'delete' ||
    s === 'manage' ||
    s === 'erase'
  );
}
