import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SubjectMemoryKind } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import {
  SUBJECT_MEMORY_RULE_EXTRACT_JSON_SCHEMA,
  SUBJECT_MEMORY_RULE_EXTRACT_SCHEMA_NAME,
  SUBJECT_MEMORY_RULE_EXTRACT_SYSTEM_PROMPT,
  SUBJECT_MEMORY_RULE_EXTRACT_USER_TEMPLATE,
} from '../prompts/subject-memory-rule-extract.prompt';

const VALID_KINDS: readonly SubjectMemoryKind[] = [
  'term',
  'disambiguation',
  'preference',
];

interface MatchCandidateRow {
  id: string;
  occurredAt: Date;
  confirmCount: number;
  similarity: number | string;
}

@Injectable()
export class SubjectMemoryService {
  private readonly logger = new Logger(SubjectMemoryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async deriveRuleFromProbeResponse(args: {
    tenantId: string;
    probeId: string;
    questionText: string;
    answerText: string;
    occurredAt: Date;
  }): Promise<void> {
    if (!this.cfg.subjectMemory.enabled) return;

    try {
      const guardOn =
        this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
      const guarded = applyInputGuards(
        SUBJECT_MEMORY_RULE_EXTRACT_SYSTEM_PROMPT,
        SUBJECT_MEMORY_RULE_EXTRACT_USER_TEMPLATE({
          question: args.questionText,
          answer: args.answerText,
        }),
        { enabled: guardOn, injection: true },
      );

      const result = await this.llm.call({
        taskType: 'subject-memory-rule-extract',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: SUBJECT_MEMORY_RULE_EXTRACT_SCHEMA_NAME,
          schema: SUBJECT_MEMORY_RULE_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'subject-memory', id: args.probeId },
        dataClass: 'internal',
      });

      const parsed = JSON.parse(result.text) as {
        isReusable?: unknown;
        kind?: unknown;
        contextText?: unknown;
        ruleText?: unknown;
        confidence?: unknown;
      };

      const isReusable = parsed.isReusable === true;
      const confidence =
        typeof parsed.confidence === 'number' &&
        Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0;
      const contextText =
        typeof parsed.contextText === 'string' ? parsed.contextText.trim() : '';
      const ruleText =
        typeof parsed.ruleText === 'string' ? parsed.ruleText.trim() : '';
      const kind = parsed.kind as SubjectMemoryKind;

      if (!isReusable || confidence < 0.5 || ruleText.length === 0) return;
      if (!VALID_KINDS.includes(kind)) return;

      await this.upsertWithSupersede({
        tenantId: args.tenantId,
        kind,
        contextText: contextText.length > 0 ? contextText : args.questionText,
        ruleText,
        confidence,
        occurredAt: args.occurredAt,
        probeId: args.probeId,
      });
    } catch (err) {
      this.logger.warn(
        {
          probeId: args.probeId,
          err: err instanceof Error ? err.message : String(err),
        },
        'subject-memory: deriveRuleFromProbeResponse упал — пропускаю (fail-open)',
      );
    }
  }

  async upsertWithSupersede(args: {
    tenantId: string;
    kind: SubjectMemoryKind;
    contextText: string;
    ruleText: string;
    confidence: number;
    occurredAt: Date;
    probeId: string;
  }): Promise<void> {
    const [vec] = await this.embeddings.embed([args.contextText]);
    if (!vec) return;
    const vecLiteral = `[${vec.join(',')}]`;

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<MatchCandidateRow[]>(
        `
        SELECT id, "occurredAt", "confirmCount",
               (1 - (embedding <=> $1::vector(1536))) AS similarity
        FROM "subject_memory"
        WHERE "tenantId" = $2
          AND kind::text = $3
          AND status IN ('shadow', 'canary', 'active')
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector(1536) ASC
        LIMIT 1
        `,
        vecLiteral,
        args.tenantId,
        args.kind,
      );

      const candidate = rows[0];
      const similarity =
        candidate != null
          ? typeof candidate.similarity === 'string'
            ? Number(candidate.similarity)
            : candidate.similarity
          : Number.NaN;

      if (
        candidate != null &&
        Number.isFinite(similarity) &&
        similarity >= this.cfg.subjectMemory.matchMinSimilarity
      ) {
        if (args.occurredAt.getTime() > candidate.occurredAt.getTime()) {
          const created = await tx.subjectMemory.create({
            data: {
              tenantId: args.tenantId,
              kind: args.kind,
              contextText: args.contextText,
              ruleText: args.ruleText,
              confidence: args.confidence,
              occurredAt: args.occurredAt,
              status: 'shadow',
              confirmCount: candidate.confirmCount + 1,
              sourceProbeIds: [args.probeId],
            },
          });
          await tx.$executeRawUnsafe(
            'UPDATE "subject_memory" SET embedding = $1::vector(1536) WHERE id = $2',
            vecLiteral,
            created.id,
          );
          await tx.subjectMemory.update({
            where: { id: candidate.id },
            data: { status: 'superseded', supersededById: created.id },
          });
        } else {
          await tx.subjectMemory.update({
            where: { id: candidate.id },
            data: { confirmCount: { increment: 1 } },
          });
        }
        return;
      }

      const created = await tx.subjectMemory.create({
        data: {
          tenantId: args.tenantId,
          kind: args.kind,
          contextText: args.contextText,
          ruleText: args.ruleText,
          confidence: args.confidence,
          occurredAt: args.occurredAt,
          status: 'shadow',
          confirmCount: 0,
          sourceProbeIds: [args.probeId],
        },
      });
      await tx.$executeRawUnsafe(
        'UPDATE "subject_memory" SET embedding = $1::vector(1536) WHERE id = $2',
        vecLiteral,
        created.id,
      );
    });

    this.metrics.incSubjectMemoryRuleExtracted({ kind: args.kind });
  }
}
