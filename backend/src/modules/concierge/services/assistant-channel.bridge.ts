import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ConversationalService } from '../../conversational/conversational.service';
import {
  CHANNEL_CLARIFY_TTL_SECONDS,
  channelClarifyKey,
} from '../../conversational/types/channel-clarify-key';
import type { InboundMessage } from '../../conversational/types/channel.types';
import { RbacService } from '../../rbac/rbac.service';
import {
  ASSISTANT_CONFIRM_CLASSIFY_SYSTEM_PROMPT,
  ASSISTANT_CONFIRM_CLASSIFY_USER_TEMPLATE,
} from '../prompts/assistant-confirm-classify.prompt';

import { ConciergeService } from './concierge.service';
import { ToolRouterService } from './tool-router.service';

const CHANNEL_CONVERSATION_TTL_SECONDS = 86_400;

const CHANNEL_CONFIRM_TTL_SECONDS = 300;

function channelConversationKey(channelBindingId: string): string {
  return `concierge:channel-conv:${channelBindingId}`;
}

function channelConfirmKey(channelBindingId: string): string {
  return `concierge:confirm:${channelBindingId}`;
}

export const CHANNEL_TOOL_WHITELIST_SELF: readonly string[] = [
  'list_tasks',
  'list_my_events',
  'list_meetings',
  'create_event',
  'make_event_online',
  'create_meeting',
  'find_free_slot',
  'create_task',
  'assign_task',
  'search_tasks',
  'ingest_note',
  'set_my_work_profile',
  'ask_chat_v2',
];

export const CHANNEL_TOOL_WHITELIST_MANAGER: readonly string[] = [
  ...CHANNEL_TOOL_WHITELIST_SELF,
  'list_user_events',
  'get_person_pulse',
  'get_team_health',
  'list_overdue_promises',
  'get_sprint_status',
];

const MANAGER_PLUS_ROLES = new Set<string>(['owner', 'admin', 'manager', 'coo']);

interface PendingConfirmState {
  toolName: string;
  params: Record<string, unknown>;
  conversationId: string;
  preview?: string;
}

const CONFIRM_YES_WORDS = new Set<string>(['да', 'ок', 'окей', 'давай', 'подтверждаю', 'yes']);

const CONFIRM_NO_WORDS = new Set<string>(['нет', 'не надо', 'отмена', 'отмени', 'стоп', 'no']);

const TEXT_ERROR = 'Помощник временно недоступен, попробуйте позже.';
const TEXT_QUOTA = 'Дневной лимит обращений к помощнику исчерпан — продолжим завтра.';
const TEXT_DONE = 'Готово.';
const TEXT_EMPTY = 'Не получилось обработать запрос, попробуйте переформулировать.';
const TEXT_CONFIRM_UNCLEAR = 'Не понял. Ответьте «да» или «нет».';
const TEXT_CONFIRM_REJECTED = 'Отменил.';

@Injectable()
export class AssistantChannelBridge implements OnModuleInit {
  private readonly logger = new Logger(AssistantChannelBridge.name);

  constructor(
    @Inject(ConciergeService) private readonly concierge: ConciergeService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(ToolRouterService) private readonly toolRouter: ToolRouterService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.conversational.subscribeInbound('assistant_turn', async (msg) => {
      await this.handleAssistantTurn(msg);
    });
    this.logger.log(
      'AssistantChannelBridge: подписан на inbound assistant_turn через ConversationalService',
    );
  }

  private async handleAssistantTurn(msg: InboundMessage): Promise<void> {
    if (msg.type !== 'assistant_turn') return;
    try {
      if (msg.originChannelBindingId) {
        const confirmKey = channelConfirmKey(msg.originChannelBindingId);
        let pendingRaw: string | null = null;
        try {
          pendingRaw = await this.redis.client.get(confirmKey);
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'assistant_turn: Redis get confirm-ключа упал — обрабатываем как обычный ход',
          );
        }
        if (pendingRaw) {
          await this.handleConfirmReply(msg, confirmKey, pendingRaw);
          this.metrics.incAssistantTurn({ outcome: 'ok' });
          return;
        }
      }

      const redisKey = msg.originChannelBindingId
        ? channelConversationKey(msg.originChannelBindingId)
        : null;
      let conversationId: string | undefined;
      if (redisKey) {
        try {
          conversationId = (await this.redis.client.get(redisKey)) ?? undefined;
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'assistant_turn: Redis get упал — ход без памяти (новый разговор)',
          );
        }
      }

      const toolWhitelist = await this.resolveToolWhitelist(msg.tenantId, msg.userId);

      let startedConversationId = '';
      let finalText = '';
      let messageId = '';
      let hadOkToolResult = false;
      let needsClarification = false;
      let outcome: 'ok' | 'error' | 'quota' = 'ok';
      let confirmRequired: {
        toolName: string;
        params: Record<string, unknown>;
        preview: string;
      } | null = null;

