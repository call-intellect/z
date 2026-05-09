import type { RoomMessageApi } from '@/api/room-messages.api';

/**
 * Доменная модель in-meeting сообщения чата.
 * Источник правды — backend `MeetingRoomMessage` (Prisma).
 */
export type RoomMessageDomain = {
  id: string;
  meetingId: string;
  /** Денормализовано на момент отправки. Не зависит от существования Participant. */
  authorName: string;
  /** Идентичность LiveKit на момент отправки — для дедупа live-сообщений. */
  authorIdentity: string;
  content: string;
  clientMessageId: string;
  sentAt: Date;
  /** UI-only: пометка «отправлено до моего присоединения» (для divider'а). */
  fromHistory?: boolean;
  /** UI-only: пометка «не сохранено в истории» (POST упал, но live дошло). */
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
