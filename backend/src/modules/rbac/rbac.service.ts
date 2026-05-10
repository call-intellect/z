import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MembershipRole, OrgVisibilityMode } from '@prisma/client';

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

export type ResourceType =
  | 'org'
  | 'meeting'
  | 'card'
  | 'task'
  | 'chapter'
  | 'highlight'
  | 'chat-message'
  | 'tag'
  | 'audit-log'
  | 'ai-usage'
  | 'block'
  | 'entity'
  | 'theme'
  | 'goal';

export type Action = 'read' | 'write' | 'delete' | 'manage';

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
  return s === 'owner' || s === 'admin' || s === 'manager';
}
function isVisibility(s: string): s is OrgVisibilityMode {
  return s === 'open' || s === 'strict';
}
function isResourceType(s: string): s is ResourceType {
  return [
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
  ].includes(s);
}
function isAction(s: string): s is Action {
  return s === 'read' || s === 'write' || s === 'delete' || s === 'manage';
}
