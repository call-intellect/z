import { apiClient } from './api-client';

export type SearchTypeKey = 'cards' | 'meetings' | 'tasks';

export type SearchCardItem = {
  id: string;
  name: string;
  kind: string;
  lastMeetingAt: string | null;
  meetingCount: number;
};

export type SearchMeetingItem = {
  id: string;
  title: string;
  type: string;
  cardId: string | null;
  createdAt: string;
};

export type SearchTaskItem = {
  id: string;
  title: string;
  status: string;
  meetingId: string;
};

export type SearchResponse = {
  cards: SearchCardItem[];
  meetings: SearchMeetingItem[];
  tasks: SearchTaskItem[];
};

export const searchApi = {
  query: (q: string, types?: SearchTypeKey[], limit = 10) => {
    const params = new URLSearchParams();
    params.set('q', q);
    if (types && types.length > 0) params.set('types', types.join(','));
    params.set('limit', String(limit));
    return apiClient.get<SearchResponse>(`/api/v1/search?${params.toString()}`);
  },
};
