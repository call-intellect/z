import { MeetingType } from '@prisma/client';
import { z } from 'zod';

/**
 * Схема входного тела для `POST /integrations/crossmark/v1/meetings`.
 * Имена полей в API — snake_case (под Crossmark-партнёра); внутри Z мы их
 * нормализуем в `MeetingsService.createFromCrossmark`.
 */
export const CreateMeetingSchema = z.object({
  host: z.object({
    external_id: z.string().min(1, 'host.external_id обязателен'),
    email: z.string().email('host.email должен быть валидным email'),
    name: z.string().min(1).max(120, 'host.name максимум 120 символов'),
  }),
  type: z.nativeEnum(MeetingType),
  title: z.string().min(1).max(200, 'title максимум 200 символов'),
  custom_prompt: z.string().max(10000).nullish(),
});

export type CreateMeetingDto = z.infer<typeof CreateMeetingSchema>;

/**
 * Приглашённый на встречу (pre-seed Participant + доставка по каналам).
 * Используется и при создании встречи (`CreateMeetingForUserSchema.invitees`),
 * и при «допригласить» (`AddInviteesSchema`, B5 2026-06-06).
 */
export const InviteeSchema = z.object({
  userId: z.string().nullish(),
  personId: z.string().nullish(),
  email: z.string().email().nullish(),
  sendVia: z.array(z.enum(['email', 'telegram'])).default([]),
});

export type InviteeDto = z.infer<typeof InviteeSchema>;

/**
 * Схема для cookie-эндпоинта (Фаза 7.5).
 * Юзер уже есть (cookie), поэтому `host` не нужен.
 *
 * `card_id` (опц.) — встреча будет автоматически привязана к карточке владельца.
 * Используется при «Создать встречу из карточки» (deeplink с `?cardId=...`).
 */
export const CreateMeetingForUserSchema = z.object({
  type: z.nativeEnum(MeetingType),
  title: z.string().min(1).max(200),
  custom_prompt: z.string().max(10000).nullish(),
  card_id: z.string().min(1).max(50).nullish(),
  record_by_default: z.boolean().optional().default(true),
  invitees: z.array(InviteeSchema).max(50).optional().default([]),
});

export type CreateMeetingForUserDto = z.infer<typeof CreateMeetingForUserSchema>;

/**
 * Тело `POST /api/v1/meetings/:id/invitees` (B5 2026-06-06) — допригласить
 * участников на уже созданную / идущую встречу. Минимум один приглашённый.
 */
export const AddInviteesSchema = z.object({
  invitees: z.array(InviteeSchema).min(1).max(50),
});

export type AddInviteesDto = z.infer<typeof AddInviteesSchema>;
