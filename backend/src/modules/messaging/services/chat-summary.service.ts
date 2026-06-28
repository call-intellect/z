import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  CHAT_SUMMARY_SYSTEM_PROMPT,
  buildChatSummaryUserPrompt,
} from '../prompts/chat-summary.prompt';

interface SummarizeUnreadArgs {
  conversationId: string;
  userId: string;
}

interface SummarizeUnreadResult {
  summary: string;
  fromSeq: string;
  toSeq: string;
  messageCount: number;
}

interface SummarizeUnreadSkipped {
  skipped: 'too_few';
}

const SUMMARY_MAX_MESSAGES = 200;
const SUMMARY_MAX_TOKENS = 1200;

@Injectable()
export class ChatSummaryService {
  private readonly logger = new Logger(ChatSummaryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async summarizeUnread(
    args: SummarizeUnreadArgs,
  ): Promise<SummarizeUnreadResult | SummarizeUnreadSkipped> {
    const { conversationId, userId } = args;

    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadSeq: true },
    });
    if (!member) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Вы не участник этого разговора' },
      });
    }

    const minMessages = await this.cfg.getDynamic<number>(
      'chat_summary_min_messages',
      undefined,
      5,
    );

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        authorType: { not: 'system' },
        seq: { gt: member.lastReadSeq },
      },
      orderBy: { seq: 'asc' },
      take: SUMMARY_MAX_MESSAGES,
      select: {
        id: true,
        seq: true,
        authorUserId: true,
        content: true,
        voiceTranscript: true,
      },
    });

    if (rows.length < minMessages) {
      return { skipped: 'too_few' };
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { title: true, tenantId: true },
    });
    const conversationTitle = conversation?.title ?? 'Разговор';

    const authorNames = await this.resolveAuthorNames(rows.map((r) => r.authorUserId));

    const messages = rows.map((r) => ({
      id: r.id,
      author: authorNames.get(r.authorUserId) ?? 'Участник',
      text: this.resolveText(r.content, r.voiceTranscript),
    }));

    const userMessage = buildChatSummaryUserPrompt({ conversationTitle, messages });

    const result = await this.llm.call({
      taskType: 'chat-summary',
      tenantId: conversation?.tenantId ?? null,
      userId,
      systemPrompt: CHAT_SUMMARY_SYSTEM_PROMPT,
      userMessage,
      maxTokens: SUMMARY_MAX_TOKENS,
      dataClass: 'internal',
    });

    return {
      summary: result.text.trim(),
      fromSeq: (member.lastReadSeq + 1n).toString(),
      toSeq: rows[rows.length - 1]!.seq.toString(),
      messageCount: rows.length,
    };
  }

  private resolveText(content: string, voiceTranscript: string | null): string {
    const body = this.crypto.decrypt(content).trim();
    if (body.length > 0) return body;
    return (voiceTranscript ?? '').trim();
  }

  private async resolveAuthorNames(userIds: string[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(userIds));
    if (unique.length === 0) return new Map();
    const persons = await this.prisma.person.findMany({
      where: { userId: { in: unique } },
      select: { userId: true, name: true },
    });
    const map = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) map.set(p.userId, p.name);
    }
    return map;
  }
}
