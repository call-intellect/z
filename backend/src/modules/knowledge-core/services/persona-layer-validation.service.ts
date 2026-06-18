import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  CLONE_RESPOND_USER_TEMPLATE,
  buildCloneRespondSystemPrompt,
} from '../prompts/clone-respond.prompt';
import {
  EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT,
  EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE,
} from '../prompts/executable-persona-compile.prompt';
import {
  PERSONA_BEHAVIOR_JUDGE_JSON_SCHEMA,
  PERSONA_BEHAVIOR_JUDGE_SCHEMA_NAME,
  PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT,
  PERSONA_BEHAVIOR_JUDGE_USER_TEMPLATE,
} from '../prompts/persona-behavior-judge.prompt';

@Injectable()
export class PersonaLayerValidationService {
  private readonly logger = new Logger(PersonaLayerValidationService.name);

  private static readonly CASE_LOOKBACK_DAYS = 60;
  private static readonly MAX_CANDIDATE_BLOCKS = 30;
  private static readonly MAX_SUBGRAPH_BLOCKS = 15;
  private static readonly MAX_TRAITS_PER_PERSON = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async validateRole(args: { tenantId: string; roleId: string }): Promise<{
    cases: number;
    avgV1: number | null;
    avgV2: number | null;
    skipped: string | null;
  }> {
    const persona = await this.prisma.executablePersona.findFirst({
      where: {
        tenantId: args.tenantId,
        scope: 'role',
        scopeRefId: args.roleId,
        status: 'active',
      },
      orderBy: { version: 'desc' },
    });
    if (!persona) {
      return { cases: 0, avgV1: null, avgV2: null, skipped: 'no_persona' };
    }

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { name: true },
    });
    const roleName = role?.name ?? 'роль';

    const personIds = await this.loadRolePersonIds(args);

    const personaV1 = await this.compileBaselineV1({
      tenantId: args.tenantId,
      roleId: args.roleId,
      roleName,
      personIds,
    });
    if (!personaV1) {
      return {
        cases: 0,
        avgV1: null,
        avgV2: null,
        skipped: 'v1_compile_failed',
      };
    }

    const blocks = await this.loadCaseCandidateBlocks({
      tenantId: args.tenantId,
      personIds,
    });
    const casesPerRole = await this.cfg.getDynamic<number>(
      'knowledge.personaValidationCasesPerRole',
      undefined,
      3,
    );
    const caseBlocks = blocks
      .filter((b) => b.trustedAnswer.trim().length > 0)
      .slice(0, Math.max(1, casesPerRole));
    if (caseBlocks.length < 1) {
      return { cases: 0, avgV1: null, avgV2: null, skipped: 'no_cases' };
    }

    const caseIds = new Set(caseBlocks.map((b) => b.id));
    const subgraph = {
      reasoningBlocks: blocks
        .filter((b) => !caseIds.has(b.id))
        .slice(0, PersonaLayerValidationService.MAX_SUBGRAPH_BLOCKS)
        .map((b) => ({
          id: b.id,
          text: b.trustedAnswer.trim().length > 0 ? b.trustedAnswer : b.name,
        })),
      knowledgeProfileSummary: null,
      decisions: [],
    };

    const scoresV1: number[] = [];
    const scoresV2: number[] = [];
    for (const caseBlock of caseBlocks) {
      try {
        const situation =
          caseBlock.criticalQuestion.trim().length > 0
            ? caseBlock.criticalQuestion.trim()
            : caseBlock.name;
        const question = `Ситуация: ${situation}. Как поступишь и почему?`;
        const answerA = await this.callCloneRespond({
          tenantId: args.tenantId,
          roleId: args.roleId,
          question,
          roleName,
          personaPrompt: personaV1,
          subgraph,
        });
        const answerB = await this.callCloneRespond({
          tenantId: args.tenantId,
          roleId: args.roleId,
          question,
          roleName,
          personaPrompt: persona.personaPrompt,
          subgraph,
        });
        const verdict = await this.judgeCase({
          tenantId: args.tenantId,
          roleId: args.roleId,
          roleName,
          caseSituation: situation,
          actualMove: caseBlock.trustedAnswer.trim(),
          answerA,
          answerB,
        });
        this.metrics.observePersonaLayerScore({
          variant: 'v1',
          score: verdict.scoreA,
        });
        this.metrics.observePersonaLayerScore({
          variant: 'v2',
          score: verdict.scoreB,
        });
        this.metrics.incPersonaLayerValidationCase({ outcome: 'judged' });
        scoresV1.push(verdict.scoreA);
        scoresV2.push(verdict.scoreB);
      } catch (err) {
        this.metrics.incPersonaLayerValidationCase({ outcome: 'skipped' });
        this.logger.warn(
          {
            roleId: args.roleId,
            blockId: caseBlock.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'persona-layer-validation: кейс упал — пропускаю кейс',
        );
      }
    }

    const avgV1 = average(scoresV1);
    const avgV2 = average(scoresV2);
    this.logger.log(
      {
        roleId: args.roleId,
        cases: scoresV1.length,
        avgV1,
        avgV2,
        verdict: avgV1 !== null && avgV2 !== null ? (avgV2 >= avgV1 ? 'v2>=v1' : 'v2<v1') : 'n/a',
      },
      'persona-layer-validation: сводка по роли',
    );
    return { cases: scoresV1.length, avgV1, avgV2, skipped: null };
  }

  private async loadRolePersonIds(args: { tenantId: string; roleId: string }): Promise<string[]> {
    const [personRoleRows, appointmentRows] = await Promise.all([
      this.prisma.personRole.findMany({
        where: { tenantId: args.tenantId, roleId: args.roleId, validTo: null },
        select: { personId: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          validTo: null,
          status: { in: ['active', 'acting'] },
        },
        select: { personId: true },
      }),
    ]);
    return [...new Set([...personRoleRows, ...appointmentRows].map((r) => r.personId))];
  }

  private async compileBaselineV1(args: {
    tenantId: string;
    roleId: string;
    roleName: string;
    personIds: string[];
  }): Promise<string | null> {
    if (args.personIds.length === 0) return null;
    const profiles = await this.prisma.skillProfile.findMany({
      where: {
        tenantId: args.tenantId,
        personId: { in: args.personIds },
        status: 'active',
      },
      include: {
        person: { select: { name: true, relationship: true } },
        traits: {
          where: { status: 'active', layer: 'skill' },
          orderBy: [{ confidence: 'desc' }, { observationCount: 'desc' }],
          take: PersonaLayerValidationService.MAX_TRAITS_PER_PERSON,
        },
      },
    });
    const traits = profiles
      .filter((p) => p.person.relationship === 'employee')
      .flatMap((p) => p.traits);
    if (traits.length === 0) return null;

    try {
      const result = await this.llm.call({
        taskType: 'executable-persona-compile',
        systemPrompt: EXECUTABLE_PERSONA_COMPILE_SYSTEM_PROMPT,
        userMessage: EXECUTABLE_PERSONA_COMPILE_USER_TEMPLATE({
          personName: args.roleName,
          personRole: args.roleName,
          traits: traits.map((t) => ({
            category: t.category,
            statement: t.statement,
            confidence: t.confidence,
            observationCount: t.observationCount,
          })),
        }),
        tenantId: args.tenantId,
        dataClass: 'internal',
        maxTokens: 8_000,
        sourceRef: { type: 'persona_layer_validation', id: args.roleId },
      });
      const text = result.text.trim();
      if (text.length < 50) return null;
      return text.slice(0, 8_000);
    } catch (err) {
      this.logger.warn(
        {
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'persona-layer-validation: компиляция baseline v1 упала',
      );
      return null;
    }
  }

  private async loadCaseCandidateBlocks(args: { tenantId: string; personIds: string[] }): Promise<
    Array<{
      id: string;
      name: string;
      criticalQuestion: string;
      trustedAnswer: string;
    }>
  > {
    if (args.personIds.length === 0) return [];
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        id: { in: args.personIds },
        relationship: 'employee',
        deletedAt: null,
        entityId: { not: null },
      },
      select: { entityId: true },
    });
    const entityIds = persons
      .map((p) => p.entityId)
      .filter((id): id is string => typeof id === 'string');
    if (entityIds.length === 0) return [];

    const since = new Date(
      Date.now() - PersonaLayerValidationService.CASE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: { in: entityIds },
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
          createdAt: { gte: since },
        },
      },
      select: { blockId: true },
    });
    const blockIds = [...new Set(mentions.map((m) => m.blockId))];
    if (blockIds.length === 0) return [];

    return this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds } },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        trustedAnswer: true,
      },
      orderBy: { createdAt: 'desc' },
      take: PersonaLayerValidationService.MAX_CANDIDATE_BLOCKS,
    });
  }

  private async callCloneRespond(args: {
    tenantId: string;
    roleId: string;
    question: string;
    roleName: string;
    personaPrompt: string;
    subgraph: {
      reasoningBlocks: ReadonlyArray<{ id: string; text: string }>;
      knowledgeProfileSummary: string | null;
      decisions: ReadonlyArray<{
        id: string;
        statement: string;
        rationale: string | null;
      }>;
    };
  }): Promise<string> {
    const result = await this.llm.call({
      taskType: 'clone-respond',
      systemPrompt: buildCloneRespondSystemPrompt({ mode: 'factual' }),
      userMessage: CLONE_RESPOND_USER_TEMPLATE({
        question: args.question,
        roleName: args.roleName,
        bearerName: null,
        personaPrompt: args.personaPrompt,
        subgraph: args.subgraph,
      }),
      tenantId: args.tenantId,
      dataClass: 'internal',
      sourceRef: { type: 'persona_layer_validation', id: args.roleId },
    });
    const text = result.text.trim();
    if (!text) {
      throw new Error('persona-layer-validation: пустой ответ clone-respond');
    }
    return text;
  }

  private async judgeCase(args: {
    tenantId: string;
    roleId: string;
    roleName: string;
    caseSituation: string;
    actualMove: string;
    answerA: string;
    answerB: string;
  }): Promise<{ scoreA: number; scoreB: number }> {
    const result = await this.llm.call({
      taskType: 'persona-behavior-judge',
      systemPrompt: PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT,
      userMessage: PERSONA_BEHAVIOR_JUDGE_USER_TEMPLATE({
        roleName: args.roleName,
        caseSituation: args.caseSituation,
        actualMove: args.actualMove,
        answerA: args.answerA,
        answerB: args.answerB,
      }),
      tenantId: args.tenantId,
      responseFormat: {
        type: 'json_schema',
        name: PERSONA_BEHAVIOR_JUDGE_SCHEMA_NAME,
        schema: PERSONA_BEHAVIOR_JUDGE_JSON_SCHEMA,
        strict: true,
      },
      dataClass: 'internal',
      sourceRef: { type: 'persona_layer_validation', id: args.roleId },
    });
    const parsed = JSON.parse(result.text) as Record<string, unknown>;
    const scoreA = normalizeScore(parsed.scoreA);
    const scoreB = normalizeScore(parsed.scoreB);
    if (scoreA === null || scoreB === null) {
      throw new Error('persona-behavior-judge: scoreA/scoreB отсутствуют или не числа 0..1');
    }
    return { scoreA, scoreB };
  }
}

function average(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function normalizeScore(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}
