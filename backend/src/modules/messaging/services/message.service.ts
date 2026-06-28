import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { GetMessagesResult, MessageAccess, MessageDto, SendMessageResult } from '../dto/message.dto';
import { MessageOutboxQueueService } from '../queue/message-outbox.queue.service';
import { VoiceTranscribeQueueService } from '../queue/voice-transcribe.queue.service';

import { stripToPlain } from './strip-to-plain';
import { UserBlockService } from './user-block.service';

interface SendMessageArgs {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  contentHtml?: string | null;
  contentStripped?: string | null;
  clientMessageId: string;
  parentMessageId?: string | null;
  access?: MessageAccess | string;
  authorType?: string;
  voice?: { url?: string | null; duration?: number | null; transcript?: string | null } | null;
  attachments?: unknown;
  mentions?: string[];
}

interface InsertHistoricalArgs {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  contentHtml?: string | null;
  contentStripped?: string | null;
  access?: MessageAccess | string;
  authorType?: string;
  parentMessageId?: string | null;
  voice?: { url?: string | null; duration?: number | null; transcript?: string | null } | null;
  attachments?: unknown;
  mentions?: string[];
  thanksUserIds?: string[];
  draftState?: string | null;
  cloneConfidence?: number | string | null;
  groundednessScore?: number | string | null;
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  clientMessageId: string;
}

interface InsertMessageRowArgs {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  contentHtml?: string | null;
  contentStripped?: string | null;
  access?: MessageAccess | string;
  authorType?: string;
  parentMessageId?: string | null;
  voice?: { url?: string | null; duration?: number | null; transcript?: string | null } | null;
  attachments?: unknown;
  mentions?: string[];
  thanksUserIds?: string[];
  draftState?: string | null;
  cloneConfidence?: number | string | null;
  groundednessScore?: number | string | null;
  clientMessageId: string;
  createdAt?: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
}

interface AppendTicketMessageArgs {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  access: 'external' | 'internal';
  authorType?: string;
  draftState?: string | null;
  cloneConfidence?: number | string | null;
  groundednessScore?: number | string | null;
  emitOutbox?: boolean;
}

interface AppendTicketMessageResult {
  messageId: string;
  seq: string;
}

interface AppendSystemMessageArgs {
  tenantId: string;
  conversationId: string;
  authorUserId: string;
  content: string;
  access?: MessageAccess | string;
  clientMessageId?: string;
}

interface AppendSystemMessageResult {
  messageId: string;
  seq: string;
  deduped: boolean;
}

interface DraftMessageView {
  id: string;
  conversationId: string;
  tenantId: string;
  authorType: string;
  draftState: string | null;
  content: string;
  cloneConfidence: string | null;
  groundednessScore: string | null;
}

interface EditMessageArgs {
  messageId: string;
  userId: string;
  content: string;
  contentHtml?: string | null;
}

interface SoftDeleteMessageArgs {
  messageId: string;
  userId: string;
}

interface InsertHistoricalResult {
  messageId: string;
  deduped: boolean;
}

interface GetMessagesArgs {
  conversationId: string;
  sinceSeq?: bigint | string | null;
  limit?: number;
}

interface ToggleReactionArgs {
  conversationId: string;
  messageId: string;
  userId: string;
  emoji: string;
}

