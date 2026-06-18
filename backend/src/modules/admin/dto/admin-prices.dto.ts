import { z } from 'zod';

export const ListPricesQuerySchema = z.object({
  activeOnly: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1'))
    .default(false),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});
export type ListPricesQuery = z.infer<typeof ListPricesQuerySchema>;

export const SetPriceSchema = z.object({
  provider: z.string().min(1).max(50),
  model: z.string().min(1).max(100),
  inputCostPerMillionTokens: z.number().nonnegative(),
  outputCostPerMillionTokens: z.number().nonnegative(),
  cachedCostPerMillionTokens: z.number().nonnegative().default(0),
  currency: z.string().min(3).max(8).default('USD'),
  effectiveFrom: z.coerce.date().optional(),
});
export type SetPriceDto = z.infer<typeof SetPriceSchema>;
