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
  EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT,
  EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE,
  type PersonaCompilePracticeSkillInput,
  type PersonaCompilePrincipleInput,
  type PersonaCompileTraitInput,
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
            // ИНТ.1 (R9) — в «черты подхода» идёт только слой skill; ценности /
            // мотивация / маркеры процесса выбираются отдельными запросами ниже.
            where: { status: 'active', layer: 'skill' },
            orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
            take: 20,
          },
        },
      });
      if (!profile) return null;
      if (profile.person.relationship !== 'employee') return null;
      if (profile.status !== 'active') return null;
      // Гейт минимума — по skill-чертам (как до ИНТ.1, деградация совместима).
      if (profile.traits.length < this.cfg.persona.minTraits) return null;

      // ИНТ.1 (R9) — новые слои метода: values/motivations/processMarkers
      // (топ-5 на слой), принципы активной роли person'а, процедуры
      // PracticeSkill(scope='person'). Все слои best-effort: пусто → секция
      // в промпте опускается, выход эквивалентен v1-поведению.
      const personId = profile.person.id;
      const [values, motivations, processMarkers, roleId, practiceSkillRows] =
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
            orderBy: [
              { pinned: 'desc' },
              { successRate: { sort: 'desc', nulls: 'last' } },
            ],
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
      const practiceSkills = this.parsePracticeSkillsForPrompt(
        practiceSkillRows,
      );

      // LLM compile (v2 — секционная сборка из всех слоёв метода).
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

      // ИНТ.1 — аудит «какие черты вошли»: skill-черты + values/motivations/
      // processMarkers (все — SkillTrait.id). Принципы (RolePrinciple) и
      // процедуры (PracticeSkill) в includedTraitIds НЕ кладём — это не
      // SkillTrait-id, поле по контракту хранит только их.
      const includedTraitIds = [
        ...profile.traits.map((t) => t.id),
        ...values.map((t) => t.id),
        ...motivations.map((t) => t.id),
        ...processMarkers.map((t) => t.id),
      ];

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
            includedTraitIds,
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
            // ИНТ.1 (R9) — агрегация «черт подхода» только по слою skill.
            where: { status: 'active', layer: 'skill' },
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
      // Ф7 (H) — схлопнуть черты по conceptId: одна и та же черта от N
      // сотрудников не должна повторяться N раз в персоне роли.
      const dedupedTraits = this.dedupeTraitsByConcept(aggregatedTraits);
      if (dedupedTraits.length < this.cfg.persona.minTraits) return null;

      const role = await this.prisma.role.findUnique({
        where: { id: args.roleId },
        select: { name: true },
      });

      // ИНТ.1 (R9) — слои метода для роли: values/motivations/processMarkers
      // агрегируются по тем же profiles (топ-3 на человека, cap 5 после
      // dedupe по концепту); принципы — RolePrinciple роли напрямую;
      // процедуры — union PracticeSkill(scope='role') + scope='person'
      // людей роли (cap 5, приоритет pinned → successRate).
      const profileIds = activeProfiles.map((p) => p.id);
      const [values, motivations, processMarkers, principles, practiceSkillRows] =
        await Promise.all([
          this.aggregateLayerTraitsForProfiles({ profileIds, layer: 'value' }),
          this.aggregateLayerTraitsForProfiles({
            profileIds,
            layer: 'motivation',
          }),
          this.aggregateLayerTraitsForProfiles({
            profileIds,
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
                { scope: 'person', scopeRefId: { in: personIds } },
              ],
            },
            orderBy: [
              { pinned: 'desc' },
              { successRate: { sort: 'desc', nulls: 'last' } },
            ],
            take: 5,
          }),
        ]);
      const practiceSkills = this.parsePracticeSkillsForPrompt(
        practiceSkillRows,
      );

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

      // ИНТ.1 — см. комментарий в buildForProfile: только SkillTrait-id;
      // RolePrinciple/PracticeSkill в includedTraitIds не кладём.
      const includedTraitIds = [
        ...dedupedTraits.map((t) => t.id),
        ...values.map((t) => t.id),
        ...motivations.map((t) => t.id),
        ...processMarkers.map((t) => t.id),
      ];

      const nextVersion = await this.nextVersion({
        profileId: null,
        scope: 'role',
        scopeRefId: args.roleId,
      });

      // Clones=Roles Ф5 (2026-05-25) — клон роли это shared-знание Org,
      // dataClass всегда `internal` (floor поднимает любой источник).
      // Используем `DataClassPolicyService.derive(kind='executable_persona')`.
      // Audit-trail сохраняем в `dataClassAudit` (W4.2-поле).
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
        // Shadow-compare с legacy='internal' (де-факто).
        this.dataClassPolicy.compareWithLegacy({
          legacyResult: 'internal',
          proposedResult: derived.dataClass,
          kind: 'executable_persona',
          sourceIds: dedupedTraits.map((t) => t.id),
        });
        dataClassAudit = derived.audit as unknown as Prisma.InputJsonValue;
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
            includedTraitIds,
            status: 'active',
            builtFromTraitsCount: dedupedTraits.length,
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

  /** Ф7 (H) — схлопывает черты по conceptId (один представитель на концепт):
   *  max observationCount, при равенстве — выше confidence. conceptId=null —
   *  оставляем как есть (не схлопываем). Порядок остальных сохраняется. */
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
        // заменить представителя в out на текущий
        const idx = out.indexOf(cur);
        if (idx >= 0) out[idx] = t;
        byConcept.set(t.conceptId, t);
      }
    }
    return out;
  }

  /**
   * ИНТ.1 (R9) — топ-5 активных черт профиля заданного слоя
   * (value / motivation / process_marker). Сортировка — как у skill-черт.
   */
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

  /**
   * ИНТ.1 (R9) — агрегация черт слоя по нескольким профилям (для role-persona):
   * топ-3 на человека → общий пул → dedupe по концепту → cap 5.
   */
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
      // Safety-cap: до 50 профилей × топ-3 — 300 строк с запасом.
      take: 300,
    });
    // rows отсортированы глобально → относительный порядок внутри профиля
    // сохраняется; берём первые 3 на профиль.
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

  /**
   * ИНТ.1 (R9) — активная роль person'а: union PersonRole(validTo=null) +
   * Appointment(active/acting, validTo=null) — обратный вариант паттерна из
   * `role-principle-synthesis.service.ts`. Берём первый roleId; нет роли → null.
   */
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
    return (
      [...personRoleRows, ...appointmentRows].map((r) => r.roleId)[0] ?? null
    );
  }

  /**
   * ИНТ.1 (R9) — нормализует PracticeSkill из БД-формата (Json-поля как
   * unknown) в формат user-шаблона v2. Безопасно к мусорному Json: скилл с
   * битыми/пустыми steps или без триггера пропускается, сборка не падает
   * (паттерн `toPromptSkills` из clones.service.ts).
   */
  private parsePracticeSkillsForPrompt(
    rows: ReadonlyArray<{ trigger: unknown; steps: unknown; redFlags: unknown }>,
  ): PersonaCompilePracticeSkillInput[] {
    const out: PersonaCompilePracticeSkillInput[] = [];
    for (const s of rows) {
      const trigger = typeof s.trigger === 'string' ? s.trigger.trim() : '';
      if (trigger.length === 0) continue;
      const stepsArr = Array.isArray(s.steps) ? s.steps : [];
      const steps = stepsArr
        .filter(
          (st): st is Record<string, unknown> => !!st && typeof st === 'object',
        )
        .map((st, idx) => ({
          order: typeof st.order === 'number' ? st.order : idx + 1,
          action: typeof st.action === 'string' ? st.action.trim() : '',
        }))
        .filter((st) => st.action.length > 0);
      if (steps.length === 0) continue;
      const redFlags = Array.isArray(s.redFlags)
        ? (s.redFlags as unknown[]).filter(
            (v): v is string => typeof v === 'string',
          )
        : [];
      out.push({ trigger, steps, redFlags });
    }
    return out;
  }

  /**
   * ИНТ.1 (R9) — компиляция persona-prompt по v2-шаблонам (секционная сборка
   * из всех слоёв метода). Новые слои опциональны (default []) — при пустых
   * выход эквивалентен прежнему v1-поведению (только черты).
   * taskType НЕ меняется ('executable-persona-compile').
   */
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
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (traits, исходно из транскриптов).
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
