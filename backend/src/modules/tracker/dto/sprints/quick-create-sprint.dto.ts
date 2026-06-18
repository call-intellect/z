import { z } from 'zod';

import { SPRINT_SCOPE_KIND_VALUES } from './sprint-list-item.dto';

export const QuickCreateSprintSchema = z
  .object({
    scope: z.enum(SPRINT_SCOPE_KIND_VALUES),
    refId: z.string().max(64).nullable().optional(),
    existingProjectId: z.string().max(64).nullable().optional(),
    sprintName: z.string().trim().min(1).max(120),
    durationDays: z.union([z.literal(7), z.literal(14), z.literal(21), z.literal(28)]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    timezone: z.string().max(64).optional().default('Europe/Moscow'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === 'project') {
      if (!v.existingProjectId || v.existingProjectId.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'existingProjectId обязателен при scope=project',
          path: ['existingProjectId'],
        });
      }
      if (v.refId && v.refId.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'refId не используется при scope=project',
          path: ['refId'],
        });
      }
      return;
    }
    if (v.scope === 'org') {
      if (v.refId && v.refId.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'refId не используется при scope=org',
          path: ['refId'],
        });
      }
      if (v.existingProjectId && v.existingProjectId.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'existingProjectId не используется при scope=org',
          path: ['existingProjectId'],
        });
      }
      return;
    }
    if (!v.refId || v.refId.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'refId обязателен для этого scope',
        path: ['refId'],
      });
    }
    if (v.existingProjectId && v.existingProjectId.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'existingProjectId не используется при scope=' + v.scope,
        path: ['existingProjectId'],
      });
    }
  });

export type QuickCreateSprintDto = z.infer<typeof QuickCreateSprintSchema>;

export interface QuickCreateSprintResponse {
  cycleId: string;
  projectId: string;
  projectIdentifier: string;
  projectSlug: string;
}
