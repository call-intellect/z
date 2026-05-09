import { apiClient } from './api-client';

/**
 * API DTO для модуля exports. Контракт — `backend/src/modules/exports/`.
 *
 * Создание: POST `/exports/meeting/:id/md|docx`, `/exports/bulk`.
 * Скачивание готового: GET `/exports/:id/download` → `{ url, expiresAt }`.
 */

export type ExportType =
  | 'meeting_md'
  | 'meeting_pdf'
  | 'meeting_docx'
  | 'bulk_zip';

export type ExportStatus =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'expired';

export type ExportApi = {
  id: string;
  userId: string;
  type: ExportType;
  meetingIds: string[];
  options: unknown;
  s3Key: string | null;
  status: ExportStatus;
  error: string | null;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ExportsListApiResponse = { items: ExportApi[] };

export type ExportDownloadApi = { url: string; expiresAt: string };

export type BulkExportRequest = {
  meetingIds: string[];
  includeTranscript?: boolean;
  includeAudio?: boolean;
  includeVideo?: boolean;
};

export const exportsApi = {
  list: () => apiClient.get<ExportsListApiResponse>('/api/v1/exports'),

  meetingMd: (meetingId: string) =>
    apiClient.post<{ exportId: string }>(
      `/api/v1/exports/meeting/${encodeURIComponent(meetingId)}/md`,
    ),

  meetingDocx: (meetingId: string) =>
    apiClient.post<{ exportId: string }>(
      `/api/v1/exports/meeting/${encodeURIComponent(meetingId)}/docx`,
    ),

  bulk: (body: BulkExportRequest) =>
    apiClient.post<{ exportId: string }>('/api/v1/exports/bulk', body),

  download: (exportId: string) =>
    apiClient.get<ExportDownloadApi>(
      `/api/v1/exports/${encodeURIComponent(exportId)}/download`,
    ),

  remove: (exportId: string) =>
    apiClient.del<void>(`/api/v1/exports/${encodeURIComponent(exportId)}`),
};
