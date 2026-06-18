import type { Prisma } from '@prisma/client';

export const PRESENT_PARTICIPANT_WHERE: Prisma.ParticipantWhereInput = {
  invitationStatus: { not: 'invited' },
};

export function isPresentParticipant(p: { invitationStatus: string | null | undefined }): boolean {
  return p.invitationStatus !== 'invited';
}
