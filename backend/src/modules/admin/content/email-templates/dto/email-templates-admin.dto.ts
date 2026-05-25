/**
 * Admin-redesign Фаза 5 — DTO для `EmailTemplatesAdminController`.
 *
 * CRUD шаблонов писем (`EmailTemplate`). Поле `variables` хранит
 * `{ varName: description }` — описание переменных для preview-renderer'а.
 */

import { z } from 'zod';

export const EMAIL_TEMPLATE_CATEGORIES = [
  'transactional',
  'marketing',
  'system',
] as const;
export type EmailTemplateCategory = (typeof EMAIL_TEMPLATE_CATEGORIES)[number];

const KeySchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9_.-]+$/i, 'key может содержать только латиницу, цифры, _.-');

const VariablesSchema = z.record(z.string(), z.string());

export const CreateEmailTemplateSchema = z.object({
  key: KeySchema,
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(50_000),
  htmlBody: z.string().trim().max(200_000).optional(),
  variables: VariablesSchema,
  category: z.enum(EMAIL_TEMPLATE_CATEGORIES),
});
export type CreateEmailTemplateDto = z.infer<typeof CreateEmailTemplateSchema>;

export const UpdateEmailTemplateSchema = z
  .object({
    subject: z.string().trim().min(1).max(998).optional(),
    body: z.string().trim().min(1).max(50_000).optional(),
    htmlBody: z.string().trim().max(200_000).nullable().optional(),
    variables: VariablesSchema.optional(),
    category: z.enum(EMAIL_TEMPLATE_CATEGORIES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'необходимо указать хотя бы одно поле',
  });
export type UpdateEmailTemplateDto = z.infer<typeof UpdateEmailTemplateSchema>;

export const TestSendEmailTemplateSchema = z.object({
  to: z.string().trim().email('некорректный email').max(254),
});
export type TestSendEmailTemplateDto = z.infer<typeof TestSendEmailTemplateSchema>;
