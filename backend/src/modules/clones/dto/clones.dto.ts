import { z } from 'zod';

/**
 * SBA γ-1 — DTO модуля Clones (Clone API).
 *
 * Эндпоинты:
 *   POST /api/v1/clones/persons/:personId/ask — ответ от клона конкретного сотрудника.
 *   POST /api/v1/clones/roles/:roleId/ask     — ответ от клона роли (агрегат).
 */

export const AskCloneBodySchema = z.object({
  question: z
    .string({ error: 'Вопрос обязателен' })
    .trim()
    .min(3, 'Слишком короткий вопрос')
    .max(2_000, 'Слишком длинный вопрос'),
  /** Опционально: продолжить существующий диалог ChatV2Conversation. */
  conversationId: z.string().min(1).max(64).optional(),
});
export type AskCloneBody = z.infer<typeof AskCloneBodySchema>;

/**
 * POST /api/v1/clones/skill-traits/:traitId/mark-misleading — body.
 * Phase F.8: заменяет `@Body() body: { reason?: string }` (untyped) на Zod-DTO.
 */
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
  /** Если true — носитель спрашивает своего же клона (для UI). */
  isOwner: boolean;
  /**
   * Фаза 1 «clone reliability hardening» — клон отказался отвечать
   * (программный анти-deepfake). По умолчанию undefined ≈ false.
   */
  refused?: boolean;
  /**
   * Машинно-читаемая причина отказа клона отвечать.
   * Текущие значения: `'topic_starved'` — в контексте недостаточно
   * рассуждений по теме вопроса. Поле опциональное — null/undefined,
   * когда клон ответил нормально.
   */
  refusalReason?: string | null;
}

/**
 * SBA γ-1 — DTO навыкового профиля (для manager / admin / self).
 */
export interface SkillTraitDto {
  id: string;
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  observationCount: number;
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  status: 'active' | 'superseded_by' | 'archived' | 'misleading';
}

export interface SkillProfileDto {
  profileId: string;
  personId: string;
  personName: string;
  status: 'active' | 'archived' | 'paused_relationship';
  buildVersion: number;
  lastBuildAt: string | null;
  /** true — недостаточно reasoning-блоков для построения профиля. */
  isEmpty: boolean;
  /** true — у запрашивающего есть право пометить trait как misleading. */
  canMarkMisleading: boolean;
  /** true — текущий пользователь — носитель профиля. */
  isSelf: boolean;
  traits: SkillTraitDto[];
  /** Persona snapshots history (timeline по version). */
  personaSnapshots: Array<{
    id: string;
    version: number;
    snapshotAt: string;
    builtFromTraitsCount: number;
    status: 'active' | 'superseded';
  }>;
}

export interface RoleSkillProfileDto {
  roleId: string;
  roleName: string;
  /** Топ-5 общих эмерджентных черт для роли. */
  topTraits: Array<{ category: string; statement: string; observationCount: number }>;
  /** Сотрудники на роли с активным SkillProfile. */
  people: Array<{
    personId: string;
    personName: string;
    activeTraitsCount: number;
    profileBuildVersion: number;
  }>;
  /** True — есть active role-persona (можно «попробовать клона роли»). */
  hasRolePersona: boolean;
}
