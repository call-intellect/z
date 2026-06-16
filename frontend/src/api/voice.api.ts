import { ApiError } from "./api-error";

const BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export interface TranscribeVoiceResponse {
  text: string;
  durationSeconds: number;
  provider: string;
}

export interface SynthesizeVoiceArgs {
  text: string;
  voice?: string | null;
  format?: "mp3" | "opus" | "aac" | "flac";
}

export interface SynthesizeVoiceResult {
  audio: Blob;
  provider: string | null;
  voice: string | null;
  chars: number | null;
}

async function parseError(
  res: Response,
  fallbackCode: string,
): Promise<ApiError> {
  let code = fallbackCode;
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {}
  return new ApiError({ code, message });
}

async function transcribe(args: {
  orgId: string;
  audio: Blob;
  filename?: string;
  signal?: AbortSignal;
}): Promise<TranscribeVoiceResponse> {
  const form = new FormData();
  form.append("audio", args.audio, args.filename ?? "voice.webm");

  const init: RequestInit = {
    method: "POST",
    credentials: "include",
    headers: { "X-Org-Id": args.orgId },
    body: form,
  };
  if (args.signal) {
    init.signal = args.signal;
  }

  const res = await fetch(`${BASE_URL}/api/v1/voice/transcribe`, init);
  if (!res.ok) throw await parseError(res, `http_${res.status}`);
  return (await res.json()) as TranscribeVoiceResponse;
}

async function synthesize(args: {
  orgId: string;
  input: SynthesizeVoiceArgs;
  signal?: AbortSignal;
}): Promise<SynthesizeVoiceResult> {
  const body: Record<string, unknown> = {
    text: args.input.text,
    format: args.input.format ?? "mp3",
  };
  if (args.input.voice) {
    body.voice = args.input.voice;
  }

  const init: RequestInit = {
    method: "POST",
    credentials: "include",
    headers: {
      "X-Org-Id": args.orgId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
  if (args.signal) {
    init.signal = args.signal;
  }

  const res = await fetch(`${BASE_URL}/api/v1/voice/synthesize`, init);
  if (!res.ok) throw await parseError(res, `http_${res.status}`);

  const blob = await res.blob();
  const provider = res.headers.get("X-Voice-Provider");
  const voice = res.headers.get("X-Voice-Voice");
  const charsHeader = res.headers.get("X-Voice-Chars");
  const chars = charsHeader ? Number.parseInt(charsHeader, 10) : null;
  return {
    audio: blob,
    provider,
    voice,
    chars: chars !== null && Number.isFinite(chars) ? chars : null,
  };
}

export const voiceApi = {
  transcribe,
  synthesize,
};
