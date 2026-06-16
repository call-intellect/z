import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";

export type AppointmentStatusApi = "active" | "former" | "acting";

export interface AppointmentApi {
  id: string;
  tenantId: string;
  personId: string;
  personName: string | null;
  roleId: string;
  roleName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  loadPercent: number;
  status: AppointmentStatusApi;
  validFrom: string;
  validTo: string | null;
  sourceBlockIds: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentTimelineItemApi extends AppointmentApi {
  durationDays: number | null;
}

export interface ListAppointmentsRequest {
  personId?: string;
  roleId?: string;
  departmentId?: string;
  status?: AppointmentStatusApi;
  activeOnly?: boolean;
  limit?: number;
}

export interface CreateAppointmentRequest {
  personId: string;
  roleId: string;
  departmentId?: string | null;
  loadPercent?: number;
  status?: AppointmentStatusApi;
  validFrom?: string;
  validTo?: string | null;
}

export interface UpdateAppointmentRequest {
  departmentId?: string | null;
  loadPercent?: number;
  status?: AppointmentStatusApi;
  validFrom?: string;
  validTo?: string | null;
}

export const appointmentsApi = {
  list: (orgId: string, req: ListAppointmentsRequest = {}) =>
    apiClient.get<{ items: AppointmentApi[]; total: number }>(
      `/api/v1/appointments${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: (orgId: string, id: string) =>
    apiClient.get<AppointmentApi>(
      `/api/v1/appointments/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),

  personTimeline: (orgId: string, personId: string) =>
    apiClient.get<{ items: AppointmentTimelineItemApi[] }>(
      `/api/v1/appointments/persons/${encodeURIComponent(personId)}/timeline`,
      { headers: orgHeaders(orgId) },
    ),

  entityTimeline: (orgId: string, entityId: string) =>
    apiClient.get<{ items: AppointmentTimelineItemApi[] }>(
      `/api/v1/appointments/entities/${encodeURIComponent(entityId)}/timeline`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateAppointmentRequest) =>
    apiClient.post<AppointmentApi>(`/api/v1/appointments`, body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, id: string, body: UpdateAppointmentRequest) =>
    apiClient.patch<AppointmentApi>(
      `/api/v1/appointments/${encodeURIComponent(id)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  archive: (orgId: string, id: string) =>
    apiClient.del<AppointmentApi>(
      `/api/v1/appointments/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    ),
};
