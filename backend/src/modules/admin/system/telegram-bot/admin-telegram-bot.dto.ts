import { z } from 'zod';

export const TelegramBotSettingsResponseSchema = z.object({
  channelExists: z.boolean(),
  channelId: z.string().nullable(),
  tokenIsSet: z.boolean(),
  tokenLastChars: z.string().nullable(),
  webhookUrl: z.string(),
  webhookSecretIsSet: z.boolean(),
  botUsername: z.string().nullable(),
  status: z.enum(['active', 'disabled', 'broken', 'global_disabled']),
  brokenReason: z.string().nullable(),
  templates: z.object({
    welcome: z.string(),
    notLinked: z.string(),
    employeeOffboarded: z.string(),
    orgFrozen: z.string(),
  }),
  proxy: z.object({
    enabled: z.boolean(),
    apiBase: z.string(),
    healthy: z.boolean().nullable(),
    botId: z.string().nullable(),
    registeredAt: z.string().nullable(),
    lastSyncError: z.string().nullable(),
  }),
  updatedAt: z.string(),
});
export type TelegramBotSettingsResponseDto = z.infer<typeof TelegramBotSettingsResponseSchema>;

export const TelegramProxyPingResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number().int(),
  durationMs: z.number().int(),
  error: z.string().nullable(),
});
export type TelegramProxyPingResponseDto = z.infer<typeof TelegramProxyPingResponseSchema>;

export const UpdateTokenSchema = z.object({
  token: z
    .string()
    .min(10, 'Токен слишком короткий')
    .max(200, 'Токен слишком длинный')
    .regex(/^\d+:[A-Za-z0-9_-]+$/, 'Ожидаемый формат: <bot_id>:<secret>'),
});
export type UpdateTokenDto = z.infer<typeof UpdateTokenSchema>;

export const ResetWebhookSchema = z.object({
  webhookUrl: z.string().url().optional(),
});
export type ResetWebhookDto = z.infer<typeof ResetWebhookSchema>;

export const UpdateTemplatesSchema = z.object({
  welcome: z.string().min(1).max(2000).optional(),
  notLinked: z.string().min(1).max(2000).optional(),
  employeeOffboarded: z.string().min(1).max(2000).optional(),
  orgFrozen: z.string().min(1).max(2000).optional(),
});
export type UpdateTemplatesDto = z.infer<typeof UpdateTemplatesSchema>;

export const UpdateStatusSchema = z.object({
  status: z.enum(['active', 'global_disabled']),
});
export type UpdateStatusDto = z.infer<typeof UpdateStatusSchema>;

export type BindingStatus = 'linked' | 'pending' | 'no_membership' | 'bot_blocked' | 'inactive';

export const ListBindingsQuerySchema = z.object({
  orgId: z.string().min(1).max(64).optional(),
  status: z.enum(['linked', 'pending', 'no_membership', 'bot_blocked', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListBindingsQueryDto = z.infer<typeof ListBindingsQuerySchema>;

export const BindingRowSchema = z.object({
  id: z.string(),
  orgId: z.string().nullable(),
  orgName: z.string().nullable(),
  userId: z.string(),
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
  status: z.enum(['linked', 'pending', 'no_membership', 'bot_blocked', 'inactive']),
  linkedAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  inboundCount: z.number().int(),
  outboundCount: z.number().int(),
});
export type BindingRowDto = z.infer<typeof BindingRowSchema>;

export const BindingsPageSchema = z.object({
  items: z.array(BindingRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type BindingsPageDto = z.infer<typeof BindingsPageSchema>;
