import { apiClient } from "./api-client";

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export type TaskApi = {
  id: string;
  meetingId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeRaw: string | null;
  dueDate: string | null;
  sourceStartMs: number | null;
  sourceEndMs: number | null;
  sourceQuote: string | null;
  confidence: number | null;
  createdManually: boolean;
  createdAt: string;
  updatedAt: string;
  extractorVersion: string | null;
};

export type TasksListApiResponse = {
  items: TaskApi[];
  page: number;
  limit: number;
  total: number;
};

export type TasksMeetingListApiResponse = { items: TaskApi[] };

export type CreateTaskRequest = {
  title: string;
  description?: string | null;
  assigneeRaw?: string | null;
  dueDate?: string | null;
};

export type UpdateTaskRequest = {
  title?: string;
  description?: string | null;
  assigneeRaw?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
};

export type TaskFiltersRequest = {
  status?: TaskStatus[];
  meetingId?: string;
  dueBefore?: string;
  q?: string;
  page?: number;
  limit?: number;
};

export type SendTaskRequest = { destinationId: string };

export type BulkTasksRequest = {
  ids: string[];
  action: "mark_done" | "delete";
};

function buildTasksQuery(filters?: TaskFiltersRequest): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.meetingId) params.set("meetingId", filters.meetingId);
  if (filters.dueBefore) params.set("dueBefore", filters.dueBefore);
  if (filters.q) params.set("q", filters.q);
  if (filters.status) {
    for (const s of filters.status) params.append("status", s);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const tasksApi = {
  listForMeeting: (meetingId: string) =>
    apiClient.get<TasksMeetingListApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/tasks`,
    ),

  list: (filters?: TaskFiltersRequest) =>
    apiClient.get<TasksListApiResponse>(
      `/api/v1/tasks${buildTasksQuery(filters)}`,
    ),

  create: (meetingId: string, body: CreateTaskRequest) =>
    apiClient.post<TaskApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/tasks`,
      body,
    ),

  update: (taskId: string, body: UpdateTaskRequest) =>
    apiClient.patch<TaskApi>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}`,
      body,
    ),

  remove: (taskId: string) =>
    apiClient.del<void>(`/api/v1/tasks/${encodeURIComponent(taskId)}`),

  send: (taskId: string, body: SendTaskRequest) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/send`,
      body,
    ),

  bulk: (body: BulkTasksRequest) =>
    apiClient.post<{ affected: number; action: BulkTasksRequest["action"] }>(
      `/api/v1/tasks/bulk`,
      body,
    ),
};
