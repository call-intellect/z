import type { TemplateApi } from '@/api/templates.api';
import type { MeetingType } from './enums';

export type TemplateDomain = {
  id: string;
  name: string;
  description: string | null;
  baseType: MeetingType | null;
  customPrompt: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function templateFromApi(api: TemplateApi): TemplateDomain {
  return {
    id: api.id,
    name: api.name,
    description: api.description ?? null,
    baseType: api.baseType ?? null,
    customPrompt: api.customPrompt ?? null,
    isSystem: api.isSystem,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}
