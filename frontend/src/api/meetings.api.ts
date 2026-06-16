import { apiClient } from "./api-client";
import { ApiError } from "./api-error";
import type {
  AccessApi,
  MeetingApi,
  MeetingSummaryApi,
  ParticipantApi,
} from "@/domain/meeting";
import type { AiResultApi } from "@/domain/ai-result";
import type { MeetingStatus, MeetingType } from "@/domain/enums";

export type ListMeetingsApiResponse = {
  items: MeetingSummaryApi[];
  page: number;
  limit: number;
  total: number;
};

export type CreateMeetingApiRequest = {
  type: MeetingType;
  title: string;
  custom_prompt?: string | null;
  templateId?: string | null;
  card_id?: string | null;
  record_by_default?: boolean;
  invitees?: Array<{
    userId?: string | null;
    personId?: string | null;
    email?: string | null;
    sendVia?: ("email" | "telegram")[];
  }>;
  closed_group_kind?: "leadership" | "council" | "personal" | null;
};

export type ListMeetingsApiRequest = {
  page?: number;
  limit?: number;
  status?: MeetingStatus | MeetingStatus[];
  type?: MeetingType | MeetingType[];
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  tagIds?: string[];
  cardId?: string;
};

export type RegenerateMeetingApiRequest = {
  expectedRecapVersion: number;
  templateId?: string | null;
};

export type RegenerateSectionApiRequest = {
  expectedRecapVersion: number;
  sectionKey: string;
};

export type CreateMeetingApiResponse = { id: string; url: string };

export type AddInviteesApiRequest = {
  invitees: Array<{
    userId?: string | null;
    personId?: string | null;
    email?: string | null;
    sendVia?: ("email" | "telegram")[];
  }>;
};

export type AddInviteesApiResponse = { added: number; skipped: number };

export type JoinMeetingApiRequest = {
  guest_name?: string;
  invite_token?: string;
};

export type JoinMeetingApiResponse = {
  participant_id: string;
  role: "host" | "guest";
  livekit_identity: string;
  livekit: { url: string; token: string; identity: string };
};

export type DownloadUrlApiResponse = { url: string; expires_at: string };

export type MeetingDetailApi = MeetingApi & {
  participants: Array<
    ParticipantApi & {
      livekitIdentity: string;
      isRegisteredUser: boolean;
    }
  >;
};

export type ResultApiResponse = {
  meeting: MeetingApi;
  participants: Array<ParticipantApi & { isRegisteredUser: boolean }>;
  aiResult: AiResultApi | null;
  recording: {
    hasRecording: boolean;
    status: string;
    durationSeconds: number | null;
    bytesTotal: string | null;
    expiresAt: string | null;
  } | null;
  transcript: {
    hasMerged: boolean;
    totalDurationSeconds: number | null;
  } | null;
  aiReady: boolean;
};

export type ResultStatusApiResponse = {
  stage: MeetingStatus;
  failureReason: string | null;
};

export type TranscriptTurn = {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
};

export type TranscriptApiResponse = {
  turns: TranscriptTurn[];
  durationSeconds: number | null;
  roomChat?: Array<{ sentAt: string; authorName: string; content: string }>;
};

export type CleanTranscriptApiResponse = {
  status: "queued" | "already_clean";
};

export type AudioTrackApi = {
  id: string;
  participantName: string;
  livekitIdentity: string;
  durationSeconds: number;
  url: string;
  expiresAt: string;
};

export type AudioTracksApiResponse = {
  tracks: AudioTrackApi[];
};

export type CreateUploadApiRequest = {
  type: MeetingType;
  title: string;
  customPrompt?: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  numSpeakersHint?: number | null;
};

export type CreateUploadApiResponse = {
  meetingId: string;
  uploadUrl: string;
  uploadKey: string;
  expiresAt: string;
};

export type SpeakerAssignmentApi =
  | "unassigned"
  | "employee"
  | "external"
  | "excluded"
  | "merged";

export type UploadSpeakerApi = {
  label: string;
  displayLabel: string;
  turnsCount: number;
  speakingSeconds: number;
  sampleText: string;
  assignment: SpeakerAssignmentApi;
  personId?: string | null;
  externalName?: string | null;
  externalCompany?: string | null;
  externalPosition?: string | null;
  mergedIntoLabel?: string | null;
};

export type SpeakersApiResponse = {
  speakers: UploadSpeakerApi[];
  turns: TranscriptTurn[];
};

export type PutSpeakersApiRequest = {
  assignments: Array<{
    label: string;
    assignment: SpeakerAssignmentApi;
    personId?: string | null;
    externalName?: string | null;
    externalCompany?: string | null;
    externalPosition?: string | null;
    mergedIntoLabel?: string | null;
  }>;
};

export type PutSpeakersApiResponse = {
  speakers: UploadSpeakerApi[];
};

export type UploadPlaybackApiResponse = {
  kind: "video" | "audio";
  url: string;
  expiresAt: string;
};

function buildListQuery(opts: ListMeetingsApiRequest): string {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.status) {
    if (Array.isArray(opts.status)) {
      for (const s of opts.status) params.append("status", s);
    } else {
      params.set("status", opts.status);
    }
  }
  if (opts.type) {
    if (Array.isArray(opts.type)) {
      for (const tt of opts.type) params.append("type", tt);
    } else {
      params.set("type", opts.type);
    }
  }
  if (opts.query) params.set("query", opts.query);
  if (opts.dateFrom) params.set("dateFrom", opts.dateFrom);
  if (opts.dateTo) params.set("dateTo", opts.dateTo);
  if (opts.tagIds) {
    for (const id of opts.tagIds) params.append("tagId", id);
  }
  if (opts.cardId) params.set("cardId", opts.cardId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function uploadFileToPresignedUrl(opts: {
  url: string;
  file: File | Blob;
  contentType: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { url, file, contentType, onProgress, signal } = opts;
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.total > 0 ? e.loaded / e.total : 0);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(
          new ApiError({
            code: "upload_put_failed",
            message: `Хранилище отклонило загрузку (код ${xhr.status}).`,
          }),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiError({
          code: "upload_network_error",
          message: "Не удалось загрузить файл. Проверьте подключение.",
        }),
      );
    xhr.onabort = () =>
      reject(
        new ApiError({ code: "upload_aborted", message: "Загрузка отменена." }),
      );

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(file);
  });
}

