import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma, IdeaBlock } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  PROCESS_TEMPLATE_EXTRACT_JSON_SCHEMA,
  PROCESS_TEMPLATE_EXTRACT_SCHEMA_NAME,
  PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT,
  PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE,
} from '../../knowledge-core/prompts/process-template-extract.prompt';
import type { ProcessTemplateDefinitionDto } from '../dto/processes.dto';

import { CrossFunctionalDetectorService } from './cross-functional-detector.service';
import { ProcessTemplateCompletenessService } from './process-template-completeness.service';
import { resolveProcessTenantTop } from './tenant-top';

/**
 * SBA α-7 wave 2 — ProcessExtractionService.
 *
 * Берёт батч `IdeaBlock` с `signalType ∈ {process_step, methodology_step}`,
 * вызывает LLM `process-template-extract`, для каждого вернувшегося кандидата:
 *   - ищет существующий `ProcessTemplate` с тем же `name` в Org;
 *   - если есть — создаёт новую `ProcessTemplateVersion` (immutable snapshot, §3.2)
 *     и сохраняет `currentVersionId` (auto-activate для agent-источника);
 *   - если нет — создаёт новый ProcessTemplate (status='draft') + первая версия.
 *
 * Дедуп по `name` через case-insensitive match (плюс embedding/cosine в
 * будущем — на α-7 wave 2 достаточно name-match).
 *
 * Все методы НЕ должны бросать наружу (best-effort). Один упавший template
 * не валит остальные.
 */
