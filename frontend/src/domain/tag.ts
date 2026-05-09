import type { TagApi } from '@/api/tags.api';

export type TagDomain = {
  id: string;
  name: string;
  color: string | null;
  meetingCount: number | null;
  createdAt: Date;
};

export function tagFromApi(api: TagApi): TagDomain {
  return {
    id: api.id,
    name: api.name,
    color: api.color ?? null,
    meetingCount: typeof api.meetingCount === 'number' ? api.meetingCount : null,
    createdAt: new Date(api.createdAt),
  };
}
