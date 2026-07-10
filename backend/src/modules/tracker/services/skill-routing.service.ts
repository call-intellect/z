import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import {
  TASK_ASSIGNEE_ARBITER_JSON_SCHEMA,
  TASK_ASSIGNEE_ARBITER_SCHEMA_NAME,
  TASK_ASSIGNEE_ARBITER_SYSTEM_PROMPT,
  TASK_ASSIGNEE_ARBITER_USER_TEMPLATE,
} from '../prompts/task-assignee-arbiter.prompt';

export interface AssigneeSuggestion {
  personId: string;
  userId: string | null;
  personName: string;
  roleName: string | null;
  departmentName: string | null;
  confidence: number;
  rationale: string;
  matchPath: 'tag_hard_gate' | 'semantic' | 'role_prior';
}

interface Candidate {
  personId: string;
  userId: string | null;
  name: string;
  roleId: string | null;
  roleName: string | null;
  departmentId: string | null;
  departmentName: string | null;
}

interface SemanticHit {
  similarity: number;
  statement: string;
}

const MAX_CANDIDATES_FOR_ARBITER = 15;
const RESPONSIBILITIES_MAX_LEN = 320;

@Injectable()
export class SkillRoutingService {
  private readonly logger = new Logger(SkillRoutingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async suggestAssignee(args: {
    tenantId: string;
    taskText: string;
    explicitTags?: { departmentId?: string; skill?: string };
  }): Promise<AssigneeSuggestion[]> {
    if (!this.cfg.taskRouting.enabled) return [];
    const taskText = (args.taskText ?? '').trim();
    if (taskText.length === 0) return [];

    try {
      const hardGate = Boolean(args.explicitTags?.departmentId);
      const candidates = await this.loadCandidates(
        args.tenantId,
        args.explicitTags?.departmentId,
      );
      if (candidates.length === 0) {
        this.metrics.incRoutingNoCandidate();
        return [];
      }

      const semantic = await this.semanticHitsByPerson(
        args.tenantId,
        taskText,
        candidates,
      );
      const rolePriors = await this.rolePriors(args.tenantId, candidates);

      const arbiterInput = this.buildArbiterCandidates(
        candidates,
        semantic,
        rolePriors,
      );
      const ranking = await this.runArbiter(
        args.tenantId,
        taskText,
        arbiterInput.promptCandidates,
      );
      if (ranking.length === 0) {
        this.metrics.incRoutingNoCandidate();
        return [];
      }

      const minConfidence = this.cfg.taskRouting.suggestMinConfidence;
      const suggestions: AssigneeSuggestion[] = [];
      for (const r of ranking) {
        const candidate = arbiterInput.orderedCandidates[r.candidate];
        if (!candidate) continue;
        const confidence = Math.max(0, Math.min(1, r.confidence));
        if (confidence < minConfidence) continue;
        const matchPath: AssigneeSuggestion['matchPath'] = hardGate
          ? 'tag_hard_gate'
          : semantic.has(candidate.personId)
            ? 'semantic'
            : 'role_prior';
        suggestions.push({
          personId: candidate.personId,
          userId: candidate.userId,
          personName: candidate.name,
          roleName: candidate.roleName,
          departmentName: candidate.departmentName,
          confidence,
          rationale: r.rationale,
          matchPath,
        });
      }

      if (suggestions.length === 0) {
        this.metrics.incRoutingNoCandidate();
        return [];
      }

      suggestions.sort((a, b) => b.confidence - a.confidence);
      const top = suggestions.slice(0, 5);
      for (const s of top) {
        this.metrics.incRoutingSuggestion({ matchPath: s.matchPath });
      }
      return top;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-routing: suggestAssignee упал — возвращаю пусто (fail-soft)',
      );
      return [];
    }
  }

