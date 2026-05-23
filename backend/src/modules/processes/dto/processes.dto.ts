/**
 * DTO модуля Processes (SBA α-7 wave 2). REST API `/api/v1/processes/*` —
 * master-detail для `ProcessTemplate` + `ProcessTemplateVersion` +
 * `DecisionPoint` + `ProcessHandoff`.
 *
 * Все user-facing строки — на русском.
 */

import { z } from 'zod';

// ─────────────────────────── enums ──────────────────────────────────

/**
 * Status — общий для ProcessTemplate (Prisma enum `ProcessStatus`).
 * Соответствует Prisma enum `ProcessStatus` (active|deprecated|archived).
 * UI отображает «черновик» как computed состояние: status='active' AND
 * currentVersionId == null (т.е. ещё нет опубликованной версии).
 */
export const ProcessTemplateStatusSchema = z.enum([
  'active',
  'deprecated',
  'archived',
]);
export type ProcessTemplateStatusDto = z.infer<
  typeof ProcessTemplateStatusSchema
>;

export const ProcessTemplateVersionSourceSchema = z.enum([
  'manual',
  'agent',
  'imported',
]);
export type ProcessTemplateVersionSourceDto = z.infer<
  typeof ProcessTemplateVersionSourceSchema
>;

export const ProcessHandoffKindSchema = z.enum([
  'document',
  'data',
  'decision',
  'physical',
  'notification',
]);
export type ProcessHandoffKindDto = z.infer<typeof ProcessHandoffKindSchema>;

// ─────────────────────────── definition JSON ────────────────────────

/**
 * Структура `ProcessTemplateVersion.definitionJson`. Не вшита в schema.prisma
 * (там Json), но описана здесь как Zod-схема для валидации входящих
 * payload'ов из UI / extraction'а.
 */
export const ProcessStepDefinitionSchema = z.object({
  /** Имя шага (короткое, до 200 символов). */
  name: z.string().trim().min(1).max(200),
  /** Описание (что именно делается). */
  description: z.string().trim().max(2_000).optional(),
  /** Очередь (1-based, монотонно). */
  order: z.number().int().min(1),
  /** Owner (Role.id) — кто отвечает за шаг. Опц. */
  ownerRoleId: z.string().min(1).max(60).optional(),
  /** Входной артефакт (документ / решение / событие). Опц. */
  inputArtifact: z.string().trim().max(300).optional(),
  /** Выходной артефакт. Опц. */
  outputArtifact: z.string().trim().max(300).optional(),
  /** Ожидаемое SLA (минут). Опц. */
  slaMinutes: z.number().int().positive().optional(),
});
export type ProcessStepDefinitionDto = z.infer<
  typeof ProcessStepDefinitionSchema
>;

export const ProcessTemplateDefinitionSchema = z.object({
  steps: z.array(ProcessStepDefinitionSchema).max(50).default([]),
  /** Inline-описание handoff'ов (для UI-просмотра в version detail). */
  handoffsInline: z
    .array(
      z.object({
        fromStepOrder: z.number().int().min(1).optional(),
        toStepOrder: z.number().int().min(1).optional(),
        kind: ProcessHandoffKindSchema,
        payloadDescription: z.string().trim().max(500).optional(),
      }),
    )
    .max(50)
    .default([]),
  /** Inline-decision-points (UI-only mirror, реальная запись — в DecisionPoint). */
  decisionPointsInline: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        condition: z.string().trim().max(500).optional(),
        afterStepOrder: z.number().int().min(1).optional(),
      }),
    )
    .max(50)
    .default([]),
});
export type ProcessTemplateDefinitionDto = z.infer<
  typeof ProcessTemplateDefinitionSchema
>;

// ─────────────────────────── List query ─────────────────────────────

export const ListProcessTemplatesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: ProcessTemplateStatusSchema.optional(),
  ownerEntityId: z.string().min(1).max(60).optional(),
  /** Минимальная completeness (0..1). Фильтрует «незакрытые» template'ы. */
  completenessMin: z.coerce.number().min(0).max(1).optional(),
  /** Категория (см. ProcessTemplate.category). */
  category: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListProcessTemplatesQuery = z.infer<
  typeof ListProcessTemplatesQuerySchema
>;

// ─────────────────────────── Create / Update bodies ─────────────────

export const CreateProcessTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(2_000).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  scope: z.string().trim().min(1).max(120).optional(),
  ownerRoleId: z.string().min(1).max(60).optional(),
  ownerPersonId: z.string().min(1).max(60).optional(),
});
export type CreateProcessTemplateBody = z.infer<
  typeof CreateProcessTemplateBodySchema
>;

export const UpdateProcessTemplateBodySchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  summary: z.string().trim().max(2_000).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  scope: z.string().trim().min(1).max(120).optional(),
  ownerRoleId: z.string().min(1).max(60).nullable().optional(),
  ownerPersonId: z.string().min(1).max(60).nullable().optional(),
  status: ProcessTemplateStatusSchema.optional(),
});
export type UpdateProcessTemplateBody = z.infer<
  typeof UpdateProcessTemplateBodySchema
>;

