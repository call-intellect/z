import type { IntegrationDestination } from '@prisma/client';

export interface SenderMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface DestinationSender {
  readonly type: string;
  send(destination: IntegrationDestination, message: SenderMessage): Promise<void>;
}
