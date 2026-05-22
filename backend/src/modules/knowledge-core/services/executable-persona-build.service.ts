import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ExecutablePersona,
  type SkillProfile,
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
  EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT,
  EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE,
} from '../prompts/executable-persona-compile.prompt';

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
  ) {}

  /**
   * Сборка persona для одного SkillProfile. Возвращает новый snapshot
   * (или null если traits недостаточно). Старый active помечается superseded.
   */
  async buildForProfile(args: {
    profileId: string;
  }): Promise<ExecutablePersona | null> {
    const start = Date.now();
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
  }): Promise<ExecutablePersona | null> {
    const start = Date.now();
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

      const newPersona = await this.prisma.$transaction(async (tx) => {
        await tx.executablePersona.updateMany({
          where: {
            tenantId: args.tenantId,
            scope: 'role',
            scopeRefId: args.roleId,
            status: 'active',
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
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'executable-persona-compile',
        systemPrompt: EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT,
        userMessage: EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE({
          personName: args.personName,
          personRole: args.personRole,
          traits: args.traits.map((t) => ({
            category: t.category,
            statement: t.statement,
            confidence: t.confidence,
            observationCount: t.observationCount,
          })),
        }),
        tenantId: args.tenantId,
        dataClass: 'internal',
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
