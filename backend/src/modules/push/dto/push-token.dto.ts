import { z } from 'zod';

export const PushTransportSchema = z.enum(['apns', 'fcm', 'rustore', 'webpush']);

export const RegisterPushTokenBodySchema = z.object({
  transport: PushTransportSchema,
  token: z.string().min(1, 'token обязателен').max(8_000),
  deviceInfo: z.record(z.string(), z.unknown()).optional(),
});
export type RegisterPushTokenBody = z.infer<typeof RegisterPushTokenBodySchema>;

export const UnregisterPushTokenBodySchema = z.object({
  token: z.string().min(1, 'token обязателен').max(8_000),
  transport: PushTransportSchema.optional(),
});
export type UnregisterPushTokenBody = z.infer<typeof UnregisterPushTokenBodySchema>;