export const CreateProcessTemplateVersionBodySchema = z.object({
  definition: ProcessTemplateDefinitionSchema,
  source: ProcessTemplateVersionSourceSchema.default('manual'),
  changeNote: z.string().trim().max(2_000).optional(),
  /** Сразу пометить новую версию как currentVersionId? (По умолчанию `false` — куратор активирует отдельно.) */
  activateImmediately: z.boolean().optional(),
});
export type CreateProcessTemplateVersionBody = z.infer<
  typeof CreateProcessTemplateVersionBodySchema
>;

// ─────────────────────────── DecisionPoint ──────────────────────────

export const ListDecisionPointsQuerySchema = z.object({
  templateId: z.string().min(1).max(60).optional(),
  templateVersionId: z.string().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListDecisionPointsQuery = z.infer<
  typeof ListDecisionPointsQuerySchema
>;

export const CreateDecisionPointBodySchema = z.object({
  templateId: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(300),
  condition: z.string().trim().max(2_000).optional(),
  branches: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500).optional(),
        /** Опц. ссылка на step (по order в definition'е). */
        leadsToStepOrder: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(10),
  decidedByRoleId: z.string().min(1).max(60).optional(),
  order: z.number().int().min(0).default(0),
});
export type CreateDecisionPointBody = z.infer<
  typeof CreateDecisionPointBodySchema
>;

export const UpdateDecisionPointBodySchema =
  CreateDecisionPointBodySchema.partial().omit({ templateId: true });
export type UpdateDecisionPointBody = z.infer<
  typeof UpdateDecisionPointBodySchema
>;

// ─────────────────────────── ProcessHandoff ─────────────────────────

export const ListProcessHandoffsQuerySchema = z.object({
  sourceTemplateId: z.string().min(1).max(60).optional(),
  targetTemplateId: z.string().min(1).max(60).optional(),
  kind: ProcessHandoffKindSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListProcessHandoffsQuery = z.infer<
  typeof ListProcessHandoffsQuerySchema
>;

export const CreateProcessHandoffBodySchema = z.object({
  fromTemplateId: z.string().min(1).max(60).optional(),
  toTemplateId: z.string().min(1).max(60).optional(),
  fromRoleId: z.string().min(1).max(60).optional(),
  toRoleId: z.string().min(1).max(60).optional(),
  kind: ProcessHandoffKindSchema,
  payloadDescription: z.string().trim().max(2_000).optional(),
  expectedSlaHours: z.number().int().min(0).max(24 * 365).optional(),
});
export type CreateProcessHandoffBody = z.infer<
  typeof CreateProcessHandoffBodySchema
>;

export const UpdateProcessHandoffBodySchema =
  CreateProcessHandoffBodySchema.partial();
export type UpdateProcessHandoffBody = z.infer<
  typeof UpdateProcessHandoffBodySchema
>;

// ─────────────────────────── Extract trigger ────────────────────────

export const ExtractProcessTemplateBodySchema = z.object({
  blockIds: z.array(z.string().min(1).max(60)).min(1).max(100),
});
export type ExtractProcessTemplateBody = z.infer<
  typeof ExtractProcessTemplateBodySchema
>;

// ─────────────────────────── Response DTOs ──────────────────────────

export interface ProcessTemplateListItemDto {
  id: string;
  name: string;
  summary: string | null;
  category: string | null;
  scope: string | null;
  status: ProcessTemplateStatusDto;
  currentVersionId: string | null;
  ownerRoleId: string | null;
  ownerPersonId: string | null;
  /** Completeness (0..1) — расчётный показатель «насколько заполнен шаблон». */
  completeness: number;
  stepsCount: number;
  decisionPointsCount: number;
  handoffsCount: number;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ProcessTemplateVersionDto {
  id: string;
  version: number;
  definition: ProcessTemplateDefinitionDto;
  source: ProcessTemplateVersionSourceDto;
  changeNote: string | null;
  publishedById: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface DecisionPointDto {
  id: string;
  templateId: string | null;
  name: string;
  condition: string | null;
  branches: Array<{
    name: string;
    description?: string;
    leadsToStepOrder?: number;
  }>;
  decidedByRoleId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessHandoffDto {
  id: string;
  fromTemplateId: string | null;
  toTemplateId: string | null;
  fromRoleId: string | null;
  toRoleId: string | null;
  kind: ProcessHandoffKindDto;
  payloadDescription: string | null;
  expectedSlaHours: number | null;
  knownFrictionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessTemplateDetailDto extends ProcessTemplateListItemDto {
  sourceBlockIds: string[];
  currentVersion: ProcessTemplateVersionDto | null;
  decisionPoints: DecisionPointDto[];
  handoffsFrom: ProcessHandoffDto[];
  handoffsTo: ProcessHandoffDto[];
}

export interface ListProcessTemplatesResponse {
  items: ProcessTemplateListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListProcessTemplateVersionsResponse {
  items: ProcessTemplateVersionDto[];
}

export interface ListDecisionPointsResponse {
  items: DecisionPointDto[];
  total: number;
}

export interface ListProcessHandoffsResponse {
  items: ProcessHandoffDto[];
  total: number;
}

export interface ExtractProcessTemplateResponse {
  ok: true;
  enqueuedJobId: string;
  blockIdsCount: number;
}
