import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { TrackerGateway } from '../../tracker/gateways/tracker.gateway';
import { PresenceService } from '../services/presence.service';

import { MESSAGE_OUTBOX_QUEUE, type MessageOutboxJobData } from './message-outbox.queue';
import { MessageOutboxQueueService } from './message-outbox.queue.service';

const SWEEP_STALE_SECONDS_KEY = 'chat_outbox_sweep_stale_seconds';
const SWEEP_BATCH_LIMIT_KEY = 'chat_outbox_sweep_batch_limit';
const SWEEP_STALE_SECONDS_DEFAULT = 30;
const SWEEP_BATCH_LIMIT_DEFAULT = 200;

interface PendingOutboxRow {
  messageId: string;
}

export function assertNoExternalBody(payload: Record<string, unknown>): void {
  const forbidden = ['content', 'authorName', 'authorUserId', 'text', 'body', 'displayName'];
  for (const key of forbidden) {
    if (key in payload) {
      throw new Error(
        `assertNoExternalBody: ключ "${key}" запрещён во внешнем канале (ФЗ-41)`,
      );
    }
  }
}

@Injectable()
export class MessageOutboxRelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageOutboxRelayWorker.name);
  private worker: Worker<MessageOutboxJobData> | null = null;
  private sweeping = false;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TrackerGateway) private readonly gateway: TrackerGateway,
    @Inject(ConversationalService) private readonly conversational: ConversationalService,
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(MessageOutboxQueueService) private readonly queue: MessageOutboxQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MessageOutboxJobData>(
      MESSAGE_OUTBOX_QUEUE,
      async (job) => this.relay(job.data.messageId),
      { connection: this.redis.client, concurrency: 8 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, messageId: job?.data.messageId, err: err.message },
        'MessageOutboxRelayWorker: job failed',
      );
    });
    this.logger.log('MessageOutboxRelayWorker запущен');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  async relay(messageId: string): Promise<void> {
    const outbox = await this.prisma.messageOutbox.findUnique({ where: { messageId } });
    if (!outbox) {
      this.logger.debug({ messageId }, 'relay: outbox не найден — skip');
      return;
    }
    if (outbox.status === 'sent') {
      return;
    }

    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      this.logger.warn({ messageId }, 'relay: Message не найден — помечаю sent');
      await this.markSent(messageId);
      return;
    }

    const room = this.gateway.conversationRoom(message.conversationId);
    this.gateway.emitToRooms([room], 'message.new', {
      id: message.id,
      conversationId: message.conversationId,
      seq: message.seq.toString(),
      authorUserId: message.authorUserId,
      authorType: message.authorType,
      access: message.access,
      content: this.crypto.decrypt(message.content),
      parentMessageId: message.parentMessageId,
      voiceUrl: message.voiceUrl,
      voiceDuration: message.voiceDuration,
      mentions: message.mentions,
      reactions: message.reactions,
      createdAt: message.createdAt.toISOString(),
    });

    await this.notifyOffline({
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      authorUserId: message.authorUserId,
    });

    await this.markSent(messageId);
  }

  private async notifyOffline(args: {
    tenantId: string;
    conversationId: string;
    authorUserId: string;
  }): Promise<void> {
    const [members, online] = await Promise.all([
      this.prisma.conversationMember.findMany({
        where: { conversationId: args.conversationId },
        select: { userId: true, mutedUntil: true },
      }),
      this.presence.collect(args.conversationId),
    ]);
    const onlineIds = new Set(online.map((u) => u.userId));
    const now = Date.now();

    const signal: Record<string, unknown> = { conversationId: args.conversationId };
    assertNoExternalBody(signal);

    for (const member of members) {
      if (member.userId === args.authorUserId) continue;
      if (onlineIds.has(member.userId)) continue;
      if (member.mutedUntil && member.mutedUntil.getTime() > now) continue;

      try {
        await this.conversational.sendNotification({
          tenantId: args.tenantId,
          recipientUserId: member.userId,
          eventType: 'chat.new_message',
          payload: signal,
          dataClass: 'internal',
        });
      } catch (err) {
        this.logger.warn(
          {
            conversationId: args.conversationId,
            recipientUserId: member.userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'notifyOffline: sendNotification упал — продолжаю',
        );
      }
    }
  }

  private async markSent(messageId: string): Promise<void> {
    await this.prisma.messageOutbox.update({
      where: { messageId },
      data: { status: 'sent' },
    });
  }

  @Cron('*/30 * * * * *', { name: 'message-outbox-sweep' })
  async sweep(now: Date = new Date()): Promise<{ reenqueued: number }> {
    if (this.sweeping) return { reenqueued: 0 };
    this.sweeping = true;
    try {
      const [staleSeconds, batchLimit] = await Promise.all([
        this.cfg.getDynamic<number>(SWEEP_STALE_SECONDS_KEY, undefined, SWEEP_STALE_SECONDS_DEFAULT),
        this.cfg.getDynamic<number>(SWEEP_BATCH_LIMIT_KEY, undefined, SWEEP_BATCH_LIMIT_DEFAULT),
      ]);
      const staleBefore = new Date(now.getTime() - staleSeconds * 1000);

      const rows = await this.prisma.$queryRaw<PendingOutboxRow[]>`
        SELECT "messageId" FROM "MessageOutbox"
        WHERE status = 'pending' AND "createdAt" < ${staleBefore}
        ORDER BY "createdAt" ASC
        LIMIT ${batchLimit}
        FOR UPDATE SKIP LOCKED
      `;

      let reenqueued = 0;
      for (const row of rows) {
        try {
          await this.queue.enqueue(row.messageId);
          reenqueued++;
        } catch (err) {
          this.logger.warn(
            { messageId: row.messageId, err: err instanceof Error ? err.message : String(err) },
            'sweep: re-enqueue упал — продолжаю',
          );
        }
      }
      if (reenqueued > 0) {
        this.logger.debug({ reenqueued, scanned: rows.length }, 'message-outbox-sweep: проход');
      }
      return { reenqueued };
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'message-outbox-sweep: проход упал',
      );
      return { reenqueued: 0 };
    } finally {
      this.sweeping = false;
    }
  }
}
