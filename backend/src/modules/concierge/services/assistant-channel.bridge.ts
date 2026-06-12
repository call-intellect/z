import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ConversationalService } from '../../conversational/conversational.service';
import type { InboundMessage } from '../../conversational/types/channel.types';
import { RbacService } from '../../rbac/rbac.service';
import {
  ASSISTANT_CONFIRM_CLASSIFY_SYSTEM_PROMPT,
  ASSISTANT_CONFIRM_CLASSIFY_USER_TEMPLATE,
} from '../prompts/assistant-confirm-classify.prompt';

import { ConciergeService } from './concierge.service';
import { ToolRouterService } from './tool-router.service';

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

/** Ф6 — TTL ожидания текстового подтверждения мутации: 5 минут. */
const CHANNEL_CONFIRM_TTL_SECONDS = 300;

/** Redis-ключ маппинга «канал-привязка → разговор помощника». */
function channelConversationKey(channelBindingId: string): string {
  return `concierge:channel-conv:${channelBindingId}`;
}

/** Ф6 — Redis-ключ отложенного подтверждения мутации per-binding. */
function channelConfirmKey(channelBindingId: string): string {
  return `concierge:confirm:${channelBindingId}`;
}

/**
 * Ф6 (2026-06-11) — канальный whitelist инструментов помощника.
 *
 * SELF — рядовой сотрудник в Telegram/MAX: личный календарь/задачи/встречи,
 * поиск и AI-чат. Руководительские инструменты (карточка человека, здоровье
 * команды, обещания, спринт, чужой календарь) НЕ видны.
 *
 * `create_task` из контракта ТЗ НЕ включён: в реестре ServiceMapGenerator
 * инструмента постановки задачи нет, а единственный семантически подходящий
 * REST (`POST /api/v1/intake`, «попадёт в авто-триаж») закрыт RBAC
 * `intake_issue/write` = owner/admin/coo — для рядового (основная аудитория
 * SELF) вызов всегда 403, а менять policy.csv в этой фазе запрещено.
 * Блокер зафиксирован в отчёте фазы — решение за оркестратором.
 *
 * Экспортируются для unit-тестов моста.
 */
export const CHANNEL_TOOL_WHITELIST_SELF: readonly string[] = [
  'list_tasks',
  'list_my_events',
  'list_meetings',
  'create_event',
  'create_meeting',
  'find_free_slot',
  'search_knowledge',
  'ask_chat_v2',
];

/** Ф6 — расширенный список для manager+ (owner/admin/manager/coo). */
export const CHANNEL_TOOL_WHITELIST_MANAGER: readonly string[] = [
  ...CHANNEL_TOOL_WHITELIST_SELF,
  'list_user_events',
  'get_person_pulse',
  'get_team_health',
  'list_overdue_promises',
  'get_sprint_status',
];

/** Ф6 — роли Membership, получающие MANAGER-список («manager и выше»). */
const MANAGER_PLUS_ROLES = new Set<string>(['owner', 'admin', 'manager', 'coo']);

/**
 * Ф6 — состояние отложенного подтверждения в Redis (JSON).
 * `preview` — человекочитаемое превью действия (для переспроса/LLM-judge).
 */
interface PendingConfirmState {
  toolName: string;
  params: Record<string, unknown>;
  conversationId: string;
  /** Опц. defensively: состояние приходит из Redis (JSON.parse без схемы). */
  preview?: string;
}

/** Ф6 — дешёвая эвристика подтверждения: нормализованные «да»-формы. */
const CONFIRM_YES_WORDS = new Set<string>([
  'да',
  'ок',
  'окей',
  'давай',
  'подтверждаю',
  'yes',
]);

/** Ф6 — дешёвая эвристика отказа: нормализованные «нет»-формы. */
const CONFIRM_NO_WORDS = new Set<string>([
  'нет',
  'не надо',
  'отмена',
  'отмени',
  'стоп',
  'no',
]);

/** Тексты-деградации (русские, уходят пользователю в канал). */
const TEXT_ERROR = 'Помощник временно недоступен, попробуйте позже.';
const TEXT_QUOTA =
  'Дневной лимит обращений к помощнику исчерпан — продолжим завтра.';
