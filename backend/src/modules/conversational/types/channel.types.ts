import type {
  Channel,
  ChannelBinding,
  ChannelKind,
  DataClass,
  Notification,
  NotificationDelivery,
} from '@prisma/client';

export type ConversationalJson =
  | string
  | number
  | boolean
  | null
  | { [k: string]: unknown }
  | unknown[];

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
      originChannelBindingId?: string;
    }
  | {
      type: 'daily_checkin_self';
      userId: string;
      tenantId: string;
      kind: 'morning' | 'evening';
      rawText: string;
      originChannelBindingId?: string;
    }
  | {
      type: 'assistant_turn';
      userId: string;
      tenantId: string;
      text: string;
      originChannelBindingId?: string;
      metadata?: Record<string, unknown>;
    };

export type ParsedResponse =
  | { kind: 'response'; notificationId: string; payload: ConversationalJson }
  | { kind: 'free_note'; text: string; metadata?: ConversationalJson }
  | { kind: 'chat_query'; question: string; conversationId?: string };

export interface IChannel {
  readonly kind: ChannelKind;

  readonly maxDataClass: DataClass;

  send(args: {
    delivery: NotificationDelivery;
    notification: Notification;
    binding: ChannelBinding;
    channel: Channel;
  }): Promise<{ externalMessageId: string | null }>;

  ingest?(rawMessage: ConversationalJson): Promise<InboundMessage>;

  parseResponse?(args: {
    rawMessage: ConversationalJson;
    openProbes: Notification[];
  }): Promise<ParsedResponse | null>;
}
