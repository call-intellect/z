import { apiClient } from "./api-client";
import type {
  RetentionPolicyApiDto,
  RetentionPreviewApiDto,
} from "@/domain/admin-retention";

const BASE = "/api/v1/admin/media/retention";

export const adminRetentionApi = {
  list: (): Promise<RetentionPolicyApiDto[]> =>
    apiClient.get<RetentionPolicyApiDto[]>(BASE),

  update: (
    type: string,
    days: number,
    reason: string,
  ): Promise<RetentionPolicyApiDto> =>
    apiClient.patch<RetentionPolicyApiDto>(
      `${BASE}/${encodeURIComponent(type)}`,
      { days, reason },
    ),

  preview: (type: string, days: number): Promise<RetentionPreviewApiDto> =>
    apiClient.get<RetentionPreviewApiDto>(
      `${BASE}/${encodeURIComponent(type)}/preview?days=${encodeURIComponent(
        String(days),
      )}`,
    ),
};
