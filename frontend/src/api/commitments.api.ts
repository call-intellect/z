import { apiClient } from './api-client';

import type { CommitmentApi } from './promises.api';

/**
 * SBA β-8.2 — API-клиент для COO-панели и страницы человека.
 *
 *   GET /api/v1/dashboard/operations/open-commitments?days=14&limit=100
 *     — все открытые/asked обещания команды (имена видны).
 *
 *   GET /api/v1/personal-relations/commitments?personId=&limit=50
 *     — исходящие + входящие обещания конкретного человека.
 *
 * Доступ: owner/admin/coo через `commitment.read` policy.
 */

export interface OpenCommitmentsListApi {
  items: CommitmentApi[];
  total: number;
}

export interface PersonCommitmentsApi {
  outgoing: CommitmentApi[];
  incoming: CommitmentApi[];
}

export const commitmentsApi = {
  listOpen: (params?: { days?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.days) q.set('days', String(params.days));
    if (params?.limit) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return apiClient.get<OpenCommitmentsListApi>(
      `/api/v1/dashboard/operations/open-commitments${suffix ? `?${suffix}` : ''}`,
    );
  },
  listForPerson: (personId: string, limit = 50) => {
    const q = new URLSearchParams({ personId, limit: String(limit) });
    return apiClient.get<PersonCommitmentsApi>(
      `/api/v1/personal-relations/commitments?${q.toString()}`,
    );
  },
};
