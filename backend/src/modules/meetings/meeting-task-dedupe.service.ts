import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';
import { cosineSimilarity, judgeSameTask } from '../knowledge-core/util/task-dedup-matcher.util';

@Injectable()
export class MeetingTaskDedupeService {
  private readonly logger = new Logger(MeetingTaskDedupeService.name);

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

  async dedupeForMeeting(args: {
    tenantId: string | null;
    meetingId: string;
  }): Promise<{ merged: number }> {
    try {
      if (!this.isEnabled()) return { merged: 0 };

      const rows = await this.prisma.task.findMany({
        where: {
          meetingId: args.meetingId,
          ...(args.tenantId ? { tenantId: args.tenantId } : {}),
        },
        select: {
          id: true,
          title: true,
          description: true,
          assigneeRaw: true,
          assigneeUserId: true,
          extractorVersion: true,
        },
      });

      const drafts = rows.filter((r) => r.extractorVersion === 'fast');
      const canonical = rows.filter((r) => r.extractorVersion !== 'fast');
      if (drafts.length === 0 || canonical.length === 0) {
        return { merged: 0 };
      }

      const threshold = this.threshold();
      const grayBand = await this.grayBand();

      let vectors: number[][];
      try {
        vectors = await this.embeddings.embed([
          ...canonical.map((r) => this.titleText(r)),
          ...drafts.map((r) => this.titleText(r)),
        ]);
      } catch (err) {
        this.metrics?.incTaskDedupe({ result: 'skipped' });
        this.logger.warn(
          {
            meetingId: args.meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'task-dedupe: embed упал — пропуск',
        );
        return { merged: 0 };
      }
      if (vectors.length !== canonical.length + drafts.length) {
        this.metrics?.incTaskDedupe({ result: 'skipped' });
        this.logger.warn(
          { meetingId: args.meetingId },
          'task-dedupe: длина embedding-батча не совпала — пропуск',
        );
        return { merged: 0 };
      }
      const canonVecs = vectors.slice(0, canonical.length);
      const draftVecs = vectors.slice(canonical.length);

      const toDelete: string[] = [];
      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i]!;
        const dv = draftVecs[i]!;

        let bestSim = -Infinity;
        let bestIdx = -1;
        for (let j = 0; j < canonical.length; j++) {
          const sim = cosineSimilarity(dv, canonVecs[j]!);
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = j;
          }
        }

        if (bestSim >= threshold) {
          toDelete.push(draft.id);
          this.metrics?.incTaskDedupe({ result: 'knn_merged' });
          continue;
        }

        if (bestSim >= threshold - grayBand && bestIdx >= 0) {
          const canon = canonical[bestIdx]!;
          const same = await judgeSameTask({
            llm: this.llm,
            tenantId: args.tenantId,
            a: { title: canon.title, assigneeRaw: canon.assigneeRaw },
            b: { title: draft.title, assigneeRaw: draft.assigneeRaw },
            sourceRef: { type: 'task', id: draft.id },
            dataClass: 'internal',
            logger: this.logger,
            logContext: { meetingId: args.meetingId, draftId: draft.id },
          });
          if (same) {
            toDelete.push(draft.id);
            this.metrics?.incTaskDedupe({ result: 'llm_merged' });
          } else {
            this.metrics?.incTaskDedupe({ result: 'kept' });
          }
          continue;
        }

        this.metrics?.incTaskDedupe({ result: 'kept' });
      }

      if (toDelete.length === 0) return { merged: 0 };

      await this.prisma.task.deleteMany({
        where: { id: { in: toDelete }, meetingId: args.meetingId },
      });
      this.logger.log(
        { meetingId: args.meetingId, merged: toDelete.length },
        'task-dedupe: удалены fast-черновики (дубли canonical)',
      );
      return { merged: toDelete.length };
    } catch (err) {
      this.metrics?.incTaskDedupe({ result: 'skipped' });
      this.logger.warn(
        {
          meetingId: args.meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-dedupe: непредвиденная ошибка — пропуск',
      );
      return { merged: 0 };
    }
  }

  private isEnabled(): boolean {
    try {
      return this.cfg.knowledgeCore.taskDedupeEnabled === true;
    } catch {
      return false;
    }
  }

  private threshold(): number {
    try {
      const t = this.cfg.knowledgeCore.taskDedupeThreshold;
      return Number.isFinite(t) ? t : 0.85;
    } catch {
      return 0.85;
    }
  }

  private async grayBand(): Promise<number> {
    try {
      const v = await this.cfg.getDynamic<number>('tracker.taskDedupGrayBand', undefined, 0.07);
      return Number.isFinite(v) ? v : 0.07;
    } catch {
      return 0.07;
    }
  }

  private titleText(row: { title: string; description?: string | null }): string {
    const title = (row.title ?? '').trim();
    const desc = (row.description ?? '').trim();
    if (!desc) return title;
    return `${title}. ${desc.slice(0, 200)}`;
  }
}
