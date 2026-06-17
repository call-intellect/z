import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";

export type AdminSettingRowApi = {
  key: string;
  value: unknown;
  category: string;
  section: string;
  severity: string;
  schemaId: string | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
  comment: string | null;
};

export const COPY_SECTIONS = {
  GLOSSARY: "glossary",
  UI_STRINGS: "copy-strings",
} as const;

export type CopySection = (typeof COPY_SECTIONS)[keyof typeof COPY_SECTIONS];

export const adminCopyStringsApi = {
  list: (section?: CopySection) =>
    apiClient.get<AdminSettingRowApi[]>(
      `/api/v1/admin/settings${buildQuery({
        category: "content",
        section: section ?? "",
      })}`,
    ),

  set: (key: string, value: string, reason?: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/settings/${encodeURIComponent(key)}`,
      reason ? { value, reason } : { value },
    ),
};
