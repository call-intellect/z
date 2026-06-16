import { MeetingType } from '@prisma/client';
import { z } from 'zod';

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

export const InviteeSchema = z.object({
  userId: z.string().nullish(),
  personId: z.string().nullish(),
  email: z.string().email().nullish(),
  sendVia: z.array(z.enum(['email', 'telegram'])).default([]),
});

export type InviteeDto = z.infer<typeof InviteeSchema>;

export const CreateMeetingForUserSchema = z.object({
  type: z.nativeEnum(MeetingType),
  title: z.string().min(1).max(200),
  custom_prompt: z.string().max(10000).nullish(),
  card_id: z.string().min(1).max(50).nullish(),
  record_by_default: z.boolean().optional().default(true),
  invitees: z.array(InviteeSchema).max(50).optional().default([]),
  closed_group_kind: z.enum(['leadership', 'council', 'personal']).nullish(),
});

export type CreateMeetingForUserDto = z.infer<typeof CreateMeetingForUserSchema>;

export const AddInviteesSchema = z.object({
  invitees: z.array(InviteeSchema).min(1).max(50),
});

export type AddInviteesDto = z.infer<typeof AddInviteesSchema>;
