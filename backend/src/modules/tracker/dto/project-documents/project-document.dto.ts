import { z } from 'zod';

export const CreateProjectDocumentSchema = z
  .object({
    title: z.string().min(1).max(200),
    content: z.unknown().optional(),
    contentHtml: z.string().max(2_000_000).optional(),
    contentStripped: z.string().max(2_000_000).optional(),
    parentId: z.string().max(64).nullable().optional(),
  })
  .strict();
export type CreateProjectDocumentDto = z.infer<typeof CreateProjectDocumentSchema>;

export const UpdateProjectDocumentSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.unknown().optional(),
    contentHtml: z.string().max(2_000_000).optional(),
    contentStripped: z.string().max(2_000_000).optional(),
    pinned: z.boolean().optional(),
    parentId: z.string().max(64).nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();
export type UpdateProjectDocumentDto = z.infer<typeof UpdateProjectDocumentSchema>;

export interface ProjectDocumentResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  content: unknown;
  contentHtml: string | null;
  contentStripped: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProjectDocumentSummaryDto {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  preview: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedCardDto {
  id: string;
  name: string;
  kind: string;
  color: string;
  meetingCount: number;
  lastMeetingAt: string | null;
  contactName: string | null;
}
