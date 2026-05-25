import { z } from 'zod';

/**
 * β-9 (2026-05-25) — Magic-link (одноразовая ссылка для входа без пароля).
 * См. plans/tz/2026-05-25-telegram-bot-global-and-invites.md §7.
 *
 * Используется двумя эндпоинтами:
 *   - POST /api/v1/accounts/magic-link/request — `{ email }`.
 *   - POST /api/v1/accounts/magic-link/consume — `{ token }`.
 */

export const MagicLinkRequestSchema = z.object({
  email: z.string().email('Невалидный адрес электронной почты').max(254),
});
export type MagicLinkRequestDto = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkConsumeSchema = z.object({
  token: z.string().min(20, 'Невалидный токен').max(200),
});
export type MagicLinkConsumeDto = z.infer<typeof MagicLinkConsumeSchema>;

/**
 * β-9 — приём приглашения по magic-link из письма (GitHub-style).
 * Используется в `POST /api/v1/accounts/invitations/accept-magic`.
 * Без auth — публичный одноразовый токен из приглашения. После прожига —
 * выдаётся сессия (создаётся `User` + `Membership` для целевой Org).
 */
export const AcceptInvitationMagicLinkSchema = z.object({
  magicToken: z.string().min(20, 'Невалидный токен приглашения').max(200),
});
export type AcceptInvitationMagicLinkDto = z.infer<
  typeof AcceptInvitationMagicLinkSchema
>;
