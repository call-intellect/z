import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IngestService } from '../../ingest/ingest.service';

const CHAT_SOURCE_TYPE = 'chat' as const;
const CHAT_SOURCE_NAME = 'Сообщения Коры' as const;

@Injectable()
export class ChatIngestService {
  private readonly logger = new Logger(ChatIngestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async ingestMessage(messageId: string): Promise<void> {
    if (!this.cfg.chat.ingestEnabled) {
      this.logger.debug({ messageId }, 'chat-ingest: CHAT_INGEST_ENABLED=false — skip');
      return;
    }

    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) {
      this.logger.debug({ messageId }, 'chat-ingest: Message не найден — skip');
      return;
    }
    if (message.deletedAt) {
      this.logger.debug({ messageId }, 'chat-ingest: Message удалён — skip');
      return;
    }
    if (message.authorType === 'system') {
      return;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
      select: { feedsGraph: true },
    });
    if (!conversation || !conversation.feedsGraph) {
      this.logger.debug({ messageId }, 'chat-ingest: feedsGraph=false — skip');
      return;
    }

    const text = this.resolveText(message.content, message.voiceTranscript);
    if (text.length === 0) {
      this.logger.debug({ messageId }, 'chat-ingest: пустой текст — skip');
      return;
    }

    const source = await this.ensureChatSource(message.tenantId);

    const result = await this.ingest.ingest({
      tenantId: message.tenantId,
      sourceId: source.id,
      sourceExternalId: `msg:${messageId}`,
      occurredAt: message.createdAt,
      payload: {
        kind: 'chat_message' as const,
        text,
        userId: message.authorUserId,
        conversationId: message.conversationId,
        messageId,
      },
      dataClass: 'internal',
    });

    this.logger.debug(
      `chat-ingest messageId=${messageId} rawEventId=${result.rawEvent.id} idempotent=${result.idempotent}`,
    );
  }

  private resolveText(content: string, voiceTranscript: string | null): string {
    const body = this.crypto.decrypt(content).trim();
    if (body.length > 0) return body;
    return (voiceTranscript ?? '').trim();
  }

  private async ensureChatSource(tenantId: string): Promise<{ id: string }> {
    return this.prisma.source.upsert({
      where: {
        tenantId_type_name: {
          tenantId,
          type: CHAT_SOURCE_TYPE,
          name: CHAT_SOURCE_NAME,
        },
      },
      update: {},
      create: {
        tenantId,
        type: CHAT_SOURCE_TYPE,
        name: CHAT_SOURCE_NAME,
        dataClass: 'internal',
        isActive: true,
        config: {},
      },
      select: { id: true },
    });
  }
}
