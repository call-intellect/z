import type { Meeting, MeetingStatus, MeetingType, Participant, User } from '@prisma/client';

/**
 * Доменные типы встречи. Используются между сервисом и контроллерами,
 * чтобы не таскать сырые Prisma-типы наружу.
 */

export type MeetingWithOwner = Meeting & {
  owner: Pick<User, 'id' | 'externalId' | 'email' | 'name'>;
};

export type MeetingWithParticipants = Meeting & {
  participants: Participant[];
};

export type MeetingWithOwnerAndParticipants = Meeting & {
  owner: Pick<User, 'id' | 'externalId' | 'email' | 'name'>;
  participants: Participant[];
};

export interface AccessInfo {
  role: 'host' | 'guest' | 'none';
  isRecordingActive: boolean;
  recordByDefault: boolean;
  meeting: {
    id: string;
    title: string;
    type: MeetingType;
    status: MeetingStatus;
  };
}

export interface CreatedMeetingResult {
  meetingId: string;
  deepLink: string;
  expiresAt: Date;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}
