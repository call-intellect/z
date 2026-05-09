import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { MeetingChatMessage } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LlmRouterService } from '../ai/services/llm-router.service';
import { CardsService } from '../cards/cards.service';
import { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';
import { QuotaService } from '../quotas/quota.service';

import { ChatRepository } from './chat.repository';
import {
  buildCrossMeetingContext,
  type CrossMeetingChunk,
} from './context-builder/cross-meeting-context';
import { buildSingleMeetingContext } from './context-builder/single-meeting-context';

interface AnswerCitation {
  meetingId: string;
  meetingTitle: string;
  startMs: number;
  endMs: number;
  snippet: string;
}

export interface ChatAnswer {
  message: string;
  citations: AnswerCitation[];
  modelUsed: string;
}

const TIMESTAMP_REGEX = /\[(\d{1,2}):(\d{2})\]/gu;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatRepository) private readonly repo: ChatRepository,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(EmbeddingFallbackService) private readonly embeddings: EmbeddingFallbackService,
    @Inject(QuotaService) private readonly quota: QuotaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CardsService) private readonly cards: CardsService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async askSingleMeeting(input: {
    meetingId: string;
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);
    await this.quota.checkAndIncrement({
      userId: input.userId,
      quotaName: 'chat_requests_per_day',
      max: this.cfg.workspace.maxChatRequestsPerDay,
      windowMs: 24 * 3600 * 1000,
    });

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: {
        id: true,
        title: true,
        type: true,
        ownerId: true,
        startedAt: true,
        deletedAt: true,
      },
    });
    if (!meeting || meeting.deletedAt !== null || meeting.ownerId !== input.userId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }

    const [aiResult, chapters, tasks, chunks, history, fullMeeting] = await Promise.all([
      this.prisma.aiResult.findUnique({ where: { meetingId: meeting.id } }),
      this.prisma.meetingChapter.findMany({
        where: { meetingId: meeting.id },
        orderBy: { startMs: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { meetingId: meeting.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.meetingTranscriptChunk.findMany({
        where: { meetingId: meeting.id },
        orderBy: { startMs: 'asc' },
      }),
      this.repo.listMeetingHistory({
        userId: input.userId,
        meetingId: meeting.id,
        limit: 20,
      }),
      this.prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } }),
    ]);

    // Сохраняем user message ДО llm-вызова — на случай падения видим что юзер спросил.
    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: meeting.id,
      role: 'user',
      content: input.message,
    });

    const ctx = buildSingleMeetingContext({
      meeting: fullMeeting,
      aiResult,
      chapters,
      tasks,
      chunks,
      history,
      question: input.message,
    });

    const result = await this.llm.call({
      taskType: 'chat',
      systemPrompt: ctx.systemPrompt,
      userMessage: ctx.userMessage,
      meetingId: meeting.id,
      userId: input.userId,
    });

    const citations = parseCitations(result.text, ctx.contextChunks);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: meeting.id,
      role: 'assistant',
      content: result.text,
      citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'single' });

    return { message: result.text, citations, modelUsed: result.modelUsed };
  }

  async askCrossMeeting(input: {
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);
    await this.quota.checkAndIncrement({
      userId: input.userId,
      quotaName: 'chat_requests_per_day',
      max: this.cfg.workspace.maxChatRequestsPerDay,
      windowMs: 24 * 3600 * 1000,
    });

    // Embedding запроса.
    const [embedding] = await this.embeddings.embed([input.message]);
    if (!embedding) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'embedding_failed', message: 'Не удалось построить embedding запроса' },
      });
    }

    const chunks = await this.searchSimilarChunks(input.userId, embedding, 10);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      role: 'user',
      content: input.message,
    });

    const ctx = buildCrossMeetingContext({ chunks, question: input.message });
    const result = await this.llm.call({
      taskType: 'chat',
      systemPrompt: ctx.systemPrompt,
      userMessage: ctx.userMessage,
      userId: input.userId,
    });

    const citations = parseCitations(result.text, ctx.contextChunks);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      role: 'assistant',
      content: result.text,
      citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'cross' });

    return { message: result.text, citations, modelUsed: result.modelUsed };
  }

  async getMeetingHistory(
    userId: string,
    meetingId: string,
  ): Promise<MeetingChatMessage[]> {
    return this.repo.listMeetingHistory({ userId, meetingId });
  }

  async getCrossHistory(userId: string): Promise<MeetingChatMessage[]> {
    return this.repo.listCrossHistory({ userId });
  }

  async getCardHistory(
    userId: string,
    cardId: string,
  ): Promise<MeetingChatMessage[]> {
    // Owner-проверка карточки.
    await this.cards.getById(cardId, userId);
    return this.repo.listCardHistory({ userId, cardId });
  }

  /**
   * AI-чат по карточке: RAG поверх transcript-chunks встреч карточки.
   * Логика идентична `askCrossMeeting`, но с фильтром по `Meeting.cardId`.
   */
  async askCard(input: {
    cardId: string;
    userId: string;
    message: string;
  }): Promise<ChatAnswer> {
    this.assertMessageLength(input.message);
    // Owner-проверка карточки + 404 если её нет.
    await this.cards.getById(input.cardId, input.userId);

    await this.quota.checkAndIncrement({
      userId: input.userId,
      quotaName: 'chat_requests_per_day',
      max: this.cfg.workspace.maxChatRequestsPerDay,
      windowMs: 24 * 3600 * 1000,
    });

    const [embedding] = await this.embeddings.embed([input.message]);
    if (!embedding) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'embedding_failed', message: 'Не удалось построить embedding запроса' },
      });
    }

    const chunks = await this.searchSimilarChunksByCard(
      input.userId,
      input.cardId,
      embedding,
      16,
    );

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      cardId: input.cardId,
      role: 'user',
      content: input.message,
    });

    const ctx = buildCrossMeetingContext({ chunks, question: input.message });
    const result = await this.llm.call({
      taskType: 'card-chat',
      systemPrompt: ctx.systemPrompt,
      userMessage: ctx.userMessage,
      userId: input.userId,
    });

    const citations = parseCitations(result.text, ctx.contextChunks);

    await this.repo.appendMessage({
      userId: input.userId,
      meetingId: null,
      cardId: input.cardId,
      role: 'assistant',
      content: result.text,
      citations,
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      modelUsed: result.modelUsed,
    });

    this.metrics?.incChatRequest({ scope: 'card' });

    return { message: result.text, citations, modelUsed: result.modelUsed };
  }

  // ─────────────────────────── helpers ──────────────────────────────────

  private assertMessageLength(message: string): void {
    const max = this.cfg.workspace.maxChatMessageChars;
    if (message.length > max) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'message_too_long',
          message: `Длина сообщения превышает ${max} символов`,
        },
      });
    }
  }

  /**
   * pgvector cosine similarity search. `embedding <=> $vec::vector` — это
   * cosine distance (0 = идентично).
   *
   * Используем Prisma raw query, так как `Unsupported("vector(1536)")` не имеет
   * native API.
   */
  private async searchSimilarChunks(
    userId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<CrossMeetingChunk[]> {
    const vec = `[${queryEmbedding.join(',')}]`;
    // ВАЖНО: не интерполировать `vec` напрямую (chunks)/limit (chunks/userId должны быть параметрами).
    // Используем $queryRaw с тегированной template literal. PostgreSQL не позволяет
    // bind для cast `::vector`, поэтому вектор через `$2::vector`.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        meeting_id: string;
        start_ms: number;
        end_ms: number;
        text: string;
        similarity: number;
        title: string;
        type: string;
        started_at: Date | null;
      }>
    >(
      `SELECT
         tc."meetingId" as meeting_id,
         tc."startMs" as start_ms,
         tc."endMs" as end_ms,
         tc.text,
         1 - (tc.embedding <=> $2::vector) as similarity,
         m.title,
         m.type::text,
         m."startedAt" as started_at
       FROM "MeetingTranscriptChunk" tc
       JOIN "Meeting" m ON m.id = tc."meetingId"
       WHERE tc."userId" = $1
         AND m."deletedAt" IS NULL
         AND tc.embedding IS NOT NULL
       ORDER BY tc.embedding <=> $2::vector
       LIMIT $3`,
      userId,
      vec,
      limit,
    );
    return rows.map((r) => ({
      meetingId: r.meeting_id,
      meetingTitle: r.title,
      meetingType: r.type,
      meetingDate: r.started_at,
      startMs: r.start_ms,
      endMs: r.end_ms,
      text: r.text,
      similarity: Number(r.similarity ?? 0),
    }));
  }

  /**
   * Аналогично `searchSimilarChunks`, но дополнительно фильтрует встречи
   * по `Meeting.cardId = $cardId`. Используется для AI-чата по карточке.
   */
  private async searchSimilarChunksByCard(
    userId: string,
    cardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<CrossMeetingChunk[]> {
    const vec = `[${queryEmbedding.join(',')}]`;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        meeting_id: string;
        start_ms: number;
        end_ms: number;
        text: string;
        similarity: number;
        title: string;
        type: string;
        started_at: Date | null;
      }>
    >(
      `SELECT
         tc."meetingId" as meeting_id,
         tc."startMs" as start_ms,
         tc."endMs" as end_ms,
         tc.text,
         1 - (tc.embedding <=> $2::vector) as similarity,
         m.title,
         m.type::text,
         m."startedAt" as started_at
       FROM "MeetingTranscriptChunk" tc
       JOIN "Meeting" m ON m.id = tc."meetingId"
       WHERE tc."userId" = $1
         AND m."cardId" = $3
         AND m."deletedAt" IS NULL
         AND tc.embedding IS NOT NULL
       ORDER BY tc.embedding <=> $2::vector
       LIMIT $4`,
      userId,
      vec,
      cardId,
      limit,
    );
    return rows.map((r) => ({
      meetingId: r.meeting_id,
      meetingTitle: r.title,
      meetingType: r.type,
      meetingDate: r.started_at,
      startMs: r.start_ms,
      endMs: r.end_ms,
      text: r.text,
      similarity: Number(r.similarity ?? 0),
    }));
  }
}

/**
 * Парсит [mm:ss] из ответа AI и сопоставляет с ближайшим chunk'ом.
 */
function parseCitations(
  answer: string,
  chunks: Array<{
    startMs: number;
    endMs: number;
    text: string;
    meetingId: string;
    meetingTitle: string;
  }>,
): AnswerCitation[] {
  const citations: AnswerCitation[] = [];
  const seen = new Set<string>();
  for (const match of answer.matchAll(TIMESTAMP_REGEX)) {
    const m = Number(match[1]);
    const s = Number(match[2]);
    const ms = (m * 60 + s) * 1000;
    // Ищем ближайший chunk.
    let best: (typeof chunks)[number] | null = null;
    let bestDist = Infinity;
    for (const c of chunks) {
      const d = ms < c.startMs ? c.startMs - ms : ms > c.endMs ? ms - c.endMs : 0;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) {
      const key = `${best.meetingId}:${best.startMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        meetingId: best.meetingId,
        meetingTitle: best.meetingTitle,
        startMs: best.startMs,
        endMs: best.endMs,
        snippet: best.text.slice(0, 200),
      });
    }
  }
  return citations;
}
