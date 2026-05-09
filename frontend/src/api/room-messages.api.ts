import { apiClient } from './api-client';

/**
 * API DTO для in-meeting чата с persist через backend.
 * Источник правды — backend/src/modules/room-messages/.
 *
 * Сообщения сохраняются в `MeetingRoomMessage` (Prisma) и видны:
 * - опоздавшему гостю при join (история);
 * - на странице результата встречи (6-й таб «Чат»);
 * - на public share-странице (если `allowChat=true`).
 */

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
  /**
   * История сообщений встречи в порядке `sentAt asc`.
   * Опц. `since` — ISO-таймстамп для фильтра «новее чем».
   */
  history: (meetingId: string, since?: string) =>
    apiClient.get<RoomMessageApi[]>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/room-messages` +
        (since ? `?since=${encodeURIComponent(since)}` : ''),
    ),

  /**
   * Отправить сообщение. Идемпотентно по `clientMessageId`:
   * повторный POST с тем же id вернёт уже сохранённое сообщение (200).
   * На collision (тот же id для другой встречи) — 400.
   */
  send: (
    meetingId: string,
    body: { clientMessageId: string; content: string },
  ) =>
    apiClient.post<RoomMessageApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/room-messages`,
      body,
    ),
};
