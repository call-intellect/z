import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type ExecutablePersona,
  Prisma,
  type SkillTrait,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { tenantTopLabel } from '../../company-foundation/utils/tenant-top';
import {
  EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT,
  EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE,
} from '../prompts/executable-persona-compile.prompt';

import { DataClassPolicyService } from './dataclass-policy.service';

/**
 * SBA γ-1 доделки — почему был собран snapshot.
 *   - 'scheduled' — еженедельный cron;
 *   - 'threshold' — ≥N новых traits с прошлого snapshot;
 *   - 'critical' — mark_as_misleading (severity=critical);
 *   - 'manual' — вручную через admin API;
 *   - 'on_demand' — on-the-fly из ClonesService (clones.askPerson/askRole).
 */
export type PersonaTriggerReason =
  | 'scheduled'
  | 'threshold'
  | 'critical'
  | 'manual'
  | 'on_demand';

/**
 * SBA γ-1 — ExecutablePersonaBuildService.
 *
 * Собирает snapshots ExecutablePersona двух типов:
 *   - scope='person': один snapshot на каждый active SkillProfile с
 *     >= PERSONA_MIN_TRAITS active traits.
 *   - scope='role': один snapshot на каждую Role с >=
 *     PERSONA_ROLE_AGG_MIN_PERSONS employee'ями (у каждого активный SkillProfile).
 *
 * Вызывается из cron (раз в неделю) И на лету из ClonesService, если active
 * persona для профиля отсутствует.
 */
