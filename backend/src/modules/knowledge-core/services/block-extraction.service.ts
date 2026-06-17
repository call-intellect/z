import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  BLOCK_INGEST_JSON_SCHEMA,
  ENTITY_TYPE_VALUES,
  METRIC_VALUE_TYPE_VALUES,
  POLICY_SEVERITY_VALUES,
  REGULATION_CATEGORY_VALUES,
  SIGNAL_TYPE_VALUES,
  TOOL_KIND_VALUES,
  buildBlockIngestPrompt,
} from '../prompts/block-ingest.prompt';

import type { Segment } from './segment-builder.service';

export interface ExtractedEntityMention {
  type: (typeof ENTITY_TYPE_VALUES)[number];
  name: string;
  mentionContext: string;
  metadata?: Record<string, unknown>;
  sourceSpan?: { startMs: number; endMs: number };
}

export interface ExtractedBlock {
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: (typeof SIGNAL_TYPE_VALUES)[number];
  tags: string[];
  confidence: number;
  evidenceQuote: string;
  evidenceStartMs: number;
  evidenceEndMs: number;
  mentionedEntities: ExtractedEntityMention[];
  role_relevant: boolean;
  roleHint?: string | undefined;
  commitmentDueDateGuess?: string | null | undefined;
  commitmentRecipientNameGuess?: string | null | undefined;
  sideHint?: 'our' | 'client' | 'unknown' | null | undefined;
}

export interface ExtractedProcess {
  name: string;
  description?: string | null;
  ownerRoleHint?: string | null;
  triggerDescription?: string | null;
  confidence: number;
  sourceBlockIndex: number | null;
}

export interface ExtractedDecision {
  text: string;
  rationale?: string | null;
  decidedByPersonHint?: string | null;
  decidedAt?: string | null;
  confidence: number;
  sourceBlockIndex: number | null;
}

export interface ExtractedRegulation {
  name: string;
  contentMd: string;
  category: (typeof REGULATION_CATEGORY_VALUES)[number];
  confidence: number;
  sourceBlockIndex: number | null;
}

export interface ExtractedPolicy {
  name: string;
  contentMd: string;
  severity: (typeof POLICY_SEVERITY_VALUES)[number];
  confidence: number;
  sourceBlockIndex: number | null;
}

export interface ExtractedMetric {
  name: string;
  description?: string | null;
  unit: string;
  target?: number | null;
  valueType: (typeof METRIC_VALUE_TYPE_VALUES)[number];
  confidence: number;
  sourceBlockIndex: number | null;
}

export interface ExtractedTool {
  name: string;
  kind: (typeof TOOL_KIND_VALUES)[number];
  externalUrl?: string | null;
  confidence: number;
  sourceBlockIndex: number | null;
}

export interface ExtractedTypedEntities {
  processes: ExtractedProcess[];
  decisions: ExtractedDecision[];
  regulations: ExtractedRegulation[];
  policies: ExtractedPolicy[];
  metrics: ExtractedMetric[];
  tools: ExtractedTool[];
}

export interface ExtractedDataQuality {
  speakerCoveragePercent: number | null;
  transcriptTruncated: boolean;
  lowConfidenceBlockCount: number;
}

export interface ExtractedWindow {
  blocks: ExtractedBlock[];
  typed: ExtractedTypedEntities;
  dataQuality?: ExtractedDataQuality | undefined;
}

const ExtractedEntityMentionSchema = z.object({
  type: z.enum(ENTITY_TYPE_VALUES),
  name: z.string().min(1),
  mentionContext: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sourceSpan: z
    .object({
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(0),
    })
    .optional(),
});

const ExtractedBlockSchema = z.object({
  name: z.string().min(1).max(200),
  criticalQuestion: z.string().min(1),
  trustedAnswer: z.string().min(1),
  signalType: z.enum(SIGNAL_TYPE_VALUES),
  tags: z.array(z.string()).max(10),
  confidence: z.number().min(0).max(1),
  evidenceQuote: z.string().min(1),
  evidenceStartMs: z.number().int().min(0),
  evidenceEndMs: z.number().int().min(0),
  mentionedEntities: z.array(ExtractedEntityMentionSchema),
  role_relevant: z.boolean().optional().default(false),
  roleHint: z.string().nullable().optional(),
  commitmentDueDateGuess: z.string().nullable().optional(),
  commitmentRecipientNameGuess: z.string().nullable().optional(),
  sideHint: z.enum(['our', 'client', 'unknown']).nullable().optional(),
});

const ExtractedProcessSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().nullable().optional(),
  ownerRoleHint: z.string().nullable().optional(),
  triggerDescription: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  sourceBlockIndex: z.number().int().min(0).nullable().optional(),
});

