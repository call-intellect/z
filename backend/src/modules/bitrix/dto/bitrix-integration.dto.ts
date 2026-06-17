import type { BitrixIntegrationStatus } from '@prisma/client';
import { z } from 'zod';


export const BitrixDomainSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .transform((v) =>
    v
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase(),
  )
  .refine((v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(v), {
    message: 'Некорректный домен портала Bitrix24',
  });

export const BitrixAuthorizeUrlQuerySchema = z.object({
  domain: BitrixDomainSchema,
});
export type BitrixAuthorizeUrlQueryDto = z.infer<
  typeof BitrixAuthorizeUrlQuerySchema
>;

export const BitrixClaimSchema = z.object({
  memberId: z.string().trim().min(1),
});
export type BitrixClaimDto = z.infer<typeof BitrixClaimSchema>;

export const BitrixAnalysisToggleSchema = z.object({
  enabled: z.boolean(),
});
export type BitrixAnalysisToggleDto = z.infer<typeof BitrixAnalysisToggleSchema>;

export const BitrixUserLinkSchema = z
  .object({
    mode: z.enum(['link', 'unlink', 'create']),
    personId: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.mode !== 'link' || !!v.personId, {
    message: 'personId обязателен для mode=link',
    path: ['personId'],
  });
export type BitrixUserLinkDto = z.infer<typeof BitrixUserLinkSchema>;

export interface BitrixUserDto {
  externalId: string;
  name: string | null;
  email: string | null;
  position: string | null;
  active: boolean;
  linkMode: 'none' | 'auto' | 'manual';
  linkedPersonId: string | null;
  linkedPersonName: string | null;
}

export interface BitrixPersonOptionDto {
  id: string;
  name: string | null;
  email: string | null;
}

export interface BitrixUsersResponseDto {
  users: BitrixUserDto[];
  personCandidates: BitrixPersonOptionDto[];
}

export interface BitrixIntegrationResponseDto {
  id: string;
  portalDomain: string;
  status: BitrixIntegrationStatus;
  scope: string | null;
  hasTokens: boolean;
  lastError: string | null;
  accessExpiresAt: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BitrixStatusResponseDto {
  integration: BitrixIntegrationResponseDto;
  analysisEnabled: boolean;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  counts: {
    users: number;
    dialogs: number;
    sessions: number;
    contacts: number;
    companies: number;
    deals: number;
    leads: number;
    notes: number;
  };
  sessionsByStatus: {
    pending: number;
    analyzing: number;
    done: number;
    failed: number;
  };
}
