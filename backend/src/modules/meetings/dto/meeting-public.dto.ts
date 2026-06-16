import type { MeetingStatus, MeetingType } from '@prisma/client';

export interface MeetingPublicDto {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  started_at: string | null;
  ended_at: string | null;
  failure_reason: string | null;
  created_at: string;
  owner: {
    external_id: string | null;
    email: string;
    name: string;
  };
}

export interface MeetingForUserDto {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  customPrompt: string | null;
  visibilityScope: string;
  participants: Array<{
    id: string;
    name: string;
    role: 'host' | 'guest';
    livekitIdentity: string;
    isRegisteredUser: boolean;
    joinedAt: string | null;
    leftAt: string | null;
  }>;
}
