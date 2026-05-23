import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ExecutablePersona } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  CLONE_RESPOND_SYSTEM_PROMPT_BASE,
  CLONE_RESPOND_USER_TEMPLATE,
} from '../../knowledge-core/prompts/clone-respond.prompt';
import { ExecutablePersonaBuildService } from '../../knowledge-core/services/executable-persona-build.service';
import { ExecutablePersonaVersioningService } from '../../knowledge-core/services/executable-persona-versioning.service';
import { RbacService } from '../../rbac/rbac.service';

import type {
  AskCloneResponseDto,
  CloneCitationDto,
  RoleSkillProfileDto,
  SkillProfileDto,
  SkillTraitDto,
} from '../dto/clones.dto';

/**
 * SBA γ-1 — ClonesService (Clone API).
 *
 * Главные методы:
 *   - askPerson — ответ в стиле конкретного сотрудника.
 *   - askRole   — ответ в стиле роли (агрегат по employee'ям этой роли).
 *
 * Контракт:
 *   - RBAC: owner/admin Org / сам носитель / direct manager.
 *   - Rate limit: cfg.skill.cloneAskPerUserPerDay (default 20) — через Redis.
 *   - Retrieval: subject-блоки + knowledgeProfile + relevant decisions.
 *   - LLM call: clone-respond с persona prompt в system.
 *   - Запись в ChatV2Conversation (mode='clone_style').
 */
@Injectable()
export class ClonesService {
  private readonly logger = new Logger(ClonesService.name);

