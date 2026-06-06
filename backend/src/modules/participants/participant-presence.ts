import type { Prisma } from '@prisma/client';

/**
 * «Присутствовавший участник» = НЕ «приглашён, но не пришёл».
 *
 * Корень бага дублирования счётчика (анализ 2026-06-06): приглашение создаёт
 * строку Participant `invitee:<token>` со `invitationStatus='invited'`, а вход —
 * отдельную строку (`host:`/`guest:`/переиспользованный `invited→joined`).
 * Считать «участников» надо только пришедших — иначе «позвал двоих → показало 5».
 * Предикат робастен и к остаточным дублям: не-пришедшую `invited`-строку
 * исключает, фактическую join-строку считает один раз.
 */
export const PRESENT_PARTICIPANT_WHERE: Prisma.ParticipantWhereInput = {
  invitationStatus: { not: 'invited' },
};

/** JS-предикат того же правила для уже загруженных строк. */
export function isPresentParticipant(p: {
  invitationStatus: string | null | undefined;
}): boolean {
  return p.invitationStatus !== 'invited';
}
