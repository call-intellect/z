import { apiClient } from "./api-client";
import type {
  CreateEmailTemplateRequest,
  EmailTemplateItemApi,
  EmailTemplateListApi,
  UpdateEmailTemplateRequest,
} from "@/domain/admin-email-template";

export const adminEmailTemplatesApi = {
  list: () =>
    apiClient.get<EmailTemplateListApi>(
      "/api/v1/admin/content/email-templates",
    ),

  create: (body: CreateEmailTemplateRequest) =>
    apiClient.post<EmailTemplateItemApi>(
      "/api/v1/admin/content/email-templates",
      body,
    ),

  update: (key: string, body: UpdateEmailTemplateRequest) =>
    apiClient.patch<EmailTemplateItemApi>(
      `/api/v1/admin/content/email-templates/${encodeURIComponent(key)}`,
      body,
    ),

  testSend: (key: string, to: string, variables?: Record<string, string>) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/content/email-templates/${encodeURIComponent(key)}/test-send`,
      variables ? { to, variables } : { to },
    ),
};
