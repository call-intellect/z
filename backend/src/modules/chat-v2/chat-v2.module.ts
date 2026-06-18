import { Inject, Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';

import { ConversationalService } from '../conversational/conversational.service';
import type { InboundMessage } from '../conversational/types/channel.types';

import { ChatV2Controller } from './chat-v2.controller';
import { ChatV2OrchestrationService } from './chat-v2.service';
import { CardSpecialistRegistry } from './services/card-specialist-registry.service';
import { ChatV2FeedbackService } from './services/chat-v2-feedback.service';
import { ChatV2ConversationsService } from './services/conversations.service';
import { SynthesisService } from './services/synthesis.service';
import { IssueCardHandler } from './specialists/issue-card-handler.service';
import { ProjectCardHandler } from './specialists/project-card-handler.service';
import { SprintCardHandler } from './specialists/sprint-card-handler.service';
import { ChatV2CleanupCron } from './workers/chat-v2-cleanup.cron';

@Injectable()
export class ChatV2OmnichannelBridge implements OnModuleInit {
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
        channelKindOrigin: msg.originChannelBindingId ? 'external' : 'in_app',
      });

      const restricted = answer.dataClass === 'sensitive' || answer.dataClass === 'private';
      const text = restricted
        ? `Ответ содержит данные ограниченного доступа — откройте в кабинете: /chat?conversation=${answer.conversationId}`
        : answer.text;

      await this.conversational.sendChatReply({
        tenantId: msg.tenantId,
        userId: msg.userId,
        conversationId: answer.conversationId,
        messageId: answer.messageId,
        text,
        citationsCount: answer.citations.length,
        mode: answer.mode,
        uncertaintyNote: answer.uncertaintyNote ?? undefined,
        originChannelBindingId: msg.originChannelBindingId,
        dataClass: 'internal',
        solicited: true,
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
    ChatV2FeedbackService,
    IssueCardHandler,
    ProjectCardHandler,
    SprintCardHandler,
  ],
  exports: [
    ChatV2OrchestrationService,
    ChatV2ConversationsService,
    CardSpecialistRegistry,
    ChatV2FeedbackService,
    IssueCardHandler,
    ProjectCardHandler,
    SprintCardHandler,
  ],
})
export class ChatV2Module {}
