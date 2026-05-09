import { z } from 'zod';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/u;

export const CreateTagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(HEX_COLOR, 'color должен быть в формате #RRGGBB')
    .optional(),
});

export type CreateTagDto = z.infer<typeof CreateTagSchema>;

export const UpdateTagSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    color: z
      .string()
      .regex(HEX_COLOR, 'color должен быть в формате #RRGGBB')
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'нужно передать хотя бы одно поле',
  });

export type UpdateTagDto = z.infer<typeof UpdateTagSchema>;

export const SetMeetingTagsSchema = z.object({
  tagIds: z.array(z.string().min(1)).max(100),
});

export type SetMeetingTagsDto = z.infer<typeof SetMeetingTagsSchema>;