  private async loadCandidates(
    tenantId: string,
    hardGateDepartmentId?: string,
  ): Promise<Candidate[]> {
    const useAppointment = this.cfg.persons.useAppointment;
    const persons = await this.prisma.person.findMany({
      where: { tenantId, deletedAt: null, relationship: 'employee' },
      select: {
        id: true,
        userId: true,
        name: true,
        personRoles: {
          where: { validTo: null },
          select: {
            role: {
              select: {
                id: true,
                name: true,
                departmentId: true,
                department: { select: { name: true } },
              },
            },
          },
          take: 1,
        },
        appointments: {
          where: { validTo: null, status: { not: 'former' } },
          select: {
            role: {
              select: {
                id: true,
                name: true,
                departmentId: true,
                department: { select: { name: true } },
              },
            },
          },
          take: 1,
        },
      },
      take: 200,
      orderBy: { name: 'asc' },
    });

    const candidates: Candidate[] = [];
    for (const p of persons) {
      const role = useAppointment
        ? (p.appointments[0]?.role ?? null)
        : (p.personRoles[0]?.role ?? null);
      if (!role) continue;
      if (hardGateDepartmentId && role.departmentId !== hardGateDepartmentId) {
        continue;
      }
      candidates.push({
        personId: p.id,
        userId: p.userId ?? null,
        name: p.name,
        roleId: role.id,
        roleName: role.name,
        departmentId: role.departmentId,
        departmentName: role.department?.name ?? null,
      });
    }
    return candidates;
  }

  private async semanticHitsByPerson(
    tenantId: string,
    taskText: string,
    candidates: Candidate[],
  ): Promise<Map<string, SemanticHit>> {
    const result = new Map<string, SemanticHit>();
    const [vec] = await this.embeddings.embed([taskText]);
    if (!vec) return result;
    const vecLiteral = `[${vec.join(',')}]`;
    const limit = Math.max(10, this.cfg.taskRouting.topK * 10);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        personId: string;
        statement: string;
        similarity: number | string;
      }>
    >(
      `
      SELECT sp."personId" AS "personId",
             st.statement AS statement,
             (1 - (st.embedding <=> $1::vector)) AS similarity
      FROM "skill_traits" st
      JOIN "skill_profiles" sp ON sp.id = st."profileId"
      WHERE sp."tenantId" = $2
        AND st.status = 'active'
        AND st.embedding IS NOT NULL
      ORDER BY st.embedding <=> $1::vector ASC
      LIMIT $3
      `,
      vecLiteral,
      tenantId,
      limit,
    );

