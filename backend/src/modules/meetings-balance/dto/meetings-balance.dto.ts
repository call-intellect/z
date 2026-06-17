import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MeetingsBalanceResponseSchema = z.object({
  balance: z.number().int().nonnegative(),
  totalGranted: z.number().int().nonnegative(),
  totalConsumed: z.number().int().nonnegative(),
  lastGrantedAt: z.string().datetime().nullable(),
});

export type MeetingsBalanceResponseBody = z.infer<typeof MeetingsBalanceResponseSchema>;
export class MeetingsBalanceResponseDto extends createZodDto(MeetingsBalanceResponseSchema) {}
