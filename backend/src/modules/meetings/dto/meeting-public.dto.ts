import type { MeetingStatus, MeetingType } from '@prisma/client';

/**
 * DTO встречи для Crossmark API (`GET /integrations/crossmark/v1/meetings/:id`).
 * Поля — snake_case под партнёра.
 */
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

/**
 * DTO для cookie-эндпоинтов фронта (`GET /api/v1/meetings/:id`).
 * camelCase — наш внутренний контракт.
 */
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