    const candidateIds = new Set(candidates.map((c) => c.personId));
    for (const row of rows) {
      if (!candidateIds.has(row.personId)) continue;
      const similarity =
        typeof row.similarity === 'string'
          ? Number(row.similarity)
          : row.similarity;
      if (!Number.isFinite(similarity)) continue;
      const existing = result.get(row.personId);
      if (!existing || similarity > existing.similarity) {
        result.set(row.personId, {
          similarity,
          statement: row.statement,
        });
      }
    }
    return result;
  }

  private async rolePriors(
    tenantId: string,
    candidates: Candidate[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const roleIds = [
      ...new Set(
        candidates
          .map((c) => c.roleId)
          .filter((id): id is string => id != null),
      ),
    ];
    if (roleIds.length === 0) return result;

    const profiles = await this.prisma.roleProfile.findMany({
      where: { tenantId, roleId: { in: roleIds } },
      select: { roleId: true, summaryCache: true },
    });

    for (const profile of profiles) {
      const prior = this.summaryToPrior(profile.summaryCache);
      if (prior) result.set(profile.roleId, prior);
    }
    return result;
  }

  private summaryToPrior(summaryCache: unknown): string | null {
    if (summaryCache == null || typeof summaryCache !== 'object') return null;
    const cache = summaryCache as Record<string, unknown>;
    const parts: string[] = [];
    const responsibilities = this.stringArray(cache.responsibilities);
    const skills = this.stringArray(cache.skills);
    if (responsibilities.length > 0) {
      parts.push(`обязанности: ${responsibilities.join(', ')}`);
    }
    if (skills.length > 0) {
      parts.push(`навыки: ${skills.join(', ')}`);
    }
    if (parts.length === 0) return null;
    const joined = parts.join('; ');
    return joined.length > RESPONSIBILITIES_MAX_LEN
      ? `${joined.slice(0, RESPONSIBILITIES_MAX_LEN)}…`
      : joined;
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((v) => {
        if (typeof v === 'string') return v.trim();
        if (v != null && typeof v === 'object') {
          const obj = v as Record<string, unknown>;
          const name = obj.name ?? obj.title ?? obj.text;
          return typeof name === 'string' ? name.trim() : '';
        }
        return '';
      })
      .filter((s) => s.length > 0);
  }

  private buildArbiterCandidates(
    candidates: Candidate[],
    semantic: Map<string, SemanticHit>,
    rolePriors: Map<string, string>,
  ): {
    orderedCandidates: Candidate[];
    promptCandidates: ReadonlyArray<{
      index: number;
      name: string;
      role: string | null;
      department: string | null;
      responsibilities: string | null;
      skillMatch: string | null;
    }>;
  } {
    const withSemantic = candidates
      .filter((c) => semantic.has(c.personId))
      .sort(
        (a, b) =>
          (semantic.get(b.personId)?.similarity ?? 0) -
          (semantic.get(a.personId)?.similarity ?? 0),
      );
    const withoutSemantic = candidates.filter((c) => !semantic.has(c.personId));

    const ordered = [...withSemantic, ...withoutSemantic].slice(
      0,
      MAX_CANDIDATES_FOR_ARBITER,
    );

    const promptCandidates = ordered.map((c, index) => ({
      index,
      name: c.name,
      role: c.roleName,
      department: c.departmentName,
      responsibilities: c.roleId ? (rolePriors.get(c.roleId) ?? null) : null,
      skillMatch: semantic.get(c.personId)?.statement ?? null,
    }));

    return { orderedCandidates: ordered, promptCandidates };
  }

  private async runArbiter(
    tenantId: string,
    taskText: string,
    promptCandidates: ReadonlyArray<{
      index: number;
      name: string;
      role: string | null;
      department: string | null;
      responsibilities: string | null;
      skillMatch: string | null;
    }>,
  ): Promise<Array<{ candidate: number; confidence: number; rationale: string }>> {
    if (promptCandidates.length === 0) return [];
    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(
      TASK_ASSIGNEE_ARBITER_SYSTEM_PROMPT,
      TASK_ASSIGNEE_ARBITER_USER_TEMPLATE({
        taskText,
        candidates: promptCandidates,
      }),
      { enabled: guardOn, injection: true },
    );

    const result = await this.llm.call({
      taskType: 'task-assignee-arbiter',
      systemPrompt: guarded.system,
      userMessage: guarded.user,
      tenantId,
      responseFormat: {
        type: 'json_schema',
        name: TASK_ASSIGNEE_ARBITER_SCHEMA_NAME,
        schema: TASK_ASSIGNEE_ARBITER_JSON_SCHEMA,
        strict: true,
      },
      sourceRef: { type: 'task-assignee', id: tenantId },
      dataClass: 'internal',
    });

    const parsed = JSON.parse(result.text) as { ranking?: unknown };
    if (!Array.isArray(parsed.ranking)) return [];

    const ranking: Array<{
      candidate: number;
      confidence: number;
      rationale: string;
    }> = [];
    for (const raw of parsed.ranking) {
      if (raw == null || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const candidate = item.candidate;
      const confidence = item.confidence;
      const rationale = item.rationale;
      if (
        typeof candidate !== 'number' ||
        !Number.isInteger(candidate) ||
        typeof confidence !== 'number' ||
        !Number.isFinite(confidence) ||
        typeof rationale !== 'string'
      ) {
        continue;
      }
      ranking.push({ candidate, confidence, rationale });
    }
    return ranking;
  }
}
