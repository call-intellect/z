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
  /**
   * KC-Temporal W1.4 (2026-05-25) — опциональный таймкод цитаты, где
   * упомянута сущность. Маппится в `IdeaBlock.propertySpans[*]` в
   * block-ingest.worker'е. LLM может не вернуть — это допустимо.
   */
  sourceSpan?: { startMs: number; endMs: number };
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
  /**
   * Wave 3b (2026-06-10) — сторона факта для клиентских типов встреч
   * (sales/customer_success/partner/custdev). null для внутренних встреч
   * или если LLM/кэш не вернул поле. Пока не используется обработчиком.
   */
  sideHint?: 'our' | 'client' | 'unknown' | null | undefined;
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
 * Wave 3b (2026-06-10) — самооценка качества входных данных окна. Опциональна
 * (старые кэш-результаты её не содержат). Пока не используется обработчиком —
 * зарезервировано для будущих метрик надёжности извлечения.
 */
export interface ExtractedDataQuality {
  speakerCoveragePercent: number | null;
  transcriptTruncated: boolean;
  lowConfidenceBlockCount: number;
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
  /**
   * Wave 3b (2026-06-10) — опциональная самооценка качества данных окна.
   * undefined, если LLM/кэш её не вернул. Пока не агрегируется в extractFull.
   */
  dataQuality?: ExtractedDataQuality | undefined;
  /** Окно исчерпало 2 попытки без валидного результата (потеря). */
  failed?: boolean;
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
  // KC-Temporal W1.4 — опциональный span (старые LLM-промпты могут не возвращать).
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
  // v2 поля — могут отсутствовать на legacy-ответах, добавляем безопасные
  // дефолты, чтобы старые промпты/модели не валили парсинг.
  role_relevant: z.boolean().optional().default(false),
  roleHint: z.string().nullable().optional(),
  // SBA β-8.2 — два поля для signalType='commitment'. Опциональные —
  // старые модели/промпты могут не возвращать.
  commitmentDueDateGuess: z.string().nullable().optional(),
  commitmentRecipientNameGuess: z.string().nullable().optional(),
  // Wave 3b (2026-06-10) — сторона факта для клиентских типов встреч.
  // Опционально + nullable: старые кэш-результаты поля не содержат, для
  // внутренних встреч приходит null.
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

/**
 * Б38 (ТЗ 2026-06-16): конверт ответа парсим в «мягком» режиме — массивы
 * блоков и типизированных сущностей принимаем как `unknown[]`, а каждый элемент
 * валидируем поэлементно (см. `parseAndValidate`). Раньше один невалидный блок
 * ронял парсинг всего окна (`safeParse` массива целиком), и терялись валидные
 * блоки + типизированные сущности. Теперь отбрасываем только битые элементы.
 */
const BlockIngestEnvelopeSchema = z.object({
  blocks: z.array(z.unknown()).optional().default([]),
  processes: z.array(z.unknown()).optional().default([]),
  decisions: z.array(z.unknown()).optional().default([]),
  regulations: z.array(z.unknown()).optional().default([]),
  policies: z.array(z.unknown()).optional().default([]),
  metrics: z.array(z.unknown()).optional().default([]),
  tools: z.array(z.unknown()).optional().default([]),
  // Mission/Vision/Strategy — ожидаем null (EXTRACTION_ENABLE_TOP_LEVEL=false).
  mission: z.null().optional(),
  vision: z.null().optional(),
  strategy: z.null().optional(),
  // Links — опц.; на эту итерацию не используем, оставляем для совместимости.
  links: z.array(z.unknown()).optional().default([]),
  // Wave 3b (2026-06-10) — самооценка качества данных окна. Опциональна
  // (старые кэш-результаты её не содержат). Пока не используется обработчиком.
  dataQuality: z
    .object({
      speakerCoveragePercent: z.number().min(0).max(100).nullable(),
      transcriptTruncated: z.boolean(),
      lowConfidenceBlockCount: z.number().int().min(0),
    })
    .optional(),
});

/**
 * Поэлементно валидирует массив `unknown[]` указанной Zod-схемой: возвращает
 * только валидные элементы + число отброшенных. Б38: один битый элемент больше
 * не теряет всё окно.
 */
function parseEachItem<T>(
  items: unknown[],
  schema: z.ZodType<T>,
): { valid: T[]; dropped: number } {
  const valid: T[] = [];
  let dropped = 0;
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) valid.push(r.data);
    else dropped += 1;
  }
  return { valid, dropped };
}

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
    failedWindows: number;
  }> {
    const windowSize = this.cfg.knowledgeCore.blockIngestWindowSegments;
    if (args.segments.length === 0) {
      return {
        blocks: [],
        blocksInOrder: [],
        typed: this.emptyTyped(),
        failedWindows: 0,
      };
    }
    const inOrder: ExtractedBlock[] = [];
    const typed = this.emptyTyped();
    let failedWindows = 0;
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
      if (win.failed) failedWindows += 1;
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
    return { blocks: sorted, blocksInOrder: inOrder, typed, failedWindows };
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
    return { blocks: [], typed: this.emptyTyped(), failed: true };
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
    // Б38: конверт парсим мягко (массивы как unknown[]), затем валидируем
    // каждый элемент отдельно — один битый блок/сущность больше не теряет
    // всё окно (раньше падал `safeParse` массива целиком).
    const envelope = BlockIngestEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      return null;
    }
    const data = envelope.data;

    const blocksParsed = parseEachItem(data.blocks, ExtractedBlockSchema);
    const processesParsed = parseEachItem(data.processes, ExtractedProcessSchema);
    const decisionsParsed = parseEachItem(data.decisions, ExtractedDecisionSchema);
    const regulationsParsed = parseEachItem(
      data.regulations,
      ExtractedRegulationSchema,
    );
    const policiesParsed = parseEachItem(data.policies, ExtractedPolicySchema);
    const metricsParsed = parseEachItem(data.metrics, ExtractedMetricSchema);
    const toolsParsed = parseEachItem(data.tools, ExtractedToolSchema);

    const droppedTotal =
      blocksParsed.dropped +
      processesParsed.dropped +
      decisionsParsed.dropped +
      regulationsParsed.dropped +
      policiesParsed.dropped +
      metricsParsed.dropped +
      toolsParsed.dropped;
    if (droppedTotal > 0) {
      // Метрики тут нет (сервис без MetricsService) — фиксируем warn'ом
      // с разбивкой, чтобы видеть, какой тип отбрасывается чаще.
      this.logger.warn(
        {
          droppedBlocks: blocksParsed.dropped,
          droppedProcesses: processesParsed.dropped,
          droppedDecisions: decisionsParsed.dropped,
          droppedRegulations: regulationsParsed.dropped,
          droppedPolicies: policiesParsed.dropped,
          droppedMetrics: metricsParsed.dropped,
          droppedTools: toolsParsed.dropped,
          keptBlocks: blocksParsed.valid.length,
        },
        'block-ingest: отброшены невалидные элементы окна (валидные сохранены)',
      );
    }

    const blocks: ExtractedBlock[] = blocksParsed.valid.map((b) => ({
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
        processes: processesParsed.valid.map((p) => ({
          name: p.name,
          description: p.description ?? null,
          ownerRoleHint: p.ownerRoleHint ?? null,
          triggerDescription: p.triggerDescription ?? null,
          confidence: p.confidence,
          sourceBlockIndex: p.sourceBlockIndex ?? null,
        })),
        decisions: decisionsParsed.valid.map((d) => ({
          text: d.text,
          rationale: d.rationale ?? null,
          decidedByPersonHint: d.decidedByPersonHint ?? null,
          decidedAt: d.decidedAt ?? null,
          confidence: d.confidence,
          sourceBlockIndex: d.sourceBlockIndex ?? null,
        })),
        regulations: regulationsParsed.valid.map((r) => ({
          name: r.name,
          contentMd: r.contentMd,
          category: r.category,
          confidence: r.confidence,
          sourceBlockIndex: r.sourceBlockIndex ?? null,
        })),
        policies: policiesParsed.valid.map((p) => ({
          name: p.name,
          contentMd: p.contentMd,
          severity: p.severity,
          confidence: p.confidence,
          sourceBlockIndex: p.sourceBlockIndex ?? null,
        })),
        metrics: metricsParsed.valid.map((m) => ({
          name: m.name,
          description: m.description ?? null,
          unit: m.unit,
          target: m.target ?? null,
          valueType: m.valueType,
          confidence: m.confidence,
          sourceBlockIndex: m.sourceBlockIndex ?? null,
        })),
        tools: toolsParsed.valid.map((t) => ({
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
