import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const InnSchema = z
  .string()
  .trim()
  .regex(/^(\d{10}|\d{12})$/, 'ИНН должен содержать 10 или 12 цифр');

export const InnLookupResultSchema = z.object({
  source: z.enum(['mock', 'dadata', 'tochka']),
  payerType: z.enum(['legal_entity', 'individual_entrepreneur', 'self_employed']),
  legalName: z.string(),
  inn: z.string(),
  kpp: z.string().nullable().optional(),
  ogrn: z.string().nullable().optional(),
  legalAddress: z.string().nullable().optional(),
  directorName: z.string().nullable().optional(),
  bankBik: z.string().nullable().optional(),
  bankAccount: z.string().nullable().optional(),
  cached: z.boolean(),
});

export type InnLookupResultBody = z.infer<typeof InnLookupResultSchema>;
export class InnLookupResultDto extends createZodDto(InnLookupResultSchema) {}

export const InnLookupBodySchema = z.object({
  inn: InnSchema,
});

export type InnLookupBody = z.infer<typeof InnLookupBodySchema>;

export const InnInvalidateBodySchema = z.object({
  inn: InnSchema,
});

export type InnInvalidateBody = z.infer<typeof InnInvalidateBodySchema>;

export const InnInvalidateResultSchema = z.object({
  deleted: z.number().int().nonnegative(),
});

export type InnInvalidateResultBody = z.infer<typeof InnInvalidateResultSchema>;
export class InnInvalidateResultDto extends createZodDto(InnInvalidateResultSchema) {}
