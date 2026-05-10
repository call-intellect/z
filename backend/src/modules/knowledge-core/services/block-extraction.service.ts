import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  BLOCK_INGEST_JSON_SCHEMA,
  ENTITY_TYPE_VALUES,
  SIGNAL_TYPE_VALUES,
  buildBlockIngestPrompt,
} from '../prompts/block-ingest.prompt';

import type { Segment } from './segment-builder.service';

/**
 * Извлечённая сущность, упомянутая в блоке. Совпадает по полям со схемой
 * `mentionedEntities[]` из block-ingest JSON-схемы.
 */
export interface ExtractedEntityMention {
  type: (typeof ENTITY_TYPE_VALUES)[number];
  name: string;
  mentionContext: string;
  metadata?: Record<string, unknown>;
}

/**
 * Извлечённый блок (до записи в БД). Структура соответствует JSON Schema
 * block-ingest LLM-ответа.
 */
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
}

/**
 * Zod-схема для валидации LLM-ответа после JSON-парсинга. Дублирует
 * правила JSON Schema, но даёт нам типизированный объект на TS-стороне.
 */
const ExtractedEntityMentionSchema = z.object({
  type: z.enum(ENTITY_TYPE_VALUES),
  name: z.string().min(1),
  mentionContext: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
});

const BlockIngestResponseSchema = z.object({
  blocks: z.array(ExtractedBlockSchema),
});

interface ExtractArgs {
  tenantId: string;
  rawEventId: string;
  meetingTitle?: string | undefined;
  segments: Segment[];
  /** Фаза 11: dataClass исходного RawEvent — пробрасывается в LLM-вызов. */
  dataClass?: DataClass;
}

/**
 * BlockExtractionService — оркестратор block-ingest LLM-вызовов.
 *
 *   - Скользящее окно `cfg.knowledgeCore.blockIngestWindowSegments` сегментов.
 *     Без overlap (overlap появится позже, если будет ловиться разрыв смысла).
 *   - На каждое окно — один LLM-вызов через `LlmRouterService.call(...)`
 *     с `responseFormat: 'json_schema' strict`.
 *   - На invalid JSON — один retry; если опять fail — окно пропускается с warn.
 *   - Все блоки склеиваются в один общий список (отсортированный по
 *     evidenceStartMs).
 */
@Injectable()
export class BlockExtractionService {
  private readonly logger = new Logger(BlockExtractionService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async extractBlocks(args: ExtractArgs): Promise<{ blocks: ExtractedBlock[] }> {
    const windowSize = this.cfg.knowledgeCore.blockIngestWindowSegments;
    if (args.segments.length === 0) {
      return { blocks: [] };
    }
    const aggregated: ExtractedBlock[] = [];
    for (let i = 0; i < args.segments.length; i += windowSize) {
      const slice = args.segments.slice(i, i + windowSize);
      const windowBlocks = await this.processWindow({
        tenantId: args.tenantId,
        rawEventId: args.rawEventId,
        meetingTitle: args.meetingTitle,
        windowIndex: Math.floor(i / windowSize),
        segments: slice,
        dataClass: args.dataClass,
      });
      aggregated.push(...windowBlocks);
    }
    aggregated.sort((a, b) => a.evidenceStartMs - b.evidenceStartMs);
    return { blocks: aggregated };
  }

  // ─────────────────────────── window ──────────────────────────────────────

  private async processWindow(args: {
    tenantId: string;
    rawEventId: string;
    meetingTitle?: string | undefined;
    windowIndex: number;
    segments: Segment[];
    dataClass?: DataClass;
  }): Promise<ExtractedBlock[]> {
    const { system, user } = buildBlockIngestPrompt({
      meetingTitle: args.meetingTitle,
      segments: args.segments,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'block-ingest',
          tenantId: args.tenantId,
          systemPrompt: system,
          userMessage: user,
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
          return parsed.blocks;
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
    return [];
  }

  /**
   * Парсит JSON-ответ LLM и валидирует через Zod. На любую ошибку — null.
   */
  private parseAndValidate(text: string): { blocks: ExtractedBlock[] } | null {
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
    return parsed.data;
  }
}