      for await (const event of this.concierge.process({
        userMessage: msg.text,
        ...(conversationId ? { conversationId } : {}),
        userId: msg.userId,
        tenantId: msg.tenantId,
        authMode: 'service',
        toolWhitelist: [...toolWhitelist],
        confirmHold: true,
      })) {
        switch (event.type) {
          case 'started':
            startedConversationId = event.conversationId;
            break;
          case 'message':
            finalText = event.text;
            needsClarification = event.needsClarification === true;
            break;
          case 'done':
            messageId = event.messageId;
            break;
          case 'tool_result':
            if (event.ok) hadOkToolResult = true;
            break;
          case 'confirm_required':
            confirmRequired = {
              toolName: event.toolName,
              params: event.params,
              preview: event.preview,
            };
            break;
          case 'quota_exceeded':
            outcome = 'quota';
            break;
          case 'error':
            outcome = 'error';
            break;
          default:
            break;
        }
      }

      let text: string;
      if (outcome === 'quota') {
        text = TEXT_QUOTA;
      } else if (outcome === 'error') {
        text = TEXT_ERROR;
      } else if (confirmRequired) {
        await this.storePendingConfirm({
          bindingId: msg.originChannelBindingId ?? null,
          state: {
            toolName: confirmRequired.toolName,
            params: confirmRequired.params,
            conversationId: startedConversationId,
            preview: confirmRequired.preview,
          },
        });
        text = `Подтвердите действие: ${confirmRequired.preview}. Ответьте «да» — выполню, «нет» — отменю.`;
      } else if (finalText.trim() !== '') {
        text = finalText;
      } else {
        text = hadOkToolResult ? TEXT_DONE : TEXT_EMPTY;
      }

