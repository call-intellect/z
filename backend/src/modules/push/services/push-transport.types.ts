export type PushTransport = 'apns' | 'fcm' | 'rustore' | 'webpush';

export interface PushTransportPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushTransportSendResult {
  ok: boolean;
  invalidToken?: boolean;
}

export interface PushTransportSender {
  readonly transport: PushTransport;
  isConfigured(): boolean;
  sendToToken(args: { token: string; payload: PushTransportPayload }): Promise<PushTransportSendResult>;
}

export const PUSH_TRANSPORT_SENDERS = Symbol('PUSH_TRANSPORT_SENDERS');
