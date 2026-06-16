import type { OpenQuestionApi } from "@/api/promises.api";

export interface OpenQuestion {
  id: string;
  text: string;
  meetingId: string | null;
  meetingTitle: string | null;
  reason: string;
  createdAt: Date;
}

export function openQuestionFromApi(dto: OpenQuestionApi): OpenQuestion {
  return {
    id: dto.id,
    text: dto.text,
    meetingId: dto.sourceMeetingId,
    meetingTitle: dto.sourceMeetingTitle,
    reason: dto.reason,
    createdAt: new Date(dto.createdAt),
  };
}
