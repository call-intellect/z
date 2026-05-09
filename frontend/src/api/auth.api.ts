import { apiClient } from './api-client';
import type { UserRole } from '@/domain/enums';

export type UserApi = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export const authApi = {
  me: () => apiClient.get<{ user: UserApi | null }>('/api/v1/auth/me'),
  exchange: (token: string, meetingId: string) =>
    apiClient.get<{ ok: true; redirect: string }>(
      `/api/v1/auth/exchange?token=${encodeURIComponent(token)}&meeting_id=${encodeURIComponent(meetingId)}`,
    ),
  logout: () => apiClient.post<{ ok: true }>('/api/v1/auth/logout'),
};
