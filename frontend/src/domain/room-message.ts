import type { RoomMessageApi } from "@/api/room-messages.api";

export type RoomMessageDomain = {
  id: string;
  meetingId: string;
  authorName: string;
  authorIdentity: string;
  content: string;
  clientMessageId: string;
  sentAt: Date;
  fromHistory?: boolean;
  notPersisted?: boolean;
};

export function roomMessageFromApi(
  api: RoomMessageApi,
  opts?: { fromHistory?: boolean },
): RoomMessageDomain {
  return {
    id: api.id,
    meetingId: api.meetingId,
    authorName: api.authorName,
    authorIdentity: api.authorIdentity,
    content: api.content,
    clientMessageId: api.clientMessageId,
    sentAt: new Date(api.sentAt),
    fromHistory: opts?.fromHistory ?? false,
  };
}
