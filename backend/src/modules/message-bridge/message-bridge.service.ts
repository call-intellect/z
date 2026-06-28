import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass, RawEvent } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IngestService } from '../ingest/ingest.service';

export interface ChatMessageBridgeInput {
  tenantId: string;
  channel: 'bitrix' | 'telegram_export' | string;
  threadExternalId: string;
  threadTitle?: string | null;
  messageExternalId: string;
  externalAuthorId?: string | null;
  authorName?: string | null;
  text: string;
  occurredAt: Date;
  metadata?: Record<string, unknown> | null;
  dataClass?: DataClass;
}

export type ChatMessageBridgeResult =
  | { rawEvent: RawEvent; idempotent: boolean }
  | { skipped: true };

const CHAT_SOURCE_TYPE = 'chat' as const;
const CHAT_SOURCE_NAME = 'Внешние чаты (мост)' as const;

@Injectable()
export class MessageBridgeService {
  private readonly logger = new Logger(MessageBridgeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async ingestChatMessage(args: ChatMessageBridgeInput): Promise<ChatMessageBridgeResult> {
    if (!this.cfg.knowledgeCore.messageBridgeEnabled) {
      this.logger.debug('message-bridge: MESSAGE_BRIDGE_ENABLED=false — skip');
      return { skipped: true };
    }
    const text = args.text.trim();
    if (text.length === 0) {
      return { skipped: true };
    }

    const source = await this.ensureChatSource(args.tenantId);
    const sourceExternalId = `${args.channel}:${args.threadExternalId}:${args.messageExternalId}`;

    const payload = {
      kind: 'chat_message' as const,
      channel: args.channel,
      threadExternalId: args.threadExternalId,
      threadTitle: args.threadTitle ?? null,
      externalAuthorId: args.externalAuthorId ?? null,
      authorName: args.authorName ?? null,
      text,
      ...(args.metadata ? { metadata: args.metadata } : {}),
    };

    const result = await this.ingest.ingest({
      tenantId: args.tenantId,
      sourceId: source.id,
      sourceExternalId,
      sourceTitle: args.threadTitle ?? null,
      occurredAt: args.occurredAt,
      payload,
      dataClass: args.dataClass ?? 'sensitive',
    });

    this.logger.debug(
      `ingestChatMessage tenantId=${args.tenantId} channel=${args.channel} sourceExternalId=${sourceExternalId} rawEventId=${result.rawEvent.id} idempotent=${result.idempotent}`,
    );
    return result;
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
        dataClass: 'sensitive',
        isActive: true,
        config: {},
      },
      select: { id: true },
    });
  }
}