  /** Минимум traits в SkillProfile для ответа клона. */
  private static readonly MIN_TRAITS_FOR_ANSWER = 3;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ExecutablePersonaBuildService)
    private readonly personaBuilder: ExecutablePersonaBuildService,
    @Inject(ExecutablePersonaVersioningService)
    private readonly personaVersioning: ExecutablePersonaVersioningService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /**
   * Ответ в стиле конкретного сотрудника.
   */
  async askPerson(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
    question: string;
    conversationId?: string;
  }): Promise<AskCloneResponseDto> {
    // 1. Проверка RBAC.
    const accessCheck = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: args.personId,
    });
    if (!accessCheck.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к клону этого сотрудника',
        },
      });
    }

    // 2. Rate limit.
    await this.assertRateLimit(args.requesterUserId);

    // 3. Найти SkillProfile + active traits.
    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
      include: {
        person: {
          select: { id: true, name: true, userId: true, relationship: true },
        },
        traits: {
          where: { status: 'active' },
          orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
        },
      },
    });
    if (!profile || profile.status !== 'active') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'no_clone',
          message:
            'У этого сотрудника пока нет клона — недостаточно встреч с обсуждением «почему я так решил».',
        },
      });
    }
    if (profile.traits.length < ClonesService.MIN_TRAITS_FOR_ANSWER) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'starved_profile',
          message:
            'Клон ещё не сформирован — нужно больше встреч с обсуждениями подхода к решениям.',
        },
      });
    }

    // 4. Найти / собрать active ExecutablePersona.
    let persona = await this.prisma.executablePersona.findFirst({
      where: {
        profileId: profile.id,
        scope: 'person',
        status: 'active',
      },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      // on-demand build.
      this.logger.debug(
        { profileId: profile.id },
        'clones.askPerson: active Persona не найдена — пытаюсь собрать on-demand',
      );
      persona = await this.personaBuilder.buildForProfile({
        profileId: profile.id,
      });
      if (!persona) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'persona_unavailable',
            message:
              'Клон пока недоступен — следующий snapshot собирается каждое воскресенье 06:00.',
          },
        });
      }
    }

    // 5. Retrieval subgraph.
    const subgraph = await this.loadPersonSubgraph({
      tenantId: args.tenantId,
      personId: args.personId,
    });

    // 6. LLM clone-respond.
    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: args.question,
      subgraph,
    });

    // 7. Распарсить цитаты.
    const citations = this.parseCitations(llmResult.text, subgraph);

    // 8. ChatV2Conversation + Message.
    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: profile.id,
      question: args.question,
      conversationId: args.conversationId,
      answer: llmResult.text,
      citations,
      llmMeta: {
        model: llmResult.modelUsed,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        tier: llmResult.tier ?? null,
        personaVersion: persona.version,
      },
    });

    // 9. Метрики.
    this.metrics.incCloneAsk({ scope: 'person' });
    if (
      profile.person.userId &&
      profile.person.userId === args.requesterUserId
    ) {
      this.metrics.incCloneAskByOwner();
    }

    return {
      conversationId,
      messageId,
      text: llmResult.text,
      citations,
      mode: 'clone_style',
      isOwner:
        profile.person.userId !== null &&
        profile.person.userId === args.requesterUserId,
    };
  }

  /**
   * Ответ в стиле роли (агрегат по employee'ям этой роли).
   */
  async askRole(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    question: string;
    conversationId?: string;
  }): Promise<AskCloneResponseDto> {
    // 1. RBAC: read на Role + read на ≥ одну skill_profile внутри Org → admin/owner.
    const allowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к клону роли',
        },
      });
    }

    // 2. Rate limit.
    await this.assertRateLimit(args.requesterUserId);

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Роль не найдена' },
      });
    }

    // 3. Active role-persona.
    let persona = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        scopeRefId: args.roleId,
        status: 'active',
      },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      persona = await this.personaBuilder.buildForRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
      if (!persona) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'role_persona_unavailable',
            message:
              'Клон роли пока недоступен — нужно больше сотрудников с накопленными профилями.',
          },
        });
      }
    }

    // 4. Retrieval — top reasoning от всех employee'ев этой роли.
    const subgraph = await this.loadRoleSubgraph({
      tenantId: args.tenantId,
      roleId: args.roleId,
    });

    // 5. LLM call.
    const llmResult = await this.callCloneRespond({
      tenantId: args.tenantId,
      persona,
      question: args.question,
      subgraph,
    });

    const citations = this.parseCitations(llmResult.text, subgraph);

    const { conversationId, messageId } = await this.persistMessage({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      scope: 'card',
      scopeRefId: args.roleId,
      question: args.question,
      conversationId: args.conversationId,
      answer: llmResult.text,
      citations,
      llmMeta: {
        model: llmResult.modelUsed,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
        tier: llmResult.tier ?? null,
        personaVersion: persona.version,
        scopeKind: 'role',
        roleId: args.roleId,
      },
    });

    this.metrics.incCloneAsk({ scope: 'role' });

    return {
      conversationId,
      messageId,
      text: llmResult.text,
      citations,
      mode: 'clone_style',
      isOwner: false,
    };
  }

  // ─────────────────────── skill-profile read ───────────────────────

  async getPersonSkillProfile(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<SkillProfileDto> {
    // RBAC: то же что для askPerson (owner/admin/self/direct manager).
    const access = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: args.personId,
    });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к навыковому профилю этого сотрудника',
        },
      });
    }

    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { id: true, name: true, userId: true, tenantId: true },
    });
    if (!person || person.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'person_not_found',
          message: 'Сотрудник не найден',
        },
      });
    }

    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
      include: {
        traits: {
          where: { status: 'active' },
          orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
        },
      },
    });

    if (!profile) {
      return {
        profileId: '',
        personId: person.id,
        personName: person.name,
        status: 'paused_relationship',
        buildVersion: 0,
        lastBuildAt: null,
        isEmpty: true,
        canMarkMisleading:
          access.relation === 'owner_admin' || access.relation === 'manager',
        isSelf: access.relation === 'self',
        traits: [],
        personaSnapshots: [],
      };
    }

    const personaSnapshots = await this.prisma.executablePersona.findMany({
      where: { profileId: profile.id, scope: 'person' },
      orderBy: { version: 'desc' },
      take: 10,
      select: {
        id: true,
        version: true,
        snapshotAt: true,
        builtFromTraitsCount: true,
        status: true,
      },
    });

    return {
      profileId: profile.id,
      personId: person.id,
      personName: person.name,
      status: profile.status,
      buildVersion: profile.buildVersion,
      lastBuildAt: profile.lastBuildAt?.toISOString() ?? null,
      isEmpty: profile.traits.length === 0,
      canMarkMisleading:
        access.relation === 'owner_admin' || access.relation === 'manager',
      isSelf: access.relation === 'self',
      traits: profile.traits.map((t) => this.serializeTrait(t)),
      personaSnapshots: personaSnapshots.map((p) => ({
        id: p.id,
        version: p.version,
        snapshotAt: p.snapshotAt.toISOString(),
        builtFromTraitsCount: p.builtFromTraitsCount,
        status: p.status,
      })),
    };
  }

  async getRoleSkillProfile(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
  }): Promise<RoleSkillProfileDto> {
    // RBAC: read role.
    const allowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к роли',
        },
      });
    }

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.deletedAt || role.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Роль не найдена' },
      });
    }

    const personRoles = await this.prisma.personRole.findMany({
      where: { tenantId: args.tenantId, roleId: args.roleId, validTo: null },
      select: { personId: true },
      take: 100,
    });
    const personIds = [...new Set(personRoles.map((p) => p.personId))];

    const people: RoleSkillProfileDto['people'] = [];
    let topTraitsMap = new Map<string, { statement: string; count: number }>();

    if (personIds.length > 0) {
      const profiles = await this.prisma.skillProfile.findMany({
        where: {
          tenantId: args.tenantId,
          personId: { in: personIds },
          status: 'active',
        },
        include: {
          person: { select: { id: true, name: true, relationship: true } },
          traits: {
            where: { status: 'active' },
            select: {
              category: true,
              statement: true,
              observationCount: true,
            },
          },
        },
      });
      for (const p of profiles) {
        if (p.person.relationship !== 'employee') continue;
        people.push({
          personId: p.person.id,
          personName: p.person.name,
          activeTraitsCount: p.traits.length,
          profileBuildVersion: p.buildVersion,
        });
        for (const t of p.traits) {
          const key = t.category.toLowerCase();
          const ex = topTraitsMap.get(key);
          if (ex) {
            ex.count += t.observationCount;
          } else {
            topTraitsMap.set(key, {
              statement: t.statement,
              count: t.observationCount,
            });
          }
        }
      }
    }
    const topTraits = [...topTraitsMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([category, v]) => ({
        category,
        statement: v.statement,
        observationCount: v.count,
      }));

    const hasRolePersona =
      (await this.prisma.executablePersona.count({
        where: {
          tenantId: args.tenantId,
          scope: 'role',
          scopeRefId: args.roleId,
          status: 'active',
        },
      })) > 0;

    return {
      roleId: role.id,
      roleName: role.name,
      topTraits,
      people,
      hasRolePersona,
    };
  }

  /**
   * Помечает SkillTrait как misleading (post-hoc контроль кураторов).
   * RBAC: owner/admin или direct manager Person'а.
   */
  async markTraitMisleading(args: {
    tenantId: string;
    requesterUserId: string;
    traitId: string;
    reason: string;
  }): Promise<void> {
    const trait = await this.prisma.skillTrait.findUnique({
      where: { id: args.traitId },
      include: {
        profile: {
          select: { id: true, tenantId: true, personId: true },
        },
      },
    });
    if (!trait || trait.profile.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'trait_not_found', message: 'Черта не найдена' },
      });
    }
    const access = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: trait.profile.personId,
    });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к навыковому профилю этого сотрудника',
        },
      });
    }
    // Носитель не может пометить свой trait — это post-hoc контроль manager'а.
    if (access.relation !== 'owner_admin' && access.relation !== 'manager') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_self_mark',
          message:
            'Пометить черту неверной может только direct manager или admin',
        },
      });
    }
    const reason = (args.reason || '').trim().slice(0, 2_000);
    if (reason.length < 5) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'reason_required',
          message: 'Укажите обоснование (минимум 5 символов)',
        },
      });
    }
    await this.prisma.skillTrait.update({
      where: { id: trait.id },
      data: {
        status: 'misleading',
        misleadingReason: reason,
        misleadingFlaggedByUserId: args.requesterUserId,
        misleadingFlaggedAt: new Date(),
      },
    });
    this.metrics.incSkillTraitsMarkedMisleading({ category: trait.category });
  }

  /**
   * SBA γ-1 доделки — manual snapshot rebuild для ExecutablePersona.
   * Только owner Person'а или admin/owner Org. Bypass'ит idempotency-замок
   * (manual всегда работает).
   */
  async triggerManualPersonaSnapshot(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<{
    built: boolean;
    personaId: string | null;
    reason: string | null;
  }> {
    const access = await this.canAccessPersonClone({
      tenantId: args.tenantId,
      requesterUserId: args.requesterUserId,
      personId: args.personId,
    });
    if (!access.allowed) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Нет доступа к навыковому профилю этого сотрудника',
        },
      });
    }
    if (access.relation !== 'owner_admin' && access.relation !== 'self') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden_manual_snapshot',
          message:
            'Manual snapshot может запросить только сам носитель или admin/owner Org',
        },
      });
    }
    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
      select: { id: true, tenantId: true },
    });
    if (!profile || profile.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'skill_profile_not_found',
          message: 'Навыковый профиль не найден',
        },
      });
    }
    const result = await this.personaVersioning.triggerRebuild({
      profileId: profile.id,
      reason: 'manual',
      triggerEventAt: new Date(),
      bypassLock: true,
    });
    return result.built
      ? { built: true, personaId: result.personaId, reason: null }
      : { built: false, personaId: null, reason: result.reason };
  }

  private serializeTrait(t: {
    id: string;
    category: string;
    statement: string;
    confidence: 'low' | 'medium' | 'high';
    observationCount: number;
    sourceBlockIds: string[];
    firstObservedAt: Date;
    lastConfirmedAt: Date;
    status: 'active' | 'superseded_by' | 'archived' | 'misleading';
  }): SkillTraitDto {
    return {
      id: t.id,
      category: t.category,
      statement: t.statement,
      confidence: t.confidence,
      observationCount: t.observationCount,
      sourceBlockIds: t.sourceBlockIds,
      firstObservedAt: t.firstObservedAt.toISOString(),
      lastConfirmedAt: t.lastConfirmedAt.toISOString(),
      status: t.status,
    };
  }

  // ─────────────────────── RBAC ───────────────────────

  /**
   * Доступ к клону Person разрешён:
   *   - owner/admin Org;
   *   - сам носитель (Person.userId === requesterUserId);
   *   - direct manager (Membership.role='manager' в той же primaryDepartment).
   */
  private async canAccessPersonClone(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<{ allowed: boolean; relation: 'owner_admin' | 'self' | 'manager' | 'none' }> {
    // 1. owner/admin?
    const adminAllowed = await this.rbac.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'knowledge_profile',
      act: 'read',
      resourceOwnerId: null,
    });
    if (adminAllowed) {
      const ctx = await this.rbac.loadContext(args.requesterUserId, args.tenantId);
      const role = ctx?.isSuperAdmin ? 'owner' : ctx?.role;
      if (role === 'owner' || role === 'admin') {
        return { allowed: true, relation: 'owner_admin' };
      }
    }

    // 2. self?
    const target = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { id: true, userId: true, primaryDepartmentId: true, tenantId: true },
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

  // ─────────────────────── rate limit ───────────────────────

  private async assertRateLimit(userId: string): Promise<void> {
    const limit = this.cfg.skill.cloneAskPerUserPerDay;
    const dayKey = new Date().toISOString().slice(0, 10);
    const redisKey = `clone:ask:${userId}:${dayKey}`;
    try {
      const count = await this.redis.client.incr(redisKey);
      if (count === 1) {
        // First hit — set TTL 26h (запас на TZ).
        await this.redis.client.expire(redisKey, 26 * 60 * 60);
      }
      if (count > limit) {
        throw new HttpException(
          {
            ok: false,
            error: {
              code: 'clone_ask_rate_limit',
              message: `Превышен суточный лимит запросов к клону (${limit}). Попробуйте завтра.`,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        { userId, err: err instanceof Error ? err.message : String(err) },
        'clones.assertRateLimit: Redis упал — пропускаю проверку',
      );
    }
  }

  // ─────────────────────── retrieval ───────────────────────

  private async loadPersonSubgraph(args: {
    tenantId: string;
    personId: string;
  }): Promise<CloneSubgraph> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: {
        id: true,
        entityId: true,
        knowledgeProfile: true,
      },
    });
    if (!person) return emptySubgraph();

    // 1. Subject-reasoning блоки (top 20 свежие).
    const reasoningBlocks: CloneBlock[] = [];
    if (person.entityId) {
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: person.entityId,
          role: 'subject',
          block: {
            tenantId: args.tenantId,
            status: 'canonical',
            signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
          },
        },
        select: { blockId: true },
        take: 40,
      });
      const blockIds = [...new Set(mentions.map((m) => m.blockId))];
      if (blockIds.length > 0) {
        const blocks = await this.prisma.ideaBlock.findMany({
          where: { id: { in: blockIds } },
          select: {
            id: true,
            name: true,
            trustedAnswer: true,
            evidence: {
              select: {
                quote: true,
                rawEventId: true,
                sourceTimestamp: true,
              },
              take: 1,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        for (const b of blocks) {
          const evidence = b.evidence[0];
          reasoningBlocks.push({
            id: b.id,
            text: b.trustedAnswer ?? b.name,
            meetingId: null,
            meetingTitle: null,
            startMs: null,
            endMs: null,
            snippet: evidence?.quote ?? null,
          });
        }
      }
    }

    // 2. KnowledgeProfile summary.
    const knowledgeProfileSummary = this.serializeKnowledgeProfile(
      person.knowledgeProfile,
    );

    // 3. Top decisions с decidedByPersonIds.includes(personId).
    const decisions = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        decidedByPersonIds: { has: args.personId },
        status: { notIn: ['rejected', 'cancelled', 'superseded'] },
      },
      select: { id: true, statement: true, rationale: true, decidedAt: true },
      orderBy: { decidedAt: 'desc' },
      take: 10,
    });

    return {
      reasoningBlocks,
      knowledgeProfileSummary,
      decisions: decisions.map((d) => ({
        id: d.id,
        statement: d.statement ?? '',
        rationale: d.rationale,
      })),
    };
  }

  private async loadRoleSubgraph(args: {
    tenantId: string;
    roleId: string;
  }): Promise<CloneSubgraph> {
    // Найти всех employee'ев этой роли.
    const personRoles = await this.prisma.personRole.findMany({
      where: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        validTo: null,
      },
      select: { personId: true },
      take: 50,
    });
    const personIds = [...new Set(personRoles.map((p) => p.personId))];
    if (personIds.length === 0) return emptySubgraph();

    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        id: { in: personIds },
        relationship: 'employee',
        deletedAt: null,
      },
      select: { id: true, entityId: true },
    });
    const entityIds = persons
      .map((p) => p.entityId)
      .filter((id): id is string => Boolean(id));

    const reasoningBlocks: CloneBlock[] = [];
    if (entityIds.length > 0) {
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: entityIds },
          role: 'subject',
          block: {
            tenantId: args.tenantId,
            status: 'canonical',
            signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
          },
        },
        select: { blockId: true },
        take: 60,
      });
      const blockIds = [...new Set(mentions.map((m) => m.blockId))];
      if (blockIds.length > 0) {
        const blocks = await this.prisma.ideaBlock.findMany({
          where: { id: { in: blockIds } },
          select: {
            id: true,
            name: true,
            trustedAnswer: true,
            evidence: { select: { quote: true }, take: 1 },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
        for (const b of blocks) {
          const evidence = b.evidence[0];
          reasoningBlocks.push({
            id: b.id,
            text: b.trustedAnswer ?? b.name,
            meetingId: null,
            meetingTitle: null,
            startMs: null,
            endMs: null,
            snippet: evidence?.quote ?? null,
          });
        }
      }
    }

    return {
      reasoningBlocks,
      knowledgeProfileSummary: null,
      decisions: [],
    };
  }

  private serializeKnowledgeProfile(raw: Prisma.JsonValue | null): string | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const categoriesRaw = Array.isArray(obj.categories) ? obj.categories : [];
    if (categoriesRaw.length === 0) return null;
    const parts: string[] = [];
    for (const c of categoriesRaw.slice(0, 8)) {
      if (!c || typeof c !== 'object') continue;
      const cat = c as Record<string, unknown>;
      const name = typeof cat.name === 'string' ? cat.name : '';
      const conf = typeof cat.confidence === 'string' ? cat.confidence : 'low';
      if (name) parts.push(`${name} (${conf})`);
    }
    return parts.length > 0 ? parts.join('; ') : null;
  }

  // ─────────────────────── LLM call ───────────────────────

  private async callCloneRespond(args: {
    tenantId: string;
    persona: ExecutablePersona;
    question: string;
    subgraph: CloneSubgraph;
  }): Promise<LlmCallResult> {
    const systemPrompt = `${CLONE_RESPOND_SYSTEM_PROMPT_BASE}\n\n${args.persona.personaPrompt}`;
    return this.llm.call({
      taskType: 'clone-respond',
      systemPrompt,
      userMessage: CLONE_RESPOND_USER_TEMPLATE({
        question: args.question,
        subgraph: {
          reasoningBlocks: args.subgraph.reasoningBlocks.map((b) => ({
            id: b.id,
            text: b.text,
          })),
          knowledgeProfileSummary: args.subgraph.knowledgeProfileSummary,
          decisions: args.subgraph.decisions,
        },
      }),
      tenantId: args.tenantId,
      sourceRef: { type: 'executable_persona', id: args.persona.id },
      dataClass: 'internal',
    });
  }

  private parseCitations(
    answerText: string,
    subgraph: CloneSubgraph,
  ): CloneCitationDto[] {
    const blockMap = new Map<string, CloneBlock>(
      subgraph.reasoningBlocks.map((b) => [b.id, b]),
    );
    const regex = /\[BLOCK:([a-zA-Z0-9_-]+)\]/g;
    const seen = new Set<string>();
    const out: CloneCitationDto[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(answerText)) !== null) {
      const id = m[1];
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const b = blockMap.get(id);
      if (!b) continue;
      out.push({
        blockId: b.id,
        meetingId: b.meetingId ?? undefined,
        meetingTitle: b.meetingTitle ?? undefined,
        startMs: b.startMs ?? undefined,
        endMs: b.endMs ?? undefined,
        snippet: b.snippet ?? undefined,
      });
    }
    return out;
  }

  // ─────────────────────── persist message ───────────────────────

  private async persistMessage(args: {
    tenantId: string;
    requesterUserId: string;
    scope: 'card' | 'personal';
    scopeRefId: string;
    question: string;
    conversationId?: string;
    answer: string;
    citations: CloneCitationDto[];
    llmMeta: Record<string, unknown>;
  }): Promise<{ conversationId: string; messageId: string }> {
    let conversationId: string;
    if (args.conversationId) {
      const existing = await this.prisma.chatV2Conversation.findFirst({
        where: {
          id: args.conversationId,
          tenantId: args.tenantId,
          userId: args.requesterUserId,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'conversation_not_found',
            message: 'Диалог не найден',
          },
        });
      }
      conversationId = existing.id;
    } else {
      const created = await this.prisma.chatV2Conversation.create({
        data: {
          tenantId: args.tenantId,
          userId: args.requesterUserId,
          scope: args.scope,
          scopeRefId: args.scopeRefId,
          channelKindOrigin: 'web',
        },
      });
      conversationId = created.id;
    }

    // Append user + assistant сообщения.
    await this.prisma.chatV2Message.create({
      data: {
        conversationId,
        role: 'user',
        text: args.question.slice(0, 4_000),
      },
    });
    const assistantMessage = await this.prisma.chatV2Message.create({
      data: {
        conversationId,
        role: 'assistant',
        mode: 'clone_style',
        text: args.answer,
        citations:
          args.citations.length > 0
            ? (args.citations as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        llmMeta: args.llmMeta as Prisma.InputJsonValue,
      },
    });
    return { conversationId, messageId: assistantMessage.id };
  }
}

// ─────────────────────── types ───────────────────────

interface CloneBlock {
  id: string;
  text: string;
  meetingId: string | null;
  meetingTitle: string | null;
  startMs: number | null;
  endMs: number | null;
  snippet: string | null;
}

export interface CloneSubgraph {
  reasoningBlocks: CloneBlock[];
  knowledgeProfileSummary: string | null;
  decisions: Array<{ id: string; statement: string; rationale: string | null }>;
}

function emptySubgraph(): CloneSubgraph {
  return {
    reasoningBlocks: [],
    knowledgeProfileSummary: null,
    decisions: [],
  };
}
