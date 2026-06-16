import { z } from 'zod';

export const SetWebhookSchema = z.object({
  url: z.string().url().optional(),
});
export type SetWebhookDto = z.infer<typeof SetWebhookSchema>;

export interface MaskedSecret {
  isSet: boolean;
  lastChars: string | null;
}

export interface BotStatusResponseDto {
  kind: 'telegram' | 'max';
  channelExists: boolean;
  token: MaskedSecret;
  webhookUrl: string | null;
  lastWebhookAt: string | null;
  globalRps: number;
  quietHours: string | null;
  status: string | null;
  apiBase: string;
}

export interface EmailInboxStatusResponseDto {
  enabled: boolean;
  host: string | null;
  port: number | null;
  user: string | null;
  tls: boolean;
  folder: string | null;
  pollCron: string | null;
  maxPerRun: number | null;
  domain: string | null;
  lastFetchAt: string | null;
}

export interface BotWebhookActionResponseDto {
  ok: true;
  webhookUrl: string | null;
  appliedAt: string;
}

export interface EmailInboxTestResponseDto {
  ok: boolean;
  message: string;
  greeting?: string;
}
