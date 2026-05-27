/**
 * DTO для эндпоинта баланса встреч.
 * См. plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md §11.1.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MeetingsBalanceResponseSchema = z.object({
  balance: z.number().int().nonnegative(),
  totalGranted: z.number().int().nonnegative(),
  totalConsumed: z.number().int().nonnegative(),
  lastGrantedAt: z.string().datetime().nullable(),
});

export type MeetingsBalanceResponseBody = z.infer<
  typeof MeetingsBalanceResponseSchema
>;
export class MeetingsBalanceResponseDto extends createZodDto(
  MeetingsBalanceResponseSchema,
) {}
