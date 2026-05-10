import { z } from 'zod';

/**
 * Создать новую Org. Используется при ручном создании (не lead-style register —
 * там Org создаётся в той же транзакции AccountsService.register).
 */
export const CreateOrgSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(120),
});

export type CreateOrgDto = z.infer<typeof CreateOrgSchema>;
