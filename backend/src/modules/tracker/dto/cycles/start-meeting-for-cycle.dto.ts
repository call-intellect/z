import { z } from 'zod';

/**
 * Sprints (2026-05-27) — DTO запуска встречи по спринту.
 * `POST /api/v1/cycles/:id/start-meeting`. Default type='sprint_review'.
 *
 * См. plans/tz/2026-05-27-sprints.md §1.2.
 */
export const StartMeetingForCycleSchema = z
  .object({
    type: z
      .enum([
        'sprint_review',
        'team',
        'standup',
        'plan_fact',
        'project',
        'retrospective',
        'review',
      ])
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
