import type { ShareApi, ShareScope } from '@/api/shares.api';

export type ShareDomain = {
  id: string;
  scope: ShareScope;
  resourceId: string;
  token: string;
  url: string;
  allowVideo: boolean;
  allowTranscript: boolean;
  allowTasks: boolean;
  allowChapters: boolean;
  allowChat: boolean;
  expiresAt: Date | null;
  viewCount: number;
  createdAt: Date;
};

export function shareFromApi(api: ShareApi): ShareDomain {
  return {
    id: api.id,
    scope: api.scope,
    resourceId: api.resourceId,
    token: api.token,
    url: api.url,
    allowVideo: api.allowVideo,
    allowTranscript: api.allowTranscript,
    allowTasks: api.allowTasks,
    allowChapters: api.allowChapters,
    allowChat: api.allowChat ?? false,
    expiresAt: api.expiresAt ? new Date(api.expiresAt) : null,
    viewCount: api.viewCount,
    createdAt: new Date(api.createdAt),
  };
}