@Injectable()
export class ProcessExtractionService {
  private readonly logger = new Logger(ProcessExtractionService.name);
  static readonly TASK_TYPE = 'process-template-extract' as const;
  /** Метричный type для core_specialist_* (если используется). */
  private static readonly METRIC_TYPE = 'process_template';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ProcessTemplateCompletenessService)
    private readonly completeness: ProcessTemplateCompletenessService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CrossFunctionalDetectorService)
    private readonly crossFunctional: CrossFunctionalDetectorService,
  ) {
    // cfg сейчас не нужен напрямую (worker управляет батч-окном), но
    // оставлен для будущих параметров (e.g. dedupeThreshold cosine).
    void this.cfg;
  }

  /**
   * Главный метод: обработать батч blockId'ов (все принадлежат одному tenant'у).
   * Возвращает счётчик результатов new/updated/skipped.
   */
  async extractBatch(args: {
    tenantId: string;
    blockIds: readonly string[];
  }): Promise<{ new: number; updated: number; skipped: number }> {
    const result = { new: 0, updated: 0, skipped: 0 };
    if (args.blockIds.length === 0) return result;

    const blocks = await this.loadBlocks({
      tenantId: args.tenantId,
      blockIds: args.blockIds,
    });
    if (blocks.length === 0) return result;

    const existingTemplates = await this.prisma.processTemplate.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { id: true, name: true, summary: true },
      take: 100,
    });

    let llmResult: LlmCallResult;
    const start = Date.now();
    try {
      llmResult = await this.llm.call({
        taskType: ProcessExtractionService.TASK_TYPE,
        systemPrompt: PROCESS_TEMPLATE_EXTRACT_SYSTEM_PROMPT,
        userMessage: PROCESS_TEMPLATE_EXTRACT_USER_TEMPLATE({
          blocks: blocks.map((b) => ({
            id: b.id,
            signalType: b.signalType,
            criticalQuestion: b.criticalQuestion,
            trustedAnswer: b.trustedAnswer,
            quotes: b.quotes,
          })),
          existingTemplates,
        }),
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROCESS_TEMPLATE_EXTRACT_SCHEMA_NAME,
          schema: PROCESS_TEMPLATE_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'process_template_batch', id: args.blockIds[0] ?? '' },
        dataClass: this.maxDataClass(blocks),
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: ProcessExtractionService.METRIC_TYPE,
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          batchSize: args.blockIds.length,
          err: err instanceof Error ? err.message : String(err),
        },
        'process-extraction: LLM упал — пропускаю батч',
      );
      result.skipped = args.blockIds.length;
      return result;
    } finally {
      this.metrics.observeProcessTemplateExtractDuration(
        (Date.now() - start) / 1000,
      );
    }

    let parsed: { templates: ExtractedTemplate[] } | null;
    try {
      parsed = JSON.parse(llmResult.text) as { templates: ExtractedTemplate[] };
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: ProcessExtractionService.METRIC_TYPE,
        reason: 'json_parse',
      });
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          textSample: llmResult.text.slice(0, 300),
        },
        'process-extraction: JSON.parse упал — пропускаю батч',
      );
      result.skipped = args.blockIds.length;
      return result;
    }

    if (!parsed?.templates || !Array.isArray(parsed.templates)) {
      result.skipped = args.blockIds.length;
      return result;
    }

    if (llmResult.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: ProcessExtractionService.METRIC_TYPE,
        model: llmResult.modelUsed,
        tier: llmResult.tier ?? 'primary',
        tokens: (llmResult.inputTokens ?? 0) + (llmResult.outputTokens ?? 0),
      });
    }

    const tenantTop = resolveProcessTenantTop(args.tenantId);
    for (const tpl of parsed.templates) {
      try {
        const outcome = await this.applyExtractedTemplate({
          tenantId: args.tenantId,
          template: tpl,
          sourceBlockIds: args.blockIds.slice(0, 50),
        });
        if (outcome === 'new') result.new += 1;
        else if (outcome === 'updated') result.updated += 1;
        else result.skipped += 1;
        this.metrics.incProcessDetectorExtraction({
          tenantTop,
          result: outcome,
        });
      } catch (err) {
        result.skipped += 1;
        this.metrics.incProcessDetectorExtraction({
          tenantTop,
          result: 'skipped',
        });
        this.logger.warn(
          {
            tenantId: args.tenantId,
            templateName: tpl?.name,
            err: err instanceof Error ? err.message : String(err),
          },
          'process-extraction: упал на одном template — продолжаю',
        );
      }
    }
    return result;
  }

  // ─────────────────────────── internals ──────────────────────────────

  private async applyExtractedTemplate(args: {
    tenantId: string;
    template: ExtractedTemplate;
    sourceBlockIds: readonly string[];
  }): Promise<'new' | 'updated' | 'skipped'> {
    if (!args.template?.name || !Array.isArray(args.template.steps)) {
      return 'skipped';
    }
    const name = args.template.name.trim().slice(0, 300);
    if (!name) return 'skipped';
    if (args.template.confidence != null && args.template.confidence < 0.3) {
      return 'skipped';
    }

    const definition: ProcessTemplateDefinitionDto = {
      steps: args.template.steps.map((s) => ({
        name: String(s.name).trim().slice(0, 200),
        order: Number(s.order) || 1,
        description: s.description ?? undefined,
        // ownerRoleId на этом шаге не резолвится — пока только hint в metadata.
        ownerRoleId: undefined,
        inputArtifact: s.inputArtifact ?? undefined,
        outputArtifact: s.outputArtifact ?? undefined,
        slaMinutes:
          typeof s.slaMinutes === 'number' && s.slaMinutes >= 0
            ? s.slaMinutes
            : undefined,
      })),
      handoffsInline: [],
      decisionPointsInline: [],
    };

    const existing = await this.prisma.processTemplate.findFirst({
      where: {
        tenantId: args.tenantId,
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true, sourceBlockIds: true },
    });

    if (existing) {
      // Создаём новую immutable version + auto-activate (agent-источник).
      const lastVersion = await this.prisma.processTemplateVersion.findFirst({
        where: { templateId: existing.id, tenantId: args.tenantId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;
      await this.prisma.$transaction(async (tx) => {
        const version = await tx.processTemplateVersion.create({
          data: {
            tenantId: args.tenantId,
            templateId: existing.id,
            version: nextVersion,
            definitionJson:
              definition as unknown as Prisma.InputJsonValue,
            source: 'agent',
            changeNote: args.template.summary?.slice(0, 1_000) ?? null,
            publishedById: null,
            publishedAt: new Date(),
          },
        });
        await tx.processTemplate.update({
          where: { id: existing.id },
          data: {
            currentVersionId: version.id,
            summary: args.template.summary ?? undefined,
            sourceBlockIds: {
              set: this.union(existing.sourceBlockIds, args.sourceBlockIds),
            },
            lastConfirmedAt: new Date(),
          },
        });
      });
      await this.completeness.recalculateAndPersist({
        tenantId: args.tenantId,
        templateId: existing.id,
      });
      // SBA γ-3 — cross-functional пересчёт после новой agent-version.
      await this.crossFunctional.recalculateAndPersist({
        tenantId: args.tenantId,
        templateId: existing.id,
      });
      return 'updated';
    }

    // Новый template + первая версия (auto-activate).
    const created = await this.prisma.$transaction(async (tx) => {
      const tpl = await tx.processTemplate.create({
        data: {
          tenantId: args.tenantId,
          name,
          summary: args.template.summary ?? null,
          category: args.template.category ?? null,
          scope: args.template.scope ?? null,
          status: 'active',
          sourceBlockIds: [...args.sourceBlockIds],
          dataClass: 'internal',
          lastConfirmedAt: new Date(),
        },
      });
      const version = await tx.processTemplateVersion.create({
        data: {
          tenantId: args.tenantId,
          templateId: tpl.id,
          version: 1,
          definitionJson: definition as unknown as Prisma.InputJsonValue,
          source: 'agent',
          changeNote: 'Авто-извлечение из встреч/документов (process-detector).',
          publishedAt: new Date(),
        },
      });
      await tx.processTemplate.update({
        where: { id: tpl.id },
        data: { currentVersionId: version.id },
      });
      return tpl;
    });
    await this.completeness.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: created.id,
    });
    // SBA γ-3 — cross-functional пересчёт для нового template.
    await this.crossFunctional.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: created.id,
    });
    return 'new';
  }

  private async loadBlocks(args: {
    tenantId: string;
    blockIds: readonly string[];
  }): Promise<
    Array<{
      id: string;
      signalType: string;
      criticalQuestion: string;
      trustedAnswer: string;
      quotes: string[];
      dataClass: IdeaBlock['dataClass'];
    }>
  > {
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: [...args.blockIds] },
        tenantId: args.tenantId,
      },
      include: { evidence: true },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      signalType: r.signalType,
      criticalQuestion: r.criticalQuestion ?? '',
      trustedAnswer: r.trustedAnswer ?? '',
      quotes: r.evidence
        .slice(0, 4)
        .map((e) => e.quote)
        .filter((q) => q && q.length > 0),
      dataClass: r.dataClass,
    }));
  }

  private maxDataClass(
    blocks: ReadonlyArray<{ dataClass: IdeaBlock['dataClass'] }>,
  ): IdeaBlock['dataClass'] {
    const order = ['public', 'internal', 'sensitive', 'private'] as const;
    let maxIdx = 1; // 'internal' дефолт
    for (const b of blocks) {
      const idx = order.indexOf(b.dataClass);
      if (idx > maxIdx) maxIdx = idx;
    }
    return order[maxIdx] ?? 'internal';
  }

  private union<T>(a: readonly T[], b: readonly T[]): T[] {
    return [...new Set([...a, ...b])];
  }
}

interface ExtractedTemplate {
  name: string;
  summary?: string | null;
  category?: string | null;
  scope?: string | null;
  confidence: number;
  steps: Array<{
    order: number;
    name: string;
    description?: string | null;
    ownerRoleHint?: string | null;
    inputArtifact?: string | null;
    outputArtifact?: string | null;
    slaMinutes?: number | null;
  }>;
}
