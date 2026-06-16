import { z } from 'zod';

export const CreateFromTemplateSchema = z
  .object({
    templateSlug: z
      .string()
      .min(2)
      .max(60)
      .regex(
        /^[a-z][a-z0-9_]*$/u,
        'Допустимы латинские буквы в нижнем регистре, цифры и подчёркивание',
      ),
    projectName: z.string().min(1).max(200),
    identifier: z
      .string()
      .min(2)
      .max(5)
      .regex(/^[A-Z][A-Z0-9]*$/u, 'Только заглавные латинские буквы и цифры, начиная с буквы'),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9-]+$/u, 'Допустимы только латинские буквы в нижнем регистре, цифры и дефис')
      .optional(),
    withExampleTasks: z.boolean().default(false),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();

export type CreateFromTemplateDto = z.infer<typeof CreateFromTemplateSchema>;
