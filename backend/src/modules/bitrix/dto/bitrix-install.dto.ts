import { z } from 'zod';

import { BitrixDomainSchema } from './bitrix-integration.dto';

export const BitrixBindSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  memberId: z.string().trim().min(1),
  orgId: z.string().trim().min(1).optional(),
});
export type BitrixBindDto = z.infer<typeof BitrixBindSchema>;

export const BitrixClaimByDomainSchema = z.object({
  domain: BitrixDomainSchema,
});
export type BitrixClaimByDomainDto = z.infer<typeof BitrixClaimByDomainSchema>;

export type BitrixBindResult =
  | { status: 'bound'; portalDomain: string; koraUrl?: string }
  | { status: 'select_org'; orgs: { id: string; name: string }[] };
