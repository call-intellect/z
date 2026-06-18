export type SystemMessageType =
  | "banner"
  | "maintenance"
  | "alert"
  | (string & {});

export type SystemMessageSeverity =
  | "info"
  | "warning"
  | "critical"
  | (string & {});

export const SYSTEM_MESSAGE_SEVERITY_LABELS: Record<string, string> = {
  info: "Инфо",
  warning: "Предупреждение",
  critical: "Критично",
};

export type SystemMessageItemApi = {
  id: string;
  type: string;
  severity: string;
  body: string;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  targetOrgs: string[];
  createdBy: string;
  createdAt: string;
};

export type SystemMessageListApi = {
  items: SystemMessageItemApi[];
};

export type SystemMessageItemDomain = Omit<
  SystemMessageItemApi,
  "createdAt" | "startsAt" | "endsAt"
> & {
  createdAt: Date;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type SystemMessageListDomain = {
  items: SystemMessageItemDomain[];
};

export function systemMessageItemFromApi(
  api: SystemMessageItemApi,
): SystemMessageItemDomain {
  return {
    ...api,
    startsAt: api.startsAt ? new Date(api.startsAt) : null,
    endsAt: api.endsAt ? new Date(api.endsAt) : null,
    createdAt: new Date(api.createdAt),
  };
}

export function systemMessageListFromApi(
  api: SystemMessageListApi,
): SystemMessageListDomain {
  return { items: api.items.map(systemMessageItemFromApi) };
}

export type CreateSystemMessageRequest = {
  type: string;
  severity: string;
  body: string;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  targetOrgs?: string[];
};

export type UpdateSystemMessageRequest = Partial<CreateSystemMessageRequest>;