const ExtractedDecisionSchema = z.object({
  text: z.string().min(1),
  rationale: z.string().nullable().optional(),
  decidedByPersonHint: z.string().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  sourceBlockIndex: z.number().int().min(0).nullable().optional(),
});

const ExtractedRegulationSchema = z.object({
  name: z.string().min(1).max(300),
  contentMd: z.string(),
  category: z.enum(REGULATION_CATEGORY_VALUES),
  confidence: z.number().min(0).max(1),
  sourceBlockIndex: z.number().int().min(0).nullable().optional(),
});

const ExtractedPolicySchema = z.object({
  name: z.string().min(1).max(300),
  contentMd: z.string(),
  severity: z.enum(POLICY_SEVERITY_VALUES),
  confidence: z.number().min(0).max(1),
  sourceBlockIndex: z.number().int().min(0).nullable().optional(),
});

const ExtractedMetricSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  unit: z.string().max(50),
  target: z.number().nullable().optional(),
  valueType: z.enum(METRIC_VALUE_TYPE_VALUES),
  confidence: z.number().min(0).max(1),
  sourceBlockIndex: z.number().int().min(0).nullable().optional(),
});

const ExtractedToolSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(TOOL_KIND_VALUES),
  externalUrl: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  sourceBlockIndex: z.number().int().min(0).nullable().optional(),
});

const BlockIngestResponseSchema = z.object({
  blocks: z.array(ExtractedBlockSchema),
  processes: z.array(ExtractedProcessSchema).optional().default([]),
  decisions: z.array(ExtractedDecisionSchema).optional().default([]),
  regulations: z.array(ExtractedRegulationSchema).optional().default([]),
  policies: z.array(ExtractedPolicySchema).optional().default([]),
  metrics: z.array(ExtractedMetricSchema).optional().default([]),
  tools: z.array(ExtractedToolSchema).optional().default([]),
  mission: z.null().optional(),
  vision: z.null().optional(),
  strategy: z.null().optional(),
  links: z.array(z.unknown()).optional().default([]),
  dataQuality: z
    .object({
      speakerCoveragePercent: z.number().min(0).max(100).nullable(),
      transcriptTruncated: z.boolean(),
      lowConfidenceBlockCount: z.number().int().min(0),
    })
    .optional(),
});

interface ExtractArgs {
  tenantId: string;
  rawEventId: string;
  meetingTitle?: string | undefined;
  segments: Segment[];
  dataClass?: DataClass;
}

