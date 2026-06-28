import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { GetMessagesResult, MessageAccess, MessageDto, SendMessageResult } from '../dto/message.dto';
import { MessageOutboxQueueService } from '../queue/message-outbox.queue.service';

interface SendMessageArgs {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  clientMessageId: string;
  parentMessageId?: string | null;
  access?: MessageAccess;
  authorType?: string;
  voice?: { url: string; duration?: number; transcript?: string } | null;
  attachments?: unknown;
  mentions?: string[];
}

interface GetMessagesArgs {
  conversationId: string;
  sinceSeq?: bigint | string | null;
  limit?: number;
}

type MessageRow = Prisma.MessageGetPayload<Record<string, never>>;

const DEFAULT_GET_LIMIT = 50;
const MAX_GET_LIMIT = 200;

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MessageOutboxQueueService) private readonly outboxQueue: MessageOutboxQueueService,
  ) {}

  async sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
    if (!this.cfg.chat.enabled) {
      throw new ServiceUnavailableException({ code: 'CHAT_DISABLED', message: 'Чат отключён' });
    }

    const { tenantId, conversationId, authorUserId, content, clientMessageId } = args;

    const existing = await this.prisma.message.findUnique({
      where: { conversationId_clientMessageId: { conversationId, clientMessageId } },
    });
    if (existing) {
      return { message: this.toDto(existing), deduped: true };
    }

    const encrypted = this.crypto.encrypt(content);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;

        const agg = await tx.message.aggregate({
          where: { conversationId },
          _max: { seq: true },
        });
        const nextSeq = (agg._max.seq ?? 0n) + 1n;

        const row = await tx.message.create({
          data: {
            tenantId,
            conversationId,
            seq: nextSeq,
            authorUserId,
            authorType: args.authorType ?? 'human',
            access: args.access ?? 'normal',
            content: encrypted,
            clientMessageId,
            parentMessageId: args.parentMessageId ?? null,
            voiceUrl: args.voice?.url ?? null,
            voiceDuration: args.voice?.duration ?? null,
            voiceTranscript: args.voice?.transcript ?? null,
            attachments:
              args.attachments == null
                ? Prisma.JsonNull
                : (args.attachments as Prisma.InputJsonValue),
            mentions: args.mentions ?? [],
          },
        });

        await tx.messageOutbox.create({ data: { messageId: row.id } });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        });

        return row;
      });

      try {
        await this.outboxQueue.enqueue(created.id);
      } catch (err) {
        this.logger.warn(
          { messageId: created.id, err: err instanceof Error ? err.message : String(err) },
          'sendMessage: outbox enqueue не удался (backstop-sweep догонит)',
        );
      }

      return { message: this.toDto(created), deduped: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.message.findUnique({
          where: { conversationId_clientMessageId: { conversationId, clientMessageId } },
        });
        if (raced) {
          return { message: this.toDto(raced), deduped: true };
        }
      }
      throw err;
    }
  }

  async getMessages(args: GetMessagesArgs): Promise<GetMessagesResult> {
    const { conversationId } = args;
    const sinceSeq = args.sinceSeq == null ? null : BigInt(args.sinceSeq);
    const limit = Math.min(Math.max(args.limit ?? DEFAULT_GET_LIMIT, 1), MAX_GET_LIMIT);

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        ...(sinceSeq == null ? {} : { seq: { gt: sinceSeq } }),
      },
      orderBy: { seq: 'asc' },
      take: limit,
    });

    const items = rows.map((row) => this.toDto(row));
    const nextSeq = rows.length > 0 ? rows[rows.length - 1]!.seq.toString() : null;
    return { items, nextSeq };
  }

  private toDto(row: MessageRow): MessageDto {
    return {
      id: row.id,
      conversationId: row.conversationId,
      seq: row.seq.toString(),
      authorUserId: row.authorUserId,
      authorType: row.authorType,
      access: row.access,
      content: this.crypto.decrypt(row.content),
      parentMessageId: row.parentMessageId,
      voiceUrl: row.voiceUrl,
      voiceDuration: row.voiceDuration,
      mentions: row.mentions,
      reactions: row.reactions,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    };
  }
}
