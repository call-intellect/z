import { MeetingType } from '@prisma/client';
import { z } from 'zod';

export const CreateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  basedOnType: z.nativeEnum(MeetingType).optional(),
  prompt: z.string().max(10_000).nullish(),
  sectionsConfig: z.array(z.string().min(1).max(100)).max(50),
});

export type CreateTemplateDto = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    basedOnType: z.nativeEnum(MeetingType).nullish(),
    prompt: z.string().max(10_000).nullish(),
    sectionsConfig: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'нужно передать хотя бы одно поле',
  });

export type UpdateTemplateDto = z.infer<typeof UpdateTemplateSchema>;
