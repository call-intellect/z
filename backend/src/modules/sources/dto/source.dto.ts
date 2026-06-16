import { DataClass, SourceType } from '@prisma/client';
import { z } from 'zod';

const TypeSchema = z.nativeEnum(SourceType);
const DataClassSchema = z.nativeEnum(DataClass);
const ConfigSchema = z.record(z.string(), z.unknown()).nullable();

export const SourceCreateSchema = z.object({
  type: TypeSchema,
  name: z.string().trim().min(1).max(200),
  config: ConfigSchema.optional(),
  dataClass: DataClassSchema.optional(),
});
export type SourceCreateDto = z.infer<typeof SourceCreateSchema>;

export const SourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  config: ConfigSchema.optional(),
  dataClass: DataClassSchema.optional(),
  isActive: z.boolean().optional(),
});
export type SourceUpdateDto = z.infer<typeof SourceUpdateSchema>;

export const SourceListQuerySchema = z.object({
  type: TypeSchema.optional(),
});
export type SourceListQuery = z.infer<typeof SourceListQuerySchema>;

export interface SourceResponseDto {
  id: string;
  tenantId: string;
  type: SourceType;
  name: string;
  config: Record<string, unknown> | null;
  dataClass: DataClass;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  webhookUrl?: string;
  lastEventAt?: string | null;
}

export interface SourceListResponseDto {
  items: SourceResponseDto[];
  total: number;
}

export interface SourceTestResultDto {
  ok: boolean;
  details?: Record<string, unknown>;
  errorMessage?: string;
}
