export const MEMBERSHIP_CREATED = 'membership.created' as const;
export const MEMBERSHIP_REMOVED = 'membership.removed' as const;

export interface MembershipCreatedPayload {
  tenantId: string;
  userId: string;
}

export interface MembershipRemovedPayload {
  tenantId: string;
  userId: string;
}
