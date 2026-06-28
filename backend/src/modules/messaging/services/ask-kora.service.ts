import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ChatV2OrchestrationService } from '../../chat-v2/chat-v2.service';

interface AskArgs {
  tenantId: string;
  userId: string;
  conversationId: string;
  question: string;
}

interface AskResult {
  answer: string;
  citations: unknown[];
  sourceMessageIds: string[];
}

@Injectable()
export class AskKoraService {
  private readonly logger = new Logger(AskKoraService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ChatV2OrchestrationService)
    private readonly chatV2: ChatV2OrchestrationService,
  ) {}

  async ask(args: AskArgs): Promise<AskResult> {
    if (!this.cfg.knowledgeCore.chatV2Enabled) {
      throw new ServiceUnavailableException({
        ok: false,
        error: { code: 'CHAT_V2_DISABLED', message: 'AI-чат Коры отключён' },
      });
    }

    const member = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId: args.conversationId, userId: args.userId },
      },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Вы не участник этого разговора' },
      });
    }

    const answer = await this.chatV2.askEphemeral({
      tenantId: args.tenantId,
      userId: args.userId,
      question: args.question,
      history: [],
      scope: 'org',
    });

    const sourceMessageIds = await this.resolveSourceMessageIds(
      args.tenantId,
      answer.usedBlockIds,
    );

    return {
      answer: answer.text,
      citations: answer.citations,
      sourceMessageIds,
    };
  }

  private async resolveSourceMessageIds(
    tenantId: string,
    usedBlockIds: string[],
  ): Promise<string[]> {
    const blockIds = Array.from(new Set(usedBlockIds)).filter((id) => id.length > 0);
    if (blockIds.length === 0) return [];

    try {
      const rows = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          tenantId,
          blockId: { in: blockIds },
          rawEvent: { sourceExternalId: { startsWith: 'msg:' } },
        },
        select: { rawEvent: { select: { sourceExternalId: true } } },
      });

      const messageIds = new Set<string>();
      for (const row of rows) {
        const ext = row.rawEvent?.sourceExternalId;
        if (ext && ext.startsWith('msg:')) {
          const messageId = ext.slice('msg:'.length);
          if (messageId.length > 0) messageIds.add(messageId);
        }
      }
      return Array.from(messageIds);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'ask-kora: резолв sourceMessageIds упал — best-effort пустой массив',
      );
      return [];
    }
  }
}
