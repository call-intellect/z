import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const WelcomePatchSchema = z.object({
  teamSize: z.string().max(20).optional(),
  industry: z.string().max(120).optional(),
  painPoints: z.array(z.string()).optional(),
  currentStack: z.array(z.string()).optional(),
  plannedFeatures: z.array(z.string()).optional(),
});

export class WelcomePatchDto extends createZodDto(WelcomePatchSchema) {}
export type WelcomePatchBody = z.infer<typeof WelcomePatchSchema>;
