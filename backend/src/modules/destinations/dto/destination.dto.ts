import { DestinationType } from '@prisma/client';
import { z } from 'zod';

const EmailConfigSchema = z.object({
  recipient_email: z.string().email().max(254),
});

const SlackConfigSchema = z.object({
  url: z.string().url().max(2000),
});

const TelegramConfigSchema = z.object({
  bot_token: z.string().min(10).max(500),
  chat_id: z.union([z.string().min(1).max(100), z.number().int()]),
});

const GenericWebhookConfigSchema = z.object({
  url: z.string().url().max(2000),
});

export const CreateDestinationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(DestinationType.email),
    name: z.string().trim().min(1).max(100),
    config: EmailConfigSchema,
  }),
  z.object({
    type: z.literal(DestinationType.slack_webhook),
    name: z.string().trim().min(1).max(100),
    config: SlackConfigSchema,
  }),
  z.object({
    type: z.literal(DestinationType.telegram_bot),
    name: z.string().trim().min(1).max(100),
    config: TelegramConfigSchema,
  }),
  z.object({
    type: z.literal(DestinationType.generic_webhook),
    name: z.string().trim().min(1).max(100),
    config: GenericWebhookConfigSchema,
  }),
]);

export type CreateDestinationDto = z.infer<typeof CreateDestinationSchema>;

export const UpdateDestinationSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
});

export type UpdateDestinationDto = z.infer<typeof UpdateDestinationSchema>;

export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type GenericWebhookConfig = z.infer<typeof GenericWebhookConfigSchema>;
