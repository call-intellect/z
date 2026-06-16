import { z } from 'zod';

export const CloneTypeSchema = z.enum(['person', 'role']);
export type CloneTypeDto = z.infer<typeof CloneTypeSchema>;

export const AccessGrantListQuerySchema = z
  .object({
    grantedToUserId: z.string().trim().min(1).max(64).optional(),
    grantedById: z.string().trim().min(1).max(64).optional(),
    cloneType: CloneTypeSchema.optional(),
    cloneRefId: z.string().trim().min(1).max(64).optional(),
    isActive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type AccessGrantListQueryDto = z.infer<typeof AccessGrantListQuerySchema>;

export const CreateAccessGrantSchema = z
  .object({
    grantedToUserId: z
      .string({ error: 'Не указан получатель гранта' })
      .trim()
      .min(1, 'Не указан получатель гранта')
      .max(64),
    cloneType: CloneTypeSchema,
    cloneRefId: z.string({ error: 'Не указан клон' }).trim().min(1, 'Не указан клон').max(64),
    expiresAt: z
      .string()
      .datetime({ message: 'Поле `expiresAt` должно быть ISO-датой' })
      .nullable()
      .optional()
      .default(null),
  })
  .strict();
export type CreateAccessGrantDto = z.infer<typeof CreateAccessGrantSchema>;

export const UpdateAccessGrantSchema = z
  .object({
    expiresAt: z
      .string()
      .datetime({ message: 'Поле `expiresAt` должно быть ISO-датой' })
      .nullable(),
  })
  .strict();
export type UpdateAccessGrantDto = z.infer<typeof UpdateAccessGrantSchema>;

export const AccessGrantPerCloneQuerySchema = z
  .object({
    includeInactive: z.coerce.boolean().optional().default(false),
  })
  .strict();
export type AccessGrantPerCloneQueryDto = z.infer<typeof AccessGrantPerCloneQuerySchema>;

export interface AccessGrantUserSummaryDto {
  userId: string;
  userName: string;
  userEmail?: string;
}

export interface AccessGrantDto {
  id: string;
  cloneType: 'person' | 'role';
  cloneRefId: string;
  cloneLabel: string;
  grantedTo: AccessGrantUserSummaryDto;
  grantedBy: AccessGrantUserSummaryDto;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: AccessGrantUserSummaryDto | null;
  isActive: boolean;
  inactiveReason: 'revoked' | 'expired' | null;
}

export interface AccessGrantListResponseDto {
  items: AccessGrantDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MyCloneAccessResponseDto {
  personClones: string[];
  roleClones: string[];
  fetchedAt: string;
}
