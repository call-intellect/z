import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { RequireSubscription } from '../billing/guards/require-subscription.decorator';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  AddMemberSchema,
  type AddMemberDto,
  AskKoraSchema,
  type AskKoraDto,
  type AskKoraResponse,
  BlockMemberSchema,
  type BlockMemberDto,
  type ClosePollResponse,
  CreateConversationSchema,
  type CreateConversationDto,
  type CreateConversationResponse,
  CreatePollSchema,
  type CreatePollDto,
  type CreatePollResponse,
  type HuddleStartResponse,
  ListMessagesQuerySchema,
  type ListMessagesQuery,
  type ListMessagesResponse,
  MarkReadSchema,
  type MarkReadDto,
  MessageToTaskSchema,
  type MessageToTaskDto,
  type MessageToDecisionResponse,
  type MessageToTaskResponse,
  type OkResponse,
  ReactionSchema,
  type ReactionDto,
  type ReactionsResponse,
  type PollResponse,
  ReportMessageSchema,
  type ReportMessageDto,
  SendMessageSchema,
  type SendMessageDto,
  type SendMessageResponse,
  VotePollSchema,
  type VotePollDto,
  type WhatsNewResponse,
} from './dto/conversation.dto';
import { AskKoraService } from './services/ask-kora.service';
import { ChatSummaryService } from './services/chat-summary.service';
import { ConversationService } from './services/conversation.service';
import { HuddleService } from './services/huddle.service';
import { MessageActionsService } from './services/message-actions.service';
import { MessageReportService } from './services/message-report.service';
import { MessageService } from './services/message.service';
import { PollService } from './services/poll.service';
import { ReadCursorService } from './services/read-cursor.service';
import { UserBlockService } from './services/user-block.service';
import { WorkChatService } from './services/work-chat.service';

