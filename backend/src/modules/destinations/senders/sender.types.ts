import type { IntegrationDestination } from '@prisma/client';

export interface SenderMessage {
  /** Заголовок (для email subject / push title). */
  title: string;
  /** Тело сообщения (markdown / plain). */
  body: string;
  /** Доп. payload для generic-webhook. */
  data?: Record<string, unknown>;
}

export interface DestinationSender {
  readonly type: string;
  send(destination: IntegrationDestination, message: SenderMessage): Promise<void>;
}
