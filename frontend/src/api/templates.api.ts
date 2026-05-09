import { apiClient } from './api-client';
import type { MeetingType } from '@/domain/enums';

/**
 * API DTO для модуля templates (custom AI-templates под типы встреч).
 * Источник правды — backend/src/modules/templates/.
 */

export type TemplateApi = {
  id: string;
  name: string;
  description: string | null;
  /** Базовый тип встречи (наследует промпт). null = полностью кастомный. */
  baseType: MeetingType | null;
  customPrompt: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TemplateListApiResponse = { items: TemplateApi[] };

export type CreateTemplateRequest = {
  name: string;
  description?: string | null;
  baseType?: MeetingType | null;
  customPrompt?: string | null;
};

export type UpdateTemplateRequest = Partial<CreateTemplateRequest>;

export const templatesApi = {
  list: () => apiClient.get<TemplateListApiResponse>(`/api/v1/templates`),

  create: (body: CreateTemplateRequest) =>
    apiClient.post<TemplateApi>(`/api/v1/templates`, body),

  update: (templateId: string, body: UpdateTemplateRequest) =>
    apiClient.patch<TemplateApi>(
      `/api/v1/templates/${encodeURIComponent(templateId)}`,
      body,
    ),

  remove: (templateId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/templates/${encodeURIComponent(templateId)}`,
    ),
};
