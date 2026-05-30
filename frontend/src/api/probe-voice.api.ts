/**
 * Probe voice helper — тонкая обёртка над `voiceApi.transcribe` для
 * компонента `ProbeAnswerInput` (Phase 0.3 ТЗ Agents v2 umbrella,
 * §«Probe без кнопок»). Цель — изолировать ASR-вызов от UI:
 * компонент работает с понятным контрактом `{ text }` и не знает про
 * multipart/form-data / orgId / провайдеров.
 *
 * Backend: `POST /api/v1/voice/transcribe` (модуль `backend/src/modules/voice`).
 * Это существующий ASR-эндпоинт, новый не создаём.
 */
import { voiceApi } from './voice.api';

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
