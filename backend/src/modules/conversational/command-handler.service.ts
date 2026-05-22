import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

import { ConversationalService } from './conversational.service';
import type { InboundMessage } from './types/channel.types';

/**
 * Обработчик slash-commands из внешних ботов (Telegram / MAX) — SBA β-1.
 *
 * Регистрируется на `subscribeInbound('command', ...)` в `onModuleInit`.
 * Поддерживает три простые команды:
 *   - `/status`  — кратко: сколько pending probe'ов у пользователя.
 *   - `/myideas` — заглушка: «доступно в следующей фазе» (β-5 ProbeService).
 *   - `/help`    — список команд.
 *
 * Ответ доставляется через `ConversationalService.sendNotification`
 * (eventType='system.message') с `preferredChannelKinds=[binding.kind]` —
 * чтобы ответ ушёл туда же, откуда пришла команда. Используем
 * `originChannelBindingId` для прицельного выбора binding'а.
 *
 * Если `originChannelBindingId` не задан — отвечаем через in_app (последний
 * fallback стандартного routing'а).
 */
@Injectable()
export class CommandHandlerService implements OnModuleInit {
  private readonly logger = new Logger(CommandHandlerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  onModuleInit(): void {
    this.conversational.subscribeInbound('command', (msg) =>
      this.handle(msg),
    );
    this.logger.log('CommandHandlerService: subscribed to "command" inbound');
  }

  private async handle(msg: InboundMessage): Promise<void> {
    if (msg.type !== 'command') return;
    const { commandName, userId, tenantId } = msg;

    if (commandName === 'status') {
      await this.respondStatus({ userId, tenantId, msg });
      return;
    }
    if (commandName === 'myideas') {
      await this.respondMyIdeas({ userId, tenantId, msg });
      return;
    }
    if (commandName === 'help') {
      await this.respondHelp({ userId, tenantId, msg });
      return;
    }
    // unknown — отвечаем help'ом.
    await this.respondHelp({ userId, tenantId, msg });
  }

  // ─────────────────────────── handlers ────────────────────────────

  private async respondStatus(args: {
    userId: string;
    tenantId: string;
    msg: Extract<InboundMessage, { type: 'command' }>;
  }): Promise<void> {
    const pending = await this.prisma.notification.count({
      where: {
        tenantId: args.tenantId,
        recipientUserId: args.userId,
        responseStatus: 'pending',
      },
    });
    const unread = await this.prisma.notification.count({
      where: {
        tenantId: args.tenantId,
        recipientUserId: args.userId,
        status: { in: ['queued', 'sent_partial', 'delivered'] },
      },
    });

    const lines: string[] = [];
    if (pending === 0 && unread === 0) {
      lines.push('Всё спокойно: открытых вопросов нет.');
    } else {
      if (pending > 0) {
        lines.push(
          `Открытых вопросов от Коры: ${pending}. Ответьте кнопкой или текстом.`,
        );
      }
      if (unread > 0 && unread !== pending) {
        lines.push(`Непрочитанных уведомлений: ${unread}.`);
      }
    }
    lines.push('Доступные команды: /ask, /note, /idea, /status, /myideas, /help.');

    await this.reply({
      tenantId: args.tenantId,
      userId: args.userId,
      title: 'Статус',
      body: lines.join('\n'),
      originChannelBindingId: args.msg.originChannelBindingId,
    });
  }

  private async respondMyIdeas(args: {
    userId: string;
    tenantId: string;
    msg: Extract<InboundMessage, { type: 'command' }>;
  }): Promise<void> {
    // SBA β-5 — реальный listing идей пользователя (top-5).
    try {
      const personEntityIds = await this.findPersonEntityIdsForUser({
        userId: args.userId,
        tenantId: args.tenantId,
      });
      const ideas = await this.prisma.idea.findMany({
        where: {
          tenantId: args.tenantId,
          OR: [
            { createdByUserId: args.userId },
            ...(personEntityIds.length > 0
              ? [{ personSubjectIds: { hasSome: personEntityIds } }]
              : []),
          ],
        },
        orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      });
      const lines: string[] = [];
      if (ideas.length === 0) {
        lines.push('У вас пока нет идей. Сохраните одну командой /idea <текст>.');
      } else {
        lines.push(`Ваши идеи (топ ${ideas.length}):`);
        for (const i of ideas) {
          const statusRu = this.statusToRu(i.status);
          lines.push(`• «${i.statement.slice(0, 80)}» — ${statusRu}`);
        }
        lines.push('');
        lines.push('Открыть полный список: /ideas');
      }
      await this.reply({
        tenantId: args.tenantId,
        userId: args.userId,
        title: 'Мои идеи',
        body: lines.join('\n'),
        originChannelBindingId: args.msg.originChannelBindingId,
      });
    } catch (err) {
      this.logger.warn(
        {
          userId: args.userId,
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'respondMyIdeas: ошибка — fallback на пустой ответ',
      );
      await this.reply({
        tenantId: args.tenantId,
        userId: args.userId,
        title: 'Мои идеи',
        body: 'Сейчас не удалось получить список идей — попробуйте позже.',
        originChannelBindingId: args.msg.originChannelBindingId,
      });
    }
  }

  private statusToRu(status: string): string {
    const map: Record<string, string> = {
      captured: 'собрана',
      in_discussion: 'в обсуждении',
      accepted: 'принята',
      in_progress: 'в работе',
      shipped: 'выпущена',
      rejected: 'отклонена',
      archived: 'в архиве',
    };
    return map[status] ?? status;
  }

  private async findPersonEntityIdsForUser(args: {
    userId: string;
    tenantId: string;
  }): Promise<string[]> {
    const persons = await this.prisma.person.findMany({
      where: {
        userId: args.userId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { entityId: true },
    });
    return persons
      .map((p) => p.entityId)
      .filter((id): id is string => !!id);
  }

  private async respondHelp(args: {
    userId: string;
    tenantId: string;
    msg: Extract<InboundMessage, { type: 'command' }>;
  }): Promise<void> {
    const body = [
      'Я — Кора, память компании.',
      '',
      'Доступные команды:',
      '• /ask <вопрос> — задать вопрос помощнику по знаниям компании',
      '• /note <текст> — сохранить свободную заметку',
      '• /idea <текст> — сохранить идею',
      '• /status — статус ваших задач и вопросов',
      '• /myideas — мои идеи (скоро)',
      '• /link <код> — привязать аккаунт',
    ].join('\n');
    await this.reply({
      tenantId: args.tenantId,
      userId: args.userId,
      title: 'Помощь',
      body,
      originChannelBindingId: args.msg.originChannelBindingId,
    });
  }

  // ─────────────────────────── reply helper ────────────────────────

  private async reply(args: {
    tenantId: string;
    userId: string;
    title: string;
    body: string;
    originChannelBindingId?: string;
  }): Promise<void> {
    let preferredChannelKinds: undefined | Parameters<
      ConversationalService['sendNotification']
    >[0]['preferredChannelKinds'];

    if (args.originChannelBindingId) {
      const binding = await this.prisma.channelBinding.findUnique({
        where: { id: args.originChannelBindingId },
        include: { channel: true },
      });
      if (
        binding &&
        binding.userId === args.userId &&
        binding.channel.tenantId === args.tenantId &&
        binding.channel.status === 'active'
      ) {
        preferredChannelKinds = [binding.channel.kind];
      }
    }

    try {
      await this.conversational.sendNotification({
        tenantId: args.tenantId,
        recipientUserId: args.userId,
        eventType: 'system.message',
        payload: {
          title: args.title,
          body: args.body,
          severity: 'info',
        },
        // Команды и ответы на них — не sensitive, можно во внешние каналы.
        dataClass: 'internal',
        preferredChannelKinds,
        // Игнорируем quiet hours: пользователь сам нажал /status в боте.
        critical: true,
      });
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          userId: args.userId,
          tenantId: args.tenantId,
        },
        'CommandHandlerService.reply: sendNotification failed',
      );
    }
  }
}