const TEXT_DONE = 'Готово.';
const TEXT_EMPTY =
  'Не получилось обработать запрос, попробуйте переформулировать.';
/** Ф6 — переспрос при непонятном ответе на подтверждение. */
const TEXT_CONFIRM_UNCLEAR = 'Не понял. Ответьте «да» или «нет».';
/** Ф6 — подтверждение отменено пользователем. */
const TEXT_CONFIRM_REJECTED = 'Отменил.';

@Injectable()
export class AssistantChannelBridge implements OnModuleInit {
  private readonly logger = new Logger(AssistantChannelBridge.name);

  constructor(
    @Inject(ConciergeService) private readonly concierge: ConciergeService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(RedisService) private readonly redis: RedisService,
    /** Ф6 — роль Membership → канальный whitelist (RbacModule @Global). */
    @Inject(RbacService) private readonly rbac: RbacService,
    /** Ф6 — исполнение подтверждённого отложенного инструмента. */
    @Inject(ToolRouterService) private readonly toolRouter: ToolRouterService,
    /** Ф6 — LLM-judge `assistant-confirm-classify` (AiModule @Global). */
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    /** L-4 (2026-06-12) — счётчик исходов ходов: z_assistant_turn_total. */
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
      // (Ф6) Ожидание подтверждения: если для binding'а висит confirm-ключ —
      // это ответ «да»/«нет» на отложенную мутацию, НЕ новый ход диалога
      // (в concierge.process не идёт). Redis-провал → fail-open в обычный ход.
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
          // L-4 — ход подтверждения обработан без исключения.
          this.metrics.incAssistantTurn({ outcome: 'ok' });
          return;
        }
      }

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

      // (Ф6) Канальный whitelist по роли Membership: manager+ (owner/admin/
      // manager/coo) → расширенный список, иначе (включая отсутствие
      // membership / провал RBAC) — безопасный SELF.
      const toolWhitelist = await this.resolveToolWhitelist(
        msg.tenantId,
        msg.userId,
      );

      // (б) Прогон через помощника: копим последний message/done/started,
      // промежуточные thinking/tool_call/tool_result в канал не шлём.
      // Ф6: confirmHold=true — мутации без undo откладываются до текстового
      // «да» (событие confirm_required ниже).
      let startedConversationId = '';
      let finalText = '';
      let messageId = '';
      let hadOkToolResult = false;
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
        // (Ф6) Отложенная мутация: сохраняем состояние подтверждения в Redis
        // (TTL 5 мин) и спрашиваем текстом — никаких inline-кнопок.
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
      // C-1 (2026-06-12): quota/error-пути не имеют started/done →
      // подставляем синтетические непустые id, чтобы payload-схема
      // chat.answer не уронила отправку (тишина вместо ответа).
      await this.conversational.sendChatReply({
        tenantId: msg.tenantId,
        userId: msg.userId,
        conversationId:
          startedConversationId || (msg.originChannelBindingId ?? 'channel'),
        messageId: messageId || 'assistant-channel',
        text,
        citationsCount: 0,
        ...(msg.originChannelBindingId
          ? { originChannelBindingId: msg.originChannelBindingId }
          : {}),
        dataClass: 'internal',
        solicited: true,
      });

      // L-4 — исход хода: ok | error | quota | confirm_hold.
      this.metrics.incAssistantTurn({
        outcome:
          outcome === 'ok' && confirmRequired ? 'confirm_hold' : outcome,
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
      // L-4 — внешний catch: ход потерян.
      try {
        this.metrics.incAssistantTurn({ outcome: 'handler_error' });
      } catch {
        /* метрика не должна ронять handler */
      }
    }
  }

  // ─────────────────── Ф6 — whitelist + текст-подтверждение ───────────────────

  /**
   * Роль Membership → канальный whitelist. Провал RBAC/отсутствие membership
   * → безопасный SELF (рядовой набор). Двойная защита: даже при ошибке здесь
   * ToolRouter всё равно гейтит каждый вызов по RBAC.
   */
  private async resolveToolWhitelist(
    tenantId: string,
    userId: string,
  ): Promise<readonly string[]> {
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

  /**
   * Сохраняет состояние отложенного подтверждения в Redis (TTL 5 мин).
   * Без binding'а сохранить некуда (следующий ход не сможет сматчиться) —
   * вопрос всё равно уйдёт в канал, но «да» обработается как обычный ход
   * (деградация с warn). Redis-провал — fail-open с warn (как и остальная
   * память моста).
   */
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

  /**
   * Ф6 — обработка ответа на запрос подтверждения. Этот ход НЕ идёт в
   * concierge.process (не новый ход диалога):
   *   - confirm → DEL ключа ДО execute (одноразовость: повторный «да» не
   *     исполнит дважды) → ToolRouter.execute(authMode='service') → «Готово/
   *     Не получилось» в канал;
   *   - reject → DEL + «Отменил.»;
   *   - unclear → переспрос, ключ ОСТАЁТСЯ жить до TTL.
   */
  private async handleConfirmReply(
    msg: Extract<InboundMessage, { type: 'assistant_turn' }>,
    confirmKey: string,
    pendingRaw: string,
  ): Promise<void> {
    let state: PendingConfirmState;
    try {
      state = JSON.parse(pendingRaw) as PendingConfirmState;
    } catch {
      // Битое состояние — чистим ключ и просим повторить запрос целиком.
      this.logger.warn(
        { confirmKey },
        'confirm: битый JSON состояния — ключ удалён, просим повторить',
      );
      try {
        await this.redis.client.del(confirmKey);
      } catch {
        /* non-fatal */
      }
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
      // Ключ намеренно НЕ удаляем — пользователь ответит ещё раз до TTL.
      await this.sendConfirmFlowReply(
        msg,
        state.conversationId,
        TEXT_CONFIRM_UNCLEAR,
      );
      return;
    }

    // Одноразовость: атомарный consume ключа ДО исполнения. del возвращает
    // число удалённых ключей: 0 — конкурентный «да» уже забрал ключ (между
    // GET и DEL прошла LLM-классификация, секунды) → исполнять НЕЛЬЗЯ
    // (H-2: двойное исполнение мутации). Если DEL упал — тоже НЕ исполняем
    // (риск дубля при повторном «да») и честно говорим про недоступность.
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
      await this.sendConfirmFlowReply(
        msg,
        state.conversationId,
        TEXT_CONFIRM_REJECTED,
      );
      return;
    }

    // decision === 'confirm' — исполняем отложенный инструмент.
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

  /**
   * Классификация ответа на подтверждение: (а) дешёвая эвристика по
   * нормализованному тексту («да»/«нет»-формы); (б) LLM-judge
   * `assistant-confirm-classify` (deepseek-v4-flash primary). Провал LLM /
   * битый JSON / низкий confidence → 'unclear' (безопасный переспрос).
   */
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

  /**
   * Отправка сообщений confirm-flow тем же путём, что и финальный ответ моста
   * (sendChatReply: solicited:true + dataClass='internal' → доставка в
   * канал-источник). У confirm-flow нет ConciergeMessage — C-1 (2026-06-12):
   * вместо пустых id подставляем синтетические непустые, чтобы payload-схема
   * chat.answer не уронила отправку (тишина вместо confirm/error-ответа).
   */
  private async sendConfirmFlowReply(
    msg: Extract<InboundMessage, { type: 'assistant_turn' }>,
    conversationId: string,
    text: string,
  ): Promise<void> {
    await this.conversational.sendChatReply({
      tenantId: msg.tenantId,
      userId: msg.userId,
      conversationId:
        conversationId || (msg.originChannelBindingId ?? 'channel'),
      messageId: 'assistant-channel',
      text,
      citationsCount: 0,
      ...(msg.originChannelBindingId
        ? { originChannelBindingId: msg.originChannelBindingId }
        : {}),
      dataClass: 'internal',
      solicited: true,
    });
  }
}