function orgHeader(orgId: string): { headers: Record<string, string> } {
  return { headers: { "X-Org-Id": orgId } };
}

export const meetingsApi = {
  list: (opts: ListMeetingsApiRequest) =>
    apiClient.get<ListMeetingsApiResponse>(
      `/api/v1/meetings${buildListQuery(opts)}`,
    ),

  create: (body: CreateMeetingApiRequest) =>
    apiClient.post<CreateMeetingApiResponse>("/api/v1/meetings", body),

  addInvitees: (id: string, body: AddInviteesApiRequest) =>
    apiClient.post<AddInviteesApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/invitees`,
      body,
    ),

  setClosedGroup: (
    id: string,
    closedGroupKind: "leadership" | "council" | "personal" | null,
  ) =>
    apiClient.patch<{ id: string; closedGroupKind: string | null }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/closed-group`,
      { closedGroupKind },
    ),

  softDelete: (id: string) =>
    apiClient.del<{ ok: true }>(`/api/v1/meetings/${encodeURIComponent(id)}`),

  regenerate: (id: string, body: RegenerateMeetingApiRequest) =>
    apiClient.post<{ ok: true; queued: boolean }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/regenerate`,
      body,
    ),

  regenerateSection: (id: string, body: RegenerateSectionApiRequest) =>
    apiClient.post<{ ok: true; queued: boolean }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/regenerate-section`,
      body,
    ),

  get: (id: string) =>
    apiClient.get<MeetingDetailApi>(
      `/api/v1/meetings/${encodeURIComponent(id)}`,
    ),

  access: (id: string) =>
    apiClient.get<AccessApi>(
      `/api/v1/meetings/${encodeURIComponent(id)}/access`,
    ),

  join: (id: string, body: JoinMeetingApiRequest) =>
    apiClient.post<JoinMeetingApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/join`,
      body,
    ),

  finish: (id: string) =>
    apiClient.post<{ ok: true; status: string; failureReason: string | null }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/finish`,
    ),

  getVisibility: (id: string) =>
    apiClient.get<{
      scope: string;
      grants: { granteeType: string; granteeId: string; name: string }[];
    }>(`/api/v1/meetings/${encodeURIComponent(id)}/visibility`),

  setVisibility: (
    id: string,
    body: {
      scope: string;
      grants?: { granteeType: string; granteeId: string }[];
    },
  ) =>
    apiClient.patch<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/visibility`,
      body,
    ),

  startRecording: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/start`,
    ),

  stopRecording: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/stop`,
    ),

  downloadUrl: (id: string) =>
    apiClient.get<DownloadUrlApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/download`,
    ),

  deleteRecording: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording`,
    ),

  muteParticipant: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/mute`,
    ),

  unmuteParticipant: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/unmute`,
    ),

  kickParticipant: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/kick`,
    ),

  lowerHand: (id: string, pid: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/lower-hand`,
    ),

  renameParticipant: (id: string, pid: string, body: { name: string }) =>
    apiClient.patch<{ id: string; name: string }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}`,
      body,
    ),

  retryAi: (id: string) =>
    apiClient.post<{ ok: true; stage: string }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/retry-ai`,
    ),

  result: (id: string) =>
    apiClient.get<ResultApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/result`,
    ),

  resultStatus: (id: string) =>
    apiClient.get<ResultStatusApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/result/status`,
    ),

  transcript: (id: string, opts?: { cleaned?: boolean }) =>
    apiClient.get<TranscriptApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/transcript${
        opts?.cleaned ? "?cleaned=true" : ""
      }`,
    ),

  cleanTranscript: (id: string) =>
    apiClient.post<CleanTranscriptApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/transcript/clean`,
    ),

  audioTracks: (id: string) =>
    apiClient.get<AudioTracksApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/recording/audio-tracks`,
    ),

  createUpload: (orgId: string, body: CreateUploadApiRequest) =>
    apiClient.post<CreateUploadApiResponse>(
      "/api/v1/meetings/upload",
      body,
      orgHeader(orgId),
    ),

  completeUpload: (orgId: string, id: string) =>
    apiClient.post<{ status: string }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/upload/complete`,
      undefined,
      orgHeader(orgId),
    ),

  getSpeakers: (orgId: string, id: string) =>
    apiClient.get<SpeakersApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/speakers`,
      orgHeader(orgId),
    ),

  putSpeakers: (
    orgId: string,
    id: string,
    assignments: PutSpeakersApiRequest["assignments"],
  ) =>
    apiClient.put<PutSpeakersApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/speakers`,
      { assignments },
      orgHeader(orgId),
    ),

  confirmSpeakers: (orgId: string, id: string) =>
    apiClient.post<{ status: string }>(
      `/api/v1/meetings/${encodeURIComponent(id)}/speakers/confirm`,
      undefined,
      orgHeader(orgId),
    ),

  getPlayback: (orgId: string, id: string) =>
    apiClient.get<UploadPlaybackApiResponse>(
      `/api/v1/meetings/${encodeURIComponent(id)}/upload/playback`,
      orgHeader(orgId),
    ),
};
