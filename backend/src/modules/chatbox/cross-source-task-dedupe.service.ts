import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { tryParseJson } from '../ai/services/json-extract.util';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../ai/services/prompts/common';
import { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';
import {
  TASK_DEDUPE_JSON_SCHEMA,
  TASK_DEDUPE_SCHEMA_NAME,
  TASK_DEDUPE_SYSTEM_PROMPT,
  TASK_DEDUPE_USER_TEMPLATE,
  TaskDedupeResponseSchema,
} from '../knowledge-core/prompts/task-dedupe.prompt';

export interface CrossSourceTaskCandidate {
  title: string;
  description?: string | null;
  assigneeRaw?: string | null;
  assigneeUserId?: string | null;
  sourceQuote?: string | null;
  confidence?: number | null;
  dueDate?: Date | null;
  evidenceBlockIds?: string[];
}

export interface CrossSourceChatContext {
  tenantId: string;
  ownerUserId: string;
  sessionId: string;
  chatId: string | null;
}

export type CrossSourceDedupeResult = 'created' | 'linked' | 'kept';

@Injectable()
export class CrossSourceTaskDedupeService {
  private readonly logger = new Logger(CrossSourceTaskDedupeService.name);

  private static readonly GRAY_BAND = 0.07;
  private static readonly LLM_RETRIES = 2;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async processCandidates(
    candidates: readonly CrossSourceTaskCandidate[],
    ctx: CrossSourceChatContext,
  ): Promise<{ created: number; linked: number }> {
    let created = 0;
    let linked = 0;
    if (candidates.length === 0) return { created, linked };

    if (!this.isEnabled()) {
      for (const c of candidates) {
        await this.createTask(c, ctx);
        created++;
        this.metrics?.incTaskDedupe({ result: 'cross_created' });
      }
      return { created, linked };
    }

    const openTasks = await this.prisma.task.findMany({
      where: { tenantId: ctx.tenantId, status: 'open' },
      select: {
        id: true,
        title: true,
        description: true,
        assigneeRaw: true,
        evidenceBlockIds: true,
      },
    });

    if (openTasks.length === 0) {
      for (const c of candidates) {
        await this.createTask(c, ctx);
        created++;
        this.metrics?.incTaskDedupe({ result: 'cross_created' });
      }
      return { created, linked };
    }

    const threshold = this.threshold();

    let openVecs: number[][];
    try {
      openVecs = await this.embeddings.embed(openTasks.map((t) => this.titleText(t)));
    } catch (err) {
      this.metrics?.incTaskDedupe({ result: 'cross_created' });
      this.logger.warn(
        {
          sessionId: ctx.sessionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'cross-source-task-dedupe: embed открытых задач упал — создаём кандидатов как новые',
      );
      for (const c of candidates) {
        await this.createTask(c, ctx);
        created++;
      }
      return { created, linked };
    }
    if (openVecs.length !== openTasks.length) {
      this.logger.warn(
        { sessionId: ctx.sessionId },
        'cross-source-task-dedupe: длина embedding-батча не совпала — создаём кандидатов как новые',
      );
      for (const c of candidates) {
        await this.createTask(c, ctx);
        created++;
        this.metrics?.incTaskDedupe({ result: 'cross_created' });
      }
      return { created, linked };
    }

    for (const cand of candidates) {
      const result = await this.processOne(cand, ctx, openTasks, openVecs, threshold);
      if (result === 'linked') {
        linked++;
        this.metrics?.incTaskDedupe({ result: 'cross_linked' });
      } else {
        created++;
        this.metrics?.incTaskDedupe({ result: 'cross_created' });
      }
    }

    return { created, linked };
  }

  private async processOne(
    cand: CrossSourceTaskCandidate,
    ctx: CrossSourceChatContext,
    openTasks: ReadonlyArray<{
      id: string;
      title: string;
      description: string | null;
      assigneeRaw: string | null;
      evidenceBlockIds: string[];
    }>,
    openVecs: number[][],
    threshold: number,
  ): Promise<CrossSourceDedupeResult> {
    try {
      let candVec: number[];
      try {
        const [v] = await this.embeddings.embed([this.titleText(cand)]);
        if (!v) throw new Error('embed вернул пустой вектор');
        candVec = v;
      } catch (err) {
        this.logger.warn(
          {
            sessionId: ctx.sessionId,
            err: err instanceof Error ? err.message : String(err),
          },
          'cross-source-task-dedupe: embed кандидата упал — создаём как новую',
        );
        await this.createTask(cand, ctx);
        return 'created';
      }

      let bestSim = -Infinity;
      let bestIdx = -1;
      for (let j = 0; j < openTasks.length; j++) {
        const sim = this.cosine(candVec, openVecs[j]!);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }

      if (bestIdx < 0) {
        await this.createTask(cand, ctx);
        return 'created';
      }

      const best = openTasks[bestIdx]!;

      if (bestSim >= threshold) {
        await this.linkToExisting(best, cand, ctx);
        return 'linked';
      }

      if (bestSim >= threshold - CrossSourceTaskDedupeService.GRAY_BAND) {
        const same = await this.judgeSame(ctx, cand, best);
        if (same) {
          await this.linkToExisting(best, cand, ctx);
          return 'linked';
        }
        await this.createTask(cand, ctx);
        return 'created';
      }

      await this.createTask(cand, ctx);
      return 'created';
    } catch (err) {
      this.logger.warn(
        {
          sessionId: ctx.sessionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'cross-source-task-dedupe: непредвиденная ошибка — создаём кандидата как новую',
      );
      try {
        await this.createTask(cand, ctx);
      } catch (createErr) {
        this.logger.error(
          {
            sessionId: ctx.sessionId,
            err: createErr instanceof Error ? createErr.message : String(createErr),
          },
          'cross-source-task-dedupe: не удалось создать задачу после сбоя дедупа',
        );
      }
      return 'created';
    }
  }

  private async createTask(
    cand: CrossSourceTaskCandidate,
    ctx: CrossSourceChatContext,
  ): Promise<void> {
    const task = await this.prisma.task.create({
      data: {
        meetingId: null,
        sourceType: 'chatbox',
        sourceChatSessionId: ctx.sessionId,
        sourceChatId: ctx.chatId,
        tenantId: ctx.tenantId,
        userId: ctx.ownerUserId,
        title: cand.title,
        description: cand.description ?? null,
        assigneeRaw: cand.assigneeRaw ?? null,
        assigneeUserId: cand.assigneeUserId ?? null,
        dueDate: cand.dueDate ?? null,
        sourceQuote: cand.sourceQuote ?? null,
        confidence: cand.confidence ?? null,
        evidenceBlockIds: cand.evidenceBlockIds ?? [],
      },
      select: { id: true },
    });

    await this.upsertTaskSource(task.id, ctx, cand.sourceQuote ?? null);
  }

  private async linkToExisting(
    existing: { id: string; evidenceBlockIds: string[] },
    cand: CrossSourceTaskCandidate,
    ctx: CrossSourceChatContext,
  ): Promise<void> {
    await this.upsertTaskSource(existing.id, ctx, cand.sourceQuote ?? null);

    const newBlocks = (cand.evidenceBlockIds ?? []).filter(
      (b) => !existing.evidenceBlockIds.includes(b),
    );
    if (newBlocks.length > 0) {
      try {
        await this.prisma.task.update({
          where: { id: existing.id },
          data: { evidenceBlockIds: [...existing.evidenceBlockIds, ...newBlocks] },
        });
      } catch (err) {
        this.logger.warn(
          {
            taskId: existing.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'cross-source-task-dedupe: append evidenceBlockIds не удался (игнорируем)',
        );
      }
    }
  }

  private async upsertTaskSource(
    taskId: string,
    ctx: CrossSourceChatContext,
    quote: string | null,
  ): Promise<void> {
    try {
      await this.prisma.taskSource.create({
        data: {
          tenantId: ctx.tenantId,
          taskId,
          sourceType: 'chatbox',
          sourceRefId: ctx.sessionId,
          chatId: ctx.chatId,
          quote,
        },
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2002') return;
      this.logger.warn(
        {
          taskId,
          sessionId: ctx.sessionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'cross-source-task-dedupe: запись TaskSource не удалась (игнорируем)',
      );
    }
  }

  private isEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.tasksCrossSourceDedupeEnabled === true;
    } catch {
      return false;
    }
  }

  private threshold(): number {
    try {
      const t = this.cfg.aiFeatures.crossSourceDedupeThreshold;
      return Number.isFinite(t) ? t : 0.85;
    } catch {
      return 0.85;
    }
  }

  private titleText(row: { title: string; description?: string | null }): string {
    const title = (row.title ?? '').trim();
    const desc = (row.description ?? '').trim();
    if (!desc) return title;
    return `${title}. ${desc.slice(0, 200)}`;
  }

  private cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i]!;
      const y = b[i]!;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  private async judgeSame(
    ctx: CrossSourceChatContext,
    cand: CrossSourceTaskCandidate,
    existing: { id: string; title: string; assigneeRaw: string | null },
  ): Promise<boolean> {
    const userMessage = TASK_DEDUPE_USER_TEMPLATE({
      a: { title: existing.title, assignee: existing.assigneeRaw },
      b: { title: cand.title, assignee: cand.assigneeRaw ?? null },
    });

    for (let attempt = 0; attempt < CrossSourceTaskDedupeService.LLM_RETRIES; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'task-dedupe',
          tenantId: ctx.tenantId,
          systemPrompt: withInjectionGuard(TASK_DEDUPE_SYSTEM_PROMPT),
          userMessage: wrapUserData(userMessage),
          responseFormat: {
            type: 'json_schema',
            name: TASK_DEDUPE_SCHEMA_NAME,
            strict: true,
            schema: TASK_DEDUPE_JSON_SCHEMA,
          },
          sourceRef: { type: 'task', id: existing.id },
          dataClass: 'sensitive',
          validate: (text) => this.parseVerdict(text) !== null,
        });
        const verdict = this.parseVerdict(out.text);
        if (verdict !== null) return verdict === 'same';
        this.logger.warn(
          { sessionId: ctx.sessionId, taskId: existing.id, attempt },
          'cross-source-task-dedupe: невалидный JSON арбитра — повтор',
        );
      } catch (err) {
        this.logger.warn(
          {
            sessionId: ctx.sessionId,
            taskId: existing.id,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'cross-source-task-dedupe: LLM-арбитр упал — повтор',
        );
      }
    }
    return false;
  }

  private parseVerdict(text: string): 'same' | 'different' | null {
    const raw = tryParseJson(text);
    const parsed = TaskDedupeResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data.verdict;
  }
}