@ApiTags('messaging / conversations')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class ConversationController {
  constructor(
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(ReadCursorService) private readonly readCursors: ReadCursorService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(WorkChatService) private readonly workChat: WorkChatService,
    @Inject(ChatSummaryService) private readonly chatSummary: ChatSummaryService,
    @Inject(AskKoraService) private readonly askKora: AskKoraService,
    @Inject(MessageActionsService)
    private readonly messageActions: MessageActionsService,
    @Inject(UserBlockService) private readonly userBlocks: UserBlockService,
    @Inject(MessageReportService) private readonly messageReports: MessageReportService,
    @Inject(PollService) private readonly polls: PollService,
    @Inject(HuddleService) private readonly huddles: HuddleService,
  ) {}

  @Post('conversations')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать разговор (dm/group/channel); создатель — owner' })
  async create(
    @Body(new ZodValidationPipe(CreateConversationSchema)) body: CreateConversationDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CreateConversationResponse> {
    const t = this.requireTenant(tenantId);
    const conversation = await this.conversations.createConversation({
      tenantId: t,
      kind: body.kind,
      title: body.title ?? null,
      createdByUserId: user.id,
      memberUserIds: body.memberUserIds,
    });
    return { conversationId: conversation.id };
  }

  @Post('conversations/company-channel')
  @RequireSubscription()
  @ApiOperation({ summary: 'Идемпотентно создать обязательный канал «Вся компания» (owner/admin)' })
  async companyChannel(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CreateConversationResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireOrgWrite(user.id, t);
    const channel = await this.conversations.ensureCompanyChannel(t, user.id);
    return { conversationId: channel.id };
  }

  @Post('conversations/:id/members')
  @RequireSubscription()
  @ApiOperation({ summary: 'Добавить участника (owner/admin разговора)' })
  async addMember(
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OkResponse> {
    this.requireTenant(tenantId);
    const role = await this.conversations.getMemberRole(conversationId, user.id);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Только owner/admin разговора могут добавлять участников',
        },
      });
    }
    await this.conversations.addMember({ conversationId, userId: body.userId });
    return { ok: true };
  }

  @Delete('conversations/:id/members/me')
  @RequireSubscription()
  @ApiOperation({ summary: 'Выйти из разговора (запрещено для обязательного канала)' })
  async leave(
    @Param('id') conversationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OkResponse> {
    this.requireTenant(tenantId);
    if (await this.conversations.isMandatory(conversationId)) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'MANDATORY_CHANNEL_LEAVE_FORBIDDEN',
          message: 'Нельзя выйти из обязательного канала',
        },
      });
    }
    await this.conversations.removeMember(conversationId, user.id);
    return { ok: true };
  }

  @Post('conversations/:id/messages')
  @RequireSubscription()
  @ApiOperation({ summary: 'Отправить сообщение в разговор' })
  async sendMessage(
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SendMessageResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    const result = await this.messages.sendMessage({
      tenantId: t,
      conversationId,
      authorUserId: user.id,
      content: body.content,
      clientMessageId: body.clientMessageId,
      parentMessageId: body.parentMessageId ?? null,
      access: body.access,
      mentions: body.mentions,
      voice: body.voice ?? null,
    });
    return result;
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Лента сообщений разговора (cursor по seq)' })
  async listMessages(
    @Param('id') conversationId: string,
    @Query(new ZodValidationPipe(ListMessagesQuerySchema)) query: ListMessagesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListMessagesResponse> {
    this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    return this.messages.getMessages({
      conversationId,
      sinceSeq: query.sinceSeq ?? null,
      limit: query.limit,
    });
  }

  @Post('message-threads/:id/read')
  @RequireSubscription()
  @ApiOperation({ summary: 'Отметить прочитанным до cursorSeq' })
  async markRead(
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(MarkReadSchema)) body: MarkReadDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OkResponse> {
    this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    await this.readCursors.markRead({
      conversationId,
      userId: user.id,
      cursorSeq: String(body.cursorSeq),
    });
    return { ok: true };
  }

  @Post('conversations/:id/messages/:messageId/reactions')
  @RequireSubscription()
  @ApiOperation({ summary: 'Переключить реакцию на сообщение' })
  async toggleReaction(
    @Param('id') conversationId: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(ReactionSchema)) body: ReactionDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ReactionsResponse> {
    this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    const { reactions } = await this.messages.toggleReaction({
      conversationId,
      messageId,
      userId: user.id,
      emoji: body.emoji,
    });
    return { messageId, reactions };
  }

  @Get('issues/:issueId/conversation')
  @ApiOperation({ summary: 'Идемпотентно создать/получить work_chat задачи' })
  async issueConversation(
    @Param('issueId') issueId: string,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ conversationId: string }> {
    this.requireTenant(tenantId);
    return this.workChat.ensureWorkChat(issueId);
  }

  @Get('conversations/:id/linked-issue')
  @ApiOperation({ summary: 'Задача, к которой привязан work_chat (если есть)' })
  async linkedIssue(
    @Param('id') conversationId: string,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ id: string; identifier: string; title: string }> {
    this.requireTenant(tenantId);
    const issue = await this.workChat.getLinkedIssue(conversationId);
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'LINKED_ISSUE_NOT_FOUND', message: 'Задача для разговора не найдена' },
      });
    }
    return issue;
  }

  @Get('conversations/:id/whats-new')
  @ApiOperation({ summary: 'AI-сводка непрочитанного «Что пропустил» (chat-summary)' })
  async whatsNew(
    @Param('id') conversationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<WhatsNewResponse> {
    this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    const result = await this.chatSummary.summarizeUnread({ conversationId, userId: user.id });
    if ('skipped' in result) {
      return {
        summary: null,
        skipped: result.skipped,
        fromSeq: null,
        toSeq: null,
        messageCount: 0,
      };
    }
    return {
      summary: result.summary,
      skipped: null,
      fromSeq: result.fromSeq,
      toSeq: result.toSeq,
      messageCount: result.messageCount,
    };
  }

  @Post('conversations/:id/ask')
  @RequireSubscription()
  @ApiOperation({ summary: 'Спросить Кору по памяти компании со ссылкой на сообщения' })
  async ask(
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(AskKoraSchema)) body: AskKoraDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<AskKoraResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    return this.askKora.ask({
      tenantId: t,
      userId: user.id,
      conversationId,
      question: body.question,
    });
  }

  @Post('conversations/:id/messages/:messageId/to-task')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать задачу из сообщения (intake-кандидат)' })
  async messageToTask(
    @Param('id') conversationId: string,
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(MessageToTaskSchema)) body: MessageToTaskDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MessageToTaskResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    return this.messageActions.messageToTask({
      tenantId: t,
      userId: user.id,
      conversationId,
      messageId,
      title: body.title ?? null,
    });
  }

  @Post('conversations/:id/messages/:messageId/to-decision')
  @RequireSubscription()
  @ApiOperation({ summary: 'Зафиксировать решение из сообщения (реестр решений)' })
  async messageToDecision(
    @Param('id') conversationId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MessageToDecisionResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    return this.messageActions.messageToDecision({
      tenantId: t,
      userId: user.id,
      conversationId,
      messageId,
    });
  }

  @Post('conversations/:id/block-member')
  @RequireSubscription()
  @ApiOperation({ summary: 'Заблокировать собеседника в разговоре (UGC-модерация)' })
  async blockMember(
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(BlockMemberSchema)) body: BlockMemberDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OkResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    await this.userBlocks.blockInConversation({
      tenantId: t,
      conversationId,
      blockerUserId: user.id,
      blockedUserId: body.userId,
    });
    return { ok: true };
  }

  @Post('messages/:messageId/report')
  @RequireSubscription()
  @ApiOperation({ summary: 'Пожаловаться на сообщение (UGC report)' })
  async reportMessage(
    @Param('messageId') messageId: string,
    @Body(new ZodValidationPipe(ReportMessageSchema)) body: ReportMessageDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OkResponse> {
    const t = this.requireTenant(tenantId);
    await this.messageReports.report({
      tenantId: t,
      messageId,
      reporterUserId: user.id,
      reason: body.reason ?? null,
    });
    return { ok: true };
  }

  @Post('conversations/:id/polls')
  @RequireSubscription()
  @ApiOperation({ summary: 'Создать опрос в разговоре (вопрос + варианты)' })
  async createPoll(
    @Param('id') conversationId: string,
    @Body(new ZodValidationPipe(CreatePollSchema)) body: CreatePollDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<CreatePollResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    return this.polls.createPoll({
      tenantId: t,
      conversationId,
      userId: user.id,
      question: body.question,
      options: body.options,
    });
  }

  @Post('polls/:id/vote')
  @RequireSubscription()
  @ApiOperation({ summary: 'Проголосовать в опросе (один голос на участника, смена допустима)' })
  async votePoll(
    @Param('id') pollId: string,
    @Body(new ZodValidationPipe(VotePollSchema)) body: VotePollDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<OkResponse> {
    this.requireTenant(tenantId);
    await this.polls.vote({ pollId, userId: user.id, optionId: body.optionId });
    return { ok: true };
  }

  @Post('polls/:id/close')
  @RequireSubscription()
  @ApiOperation({ summary: 'Закрыть опрос — итог фиксируется как решение (IdeaBlock)' })
  async closePoll(
    @Param('id') pollId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ClosePollResponse> {
    this.requireTenant(tenantId);
    return this.polls.closePoll({ pollId, userId: user.id });
  }

  @Get('polls/:id')
  @ApiOperation({ summary: 'Опрос: вопрос, варианты, счётчики голосов' })
  async getPoll(
    @Param('id') pollId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<PollResponse> {
    this.requireTenant(tenantId);
    const poll = await this.polls.getPoll(pollId);
    await this.requireMember(poll.conversationId, user.id);
    return poll;
  }

  @Post('conversations/:id/huddle/start')
  @RequireSubscription()
  @ApiOperation({ summary: 'Начать созвон из разговора (huddle): встреча + токен инициатора' })
  async startHuddle(
    @Param('id') conversationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<HuddleStartResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    return this.huddles.startHuddle({ tenantId: t, conversationId, userId: user.id });
  }

  @Post('conversations/:id/huddle/join')
  @RequireSubscription()
  @ApiOperation({ summary: 'Присоединиться к идущему созвону разговора (huddle): токен участника' })
  async joinHuddle(
    @Param('id') conversationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<HuddleStartResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireMember(conversationId, user.id);
    return this.huddles.joinHuddle({ tenantId: t, conversationId, userId: user.id });
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireMember(conversationId: string, userId: string): Promise<void> {
    const ok = await this.conversations.assertMember(conversationId, userId);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Вы не участник этого разговора' },
      });
    }
  }

  private async requireOrgWrite(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canWrite(userId, tenantId, 'conversation');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Только owner/admin могут управлять каналом компании',
        },
      });
    }
  }
}
