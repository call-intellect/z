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
  | 'goal'
  | 'source'
  /**
   * Фаза 11: «персона» как отдельный ресурс RBAC, отделена от 'entity'
   * исключительно ради действия 'erase' (152-ФЗ — право на удаление личных
   * данных), которое доступно только owner'у Org.
   */
  | 'person'
  // ── Фаза 0a — структура компании (группа А) ──
  | 'department'
  | 'role'
  | 'job-description'
  | 'skill'
  | 'document'
  | 'role-profile'
  // ── Фаза 0a — каркас 5 уровней (группа Б) ──
  | 'mission'
  | 'vision'
  | 'strategy'
  | 'process'
  | 'process-step'
  | 'regulation'
  | 'policy'
  | 'tool'
  | 'metric'
  | 'decision'
  // ── Фаза A.2 — шаблоны промптов AI-отчёта (prompt registry) ──
  | 'prompt_template'
  // ── SBA α-3 — Layer 2 ontology extension ──
  // 'vendor' — поставщик (модель Vendor + Entity{type=vendor}).
  // 'event_card' — событие (модель Event + Entity{type=event}). Имя
  // выбрано как `event_card`, чтобы не конфликтовать с доменными
  // событиями (бизнес-вокабуляр) — RBAC ResourceType должен быть
  // конкретным «карточным» именем.
  | 'vendor'
  | 'event_card'
  // ── SBA α-4 — Layer 4 Curation Foundation ──
  | 'curation_item'
  | 'curation_decision'
  | 'conflict_item'
  | 'card_version'
  | 'curator_assignment'
  // ── SBA α-4 wave 2 — CompletenessSlot ──
  // 'completeness_slot' — слот «незаполненного поля» нормативной карточки
  // (regulation / process / role / company_profile). Создаётся
  // CompletenessScannerCron'ом. owner/admin Org — r/w/d; manager — read всех
  // Org-слотов (карта пробелов компании), write self (закрытие своих слотов).
  | 'completeness_slot'
  // ── SBA α-5 — Layer 5 Chat-v2 Omnichannel ──
  // 'chat_v2_conversation' — диалог пользователя с AI-чатом. Owner — сам
  // пользователь; admin/owner Org могут читать для отладки.
  | 'chat_v2_conversation'
  // ── SBA β-2 — Specialist 3.2 Knowledge Clone ──
  // 'knowledge_profile' — Person.knowledgeProfile (что человек знает).
  // Это shared knowledge внутри Org: owner/admin — r/w/d; manager — r на все
  // профили Org; member-level (manager:strict) — r self. Write идёт только
  // через worker; ручной API write нет.
  | 'knowledge_profile'
  // ── SBA β-4 — Specialist 3.5 Insights Radar ──
  // 'insight' — повторяющиеся проблемы / риски / блокеры / неэффективности.
  // Shared knowledge: owner/admin — r/w/d; manager open — r/w (write для
  // mitigation); manager strict — r self; curator — w (через CurationItem).
  | 'insight'
  // ── SBA β-5 — Specialist 3.6 Ideas Collector + Layer 6 Probe-Agent ──
  // 'idea' — идеи сотрудников и запросы клиентов. Shared knowledge:
  // owner/admin — r/w/d; manager — r/w (support/withdraw); read для всех
  // member'ов Org.
  // 'probe_event' — внутренний ресурс Probe-Agent. Read — admin (queue).
  // Получатель видит свои probe через `/me/notifications` (фильтр eventType).
  | 'idea'
  | 'probe_event'
  // ── SBA γ-1 — Specialist 3.7 SkillProfile + Clone API ──
  // 'skill_profile' — навыковый профиль сотрудника (SkillProfile + SkillTrait[]).
  // Видимость: owner/admin Org / direct manager / сам носитель.
  // Write — только worker (нет manual API).
  // 'clone_persona' — ExecutablePersona (snapshot для clone API). Read = тем же,
  // кто имеет read на skill_profile того же Person'а.
  | 'skill_profile'
  | 'clone_persona'
  // ── SBA γ-1 доделки — SkillTraitCategory ──
  // 'skill_category' — эмерджентная категория SkillTrait. Видимость:
  // employee — read (видит словарь категорий компании); admin/owner — write/delete;
  // merge_categories идёт через CurationDecision (см. α-4 wave 2 enum-value).
  | 'skill_category'
  // ── SBA α-7 wave 2 — ProcessTemplate (Specialist 3.1) ──
  // 'process_template' — библиотечный шаблон процесса (`ProcessTemplate` +
  // `ProcessTemplateVersion` + `DecisionPoint` + `ProcessHandoff`). Shared
  // knowledge компании: owner/admin — r/w/d; manager — read всех template'ов
  // Org (чтобы видеть схемы процессов). Write/delete — только admin/owner;
  // `manage` (force-activate version, hard-delete без archived) — super_admin
  // через RbacService bypass.
  | 'process_template'
  // ── SBA α-9 wave 3 — Company Foundation ──
  // 'company_profile' — 1:1 на Org-запись идентичности компании
  // (mission/vision/strategy/stage). read — все members; write/delete —
  // owner/admin (это owner-territory).
  // 'functional_domain' — функциональная область + дерево. read — все members;
  // write/delete — owner/admin; manage — для seed-template (per-industry).
  // 'maturity' — сводка зрелости (Role/Department/Company). read — все members
  // (shared knowledge); manage — admin/owner (rebuild).
  | 'company_profile'
  | 'functional_domain'
  | 'maturity'
  // ── SBA α-8 wave 3 — Appointment + KPI ──
  // 'appointment' — назначение Person на Role в конкретном Department с
  // loadPercent / status / valid-интервалом. Read — все members; write/delete —
  // owner/admin (HR-функция).
  // 'kpi' — Metric с заполненным attachedTo*Id. Read — все members (видят
  // KPI компании); write/delete — owner/admin. measurement (PATCH currentValue)
  // — owner/admin (kpi_owner role появится отдельно позже).
  | 'appointment'
  | 'kpi'
  // ── SBA β-7 — Brand Voice Curator (Specialist 3.10) ──
  // 'brand_voice' — 1:1 на Org «голос бренда» (tone/values/taboos). Read — все
  // members (нужен всем, кто пишет контент). Write — owner/admin (manage —
  // rebuild через `act=manage`). Marketing-role hint: manager open получает
  // write, чтобы команда маркетинга могла править tone/taboos без owner-эскалации.
  | 'brand_voice'
  // ── SBA β-6 — Experiment Tracker (Specialist 3.9) ──
  // 'experiment' — эксперименты компании (гипотеза → выполнение → результат →
  // урок). First-class сущность (не подкатегория Decision/Insight). owner/admin —
  // r/w/d + manage (force-transition); manager open — r/w (могут заводить и
  // править эксперименты, как идеи); manager strict — read self.
  | 'experiment'
  // ── SBA β-8 — Operations Dashboard + DailyCheckIn + PersonalRelation ──
  // 'dashboard_operations' — COO pulse-агрегат (`GET /dashboard/operations`).
  // Read — owner/admin/coo. Manager → 403.
  // 'daily_checkin' — личный чек-ин (морнинг/ивнинг) Person'а.
  // 'personal_relation' — EntityLink между Person'ами (manages /
  // collaborates_with / mentors / ...). Read для admin/coo; write — internal worker.
  | 'dashboard_operations'
  | 'daily_checkin'
  | 'personal_relation'
  // ── SBA δ-3 — VoiceChannelAdapter ──
  // 'voice' — синтез/распознавание речи (TTS + ASR REST endpoints).
  // Маппинг действий: read = `voice.transcribe` (ASR), write = `voice.synthesize`
  // (TTS). Employee-доступ: любой member может транскрибировать своё аудио и
  // синтезировать короткий ответ (≤500 chars). Tenant-scope обязателен.
  | 'voice'
  // ── SBA γ-2 — Concierge Agent ──
  // 'concierge' — sквозной AI-помощник кабинета (tool-use). read — свои
  // диалоги; write — отправлять сообщения / выполнять tool-use loop. Внутри
  // ToolRouter дополнительно проверяются permissions на ресурс самого
  // tool'а (например, create_meeting требует write на 'meeting'). Manage —
  // admin-функция (просмотр OrgConciergeQuota, чужих диалогов).
  | 'concierge'
  // ── SBA δ-1 — Orchestrator (multi-agent research) ──
  // 'orchestrator' — multi-agent deep research для сложных запросов
  // («составь отчёт по X», «сравни Y и Z»). read — свои runs + статусы;
  // write (act='write') = orchestrator.run — запустить новый research-run
  // (employee с feature-flag). manage (act='manage') = orchestrator.admin —
  // admin-видение всех runs организации (наблюдение и kill).
  | 'orchestrator'
  // ── SBA δ-2 — ProactiveWatcher (2026-05-23) ──
  // 'proactive_notification' — инициативное уведомление от Watcher'а
  // («заметил X — может, посмотришь?»). read — свои (employee); write
  // (PATCH /me/proactive-notifications/:id/dismiss — пометка как
  // «не показывать») — self. manage — admin (видит все ProactiveNotification
  // компании для аналитики качества правил).
  | 'proactive_notification';

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
    'source',
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
    // SBA β-4 — Insights Radar.
    'insight',
    // SBA β-5 — Ideas Collector + Probe-Agent.
    'idea',
    'probe_event',
    // SBA γ-1 доделки — SkillTraitCategory.
    'skill_category',
    // SBA α-8 wave 3 — Appointment + KPI.
    'appointment',
    'kpi',
    // SBA β-7 — Brand Voice Curator.
    'brand_voice',
  ].includes(s);
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
