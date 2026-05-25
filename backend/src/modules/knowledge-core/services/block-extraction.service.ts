import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
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
 * block-ingest LLM-ответа (v2 Фазы 0b).
 *
 * Поля v2:
 *   - `role_relevant` — классификатор прямой отнесённости блока к должности.
 *   - `roleHint` — имя должности из контекста, если упомянуто.
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
  /** Фаза 0b — прямая отнесённость к должности (из LLM-классификатора). */
  role_relevant: boolean;
  /** Фаза 0b — имя должности из контекста, если упомянуто. */
  roleHint?: string | undefined;
  /**
   * SBA β-8.2 — для signalType='commitment': срок в формате YYYY-MM-DD,
   * извлечённый LLM из текста. null если не извлечён или не commitment.
   */
  commitmentDueDateGuess?: string | null | undefined;
  /**
   * SBA β-8.2 — имя адресата обещания, как звучит в тексте. null если
   * не извлечён или не commitment. Сопоставление с Person — в worker'е.
   */
  commitmentRecipientNameGuess?: string | null | undefined;
}

/**
 * Группа Б — типизированные сущности, извлечённые тем же проходом LLM,
 * что и блоки. У каждой есть `sourceBlockIndex` (нумерация по `blocks[]` в
 * том же ответе) — для провенанса «откуда взялась сущность».
 */
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

/**
 * Один LLM-ответ из block-ingest v2.
 *
 * sourceBlockIndex у типизированных сущностей — индекс в `blocks` ТОГО ЖЕ
 * окна (один LLM-вызов = одно окно). Caller (`block-ingest.worker.ts`)
 * соответственно мапит индекс → реальный blockId после persist.
 */
export interface ExtractedWindow {
  blocks: ExtractedBlock[];
  typed: ExtractedTypedEntities;
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
  // v2 поля — могут отсутствовать на legacy-ответах, добавляем безопасные
  // дефолты, чтобы старые промпты/модели не валили парсинг.
  role_relevant: z.boolean().optional().default(false),
  roleHint: z.string().nullable().optional(),
  // SBA β-8.2 — два поля для signalType='commitment'. Опциональные —
  // старые модели/промпты могут не возвращать.
  commitmentDueDateGuess: z.string().nullable().optional(),
  commitmentRecipientNameGuess: z.string().nullable().optional(),
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
  // Все группы Б — опц. (старые модели могут не вернуть). Дефолт — пустой массив.
  processes: z.array(ExtractedProcessSchema).optional().default([]),
  decisions: z.array(ExtractedDecisionSchema).optional().default([]),
  regulations: z.array(ExtractedRegulationSchema).optional().default([]),
  policies: z.array(ExtractedPolicySchema).optional().default([]),
  metrics: z.array(ExtractedMetricSchema).optional().default([]),
  tools: z.array(ExtractedToolSchema).optional().default([]),
  // Mission/Vision/Strategy — ожидаем null (EXTRACTION_ENABLE_TOP_LEVEL=false).
  mission: z.null().optional(),
  vision: z.null().optional(),
  strategy: z.null().optional(),
  // Links — опц.; на эту итерацию не используем, оставляем для совместимости.
  links: z.array(z.unknown()).optional().default([]),
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
 *
 * Фаза 0b: возвращаем ТАКЖЕ типизированные сущности группы Б. Они
 * привязываются к блокам через `sourceBlockIndex`, который указывает на
 * индекс блока в МАССИВЕ ТОГО ЖЕ ОКНА. Worker'у нужно после persist'а
 * замапить их в реальный `blockId`.
 *
 * TODO (Фаза γ или позже): эксперимент B — три прохода (блоки + сущности +
 * рёбра отдельными запросами) для длинных документов. Пока — вариант A
 * (один промпт за окно).
 */
@Injectable()
export class BlockExtractionService {
  private readonly logger = new Logger(BlockExtractionService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   * Defensive try/catch — старые unit-тесты могут мокать cfg без `aiFeatures`.
   * Default — true (как в env.schema).
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Главный метод извлечения. Возвращает:
   *   - `blocks` — блоки в порядке по `evidenceStartMs` (для UI/таймлайна).
   *   - `blocksInOrder` — блоки в исходном порядке выдачи LLM (для маппинга
   *     `sourceBlockIndex` → реальный `blockId` после persist).
   *   - `typed` — типизированные сущности группы Б, отфильтрованные по
   *     `cfg.extraction.typedEntityMinConfidence`. `sourceBlockIndex` у них
   *     глобализован относительно `blocksInOrder`.
   */
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
    const sorted = [...inOrder].sort(
      (a, b) => a.evidenceStartMs - b.evidenceStartMs,
    );
    return { blocks: sorted, blocksInOrder: inOrder, typed };
  }

  // ─────────────────────────── window ──────────────────────────────────────

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
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть транскрипт-сегменты + meetingTitle
    // в маркеры данных + INJECTION_GUARD_NOTE в system. Источник = 'transcript'.
    // Sanitize по транскрипту не делаем — естественная речь даёт много
    // false positives на regex'ах вроде «забудь предыдущие шаги».
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

  /**
   * Парсит JSON-ответ LLM и валидирует через Zod. На любую ошибку — null.
   */
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
    }));
    return {
      blocks,
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

  // ─────────────────────────── helpers ─────────────────────────────────────

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

  private shiftIdx<T extends { sourceBlockIndex: number | null }>(
    entity: T,
    offset: number,
  ): T {
    if (entity.sourceBlockIndex == null) return entity;
    return { ...entity, sourceBlockIndex: entity.sourceBlockIndex + offset };
  }
}
