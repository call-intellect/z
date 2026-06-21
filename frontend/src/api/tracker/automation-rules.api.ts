import { apiClient } from "../api-client";
import { orgHeaders } from "../admin-helpers";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationRuleApi,
  AutomationTrigger,
} from "@/domain/tracker/automation-rule";

export interface CreateAutomationRuleRequest {
  projectId?: string | null;
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  conditions?: AutomationCondition[];
  actions: AutomationAction[];
}

export interface UpdateAutomationRuleRequest {
  name?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  conditions?: AutomationCondition[];
  actions?: AutomationAction[];
}

export const automationRulesApi = {
  list: (orgId: string, projectId?: string | null) =>
    apiClient.get<AutomationRuleApi[]>(
      `/api/v1/automation-rules${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateAutomationRuleRequest) =>
    apiClient.post<AutomationRuleApi>(`/api/v1/automation-rules`, body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateAutomationRuleRequest) =>
    apiClient.patch<AutomationRuleApi>(
      `/api/v1/automation-rules/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  remove: (orgId: string, id: string) =>
    apiClient.del<void>(
      `/api/v1/automation-rules/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),
};
