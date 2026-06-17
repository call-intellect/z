import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';

@Injectable()
export class ConciergeConversationSummarizerCron {
  private readonly logger = new Logger(ConciergeConversationSummarizerCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  @Cron('*/30 * * * *', { name: 'concierge-conversation-summarizer' })
  async run(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let processed = 0;
    let errors = 0;
    try {
      const candidates = await this.prisma.conciergeConversation.findMany({
        where: {
          summary: null,
          archivedAt: null,
          lastMessageAt: { lt: oneHourAgo },
        },
        orderBy: { lastMessageAt: 'asc' },
        take: 50,
      });

      for (const conv of candidates) {
        const msgs = await this.prisma.conciergeMessage.findMany({
          where: { conversationId: conv.id },
          orderBy: { createdAt: 'asc' },
        });
        if (msgs.length < 20) continue;

        const flat = msgs.map((m) => `[${m.role}] ${m.content.slice(0, 400)}`).join('\n');

        try {
          const out = await this.llm.call({
            taskType: 'concierge-respond',
            systemPrompt:
              'Сожми диалог пользователя с Concierge-агентом в 2-3 предложения по-русски. ' +
              'Сохрани ключевые сущности (имена встреч/задач/проектов) и принятые решения.',
            userMessage: flat,
            tenantId: conv.tenantId,
            userId: conv.userId,
            maxTokens: 200,
          });
          await this.prisma.conciergeConversation.update({
            where: { id: conv.id },
            data: { summary: out.text.trim().slice(0, 2000) },
          });
          processed++;
        } catch (err) {
          errors++;
          this.logger.warn(
            { convId: conv.id, err: err instanceof Error ? err.message : String(err) },
            'summarize: LLM failed',
          );
        }
      }
    } catch (err) {
      this.logger.error(`cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (processed > 0 || errors > 0) {
      this.logger.debug(`concierge-summarizer: processed=${processed} errors=${errors}`);
    }
  }
}
