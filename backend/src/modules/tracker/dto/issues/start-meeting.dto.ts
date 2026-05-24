import { z } from 'zod';

/**
 * DTO запуска встречи по задаче. Body опционален: если ничего не передано —
 * встреча создаётся только с хостом. `inviteUserIds` — список user.id, которых
 * сразу добавить как guest-Participant'ов. Чужих (не из tenant'а) тихо
 * отбрасываем.
 */
export const StartMeetingFromIssueSchema = z
  .object({
    inviteUserIds: z.array(z.string().min(1).max(64)).max(32).default([]),
  })
  .strict();
export type StartMeetingFromIssueDto = z.infer<
  typeof StartMeetingFromIssueSchema
>;

export interface StartMeetingFromIssueResponseDto {
  meetingId: string;
  meetingUrl: string;
  token: string;
}
