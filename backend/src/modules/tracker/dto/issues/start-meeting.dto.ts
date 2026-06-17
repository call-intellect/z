import { z } from 'zod';

export const StartMeetingFromIssueSchema = z
  .object({
    inviteUserIds: z.array(z.string().min(1).max(64)).max(32).default([]),
  })
  .strict();
export type StartMeetingFromIssueDto = z.infer<typeof StartMeetingFromIssueSchema>;

export interface StartMeetingFromIssueResponseDto {
  meetingId: string;
  meetingUrl: string;
  token: string;
}