@Injectable()
export class BlockExtractionService {
  private readonly logger = new Logger(BlockExtractionService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async extractFull(args: ExtractArgs): Promise<{
    blocks: ExtractedBlock[];
    blocksInOrder: ExtractedBlock[];
    typed: ExtractedTypedEntities;
  }> {
    const windowSize = this.cfg.knowledgeCore.blockIngestWindowSegments;
    if (args.segments.length === 0) {
      return { blocks: [], blocksInOrder: [], typed: this.emptyTyped() };
    }
    const inOrder: ExtractedBlock[] = [];
    const typed = this.emptyTyped();
    const minConfidence = this.cfg.extraction.typedEntityMinConfidence;

    for (let i = 0; i < args.segments.length; i += windowSize) {
      const slice = args.segments.slice(i, i + windowSize);
      const win = await this.processWindow({
        tenantId: args.tenantId,
        rawEventId: args.rawEventId,
        meetingTitle: args.meetingTitle,
        windowIndex: Math.floor(i / windowSize),
        segments: slice,
        dataClass: args.dataClass,
      });
      const baseOffset = inOrder.length;
      inOrder.push(...win.blocks);
      for (const p of win.typed.processes) {
        if (p.confidence < minConfidence) continue;
        typed.processes.push(this.shiftIdx(p, baseOffset));
      }
      for (const d of win.typed.decisions) {
        if (d.confidence < minConfidence) continue;
        typed.decisions.push(this.shiftIdx(d, baseOffset));
      }
      for (const r of win.typed.regulations) {
        if (r.confidence < minConfidence) continue;
        typed.regulations.push(this.shiftIdx(r, baseOffset));
      }
      for (const p of win.typed.policies) {
        if (p.confidence < minConfidence) continue;
        typed.policies.push(this.shiftIdx(p, baseOffset));
      }
      for (const m of win.typed.metrics) {
        if (m.confidence < minConfidence) continue;
        typed.metrics.push(this.shiftIdx(m, baseOffset));
      }
      for (const t of win.typed.tools) {
        if (t.confidence < minConfidence) continue;
        typed.tools.push(this.shiftIdx(t, baseOffset));
      }
    }
    const sorted = [...inOrder].sort((a, b) => a.evidenceStartMs - b.evidenceStartMs);
    return { blocks: sorted, blocksInOrder: inOrder, typed };
  }

  private async processWindow(args: {
    tenantId: string;
    rawEventId: string;
    meetingTitle?: string | undefined;
    windowIndex: number;
    segments: Segment[];
    dataClass?: DataClass;
  }): Promise<ExtractedWindow> {
    const { system, user } = buildBlockIngestPrompt({
      meetingTitle: args.meetingTitle,
      segments: args.segments,
    });
    const guardOn = this.isPromptInjectionGuardEnabled();
    const guardedSystem = guardOn ? withInjectionGuard(system) : system;
    const guardedUser = guardOn ? wrapUserData(user) : user;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'block-ingest',
          tenantId: args.tenantId,
          systemPrompt: guardedSystem,
          userMessage: guardedUser,
          responseFormat: {
            type: 'json_schema',
            name: 'IdeaBlocks',
            strict: true,
            schema: BLOCK_INGEST_JSON_SCHEMA,
          },
          sourceRef: { type: 'raw-event', id: args.rawEventId },
          dataClass: args.dataClass,
        });
        const parsed = this.parseAndValidate(out.text);
        if (parsed) {
          return parsed;
        }
        this.logger.warn(
          { rawEventId: args.rawEventId, windowIndex: args.windowIndex, attempt },
          'block-ingest: invalid JSON по схеме, повтор',
        );
      } catch (err) {
        this.logger.warn(
          {
            rawEventId: args.rawEventId,
            windowIndex: args.windowIndex,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'block-ingest: LLM call упал, повтор',
        );
      }
    }
    this.logger.warn(
      { rawEventId: args.rawEventId, windowIndex: args.windowIndex },
      'block-ingest: окно не извлеклось после 2 попыток — пропуск',
    );
    return { blocks: [], typed: this.emptyTyped() };
  }

  private parseAndValidate(text: string): ExtractedWindow | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = BlockIngestResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    const data = parsed.data;
    const blocks: ExtractedBlock[] = data.blocks.map((b) => ({
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
      confidence: b.confidence,
      evidenceQuote: b.evidenceQuote,
      evidenceStartMs: b.evidenceStartMs,
      evidenceEndMs: b.evidenceEndMs,
      mentionedEntities: b.mentionedEntities,
      role_relevant: b.role_relevant ?? false,
      roleHint: b.roleHint ?? undefined,
      commitmentDueDateGuess: b.commitmentDueDateGuess ?? null,
      commitmentRecipientNameGuess: b.commitmentRecipientNameGuess ?? null,
      sideHint: b.sideHint ?? null,
    }));
    return {
      blocks,
      dataQuality: data.dataQuality ?? undefined,
      typed: {
        processes: data.processes.map((p) => ({
          name: p.name,
          description: p.description ?? null,
          ownerRoleHint: p.ownerRoleHint ?? null,
          triggerDescription: p.triggerDescription ?? null,
          confidence: p.confidence,
          sourceBlockIndex: p.sourceBlockIndex ?? null,
        })),
        decisions: data.decisions.map((d) => ({
          text: d.text,
          rationale: d.rationale ?? null,
          decidedByPersonHint: d.decidedByPersonHint ?? null,
          decidedAt: d.decidedAt ?? null,
          confidence: d.confidence,
          sourceBlockIndex: d.sourceBlockIndex ?? null,
        })),
        regulations: data.regulations.map((r) => ({
          name: r.name,
          contentMd: r.contentMd,
          category: r.category,
          confidence: r.confidence,
          sourceBlockIndex: r.sourceBlockIndex ?? null,
        })),
        policies: data.policies.map((p) => ({
          name: p.name,
          contentMd: p.contentMd,
          severity: p.severity,
          confidence: p.confidence,
          sourceBlockIndex: p.sourceBlockIndex ?? null,
        })),
        metrics: data.metrics.map((m) => ({
          name: m.name,
          description: m.description ?? null,
          unit: m.unit,
          target: m.target ?? null,
          valueType: m.valueType,
          confidence: m.confidence,
          sourceBlockIndex: m.sourceBlockIndex ?? null,
        })),
        tools: data.tools.map((t) => ({
          name: t.name,
          kind: t.kind,
          externalUrl: t.externalUrl ?? null,
          confidence: t.confidence,
          sourceBlockIndex: t.sourceBlockIndex ?? null,
        })),
      },
    };
  }

  private emptyTyped(): ExtractedTypedEntities {
    return {
      processes: [],
      decisions: [],
      regulations: [],
      policies: [],
      metrics: [],
      tools: [],
    };
  }

  private shiftIdx<T extends { sourceBlockIndex: number | null }>(entity: T, offset: number): T {
    if (entity.sourceBlockIndex == null) return entity;
    return { ...entity, sourceBlockIndex: entity.sourceBlockIndex + offset };
  }
}