type ReactionMap = Record<string, string[]>;

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
    @Inject(VoiceTranscribeQueueService)
    private readonly voiceTranscribeQueue: VoiceTranscribeQueueService,
    @Inject(UserBlockService) private readonly blocks: UserBlockService,
  ) {}

  async sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
    if (!this.cfg.chat.enabled) {
      throw new ServiceUnavailableException({ code: 'CHAT_DISABLED', message: 'Чат отключён' });
    }

    const { tenantId, conversationId, authorUserId, content, clientMessageId } = args;

    if (args.authorType !== 'system') {
      await this.assertNotBlocked({ tenantId, conversationId, authorUserId });
    }

    const existing = await this.prisma.message.findUnique({
      where: { conversationId_clientMessageId: { conversationId, clientMessageId } },
    });
    if (existing) {
      return { message: this.toDto(existing), deduped: true };
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await this.insertMessageRow(tx, {
          tenantId,
          conversationId,
          authorUserId,
          content,
          contentHtml: args.contentHtml ?? null,
          contentStripped: args.contentStripped ?? null,
          access: args.access,
          authorType: args.authorType,
          parentMessageId: args.parentMessageId ?? null,
          voice: args.voice ?? null,
          attachments: args.attachments,
          mentions: args.mentions ?? [],
          clientMessageId,
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

      await this.maybeEnqueueVoiceTranscribe(created);

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

  private async assertNotBlocked(args: {
    tenantId: string;
    conversationId: string;
    authorUserId: string;
  }): Promise<void> {
    const blocked = await this.blocks.isSendBlockedInConversation(args);
    if (blocked) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'BLOCKED_BY_RECIPIENT', message: 'Получатель ограничил переписку с вами' },
      });
    }
  }

  async appendTicketMessage(args: AppendTicketMessageArgs): Promise<AppendTicketMessageResult> {
    const emitOutbox = args.emitOutbox !== false;
    const clientMessageId = `tkt:${nanoid()}`;

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await this.insertMessageRow(tx, {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        authorUserId: args.authorUserId,
        content: args.content,
        access: args.access,
        authorType: args.authorType ?? 'human',
        draftState: args.draftState ?? null,
        cloneConfidence: args.cloneConfidence ?? null,
        groundednessScore: args.groundednessScore ?? null,
        clientMessageId,
        createdAt: new Date(),
      });

      if (emitOutbox) {
        await tx.messageOutbox.create({ data: { messageId: row.id } });
      }
      await tx.conversation.update({
        where: { id: args.conversationId },
        data: { lastMessageAt: new Date() },
      });

      return row;
    });

    if (emitOutbox) {
      try {
        await this.outboxQueue.enqueue(created.id);
      } catch (err) {
        this.logger.warn(
          { messageId: created.id, err: err instanceof Error ? err.message : String(err) },
          'appendTicketMessage: outbox enqueue не удался (backstop-sweep догонит)',
        );
      }
    }

    return { messageId: created.id, seq: created.seq.toString() };
  }

  async appendSystemMessage(args: AppendSystemMessageArgs): Promise<AppendSystemMessageResult> {
    const clientMessageId = args.clientMessageId ?? `sys:${nanoid()}`;

    const existing = await this.prisma.message.findUnique({
      where: {
        conversationId_clientMessageId: { conversationId: args.conversationId, clientMessageId },
      },
    });
    if (existing) {
      return { messageId: existing.id, seq: existing.seq.toString(), deduped: true };
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await this.insertMessageRow(tx, {
          tenantId: args.tenantId,
          conversationId: args.conversationId,
          authorUserId: args.authorUserId,
          content: args.content,
          access: args.access ?? 'normal',
          authorType: 'system',
          clientMessageId,
          createdAt: new Date(),
        });
        await tx.messageOutbox.create({ data: { messageId: row.id } });
        await tx.conversation.update({
          where: { id: args.conversationId },
          data: { lastMessageAt: new Date() },
        });
        return row;
      });

      try {
        await this.outboxQueue.enqueue(created.id);
      } catch (err) {
        this.logger.warn(
          { messageId: created.id, err: err instanceof Error ? err.message : String(err) },
          'appendSystemMessage: outbox enqueue не удался (backstop-sweep догонит)',
        );
      }

      return { messageId: created.id, seq: created.seq.toString(), deduped: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.message.findUnique({
          where: {
            conversationId_clientMessageId: { conversationId: args.conversationId, clientMessageId },
          },
        });
        if (raced) {
          return { messageId: raced.id, seq: raced.seq.toString(), deduped: true };
        }
      }
      throw err;
    }
  }

  private async maybeEnqueueVoiceTranscribe(row: MessageRow): Promise<void> {
    if (!row.voiceUrl) return;
    if (row.voiceTranscript && row.voiceTranscript.trim().length > 0) return;
    try {
      await this.voiceTranscribeQueue.enqueue(row.id);
    } catch (err) {
      this.logger.warn(
        { messageId: row.id, err: err instanceof Error ? err.message : String(err) },
        'maybeEnqueueVoiceTranscribe: enqueue не удался',
      );
    }
  }

  async setDraftState(args: { messageId: string; draftState: string }): Promise<void> {
    await this.prisma.message.update({
      where: { id: args.messageId },
      data: { draftState: args.draftState },
    });
  }

  async getLastExternalQuestion(conversationId: string): Promise<string | null> {
    const row = await this.prisma.message.findFirst({
      where: {
        conversationId,
        access: 'external',
        authorType: { not: 'clone' },
        deletedAt: null,
      },
      orderBy: { seq: 'desc' },
      select: { content: true },
    });
    if (!row) return null;
    const text = this.crypto.decrypt(row.content).trim();
    return text.length > 0 ? text : null;
  }

  async getDraftMessage(messageId: string): Promise<DraftMessageView | null> {
    const row = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        tenantId: true,
        authorType: true,
        draftState: true,
        content: true,
        cloneConfidence: true,
        groundednessScore: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      tenantId: row.tenantId,
      authorType: row.authorType,
      draftState: row.draftState,
      content: this.crypto.decrypt(row.content),
      cloneConfidence: row.cloneConfidence ? row.cloneConfidence.toString() : null,
      groundednessScore: row.groundednessScore ? row.groundednessScore.toString() : null,
    };
  }

  private async insertMessageRow(
    tx: Prisma.TransactionClient,
    args: InsertMessageRowArgs,
  ): Promise<MessageRow> {
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${args.conversationId} FOR UPDATE`;

    const agg = await tx.message.aggregate({
      where: { conversationId: args.conversationId },
      _max: { seq: true },
    });
    const nextSeq = (agg._max.seq ?? 0n) + 1n;

    const encrypted = this.crypto.encrypt(args.content);
    const stripped = stripToPlain(args.contentStripped ?? args.content);

    return tx.message.create({
      data: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        seq: nextSeq,
        authorUserId: args.authorUserId,
        authorType: args.authorType ?? 'human',
        access: args.access ?? 'normal',
        content: encrypted,
        contentHtml: args.contentHtml ?? null,
        contentStripped: stripped.length > 0 ? stripped : null,
        clientMessageId: args.clientMessageId,
        parentMessageId: args.parentMessageId ?? null,
        voiceUrl: args.voice?.url ?? null,
        voiceDuration: args.voice?.duration ?? null,
        voiceTranscript: args.voice?.transcript ?? null,
        attachments:
          args.attachments == null
            ? Prisma.JsonNull
            : (args.attachments as Prisma.InputJsonValue),
        mentions: args.mentions ?? [],
        thanksUserIds: args.thanksUserIds ?? [],
        draftState: args.draftState ?? null,
        cloneConfidence: args.cloneConfidence ?? null,
        groundednessScore: args.groundednessScore ?? null,
        ...(args.createdAt ? { createdAt: args.createdAt } : {}),
        ...(args.editedAt !== undefined ? { editedAt: args.editedAt } : {}),
        ...(args.deletedAt !== undefined ? { deletedAt: args.deletedAt } : {}),
      },
    });
  }

  async insertHistorical(args: InsertHistoricalArgs): Promise<InsertHistoricalResult> {
    const existing = await this.prisma.message.findUnique({
      where: {
        conversationId_clientMessageId: {
          conversationId: args.conversationId,
          clientMessageId: args.clientMessageId,
        },
      },
    });
    if (existing) {
      return { messageId: existing.id, deduped: true };
    }

    try {
      const created = await this.prisma.$transaction((tx) =>
        this.insertMessageRow(tx, {
          tenantId: args.tenantId,
          conversationId: args.conversationId,
          authorUserId: args.authorUserId,
          content: args.content,
          contentHtml: args.contentHtml ?? null,
          contentStripped: args.contentStripped ?? null,
          access: args.access,
          authorType: args.authorType,
          parentMessageId: args.parentMessageId ?? null,
          voice: args.voice ?? null,
          attachments: args.attachments,
          mentions: args.mentions ?? [],
          thanksUserIds: args.thanksUserIds ?? [],
          draftState: args.draftState ?? null,
          cloneConfidence: args.cloneConfidence ?? null,
          groundednessScore: args.groundednessScore ?? null,
          clientMessageId: args.clientMessageId,
          createdAt: args.createdAt,
          editedAt: args.editedAt ?? null,
          deletedAt: args.deletedAt ?? null,
        }),
      );
      return { messageId: created.id, deduped: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.message.findUnique({
          where: {
            conversationId_clientMessageId: {
              conversationId: args.conversationId,
              clientMessageId: args.clientMessageId,
            },
          },
        });
        if (raced) {
          return { messageId: raced.id, deduped: true };
        }
      }
      throw err;
    }
  }

  async editMessage(args: EditMessageArgs): Promise<void> {
    const row = await this.prisma.message.findUnique({
      where: { id: args.messageId },
      select: { authorUserId: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Сообщение не найдено' });
    }
    if (row.authorUserId !== args.userId) {
      throw new ForbiddenException({
        code: 'MESSAGE_NOT_AUTHOR',
        message: 'Редактировать может только автор',
      });
    }
    await this.prisma.message.update({
      where: { id: args.messageId },
      data: {
        content: this.crypto.encrypt(args.content),
        contentHtml: args.contentHtml ?? null,
        editedAt: new Date(),
      },
    });
  }

  async softDeleteMessage(args: SoftDeleteMessageArgs): Promise<void> {
    const row = await this.prisma.message.findUnique({
      where: { id: args.messageId },
      select: { authorUserId: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Сообщение не найдено' });
    }
    if (row.authorUserId !== args.userId) {
      throw new ForbiddenException({
        code: 'MESSAGE_NOT_AUTHOR',
        message: 'Удалить может только автор',
      });
    }
    await this.prisma.message.update({
      where: { id: args.messageId },
      data: { deletedAt: new Date() },
    });
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

  async toggleReaction(args: ToggleReactionArgs): Promise<{ reactions: ReactionMap }> {
    const { conversationId, messageId, userId, emoji } = args;

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; reactions: ReactionMap | null }>>`
        SELECT id, reactions FROM "Message"
        WHERE id = ${messageId} AND "conversationId" = ${conversationId}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current) {
        throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Сообщение не найдено' });
      }

      const reactions: ReactionMap = { ...(current.reactions ?? {}) };
      const users = reactions[emoji] ?? [];
      const next = users.includes(userId)
        ? users.filter((u) => u !== userId)
        : [...users, userId];

      if (next.length === 0) {
        delete reactions[emoji];
      } else {
        reactions[emoji] = next;
      }

      await tx.message.update({
        where: { id: messageId },
        data: {
          reactions:
            Object.keys(reactions).length === 0
              ? Prisma.JsonNull
              : (reactions as Prisma.InputJsonValue),
        },
      });

      return { reactions };
    });
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
