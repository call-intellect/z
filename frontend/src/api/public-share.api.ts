import { apiClient } from "./api-client";

export type PublicShareMeetingApi = {
  meeting: {
    id: string;
    title: string;
    type: string;
    durationMs: number;
    startedAt: string | null;
  };
  permissions: {
    allowVideo: boolean;
    allowTranscript: boolean;
    allowTasks: boolean;
    allowChapters: boolean;
    allowChat: boolean;
  };
  messages?: Array<{
    id: string;
    authorName: string;
    content: string;
    sentAt: string;
  }>;
  summary: string | null;
  tasks: Array<{
    id: string;
    title: string;
    assignee: string | null;
    dueDate: string | null;
    status: string;
  }> | null;
  chapters: Array<{
    id: string;
    startMs: number;
    endMs: number;
    title: string;
    summary: string | null;
  }> | null;
  videoUrl: string | null;
  transcript: Array<{
    id: string;
    startMs: number;
    speakerName: string | null;
    text: string;
  }> | null;
  expiresAt: string | null;
};

export type PublicShareClipApi = {
  highlight: {
    id: string;
    title: string;
    durationMs: number;
  };
  videoUrl: string;
  expiresAt: string | null;
};

export const publicShareApi = {
  getMeeting: (token: string) =>
    apiClient.get<PublicShareMeetingApi>(
      `/api/v1/public/share/${encodeURIComponent(token)}`,
    ),

  getClip: (token: string) =>
    apiClient.get<PublicShareClipApi>(
      `/api/v1/public/share/clip/${encodeURIComponent(token)}`,
    ),
};
