export type RetentionPolicyApiDto = {
  type: string;
  days: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

export type RetentionPreviewApiDto = {
  type: string;
  currentDays: number;
  newDays: number;
  affectedCount: number;
  sampleIds: string[];
  warning: string | null;
};

export const RETENTION_TYPE_LABELS: Record<string, string> = {
  meeting_recording: "Записи встреч",
  share_view: "Просмотры shared записей",
  api_access_log: "Журнал API доступа",
  webhook_delivery: "Доставки webhook",
  soft_delete_grace: "Срок до полного удаления",
};

export type RetentionPolicyDomain = {
  type: string;
  displayName: string;
  days: number;
  description: string | null;
  updatedBy: string | null;
  updatedAt: Date;
};

export type RetentionPreviewDomain = {
  type: string;
  displayName: string;
  currentDays: number;
  newDays: number;
  affectedCount: number;
  sampleIds: string[];
  warning: string | null;
};

export function retentionPolicyFromApi(
  api: RetentionPolicyApiDto,
): RetentionPolicyDomain {
  return {
    type: api.type,
    displayName: RETENTION_TYPE_LABELS[api.type] ?? api.type,
    days: api.days,
    description: api.description,
    updatedBy: api.updatedBy,
    updatedAt: new Date(api.updatedAt),
  };
}

export function retentionPreviewFromApi(
  api: RetentionPreviewApiDto,
): RetentionPreviewDomain {
  return {
    type: api.type,
    displayName: RETENTION_TYPE_LABELS[api.type] ?? api.type,
    currentDays: api.currentDays,
    newDays: api.newDays,
    affectedCount: api.affectedCount,
    sampleIds: api.sampleIds,
    warning: api.warning,
  };
}
