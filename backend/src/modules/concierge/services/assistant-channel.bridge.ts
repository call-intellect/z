import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';

import { RedisService } from '../../../common/redis/redis.service';
import { ConversationalService } from '../../conversational/conversational.service';
import type { InboundMessage } from '../../conversational/types/channel.types';

import { ConciergeService } from './concierge.service';

/**
 * Ф5 assistant-channels (2026-06-11) — AssistantChannelBridge.
 *
 * Мост «каналы → единый AI-помощник» по паттерну ChatV2OmnichannelBridge
 * (см. chat-v2.module.ts). Подписывается на inbound type='assistant_turn'
 * (его эмитят Telegram/MAX-адаптеры при включённом kill-switch
 * `ASSISTANT_CHANNEL_ROUTING_ENABLED`), прогоняет сообщение через
 * `ConciergeService.process` в service-режиме аутентификации (Ф4: ToolRouter
 * сам минтит session-JWT по userId, RBAC сохраняется) и отправляет ОДИН
 * финальный ответ в канал-источник через
 * `ConversationalService.sendChatReply` (solicited:true + dataClass
 * 'internal' — Ф1 «Стоп-молчание»: ответ доходит в Telegram/MAX, а не молча
 * оседает в кабинете). Промежуточные события (thinking/tool_call/tool_result)
 * в канал НЕ отправляются — text-only, без шума.
 *
 * Память диалога per-binding: модель ConciergeConversation НЕ имеет
 * channelBindingId (миграция в этой фазе запрещена), поэтому маппинг живёт в
 * Redis: ключ `concierge:channel-conv:<channelBindingId>` → conversationId,
 * TTL 24 часа, перезаписывается после каждого успешного хода. Если
 * originChannelBindingId не пришёл — ход без памяти (новый разговор).
 *
 * Циклического импорта нет: ConversationalModule @Global и экспортирует
 * ConversationalService, RedisService тоже @Global — ConciergeModule ничего
 * не импортирует, мост просто инжектит оба сервиса.
 */

/** TTL маппинга binding → conversation: 24 часа. */
const CHANNEL_CONVERSATION_TTL_SECONDS = 86_400;

/** Redis-ключ маппинга «канал-привязка → разговор помощника». */
function channelConversationKey(channelBindingId: string): string {
  return `concierge:channel-conv:${channelBindingId}`;
}

/** Тексты-деградации (русские, уходят пользователю в канал). */
const TEXT_ERROR = 'Помощник временно недоступен, попробуйте позже.';
const TEXT_QUOTA =
  'Дневной лимит обращений к помощнику исчерпан — продолжим завтра.';
const TEXT_DONE = 'Готово.';
const TEXT_EMPTY =
  'Не получилось обработать запрос, попробуйте переформулировать.';

@Injectable()
export class AssistantChannelBridge implements OnModuleInit {
  private readonly logger = new Logger(AssistantChannelBridge.name);

  constructor(
    @Inject(ConciergeService) private readonly concierge: ConciergeService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.conversational.subscribeInbound('assistant_turn', async (msg) => {
      await this.handleAssistantTurn(msg);
    });
    this.logger.log(
      'AssistantChannelBridge: подписан на inbound assistant_turn через ConversationalService',
    );
  }

  /**
   * Обработчик одного хода: память (Redis get) → ConciergeService.process
   * (service-режим) → сборка потока в один финальный текст → память
   * (Redis set) → отправка в канал-источник. Никогда не пробрасывает
   * ошибку — dispatchInbound и так ловит, но один кривой ход не должен
   * ронять pipeline (паттерн ChatV2OmnichannelBridge).
   */
  private async handleAssistantTurn(msg: InboundMessage): Promise<void> {
    if (msg.type !== 'assistant_turn') return;
    try {
      // (а) Память per-binding: Redis get → conversationId | undefined.
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

      // (б) Прогон через помощника: копим последний message/done/started,
      // промежуточные thinking/tool_call/tool_result в канал не шлём.
      let startedConversationId = '';
      let finalText = '';
      let messageId = '';
      let hadOkToolResult = false;
      let outcome: 'ok' | 'error' | 'quota' = 'ok';

      for await (const event of this.concierge.process({
        userMessage: msg.text,
        ...(conversationId ? { conversationId } : {}),
        userId: msg.userId,
        tenantId: msg.tenantId,
        authMode: 'service',
      })) {
        switch (event.type) {
          case 'started':
            startedConversationId = event.conversationId;
            break;
          case 'message':
            finalText = event.text;
            break;
          case 'done':
            messageId = event.messageId;
            break;
          case 'tool_result':
            if (event.ok) hadOkToolResult = true;
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
      } else if (finalText.trim() !== '') {
        text = finalText;
      } else {
        // LLM вернул пусто: «Готово.» только если был хотя бы один успешный
        // tool_result (действие реально выполнено), иначе честный отказ.
        text = hadOkToolResult ? TEXT_DONE : TEXT_EMPTY;
      }

      // (в) Память: после успешного завершения перезаписываем маппинг
      // binding → фактический conversationId (из события started), TTL 24ч.
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

      // (г) Один финальный ответ в канал-источник. solicited:true + dataClass
      // 'internal' (Ф1) — critical-доставка в Telegram/MAX, не в кабинет.
      await this.conversational.sendChatReply({
        tenantId: msg.tenantId,
        userId: msg.userId,
        conversationId: startedConversationId,
        messageId,
        text,
        citationsCount: 0,
        ...(msg.originChannelBindingId
          ? { originChannelBindingId: msg.originChannelBindingId }
          : {}),
        dataClass: 'internal',
        solicited: true,
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
      // (д) Не пробрасываем — один кривой ход не валит dispatchInbound.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { userId: msg.userId, err: message },
        'assistant_turn handler упал — пользователь не получит ответ',
      );
    }
  }
}