@Injectable()
export class ExecutablePersonaBuildService {
  private readonly logger = new Logger(ExecutablePersonaBuildService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    // W4.1 — DataClassPolicyService для shadow-compare (см. ТЗ §W4.1).
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Сборка persona для одного SkillProfile. Возвращает новый snapshot
   * (или null если traits недостаточно). Старый active помечается superseded.
   */
  async buildForProfile(args: {
    profileId: string;
    /** SBA γ-1 доделки — почему этот snapshot сейчас собирается (по умолчанию on_demand). */
    triggerReason?: PersonaTriggerReason;
    /** SBA γ-1 доделки — момент триггерного события (для метрики lag). */
    triggerEventAt?: Date | null;
  }): Promise<ExecutablePersona | null> {
    const start = Date.now();
    const triggerReason: PersonaTriggerReason = args.triggerReason ?? 'on_demand';
    const triggerEventAt = args.triggerEventAt ?? null;
    try {
      const profile = await this.prisma.skillProfile.findUnique({
        where: { id: args.profileId },
        include: {
          person: {
            select: { id: true, tenantId: true, name: true, relationship: true },
          },
          traits: {
            where: { status: 'active' },
            orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
            take: 20,
          },
        },
      });
      if (!profile) return null;
      if (profile.person.relationship !== 'employee') return null;
      if (profile.status !== 'active') return null;
      if (profile.traits.length < this.cfg.persona.minTraits) return null;

      // LLM compile.
      const personaPrompt = await this.compilePersonaPrompt({
        tenantId: profile.tenantId,
        personName: profile.person.name,
        personRole: null,
        traits: profile.traits,
      });
      if (!personaPrompt) return null;

      // Insert new + supersede previous.
      const nextVersion = await this.nextVersion({
        profileId: profile.id,
        scope: 'person',
        scopeRefId: null,
      });

      // W4.1/W4.2 — derive DataClass для ExecutablePersona.
      // Floor: 'internal' (Клон Роли, §4 ТЗ — решение №6 clones-role-based-rebrand).
      // На enforce — сохраняем audit в `ExecutablePersona.dataClassAudit`;
      // на shadow/off — JsonNull. dataClass-колонки у модели нет — это
      // ожидаемо, артефакт всегда 'internal' по floor'у.
      const enforcementEp = this.cfg?.dataClassPolicy.enforcement ?? 'off';
      const derivedEp = this.dataClassPolicy?.derive({
        sources: profile.traits.map((t) => ({
          dataClass: 'internal' as const,
          sourceId: t.id,
          sourceKind: 'skill_trait' as const,
        })),
        context: { kind: 'executable_persona' },
      });
      if (this.dataClassPolicy && derivedEp) {
        this.dataClassPolicy.compareWithLegacy({
          legacyResult: 'internal',
          proposedResult: derivedEp.dataClass,
          kind: 'executable_persona',
          sourceIds: profile.traits.map((t) => t.id),
        });
      }
      const personaAudit: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        enforcementEp === 'enforce' && derivedEp
          ? (derivedEp.audit as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;

      const newPersona = await this.prisma.$transaction(async (tx) => {
        await tx.executablePersona.updateMany({
          where: {
            profileId: profile.id,
            scope: 'person',
            status: 'active',
          },
          data: { status: 'superseded' },
        });
        return tx.executablePersona.create({
          data: {
            tenantId: profile.tenantId,
            profileId: profile.id,
            scope: 'person',
            scopeRefId: null,
            version: nextVersion,
            personaPrompt,
            includedTraitIds: profile.traits.map((t) => t.id),
            status: 'active',
            builtFromTraitsCount: profile.traits.length,
            triggerReason,
            triggerEventAt,
            dataClassAudit: personaAudit,
          },
        });
      });

      this.metrics.observePersonaBuildDuration(
        (Date.now() - start) / 1000,
      );
      this.metrics.incCoreSpecialistCards({
        type: 'persona',
        status: 'canonical',
      });

      // SBA γ-1 доделки — counter и lag-gauge для snapshot.
      try {
        const tenantTop = await tenantTopLabel(this.prisma, profile.tenantId);
        this.metrics.incExecutablePersonaSnapshot({
          tenantTop,
          trigger: triggerReason,
        });
        if (triggerEventAt) {
          this.metrics.setExecutablePersonaSnapshotLag({
            tenantTop,
            seconds: Math.max(
              0,
              Math.floor((Date.now() - triggerEventAt.getTime()) / 1000),
            ),
          });
        }
      } catch (metricsErr) {
        this.logger.debug(
          { err: metricsErr instanceof Error ? metricsErr.message : String(metricsErr) },
          'buildForProfile: snapshot-метрика упала — skip',
        );
      }

      return newPersona;
    } catch (err) {
      this.logger.warn(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'executable-persona-build.buildForProfile: упал — skip',
      );
      return null;
    }
  }

  /**
   * Сборка role-persona. Аггрегирует top traits всех employee'ев Role.
   * Возвращает новый snapshot (или null если employee'ев недостаточно).
   */
  async buildForRole(args: {
    tenantId: string;
    roleId: string;
    triggerReason?: PersonaTriggerReason;
    triggerEventAt?: Date | null;
  }): Promise<ExecutablePersona | null> {
    const start = Date.now();
    const triggerReason: PersonaTriggerReason = args.triggerReason ?? 'on_demand';
    const triggerEventAt = args.triggerEventAt ?? null;
    try {
      // Найти всех employee'ев Role с активным SkillProfile.
      const personRoles = await this.prisma.personRole.findMany({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          validTo: null,
        },
        select: { personId: true },
        take: 50,
      });
      if (personRoles.length === 0) return null;

      const personIds = [...new Set(personRoles.map((p) => p.personId))];
      const profiles = await this.prisma.skillProfile.findMany({
        where: {
          tenantId: args.tenantId,
          personId: { in: personIds },
          status: 'active',
        },
        include: {
          person: { select: { name: true, relationship: true } },
          traits: {
            where: { status: 'active' },
            orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
            take: 10,
          },
        },
      });
      const activeProfiles = profiles.filter(
        (p) => p.person.relationship === 'employee' && p.traits.length > 0,
      );
      if (activeProfiles.length < this.cfg.persona.roleAggMinPersons) return null;

      // Aggregate top-N traits (combined).
      const aggregatedTraits: SkillTrait[] = [];
      for (const p of activeProfiles) {
        aggregatedTraits.push(...p.traits.slice(0, 5));
      }
      if (aggregatedTraits.length < this.cfg.persona.minTraits) return null;

      const role = await this.prisma.role.findUnique({
        where: { id: args.roleId },
        select: { name: true },
      });
      const personaPrompt = await this.compilePersonaPrompt({
        tenantId: args.tenantId,
        personName: role?.name ?? 'роль',
        personRole: role?.name ?? null,
        traits: aggregatedTraits,
      });
      if (!personaPrompt) return null;

      const nextVersion = await this.nextVersion({
        profileId: null,
        scope: 'role',
        scopeRefId: args.roleId,
      });

      // Clones=Roles Ф5 (2026-05-25) — клон роли это shared-знание Org,
      // dataClass всегда `internal` (floor поднимает любой источник).
      // Используем `DataClassPolicyService.derive(kind='executable_persona')`.
      // Audit-trail сохраняем в `dataClassAudit` (W4.2-поле).
      let dataClassAudit: import('@prisma/client').Prisma.InputJsonValue | undefined;
      if (this.dataClassPolicy) {
        const derived = this.dataClassPolicy.derive({
          sources: aggregatedTraits.map((t) => ({
            dataClass: 'internal' as const,
            sourceId: t.id,
            sourceKind: 'skill_trait' as const,
          })),
          context: { kind: 'executable_persona' },
        });
        // Shadow-compare с legacy='internal' (де-факто).
        this.dataClassPolicy.compareWithLegacy({
          legacyResult: 'internal',
          proposedResult: derived.dataClass,
          kind: 'executable_persona',
          sourceIds: aggregatedTraits.map((t) => t.id),
        });
        dataClassAudit = derived.audit as unknown as import('@prisma/client').Prisma.InputJsonValue;
      }

      // Clones=Roles Ф2 — пересборка для role-scope должна также
      // «погашать» pending_rebuild версии (создаваемые handler'ом при
      // смене носителя). Иначе они останутся висеть в БД и портить count
      // в `clones_role_versions_total`.
      const newPersona = await this.prisma.$transaction(async (tx) => {
        await tx.executablePersona.updateMany({
          where: {
            tenantId: args.tenantId,
            scope: 'role',
            scopeRefId: args.roleId,
            status: { in: ['active', 'pending_rebuild'] },
          },
          data: { status: 'superseded' },
        });
        return tx.executablePersona.create({
          data: {
            tenantId: args.tenantId,
            profileId: null,
            scope: 'role',
            scopeRefId: args.roleId,
            version: nextVersion,
            personaPrompt,
            includedTraitIds: aggregatedTraits.map((t) => t.id),
            status: 'active',
            builtFromTraitsCount: aggregatedTraits.length,
            triggerReason,
            triggerEventAt,
            ...(dataClassAudit ? { dataClassAudit } : {}),
          },
        });
      });

      this.metrics.observePersonaBuildDuration(
        (Date.now() - start) / 1000,
      );
      this.metrics.incCoreSpecialistCards({
        type: 'persona',
        status: 'canonical',
      });

      // SBA γ-1 доделки — snapshot-метрики.
      try {
        const tenantTop = await tenantTopLabel(this.prisma, args.tenantId);
        this.metrics.incExecutablePersonaSnapshot({
          tenantTop,
          trigger: triggerReason,
        });
        if (triggerEventAt) {
          this.metrics.setExecutablePersonaSnapshotLag({
            tenantTop,
            seconds: Math.max(
              0,
              Math.floor((Date.now() - triggerEventAt.getTime()) / 1000),
            ),
          });
        }
      } catch (metricsErr) {
        this.logger.debug(
          { err: metricsErr instanceof Error ? metricsErr.message : String(metricsErr) },
          'buildForRole: snapshot-метрика упала — skip',
        );
      }

      return newPersona;
    } catch (err) {
      this.logger.warn(
        {
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'executable-persona-build.buildForRole: упал — skip',
      );
      return null;
    }
  }

  private async compilePersonaPrompt(args: {
    tenantId: string;
    personName: string;
    personRole: string | null;
    traits: ReadonlyArray<{
      category: string;
      statement: string;
      confidence: string;
      observationCount: number;
    }>;
  }): Promise<string | null> {
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (traits, исходно из транскриптов).
    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE({
      personName: args.personName,
      personRole: args.personRole,
      traits: args.traits.map((t) => ({
        category: t.category,
        statement: t.statement,
        confidence: t.confidence,
        observationCount: t.observationCount,
      })),
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'executable-persona-compile',
        systemPrompt: guardOn
          ? withInjectionGuard(EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT)
          : EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: args.tenantId,
        dataClass: 'internal',
        // ТЗ 2026-05-25 LLM-architecture §10.4 Find 1 — текст persona 300-800
        // слов + thinking-токены DeepSeek-Pro. На дефолтных 4096 проваливается.
        maxTokens: 8_000,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'executable-persona-build.compilePersonaPrompt: LLM упал',
      );
      return null;
    }
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'persona',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }
    const text = result.text.trim();
    if (text.length < 50) return null;
    return text.slice(0, 8_000);
  }

  private async nextVersion(args: {
    profileId: string | null;
    scope: 'person' | 'role';
    scopeRefId: string | null;
  }): Promise<number> {
    const where: {
      profileId: string | null;
      scope: 'person' | 'role';
      scopeRefId: string | null;
    } = {
      profileId: args.profileId,
      scope: args.scope,
      scopeRefId: args.scopeRefId,
    };
    const last = await this.prisma.executablePersona.findFirst({
      where,
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (last?.version ?? 0) + 1;
  }
}
