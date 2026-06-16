import { z } from 'zod';

export const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(10_000).nullable().optional(),
    defaultAssigneeId: z.string().max(64).nullable().optional(),
    defaultStateId: z.string().max(64).nullable().optional(),
    network: z.union([z.literal(0), z.literal(2)]).optional(),
    timezone: z.string().max(64).optional(),
    cycleViewEnabled: z.boolean().optional(),
    intakeViewEnabled: z.boolean().optional(),
    gantViewEnabled: z.boolean().optional(),
    timeTrackingEnabled: z.boolean().optional(),
    customerCardId: z.string().max(64).nullable().optional(),
    vendorId: z.string().max(64).nullable().optional(),
    subjectPersonId: z.string().max(64).nullable().optional(),
    departmentId: z.string().max(64).nullable().optional(),
  })
  .strict();

export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
