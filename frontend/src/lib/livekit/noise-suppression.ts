/**
 * Шумоподавление микрофона во встречах LiveKit.
 *
 * Для self-hosted LiveKit (наш случай) на Sprint 1 используем
 * BROWSER-уровень noise suppression через `AudioCaptureOptions`:
 *   - `noiseSuppression: true` — шумодав браузера (WebRTC, обычно RNNoise-подобный).
 *   - `echoCancellation: true` — подавление эха.
 *   - `autoGainControl: true` — авто-уровень.
 *
 * Это работает в Chrome / Edge / Firefox / Safari «из коробки» без новых
 * зависимостей. Качество приемлемое (лучше чем без обработки), но хуже,
 * чем коммерческий Krisp.
 *
 * Включено ПО УМОЛЧАНИЮ. Пользователь может отключить через UI (Pre-Join /
 * Lobby) — выбор сохраняется в `localStorage` и применяется ДО создания
 * LocalAudioTrack (LiveKit читает options при первом enableMicrophone).
 *
 * TODO (Sprint 2+): мигрировать на полноценный RNNoise WASM через
 * AudioWorklet + `track.setProcessor(...)` из `@livekit/track-processors`.
 * Это даст идентичное качество шумоподавления независимо от браузера и
 * откроет путь к замене на Krisp (если перейдём на LiveKit Cloud).
 *
 * @see docs/01_projects/livekit-noise-cancellation.md
 */

import type { AudioCaptureOptions } from 'livekit-client';

const STORAGE_KEY = 'kora_noise_suppression_enabled';

/**
 * Прочитать настройку из localStorage. По умолчанию — `true` (включено).
 * SSR-safe: на сервере вернёт default.
 */
export function getNoiseSuppressionEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true; // не задано → по умолчанию вкл
    return raw === 'true';
  } catch {
    // localStorage может бросить в приватном режиме Safari
    return true;
  }
}

/**
 * Сохранить настройку. SSR-safe (no-op на сервере).
 */
export function setNoiseSuppressionEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // ignore
  }
}

/**
 * Опции захвата аудио для `<LiveKitRoom audio={...} />` или
 * `room.localParticipant.setMicrophoneEnabled(true, audioCaptureOptions)`.
 *
 * Возвращает явный объект (а не `true`), чтобы:
 *   1) Чётко зафиксировать конфигурацию в коде (а не полагаться на default
 *      livekit-client, который может измениться между версиями).
 *   2) Дать пользователю возможность отключить шумоподавление.
 */
export function buildAudioCaptureOptions(enabled: boolean): AudioCaptureOptions {
  return {
    noiseSuppression: enabled,
    echoCancellation: enabled,
    autoGainControl: enabled,
  };
}
