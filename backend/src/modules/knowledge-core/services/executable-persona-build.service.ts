import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type ExecutablePersona, Prisma, type SkillTrait } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { tenantTopLabel } from '../../company-foundation/utils/tenant-top';
import {
  EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT,
  EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE,
  type PersonaCompilePracticeSkillInput,
  type PersonaCompilePrincipleInput,
  type PersonaCompileTraitInput,
} from '../prompts/executable-persona-compile.prompt';

import { DataClassPolicyService } from './dataclass-policy.service';

export type PersonaTriggerReason = 'scheduled' | 'threshold' | 'critical' | 'manual' | 'on_demand';

@Injectable()
export class ExecutablePersonaBuildService {
  private readonly logger = new Logger(ExecutablePersonaBuildService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async buildForProfile(args: {
    profileId: string;
    triggerReason?: PersonaTriggerReason;
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
            where: { status: 'active', layer: 'skill' },
            orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
            take: 20,
          },
        },
      });
      if (!profile) return null;
      if (profile.person.relationship !== 'employee') return null;
      if (profile.status !== 'active') return null;
      if (profile.traits.length < this.cfg.persona.minTraits) return null;

      const personId = profile.person.id;
      const [values, motivations, processMarkers, roleId, practiceSkillRows] = await Promise.all([
        this.findTopTraitsByLayer({ profileId: profile.id, layer: 'value' }),
        this.findTopTraitsByLayer({
          profileId: profile.id,
          layer: 'motivation',
        }),
        this.findTopTraitsByLayer({
          profileId: profile.id,
          layer: 'process_marker',
        }),
        this.findActiveRoleIdForPerson({
          tenantId: profile.tenantId,
          personId,
        }),
        this.prisma.practiceSkill.findMany({
          where: {
            tenantId: profile.tenantId,
            scope: 'person',
            scopeRefId: personId,
            status: 'active',
          },
          orderBy: [{ pinned: 'desc' }, { successRate: { sort: 'desc', nulls: 'last' } }],
          take: 5,
        }),
      ]);
      const principles = roleId
        ? await this.prisma.rolePrinciple.findMany({
            where: {
              tenantId: profile.tenantId,
              roleId,
              status: 'active',
            },
            orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
            take: 5,
          })
        : [];
      const practiceSkills = this.parsePracticeSkillsForPrompt(practiceSkillRows);

      const personaPrompt = await this.compilePersonaPrompt({
        tenantId: profile.tenantId,
        personName: profile.person.name,
        personRole: null,
        traits: profile.traits,
        values,
        motivations,
        processMarkers,
        principles: principles.map((p) => ({
          situation: p.situation,
          statement: p.statement,
          observationCount: p.observationCount,
          confidence: p.confidence,
        })),
        practiceSkills,
      });
      if (!personaPrompt) return null;

      const includedTraitIds = [
        ...profile.traits.map((t) => t.id),
        ...values.map((t) => t.id),
        ...motivations.map((t) => t.id),
        ...processMarkers.map((t) => t.id),
      ];

      const nextVersion = await this.nextVersion({
        profileId: profile.id,
        scope: 'person',
        scopeRefId: null,
      });

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
            includedTraitIds,
            status: 'active',
            builtFromTraitsCount: profile.traits.length,
            triggerReason,
            triggerEventAt,
            dataClassAudit: personaAudit,
          },
        });
      });

      this.metrics.observePersonaBuildDuration((Date.now() - start) / 1000);
      this.metrics.incCoreSpecialistCards({
        type: 'persona',
        status: 'canonical',
      });

      try {
        const tenantTop = await tenantTopLabel(this.prisma, profile.tenantId);
        this.metrics.incExecutablePersonaSnapshot({
          tenantTop,
          trigger: triggerReason,
        });
        if (triggerEventAt) {
          this.metrics.setExecutablePersonaSnapshotLag({
            tenantTop,
            seconds: Math.max(0, Math.floor((Date.now() - triggerEventAt.getTime()) / 1000)),
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

  async buildForRole(args: {
    tenantId: string;
    roleId: string;
    bearerPersonId?: string | null;
    triggerReason?: PersonaTriggerReason;
    triggerEventAt?: Date | null;
  }): Promise<ExecutablePersona | null> {
    const start = Date.now();
    const triggerReason: PersonaTriggerReason = args.triggerReason ?? 'on_demand';
    const triggerEventAt = args.triggerEventAt ?? null;

    const roleLockKey = `persona:rebuild:role:${args.roleId}`;
    const roleLockAcquired = await this.acquireRoleLock(roleLockKey);
    if (!roleLockAcquired) {
      this.logger.debug(
        { roleId: args.roleId },
        'buildForRole: role-lock занят — skip (параллельная сборка идёт)',
      );
      return null;
    }
    try {
      const bearerPersonId =
        args.bearerPersonId ??
        (await this.resolveCurrentBearer({
          tenantId: args.tenantId,
          roleId: args.roleId,
        }));
      if (!bearerPersonId) {
        return null;
      }

      const profile = await this.prisma.skillProfile.findFirst({
        where: {
          tenantId: args.tenantId,
          personId: bearerPersonId,
          status: 'active',
        },
        include: {
          person: { select: { name: true, relationship: true } },
          traits: {
            where: { status: 'active', layer: 'skill' },
            orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
            take: 10,
          },
        },
      });
      if (!profile || profile.person.relationship !== 'employee') return null;

      const dedupedTraits = this.dedupeTraitsByConcept(profile.traits);
      if (dedupedTraits.length < this.cfg.persona.minTraits) return null;

      const role = await this.prisma.role.findUnique({
        where: { id: args.roleId },
        select: { name: true },
      });

      const [values, motivations, processMarkers, principles, practiceSkillRows] =
        await Promise.all([
          this.findTopTraitsByLayer({ profileId: profile.id, layer: 'value' }),
          this.findTopTraitsByLayer({
            profileId: profile.id,
            layer: 'motivation',
          }),
          this.findTopTraitsByLayer({
            profileId: profile.id,
            layer: 'process_marker',
          }),
          this.prisma.rolePrinciple.findMany({
            where: {
              tenantId: args.tenantId,
              roleId: args.roleId,
              status: 'active',
            },
            orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
            take: 5,
          }),
          this.prisma.practiceSkill.findMany({
            where: {
              tenantId: args.tenantId,
              status: 'active',
              OR: [
                { scope: 'role', scopeRefId: args.roleId },
                { scope: 'person', scopeRefId: bearerPersonId },
              ],
            },
            orderBy: [{ pinned: 'desc' }, { successRate: { sort: 'desc', nulls: 'last' } }],
            take: 5,
          }),
        ]);
      const practiceSkills = this.parsePracticeSkillsForPrompt(practiceSkillRows);

      const personaPrompt = await this.compilePersonaPrompt({
        tenantId: args.tenantId,
        personName: role?.name ?? 'роль',
        personRole: role?.name ?? null,
        traits: dedupedTraits,
        values,
        motivations,
        processMarkers,
        principles: principles.map((p) => ({
          situation: p.situation,
          statement: p.statement,
          observationCount: p.observationCount,
          confidence: p.confidence,
        })),
        practiceSkills,
      });
      if (!personaPrompt) return null;

      const includedTraitIds = [
        ...dedupedTraits.map((t) => t.id),
        ...values.map((t) => t.id),
        ...motivations.map((t) => t.id),
        ...processMarkers.map((t) => t.id),
      ];

      let dataClassAudit: Prisma.InputJsonValue | undefined;
      if (this.dataClassPolicy) {
        const derived = this.dataClassPolicy.derive({
          sources: dedupedTraits.map((t) => ({
            dataClass: 'internal' as const,
            sourceId: t.id,
            sourceKind: 'skill_trait' as const,
          })),
          context: { kind: 'executable_persona' },
        });
        this.dataClassPolicy.compareWithLegacy({
          legacyResult: 'internal',
          proposedResult: derived.dataClass,
          kind: 'executable_persona',
          sourceIds: dedupedTraits.map((t) => t.id),
        });
        dataClassAudit = derived.audit as unknown as Prisma.InputJsonValue;
      }

      const newPersona = await this.prisma.$transaction(async (tx) => {
        const prevActive = await tx.executablePersona.findFirst({
          where: {
            tenantId: args.tenantId,
            scope: 'role',
            scopeRefId: args.roleId,
            status: 'active',
          },
          orderBy: [{ roleVersion: 'desc' }, { snapshotAt: 'desc' }],
          select: { id: true, roleVersion: true },
        });
        const lastForVersion = await tx.executablePersona.findFirst({
          where: {
            tenantId: args.tenantId,
            scope: 'role',
            scopeRefId: args.roleId,
          },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const nextVersion = (lastForVersion?.version ?? 0) + 1;
        const nextRoleVersion = (prevActive?.roleVersion ?? 0) + 1;

        if (prevActive) {
          await tx.executablePersona.updateMany({
            where: { id: prevActive.id, status: 'active' },
            data: { status: 'frozen' },
          });
        }
        await tx.executablePersona.updateMany({
          where: {
            tenantId: args.tenantId,
            scope: 'role',
            scopeRefId: args.roleId,
            status: 'pending_rebuild',
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
            roleVersion: nextRoleVersion,
            currentBearerPersonId: bearerPersonId,
            publicName: `Клон ${role?.name ?? 'роль'} v${nextRoleVersion}`,
            succeedsPersonaId: prevActive?.id ?? null,
            personaPrompt,
            includedTraitIds,
            status: 'active',
            builtFromTraitsCount: dedupedTraits.length,
            triggerReason,
            triggerEventAt,
            ...(dataClassAudit ? { dataClassAudit } : {}),
          },
        });
      });

      this.metrics.observePersonaBuildDuration((Date.now() - start) / 1000);
      this.metrics.incCoreSpecialistCards({
        type: 'persona',
        status: 'canonical',
      });

      try {
        const tenantTop = await tenantTopLabel(this.prisma, args.tenantId);
        this.metrics.incExecutablePersonaSnapshot({
          tenantTop,
          trigger: triggerReason,
        });
        if (triggerEventAt) {
          this.metrics.setExecutablePersonaSnapshotLag({
            tenantTop,
            seconds: Math.max(0, Math.floor((Date.now() - triggerEventAt.getTime()) / 1000)),
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
    } finally {
      await this.releaseRoleLock(roleLockKey);
    }
  }

  private async resolveCurrentBearer(args: {
    tenantId: string;
    roleId: string;
  }): Promise<string | null> {
    const [personRoleRows, appointmentRows] = await Promise.all([
      this.prisma.personRole.findMany({
        where: { tenantId: args.tenantId, roleId: args.roleId, validTo: null },
        select: { personId: true, validFrom: true },
        orderBy: { validFrom: 'desc' },
        take: 5,
      }),
      this.prisma.appointment.findMany({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          validTo: null,
          status: { in: ['active', 'acting'] },
        },
        select: { personId: true, validFrom: true },
        orderBy: { validFrom: 'desc' },
        take: 5,
      }),
    ]);
    const all = [...personRoleRows, ...appointmentRows];
    if (all.length === 0) return null;
    all.sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());
    return all[0]?.personId ?? null;
  }

  private async acquireRoleLock(key: string): Promise<boolean> {
    if (!this.redis) return true;
    try {
      const res = await this.redis.client.set(key, '1', 'EX', 120, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'buildForRole: Redis lock упал — fail-open (разрешаем сборку)',
      );
      return true;
    }
  }

  private async releaseRoleLock(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.client.del(key);
    } catch {}
  }

  private dedupeTraitsByConcept(traits: SkillTrait[]): SkillTrait[] {
    const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const byConcept = new Map<string, SkillTrait>();
    const out: SkillTrait[] = [];
    for (const t of traits) {
      if (!t.conceptId) {
        out.push(t);
        continue;
      }
      const cur = byConcept.get(t.conceptId);
      if (!cur) {
        byConcept.set(t.conceptId, t);
        out.push(t);
        continue;
      }
      const better =
        t.observationCount > cur.observationCount ||
        (t.observationCount === cur.observationCount &&
          (rank[t.confidence] ?? 0) > (rank[cur.confidence] ?? 0));
      if (better) {
        const idx = out.indexOf(cur);
        if (idx >= 0) out[idx] = t;
        byConcept.set(t.conceptId, t);
      }
    }
    return out;
  }

  private findTopTraitsByLayer(args: {
    profileId: string;
    layer: 'value' | 'motivation' | 'process_marker';
  }): Promise<SkillTrait[]> {
    return this.prisma.skillTrait.findMany({
      where: { profileId: args.profileId, status: 'active', layer: args.layer },
      orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
      take: 5,
    });
  }

  private async aggregateLayerTraitsForProfiles(args: {
    profileIds: string[];
    layer: 'value' | 'motivation' | 'process_marker';
  }): Promise<SkillTrait[]> {
    if (args.profileIds.length === 0) return [];
    const rows = await this.prisma.skillTrait.findMany({
      where: {
        profileId: { in: args.profileIds },
        status: 'active',
        layer: args.layer,
      },
      orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
      take: 300,
    });
    const perProfileCount = new Map<string, number>();
    const picked: SkillTrait[] = [];
    for (const row of rows) {
      const count = perProfileCount.get(row.profileId) ?? 0;
      if (count >= 3) continue;
      perProfileCount.set(row.profileId, count + 1);
      picked.push(row);
    }
    return this.dedupeTraitsByConcept(picked).slice(0, 5);
  }

  private async findActiveRoleIdForPerson(args: {
    tenantId: string;
    personId: string;
  }): Promise<string | null> {
    const [personRoleRows, appointmentRows] = await Promise.all([
      this.prisma.personRole.findMany({
        where: {
          tenantId: args.tenantId,
          personId: args.personId,
          validTo: null,
        },
        select: { roleId: true },
        take: 5,
      }),
      this.prisma.appointment.findMany({
        where: {
          tenantId: args.tenantId,
          personId: args.personId,
          validTo: null,
          status: { in: ['active', 'acting'] },
        },
        select: { roleId: true },
        take: 5,
      }),
    ]);
    return [...personRoleRows, ...appointmentRows].map((r) => r.roleId)[0] ?? null;
  }

  private parsePracticeSkillsForPrompt(
    rows: ReadonlyArray<{ trigger: unknown; steps: unknown; redFlags: unknown }>,
  ): PersonaCompilePracticeSkillInput[] {
    const out: PersonaCompilePracticeSkillInput[] = [];
    for (const s of rows) {
      const trigger = typeof s.trigger === 'string' ? s.trigger.trim() : '';
      if (trigger.length === 0) continue;
      const stepsArr = Array.isArray(s.steps) ? s.steps : [];
      const steps = stepsArr
        .filter((st): st is Record<string, unknown> => !!st && typeof st === 'object')
        .map((st, idx) => ({
          order: typeof st.order === 'number' ? st.order : idx + 1,
          action: typeof st.action === 'string' ? st.action.trim() : '',
        }))
        .filter((st) => st.action.length > 0);
      if (steps.length === 0) continue;
      const redFlags = Array.isArray(s.redFlags)
        ? (s.redFlags as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      out.push({ trigger, steps, redFlags });
    }
    return out;
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
    values?: ReadonlyArray<PersonaCompileTraitInput>;
    motivations?: ReadonlyArray<PersonaCompileTraitInput>;
    principles?: ReadonlyArray<PersonaCompilePrincipleInput>;
    practiceSkills?: ReadonlyArray<PersonaCompilePracticeSkillInput>;
    processMarkers?: ReadonlyArray<PersonaCompileTraitInput>;
  }): Promise<string | null> {
    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE({
      personName: args.personName,
      personRole: args.personRole,
      traits: args.traits.map((t) => ({
        category: t.category,
        statement: t.statement,
        confidence: t.confidence,
        observationCount: t.observationCount,
      })),
      values: args.values ?? [],
      motivations: args.motivations ?? [],
      principles: args.principles ?? [],
      practiceSkills: args.practiceSkills ?? [],
      processMarkers: args.processMarkers ?? [],
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'executable-persona-compile',
        systemPrompt: guardOn
          ? withInjectionGuard(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT)
          : EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: args.tenantId,
        dataClass: 'internal',
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
