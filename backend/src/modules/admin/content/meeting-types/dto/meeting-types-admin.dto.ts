import { MeetingType } from '@prisma/client';
import { z } from 'zod';

export const MEETING_TYPE_IDS = Object.values(MeetingType) as readonly string[];

const MeetingTypeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((v) => MEETING_TYPE_IDS.includes(v), {
    message: 'id должен совпадать со значением enum MeetingType',
  });

export const CreateMeetingTypeSchema = z.object({
  id: MeetingTypeIdSchema,
  displayName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  icon: z.string().trim().max(64).optional(),
  reportPromptKey: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreateMeetingTypeDto = z.infer<typeof CreateMeetingTypeSchema>;

export const UpdateMeetingTypeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    icon: z.string().trim().max(64).nullable().optional(),
    reportPromptKey: z.string().trim().min(1).max(200).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'необходимо указать хотя бы одно поле',
  });
export type UpdateMeetingTypeDto = z.infer<typeof UpdateMeetingTypeSchema>;