      if (redisKey && startedConversationId && outcome === 'ok') {
        try {
          await this.redis.client.set(
            redisKey,
            startedConversationId,
            'EX',
            CHANNEL_CONVERSATION_TTL_SECONDS,
          );
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'assistant_turn: Redis set упал — память хода не сохранена (non-fatal)',
          );
        }
      }

      if (msg.originChannelBindingId && outcome === 'ok' && !confirmRequired) {
        const clarifyKey = channelClarifyKey(msg.originChannelBindingId);
        try {
          if (needsClarification) {
            await this.redis.client.set(clarifyKey, '1', 'EX', CHANNEL_CLARIFY_TTL_SECONDS);
          } else {
            await this.redis.client.del(clarifyKey);
          }
        } catch (err) {
          this.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'assistant_turn: Redis set/del clarify-ключа упал (non-fatal)',
          );
        }
      }

      await this.conversational.sendChatReply({
        tenantId: msg.tenantId,
        userId: msg.userId,
        conversationId: startedConversationId || (msg.originChannelBindingId ?? 'channel'),
        messageId: messageId || 'assistant-channel',
        text,
        citationsCount: 0,
        ...(msg.originChannelBindingId
          ? { originChannelBindingId: msg.originChannelBindingId }
          : {}),
        dataClass: 'internal',
        solicited: true,
      });

      this.metrics.incAssistantTurn({
        outcome: outcome === 'ok' && confirmRequired ? 'confirm_hold' : outcome,
      });

      this.logger.log(
        {
          userId: msg.userId,
          conversationId: startedConversationId,
          messageId,
          outcome,
          channel: msg.originChannelBindingId ?? 'unknown',
        },
        'assistant_turn handled: ответ помощника отправлен в канал-источник',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { userId: msg.userId, err: message },
        'assistant_turn handler упал — пользователь не получит ответ',
      );
      try {
        this.metrics.incAssistantTurn({ outcome: 'handler_error' });
      } catch {}
    }
  }

  private async resolveToolWhitelist(tenantId: string, userId: string): Promise<readonly string[]> {
    try {
      const role = await this.rbac.getMembershipRole(tenantId, userId);
      return role != null && MANAGER_PLUS_ROLES.has(role)
        ? CHANNEL_TOOL_WHITELIST_MANAGER
        : CHANNEL_TOOL_WHITELIST_SELF;
    } catch (err) {
      this.logger.warn(
        { userId, err: err instanceof Error ? err.message : String(err) },
        'assistant_turn: getMembershipRole упал — fallback на SELF-whitelist',
      );
      return CHANNEL_TOOL_WHITELIST_SELF;
    }
  }

  private async storePendingConfirm(args: {
    bindingId: string | null;
    state: PendingConfirmState;
  }): Promise<void> {
    if (!args.bindingId) {
      this.logger.warn(
        { toolName: args.state.toolName },
        'confirm_required без originChannelBindingId — состояние подтверждения не сохранено',
      );
      return;
    }
    try {
      await this.redis.client.set(
        channelConfirmKey(args.bindingId),
        JSON.stringify(args.state),
        'EX',
        CHANNEL_CONFIRM_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'confirm_required: Redis set упал — подтверждение не сохранено (non-fatal)',
      );
    }
  }

  private async handleConfirmReply(
    msg: Extract<InboundMessage, { type: 'assistant_turn' }>,
    confirmKey: string,
    pendingRaw: string,
  ): Promise<void> {
    let state: PendingConfirmState;
    try {
      state = JSON.parse(pendingRaw) as PendingConfirmState;
    } catch {
      this.logger.warn(
        { confirmKey },
        'confirm: битый JSON состояния — ключ удалён, просим повторить',
      );
      try {
        await this.redis.client.del(confirmKey);
      } catch {}
      await this.sendConfirmFlowReply(msg, '', TEXT_EMPTY);
      return;
    }

    const decision = await this.classifyConfirmReply({
      reply: msg.text,
      actionPreview: state.preview ?? state.toolName,
      tenantId: msg.tenantId,
      userId: msg.userId,
    });

    if (decision === 'unclear') {
      await this.sendConfirmFlowReply(msg, state.conversationId, TEXT_CONFIRM_UNCLEAR);
      return;
    }

    let deleted: number;
    try {
      deleted = await this.redis.client.del(confirmKey);
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), confirmKey },
        'confirm: Redis del упал — исполнение отменено (риск дубля)',
      );
      await this.sendConfirmFlowReply(msg, state.conversationId, TEXT_ERROR);
      return;
    }
    if (deleted !== 1) {
      this.logger.warn(
        { confirmKey, toolName: state.toolName },
        'confirm: ключ уже обработан конкурентно — исполнение пропущено',
      );
      return;
    }

    if (decision === 'reject') {
      await this.sendConfirmFlowReply(msg, state.conversationId, TEXT_CONFIRM_REJECTED);
      return;
    }

    let text: string;
    try {
      const exec = await this.toolRouter.execute({
        toolName: state.toolName,
        args: state.params,
        userId: msg.userId,
        tenantId: msg.tenantId,
        authMode: 'service',
      });
      text = exec.ok
        ? `Готово: ${state.preview ?? state.toolName}.`
        : `Не получилось: ${exec.errorMessage ?? `HTTP ${exec.status}`}.`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { toolName: state.toolName, err: message },
        'confirm: исполнение отложенного инструмента упало',
      );
      text = `Не получилось: ${message}.`;
    }
    await this.sendConfirmFlowReply(msg, state.conversationId, text);
  }

  private async classifyConfirmReply(args: {
    reply: string;
    actionPreview: string;
    tenantId: string;
    userId: string;
  }): Promise<'confirm' | 'reject' | 'unclear'> {
    const normalized = args.reply
      .toLowerCase()
      .replace(/[!?.,…«»"']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (CONFIRM_YES_WORDS.has(normalized)) return 'confirm';
    if (CONFIRM_NO_WORDS.has(normalized)) return 'reject';

    try {
      const out = await this.llm.call({
        taskType: 'assistant-confirm-classify',
        systemPrompt: ASSISTANT_CONFIRM_CLASSIFY_SYSTEM_PROMPT,
        userMessage: ASSISTANT_CONFIRM_CLASSIFY_USER_TEMPLATE({
          actionPreview: args.actionPreview,
          reply: args.reply,
        }),
        tenantId: args.tenantId,
        userId: args.userId,
      });
      const match = out.text.match(/\{[\s\S]*\}/);
      if (!match) return 'unclear';
      const parsed = JSON.parse(match[0]) as {
        decision?: string;
        confidence?: number;
      };
      if (parsed.decision === 'reject') return 'reject';
      if (
        parsed.decision === 'confirm' &&
        typeof parsed.confidence === 'number' &&
        parsed.confidence >= 0.6
      ) {
        return 'confirm';
      }
      return 'unclear';
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'confirm: LLM-judge упал — переспрашиваем (unclear)',
      );
      return 'unclear';
    }
  }

  private async sendConfirmFlowReply(
    msg: Extract<InboundMessage, { type: 'assistant_turn' }>,
    conversationId: string,
    text: string,
  ): Promise<void> {
    await this.conversational.sendChatReply({
      tenantId: msg.tenantId,
      userId: msg.userId,
      conversationId: conversationId || (msg.originChannelBindingId ?? 'channel'),
      messageId: 'assistant-channel',
      text,
      citationsCount: 0,
      ...(msg.originChannelBindingId ? { originChannelBindingId: msg.originChannelBindingId } : {}),
      dataClass: 'internal',
      solicited: true,
    });
  }
}
