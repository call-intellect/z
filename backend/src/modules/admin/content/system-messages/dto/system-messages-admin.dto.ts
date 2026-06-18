import { z } from 'zod';

export const SYSTEM_MESSAGE_TYPES = ['banner', 'maintenance', 'alert'] as const;
export type SystemMessageType = (typeof SYSTEM_MESSAGE_TYPES)[number];

export const SYSTEM_MESSAGE_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type SystemMessageSeverity = (typeof SYSTEM_MESSAGE_SEVERITIES)[number];

const IsoDateSchema = z
  .string()
  .datetime({ message: 'ISO-8601 ожидается' })
  .transform((s) => new Date(s));

export const ListSystemMessagesQuerySchema = z.object({
  type: z.enum(SYSTEM_MESSAGE_TYPES).optional(),
  isActive: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .optional(),
});
export type ListSystemMessagesQueryDto = z.infer<typeof ListSystemMessagesQuerySchema>;

export const CreateSystemMessageSchema = z.object({
  type: z.enum(SYSTEM_MESSAGE_TYPES),
  severity: z.enum(SYSTEM_MESSAGE_SEVERITIES),
  body: z.string().trim().min(1).max(10_000),
  startsAt: IsoDateSchema.optional(),
  endsAt: IsoDateSchema.optional(),
  targetOrgs: z.array(z.string().trim().min(1).max(64)).max(1000).optional(),
  isActive: z.boolean().optional(),
});
export type CreateSystemMessageDto = z.infer<typeof CreateSystemMessageSchema>;

export const UpdateSystemMessageSchema = z
  .object({
    type: z.enum(SYSTEM_MESSAGE_TYPES).optional(),
    severity: z.enum(SYSTEM_MESSAGE_SEVERITIES).optional(),
    body: z.string().trim().min(1).max(10_000).optional(),
    startsAt: IsoDateSchema.nullable().optional(),
    endsAt: IsoDateSchema.nullable().optional(),
    targetOrgs: z.array(z.string().trim().min(1).max(64)).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'необходимо указать хотя бы одно поле',
  });
export type UpdateSystemMessageDto = z.infer<typeof UpdateSystemMessageSchema>;
