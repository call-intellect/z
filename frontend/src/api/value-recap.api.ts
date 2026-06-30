import { apiClient } from "./api-client";
import { ApiError } from "./api-error";
import { buildQuery, orgHeaders } from "./admin-helpers";

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export interface ValueRecapRoutineApi {
  meetingsAutoProtocoled: number;
  tasksExtracted: number;
  decisionsExtracted: number;
  commitmentsExtracted: number;
  statusesCollected: number;
  questionsAnsweredWithCitation: number;
  ideasShipped: number;
}

export interface ValueRecapTeamApi {
  reliabilityPercent: number | null;
  reliabilityDenominator: number;
  reliabilityDelta: number | null;
  chatHelpedRatePercent: number | null;
  chatRated: number;
  chatAnsweredWithCitation: number;
  ideasShipped: number;
  estimate: true;
}

export interface ValueRecapDeltaApi {
  meetingsAutoProtocoled: number | null;
  tasksExtracted: number | null;
  decisionsExtracted: number | null;
  commitmentsExtracted: number | null;
  statusesCollected: number | null;
  questionsAnsweredWithCitation: number | null;
  ideasShipped: number | null;
}

export interface ValueRecapPayloadApi {
  periodYm: string;
  builtAt: string;
  isBaseline: boolean;
  routine: ValueRecapRoutineApi;
  team: ValueRecapTeamApi;
  delta: ValueRecapDeltaApi | null;
  narrative: string;
}

export interface ValueRecapSnapshotApi {
  id: string;
  periodYm: string;
  payload: ValueRecapPayloadApi | null;
  deliveredAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

export interface ValueRecapSlideApi {
  title: string;
  subtitle?: string;
  bullets: string[];
}

export interface ValueRecapExportApi {
  format: "slides" | "json";
  periodYm: string;
  slides?: ValueRecapSlideApi[];
  payload?: ValueRecapPayloadApi | null;
}

export interface ValueRecapExportBlob {
  blob: Blob;
  filename: string;
}

function parseFilename(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ""));
    } catch {}
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? fallback;
}

export const valueRecapApi = {
  get: (orgId: string, period?: string) =>
    apiClient.get<ValueRecapSnapshotApi>(
      `/api/v1/dashboard/operations/value-recap${buildQuery({ period })}`,
      { headers: orgHeaders(orgId) },
    ),

  markOpened: (orgId: string, id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/dashboard/operations/value-recap/${encodeURIComponent(id)}/opened`,
      undefined,
      { headers: orgHeaders(orgId) },
    ),

  exportRecap: (orgId: string, id: string, format: "slides" | "json") =>
    apiClient.get<ValueRecapExportApi>(
      `/api/v1/dashboard/operations/value-recap/${encodeURIComponent(id)}/export${buildQuery({ format })}`,
      { headers: orgHeaders(orgId) },
    ),

  exportRecapPptx: async (
    orgId: string,
    id: string,
    periodYm: string,
  ): Promise<ValueRecapExportBlob> => {
    const url = `${BASE_URL}/api/v1/dashboard/operations/value-recap/${encodeURIComponent(
      id,
    )}/export${buildQuery({ format: "pptx" })}`;
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { ...orgHeaders(orgId), Accept: "*/*" },
    });
    if (!res.ok) {
      let message = "Не удалось выгрузить презентацию.";
      let code = `http_${res.status}`;
      try {
        const body = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
        if (body.error?.message) message = body.error.message;
        if (body.error?.code) code = body.error.code;
      } catch {}
      throw new ApiError({ code, message });
    }
    const blob = await res.blob();
    const filename = parseFilename(
      res.headers.get("Content-Disposition"),
      `kora-itogi-${periodYm}.pptx`,
    );
    return { blob, filename };
  },
};
