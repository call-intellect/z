import type { AudioCaptureOptions } from "livekit-client";

const STORAGE_KEY = "kora_noise_suppression_enabled";

export function getNoiseSuppressionEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function setNoiseSuppressionEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {}
}

export function buildAudioCaptureOptions(
  enabled: boolean,
): AudioCaptureOptions {
  return {
    noiseSuppression: enabled,
    echoCancellation: enabled,
    autoGainControl: enabled,
  };
}
