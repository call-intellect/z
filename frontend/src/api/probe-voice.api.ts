import { voiceApi } from "./voice.api";

export interface TranscribeProbeAnswerArgs {
  orgId: string;
  audio: Blob;
  filename?: string;
  signal?: AbortSignal;
}

export interface TranscribeProbeAnswerResult {
  text: string;
}

export async function transcribeProbeAnswer(
  args: TranscribeProbeAnswerArgs,
): Promise<TranscribeProbeAnswerResult> {
  const res = await voiceApi.transcribe({
    orgId: args.orgId,
    audio: args.audio,
    filename: args.filename,
    signal: args.signal,
  });
  return { text: res.text };
}
