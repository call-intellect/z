import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { TranscriptChunk } from '../embeddings.types';

import { EmbeddingFallbackService } from './embedding-fallback.service';

interface MergedTranscriptTurn {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
}

@Injectable()
export class TranscriptIndexerService {
  private readonly logger = new Logger(TranscriptIndexerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async indexMeeting(meetingId: string): Promise<{ chunksIndexed: number }> {
    try {
      const meeting = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        include: { transcript: true },
      });
      if (!meeting) {
        throw new Error(`indexMeeting: meeting ${meetingId} не найден`);
      }
      if (!meeting.transcript?.turns) {
        throw new Error(`indexMeeting: нет transcript.turns в БД для ${meetingId}`);
      }

      const turns = Array.isArray(meeting.transcript.turns)
        ? (meeting.transcript.turns as unknown as MergedTranscriptTurn[])
        : [];
      const chunks = this.chunkTurns(turns, {
        targetTokens: this.cfg.ai.embeddings.chunkTargetTokens,
        overlapTokens: this.cfg.ai.embeddings.chunkOverlapTokens,
      });

      await this.prisma.meetingTranscriptChunk.deleteMany({
        where: { meetingId },
      });

      if (chunks.length === 0) {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { embeddingsStatus: 'ready' },
        });
        this.logger.log({ meetingId }, 'indexMeeting: пустой транскрипт — статус ready');
        return { chunksIndexed: 0 };
      }

      const batchSize = this.cfg.ai.embeddings.batchSize;
      let inserted = 0;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vectors = await this.embeddings.embed(batch.map((c) => c.text));
        if (vectors.length !== batch.length) {
          throw new Error(
            `indexMeeting: provider вернул ${vectors.length} embeddings вместо ${batch.length}`,
          );
        }
        await this.insertChunks(meetingId, meeting.ownerId, batch, vectors);
        inserted += batch.length;
      }

      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { embeddingsStatus: 'ready' },
      });
      this.metrics?.addEmbeddingChunks({ status: 'success', count: inserted });
      this.logger.log({ meetingId, chunks: inserted }, 'indexMeeting: успешно проиндексировано');
      return { chunksIndexed: inserted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.metrics?.addEmbeddingChunks({ status: 'failed', count: 1 });
      try {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { embeddingsStatus: 'failed' },
        });
      } catch (e) {
        this.logger.warn(
          `indexMeeting: не удалось выставить failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      this.logger.warn({ meetingId, err: message }, 'indexMeeting: упал');
      throw err;
    }
  }

  chunkTurns(
    turns: MergedTranscriptTurn[],
    opts: { targetTokens: number; overlapTokens: number },
  ): TranscriptChunk[] {
    if (turns.length === 0) return [];
    type Token = { word: string; speaker: string; startSec: number; endSec: number };
    const tokens: Token[] = [];
    for (const turn of turns) {
      const words = (turn.text ?? '').split(/\s+/u).filter(Boolean);
      if (words.length === 0) continue;
      const span = Math.max(0, turn.endSec - turn.startSec);
      for (let i = 0; i < words.length; i++) {
        const word = words[i] as string;
        const ratio = words.length === 1 ? 0 : i / (words.length - 1);
        const wordTime = turn.startSec + ratio * span;
        tokens.push({
          word,
          speaker: turn.speaker,
          startSec: wordTime,
          endSec: wordTime,
        });
      }
    }
    if (tokens.length === 0) return [];

    const chunks: TranscriptChunk[] = [];
    const target = Math.max(1, opts.targetTokens);
    const overlap = Math.max(0, Math.min(opts.overlapTokens, target - 1));
    let i = 0;
    while (i < tokens.length) {
      const slice = tokens.slice(i, i + target);
      if (slice.length === 0) break;
      const text = this.formatChunk(slice);
      const startMs = Math.max(0, Math.round((slice[0]?.startSec ?? 0) * 1000));
      const endMs = Math.max(startMs, Math.round((slice[slice.length - 1]?.endSec ?? 0) * 1000));
      chunks.push({ text, startMs, endMs });
      if (i + target >= tokens.length) break;
      i += target - overlap;
    }
    return chunks;
  }

  private formatChunk(tokens: Array<{ word: string; speaker: string }>): string {
    const parts: string[] = [];
    let currentSpeaker: string | null = null;
    let buffer: string[] = [];
    const flush = (): void => {
      if (currentSpeaker !== null && buffer.length > 0) {
        parts.push(`${currentSpeaker}: ${buffer.join(' ')}`);
      }
    };
    for (const t of tokens) {
      if (t.speaker !== currentSpeaker) {
        flush();
        currentSpeaker = t.speaker;
        buffer = [t.word];
      } else {
        buffer.push(t.word);
      }
    }
    flush();
    return parts.join('\n');
  }

  private async insertChunks(
    meetingId: string,
    userId: string,
    chunks: TranscriptChunk[],
    vectors: number[][],
  ): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] as TranscriptChunk;
      const vector = vectors[i] as number[];
      const id = makeChunkId();
      const vectorLiteral = formatVectorLiteral(vector);
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "MeetingTranscriptChunk"
           (id, "meetingId", "userId", "startMs", "endMs", text, embedding, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector, NOW())
         ON CONFLICT ("meetingId", "startMs", "endMs") DO UPDATE
         SET text = EXCLUDED.text,
             embedding = EXCLUDED.embedding`,
        id,
        meetingId,
        userId,
        chunk.startMs,
        chunk.endMs,
        chunk.text,
        vectorLiteral,
      );
    }
  }
}

export function formatVectorLiteral(vector: number[]): string {
  const parts: string[] = [];
  for (const v of vector) {
    if (!Number.isFinite(v)) {
      throw new Error(`formatVectorLiteral: нечисловое значение ${v}`);
    }
    parts.push(String(v));
  }
  return `[${parts.join(',')}]`;
}

function makeChunkId(): string {
  const rand = Math.random().toString(36).slice(2);
  const ts = Date.now().toString(36);
  return `c${ts}${rand}${Math.random().toString(36).slice(2, 8)}`;
}
