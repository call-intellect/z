import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleInit,
} from '@nestjs/common';

import { ConversationalService } from '../conversational/conversational.service';
import type { InboundMessage } from '../conversational/types/channel.types';

import { ChatV2Controller } from './chat-v2.controller';
import { ChatV2OrchestrationService } from './chat-v2.service';
import { CardSpecialistRegistry } from './services/card-specialist-registry.service';
import { ChatV2ConversationsService } from './services/conversations.service';
import { SynthesisService } from './services/synthesis.service';
import { ChatV2CleanupCron } from './workers/chat-v2-cleanup.cron';

/**
 * SBA α-5 — ChatV2Module.
 *
 * Зависимости (через @Global):
 *   - PrismaService, TypedConfigService, BusinessMetricsService — глобальные.
 *   - LlmRouterService (AiModule, @Global) — для generateTitle.
 *   - ChatV2Service (KnowledgeCoreModule, @Global) — основной retrieval+LLM.
 *   - ConversationalService (ConversationalModule, @Global) — inbound
 *     `chat_query` подписка + outbound `sendChatReply`.
 *
 * Регистрирует inbound-handler 'chat_query' в onModuleInit — любое
 * сообщение через любой канал, распарсенное как chat_query, превращается в
 * ChatV2OrchestrationService.ask() и ответ уходит обратно через тот же
 * канал (через ConversationalService.sendChatReply).
 *
 * Старый `ChatModule` остаётся в строю (помечен @deprecated), переключается
 * через ENV `CHAT_V2_ENABLED`.
 */

@Injectable()
class ChatV2OmnichannelBridge implements OnModuleInit {
  private readonly logger = new Logger(ChatV2OmnichannelBridge.name);

  constructor(
    @Inject(ChatV2OrchestrationService)
    private readonly orchestration: ChatV2OrchestrationService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  onModuleInit(): void {
    this.conversational.subscribeInbound('chat_query', async (msg) => {
      await this.handleChatQuery(msg);
    });
    this.logger.log(
      'ChatV2OmnichannelBridge: подписан на inbound chat_query через ConversationalService',
    );
  }

  private async handleChatQuery(msg: InboundMessage): Promise<void> {
    if (msg.type !== 'chat_query') return;
    try {
      const answer = await this.orchestration.ask({
        tenantId: msg.tenantId,
        userId: msg.userId,
        question: msg.question,
        conversationId: msg.conversationId,
        // mode/scope не задаём — используются дефолты.
        channelKindOrigin: msg.originChannelBindingId ? 'external' : 'in_app',
      });

      await this.conversational.sendChatReply({
        tenantId: msg.tenantId,
        userId: msg.userId,
        conversationId: answer.conversationId,
        messageId: answer.messageId,
        text: answer.text,
        citationsCount: answer.citations.length,
        mode: answer.mode,
        uncertaintyNote: answer.uncertaintyNote ?? undefined,
        originChannelBindingId: msg.originChannelBindingId,
      });
      this.logger.log(
        {
          userId: msg.userId,
          conversationId: answer.conversationId,
          messageId: answer.messageId,
          channel: msg.originChannelBindingId ?? 'in_app',
        },
        'chat_query handled: ответ отправлен через ConversationalService',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { userId: msg.userId, err: message },
        'chat_query handler упал — пользователь не получит ответ',
      );
      // Не пробрасываем дальше — ConversationalService.dispatchInbound сам
      // ловит ошибки, чтобы один кривой handler не валил весь pipeline.
    }
  }
}

@Module({
  controllers: [ChatV2Controller],
  providers: [
    ChatV2OrchestrationService,
    ChatV2ConversationsService,
    SynthesisService,
    CardSpecialistRegistry,
    ChatV2CleanupCron,
    ChatV2OmnichannelBridge,
  ],
  exports: [
    ChatV2OrchestrationService,
    ChatV2ConversationsService,
    CardSpecialistRegistry,
  ],
})
export class ChatV2Module {}
