export type OrgTier = "basic" | "pro" | "enterprise";

export const ORG_TIER_LABELS: Record<OrgTier, string> = {
  basic: "Basic",
  pro: "Pro",
  enterprise: "Enterprise",
};

export type SubscriptionStatusUi =
  | "DEMO"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELED"
  | "EXPIRED";

export type PaymentModeUi = "paid" | "bonus" | "reference";

export type AdminOrgRowApi = {
  id: string;
  name: string;
  slug: string;
  tier: OrgTier;
  subscriptionStatus: SubscriptionStatusUi | null;
  paymentMode: PaymentModeUi | null;
  ownerId: string;
  ownerEmail: string | null;
  membersCount: number;
  meetingsCount: number;
  deletedAt: string | null;
  createdAt: string;
};

export type AdminOrgListApi = {
  items: AdminOrgRowApi[];
};

export type AdminOrgRowDomain = Omit<
  AdminOrgRowApi,
  "createdAt" | "deletedAt"
> & {
  createdAt: Date;
  deletedAt: Date | null;
  isFrozen: boolean;
};

export type AdminOrgListDomain = {
  items: AdminOrgRowDomain[];
};

export function adminOrgRowFromApi(api: AdminOrgRowApi): AdminOrgRowDomain {
  return {
    ...api,
    createdAt: new Date(api.createdAt),
    deletedAt: api.deletedAt ? new Date(api.deletedAt) : null,
    isFrozen: api.deletedAt !== null,
  };
}

export function adminOrgListFromApi(api: AdminOrgListApi): AdminOrgListDomain {
  return { items: api.items.map(adminOrgRowFromApi) };
}

export type UpdateOrgRequest = {
  tier?: OrgTier;
  freeze?: boolean;
};

export type OrgSubscriptionBadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "secondary";

export function orgSubscriptionLabel(
  status: SubscriptionStatusUi | null,
  paymentMode: PaymentModeUi | null,
): string {
  if (status === null || status === "DEMO") return "Демо";
  switch (status) {
    case "ACTIVE":
      if (paymentMode === "paid") return "Платный";
      if (paymentMode === "bonus") return "Бонус";
      if (paymentMode === "reference") return "Эталон";
      return "Активна";
    case "PAST_DUE":
      return "Просрочена";
    case "SUSPENDED":
      return "Заморожена оплата";
    case "CANCELED":
      return "Отменена";
    case "EXPIRED":
      return "Истекла";
    default:
      return "Демо";
  }
}

export function orgSubscriptionBadgeVariant(
  status: SubscriptionStatusUi | null,
  paymentMode: PaymentModeUi | null,
): OrgSubscriptionBadgeVariant {
  if (status === null || status === "DEMO") return "secondary";
  switch (status) {
    case "ACTIVE":
      if (paymentMode === "paid") return "success";
      if (paymentMode === "bonus") return "warning";
      if (paymentMode === "reference") return "secondary";
      return "default";
    case "PAST_DUE":
    case "SUSPENDED":
      return "danger";
    case "CANCELED":
    case "EXPIRED":
      return "secondary";
    default:
      return "secondary";
  }
}
