import { z } from 'zod';

export const StartMeetingForCycleSchema = z
  .object({
    type: z
      .enum(['sprint_review', 'team', 'standup', 'plan_fact', 'project', 'retrospective', 'review'])
      .default('sprint_review'),
    title: z.string().min(1).max(200).optional(),
    inviteUserIds: z.array(z.string().min(1).max(64)).max(32).default([]),
  })
  .strict();

export type StartMeetingForCycleDto = z.infer<typeof StartMeetingForCycleSchema>;

export interface StartMeetingForCycleResponseDto {
  meetingId: string;
  meetingUrl: string;
  token: string;
}
