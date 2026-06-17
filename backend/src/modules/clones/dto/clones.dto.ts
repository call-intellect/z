import { z } from 'zod';

export const AskCloneBodySchema = z.object({
  question: z
    .string({ error: 'Вопрос обязателен' })
    .trim()
    .min(3, 'Слишком короткий вопрос')
    .max(2_000, 'Слишком длинный вопрос'),
  conversationId: z.string().min(1).max(64).optional(),
  roleVersion: z.coerce.number().int().min(1).optional(),
});
export type AskCloneBody = z.infer<typeof AskCloneBodySchema>;

export const MarkTraitMisleadingBodySchema = z
  .object({
    reason: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type MarkTraitMisleadingBody = z.infer<typeof MarkTraitMisleadingBodySchema>;

export interface CloneCitationDto {
  blockId: string;
  meetingId?: string;
  meetingTitle?: string;
  startMs?: number;
  endMs?: number;
  snippet?: string;
}

export interface AskCloneResponseDto {
  conversationId: string;
  messageId: string;
  text: string;
  citations: CloneCitationDto[];
  mode: 'clone_style';
  isOwner: boolean;
  refused?: boolean;
  refusalReason?: string | null;
}

export interface SkillTraitDto {
  id: string;
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  observationCount: number;
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  status: 'active' | 'superseded_by' | 'archived' | 'misleading' | 'pending_verification';
}

export interface SkillProfileDto {
  profileId: string;
  personId: string;
  personName: string;
  status: 'active' | 'archived' | 'paused_relationship';
  buildVersion: number;
  lastBuildAt: string | null;
  isEmpty: boolean;
  canMarkMisleading: boolean;
  isSelf: boolean;
  traits: SkillTraitDto[];
  personaSnapshots: Array<{
    id: string;
    version: number;
    snapshotAt: string;
    builtFromTraitsCount: number;
    status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  }>;
}

export interface RoleSkillProfileDto {
  roleId: string;
  roleName: string;
  topTraits: Array<{ category: string; statement: string; observationCount: number }>;
  people: Array<{
    personId: string;
    personName: string;
    activeTraitsCount: number;
    profileBuildVersion: number;
  }>;
  hasRolePersona: boolean;
}

export const ClonesListQuerySchema = z.object({
  status: z
    .enum(['active', 'superseded', 'pending_rebuild', 'frozen'])
    .optional()
    .default('active'),
  q: z.string().trim().min(1).max(200).optional(),
  confidenceMin: z.coerce.number().min(0).max(1).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});
export type ClonesListQuery = z.infer<typeof ClonesListQuerySchema>;

export interface CloneListItemDto {
  personaId: string;
  roleId: string;
  roleName: string;
  departmentName: string | null;
  departmentId: string | null;
  version: number;
  publicName: string;
  status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  currentBearer: { personId: string; personName: string } | null;
  confidence: number;
  traitsCount: number;
  lastBuildAt: string;
}

export interface ClonesListResponseDto {
  items: CloneListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CloneVersionDto {
  personaId: string;
  roleId: string;
  version: number;
  publicName: string;
  status: 'active' | 'superseded' | 'pending_rebuild' | 'frozen';
  bearer: { personId: string; personName: string } | null;
  validFrom: string;
  validUntil: string | null;
  confidence: number;
  traitsCount: number;
}

export interface CloneHistoryResponseDto {
  roleId: string;
  roleName: string;
  versions: CloneVersionDto[];
}

export const CloneQueryLogQuerySchema = z.object({
  cloneTargetId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type CloneQueryLogQuery = z.infer<typeof CloneQueryLogQuerySchema>;

export interface CloneQueryLogItemDto {
  id: string;
  cloneScope: 'person' | 'role';
  cloneTargetId: string;
  userId: string;
  questionPreview: string;
  answeredGrounded: boolean;
  refusalReason: string | null;
  createdAt: string;
}

export interface CloneQueryLogListResponseDto {
  items: CloneQueryLogItemDto[];
  total: number;
}

export interface CreateCloneConversationResponseDto {
  conversationId: string;
}

export const AskAllFormersBodySchema = z.object({
  question: z
    .string({ error: 'Вопрос обязателен' })
    .trim()
    .min(3, 'Слишком короткий вопрос')
    .max(2_000, 'Слишком длинный вопрос'),
});
export type AskAllFormersBody = z.infer<typeof AskAllFormersBodySchema>;

export interface AskAllFormersAnswerDto {
  personaId: string;
  version: number;
  publicName: string;
  status: 'active' | 'frozen';
  response: AskCloneResponseDto | null;
  error: string | null;
}

export interface AskAllFormersResponseDto {
  roleId: string;
  roleName: string;
  question: string;
  answers: AskAllFormersAnswerDto[];
}
