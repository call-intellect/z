import type {
  Channel,
  ChannelBinding,
  ChannelKind,
  DataClass,
  Notification,
  NotificationDelivery,
} from '@prisma/client';

/**
 * Универсальная JSON-структура (избегаем `any`). Совместима с
 * `Prisma.InputJsonValue` и принимает любой объект с unknown-значениями
 * (Zod `z.record(z.string(), z.unknown())` выдаёт именно такой тип).
 */
export type ConversationalJson =
  | string
  | number
  | boolean
  | null
  | { [k: string]: unknown }
  | unknown[];

/**
 * Inbound-сообщение, полученное от внешнего канала или от внутреннего
 * UI-канала (in_app). Четыре типа — каждый идёт по своему пути:
 *   - `free_note`     → создаётся `RawEvent` через `IngestService`;
 *   - `response`      → разрешает открытый `Notification` (probe);
 *   - `chat_query`    → передаётся подписанному chat-handler'у (α-5);
 *   - `command`       → slash-command от бота (`/status`, `/myideas`, ...),
 *                        обрабатывается ConversationalService встроенным
 *                        command-handler'ом (SBA β-1).
 */
export type InboundMessage =
  | {
      type: 'free_note';
      userId: string;
      tenantId: string;
      text: string;
      metadata?: ConversationalJson;
      originChannelBindingId?: string;
    }
  | {
      type: 'response';
      userId: string;
      tenantId: string;
      notificationId: string;
      payload: ConversationalJson;
      originChannelBindingId?: string;
    }
  | {
      type: 'chat_query';
      userId: string;
      tenantId: string;
      question: string;
      conversationId?: string;
      /**
       * SBA α-5: id `ChannelBinding`'а, через который пришёл вопрос. Если
       * задан — ответ адресуется в первую очередь через этот канал
       * (см. ConversationalService.sendChatReply). NULL/undefined для in_app
       * (web-UI), где привязка не важна.
       */
      originChannelBindingId?: string;
    }
  | {
      type: 'command';
      userId: string;
      tenantId: string;
      /** Имя команды без слэша: `status`, `myideas`, `help`. */
      commandName: string;
      /** Сырой аргумент-хвост после команды (если есть). */
      args?: string;
      originChannelBindingId?: string;
    };

/**
 * Результат парсинга сообщения из канала через `parseResponse`. Используется
 * для inbound-постов через webhook/poll: канал решает, относится ли это
 * сообщение к одному из открытых `Notification` (probe-ответ) или к
 * свободному ингесту (free_note).
 */
export type ParsedResponse =
  | { kind: 'response'; notificationId: string; payload: ConversationalJson }
  | { kind: 'free_note'; text: string; metadata?: ConversationalJson }
  | { kind: 'chat_query'; question: string; conversationId?: string };

/**
 * Контракт канала. Каждый адаптер (in_app, email_smtp, telegram_bot, ...)
 * реализует его. Адаптеры регистрируются в `ChannelRegistry` через
 * `@Injectable()` + `register(adapter)` (см. `channel-registry.ts`).
 */
export interface IChannel {
  readonly kind: ChannelKind;

  /**
   * Верхняя граница `DataClass`, которую этот тип канала готов принять
   * по-умолчанию. Может быть переопределена per-`Channel.maxDataClass`
   * (более строгой). Чувствительные probe не уходят во внешние каналы.
   */
  readonly maxDataClass: DataClass;

  /**
   * Отправить нотификацию. Адаптер не сам инициирует retry-логику —
   * outbound-воркер вызывает `send` и интерпретирует возврат/exception.
   * При успехе возвращает внешний messageId (для трассировки).
   */
  send(args: {
    delivery: NotificationDelivery;
    notification: Notification;
    binding: ChannelBinding;
    channel: Channel;
  }): Promise<{ externalMessageId: string | null }>;

  /**
   * Принять «сырое» входящее сообщение из канала. Превращает его в
   * нормализованный `InboundMessage`. Для in_app не используется
   * (inbound идёт через REST-эндпоинты, см. `respondToProbe`).
   * Опционально для α-1; в α-1 у нас только in_app + email_smtp
   * (последний — outbound-only).
   */
  ingest?(rawMessage: ConversationalJson): Promise<InboundMessage>;

  /**
   * Попытка распознать, что входящее сообщение — это ответ на один
   * из открытых probe'ов. Используется в β-1 (telegram/max/imap).
   */
  parseResponse?(args: {
    rawMessage: ConversationalJson;
    openProbes: Notification[];
  }): Promise<ParsedResponse | null>;
}
