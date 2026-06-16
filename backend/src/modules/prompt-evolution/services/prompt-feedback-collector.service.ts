import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

@Injectable()
export class PromptFeedbackCollectorService {
  private readonly logger = new Logger(PromptFeedbackCollectorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
  ) {}

  @OnEvent('ai.invocation.completed')
  async handleInvocationCompleted(event: AiInvocationCompletedEvent): Promise<void> {
    try {
      const inputText = `${event.input.systemPrompt}\n---\n${event.input.userMessage}`;
      const inputDigest = sha256short(inputText);

      let embeddingVector: number[] | null = null;
      if (this.embeddings) {
        try {
          const [vec] = await this.embeddings.embed([inputText.slice(0, 8000)]);
          embeddingVector = vec ?? null;
        } catch (err) {
          this.logger.debug(
            `embed failed для invocation=${event.invocationId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const existing = await this.prisma.promptFeedback.findUnique({
        where: { invocationId: event.invocationId },
      });
      if (existing) {
        return;
      }

      await this.prisma.promptFeedback.create({
        data: {
          tenantId: event.tenantId,
          promptKey: event.promptKey,
          promptVersion: event.promptVersion,
          invocationId: event.invocationId,
          inputDigest,
          originalOutput: event.output,
        },
      });

      if (embeddingVector && embeddingVector.length === 1536) {
        try {
          await this.prisma.$executeRawUnsafe(
            `UPDATE "PromptFeedback" SET "inputEmbedding" = $1::vector WHERE "invocationId" = $2`,
            `[${embeddingVector.join(',')}]`,
            event.invocationId,
          );
        } catch (err) {
          this.logger.debug(
            `Embedding update failed для invocation=${event.invocationId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.metrics.incPromptFeedback({
        promptKey: event.promptKey,
        hasEdit: 'false',
      });
    } catch (err) {
      this.logger.warn(
        {
          invocationId: event.invocationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'handleInvocationCompleted: пропускаю запись (best-effort)',
      );
    }
  }

  @OnEvent('ai.invocation.edited')
  async handleInvocationEdited(event: AiInvocationEditedEvent): Promise<void> {
    try {
      const fb = await this.prisma.promptFeedback.findUnique({
        where: { invocationId: event.invocationId },
      });
      if (!fb) {
        return;
      }
      const editDistance = normalizedLevenshtein(fb.originalOutput, event.editedOutput);
      await this.prisma.promptFeedback.update({
        where: { id: fb.id },
        data: {
          editedOutput: event.editedOutput,
          editDistance,
          editedAt: new Date(),
          editedByUserId: event.editedByUserId,
          ...(event.downstreamSignals
            ? { downstreamSignals: event.downstreamSignals as object }
            : {}),
        },
      });
      this.metrics.incPromptFeedback({
        promptKey: fb.promptKey,
        hasEdit: 'true',
      });
    } catch (err) {
      this.logger.warn(
        {
          invocationId: event.invocationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'handleInvocationEdited: пропускаю update (best-effort)',
      );
    }
  }
}

export interface AiInvocationCompletedEvent {
  invocationId: string;
  tenantId: string;
  promptKey: string;
  promptVersion: string;
  input: { systemPrompt: string; userMessage: string };
  output: string;
}

export interface AiInvocationEditedEvent {
  invocationId: string;
  editedOutput: string;
  editedByUserId: string | null;
  downstreamSignals?: Record<string, unknown>;
}

function sha256short(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function normalizedLevenshtein(a: string, b: string): number {
  const MAX = 4000;
  const s1 = a.length > MAX ? a.slice(0, MAX) : a;
  const s2 = b.length > MAX ? b.slice(0, MAX) : b;
  if (s1.length === 0 && s2.length === 0) return 0;
  if (s1.length === 0 || s2.length === 0) return 1;
  const dist = levenshtein(s1, s2);
  return Math.min(1, dist / Math.max(s1.length, s2.length));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}
