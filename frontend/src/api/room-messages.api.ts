import { apiClient } from "./api-client";

export type RoomMessageApi = {
  id: string;
  meetingId: string;
  participantId: string | null;
  authorName: string;
  authorIdentity: string;
  content: string;
  clientMessageId: string;
  sentAt: string;
};

export const roomMessagesApi = {
  history: async (
    meetingId: string,
    since?: string,
  ): Promise<RoomMessageApi[]> => {
    const res = await apiClient.get<{ items: RoomMessageApi[] }>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/room-messages` +
        (since ? `?since=${encodeURIComponent(since)}` : ""),
    );
    return res.items ?? [];
  },

  send: (
    meetingId: string,
    body: { clientMessageId: string; content: string },
  ) =>
    apiClient.post<RoomMessageApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/room-messages`,
      body,
    ),
};
