'use client';

/**
 * useVoiceStream (T4 / δ-3) — WebSocket-стриминг голосового **ввода**
 * в Concierge через namespace `/ws/voice`.
 *
 * Backend: `backend/src/modules/voice/gateways/voice-stream.gateway.ts`.
 *
 * Контракт:
 *   - one connection per orgId (хук пересоздаёт socket при смене tenant);
 *   - withCredentials: true — отправляем cookie `z_session` (handshake auth);
 *   - handshake.auth.tenantId = orgId — gateway резолвит tenant + проверяет
 *     membership;
 *   - после получения transcript socket остаётся открытым: следующее `start()`
 *     переиспользует подключение, не дёргает re-auth.
 *
 * API:
 *   - `start()`         — getUserMedia + MediaRecorder.start(200) + voice:start.
 *   - `stop()`          — MediaRecorder.stop + voice:end → state='transcribing'.
 *   - `cancel()`        — voice:cancel + MediaRecorder.stop → state='idle'.
 *   - `state`           — 'idle' | 'connecting' | 'recording' | 'transcribing'
 *                        | 'error' | 'unavailable'.
 *   - `transcript`      — последний распознанный текст (string|null).
 *   - `latencyMs`       — длительность ASR (число|null).
 *   - `error`           — последняя ошибка (string|null).
 *   - `reset()`         — сбросить transcript/error в null, state='idle'.
 *
 * Mobile Safari quirks: `audio/webm` НЕ поддерживается; `pickSupportedMimeType`
 * автоматически выбирает `audio/mp4`. Backend Vox принимает оба.
 *
 * Известное ограничение (TODO):
 *   Vox работает по submit + poll каждые 2 сек → p50 latencyMs ≥ 2000 ms.
 *   Когда backend перейдёт на streaming ASR (Whisper realtime), хук не
 *   меняется: те же события `voice:chunk` / `voice:end` / `voice:transcribed`,
 *   но latency упадёт до 200-500 ms.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { pickSupportedMimeType } from '../../ui/concierge/audio-mime';

export type VoiceStreamState =
  | 'idle'
  | 'connecting'
  | 'recording'
  | 'transcribing'
  | 'error'
  | 'unavailable';

export interface VoiceStreamApi {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
  reset: () => void;
  state: VoiceStreamState;
  transcript: string | null;
  latencyMs: number | null;
  error: string | null;
  /** Состояние WS-соединения для UI индикатора «онлайн». */
  connected: boolean;
}

interface VoiceTranscribedPayload {
  text: string;
  durationMs: number;
  latencyMs: number;
}

interface VoiceErrorPayload {
  code: string;
  message: string;
}

/** Резолвит базовый WS-URL — same-origin или `NEXT_PUBLIC_WS_URL`. */
function resolveWsUrl(): string {
  const fromEnv =
    typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_WS_URL ?? '').trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/+$/, '') + '/ws/voice';
  }
  return '/ws/voice';
}

function humanizeError(code: string, fallback: string): string {
  switch (code) {
    case 'not_authenticated':
      return 'Не авторизованы — обновите страницу';
    case 'no_session':
      return 'Сессия записи не открыта';
    case 'audio_empty':
      return 'Запись пустая — попробуйте ещё раз';
    case 'buffer_overflow':
      return 'Слишком длинная запись — попробуйте короче';
    case 'chunk_too_large':
      return 'Слишком большой фрагмент аудио';
    case 'ttl_expired':
      return 'Запись слишком долгая — отменено';
    case 'superseded':
      return 'Открыта новая сессия записи';
    case 'asr_failed':
      return 'Не удалось распознать речь — попробуйте ещё раз';
    case 'mic_denied':
      return 'Нет доступа к микрофону';
    case 'mic_unsupported':
      return 'Браузер не поддерживает запись микрофона';
    case 'ws_disconnected':
      return 'Соединение с сервером прервано';
    default:
      return fallback || 'Ошибка распознавания';
  }
}

export function useVoiceStream(
  orgId: string | null | undefined,
  enabled: boolean = true,
): VoiceStreamApi {
  const [state, setState] = useState<VoiceStreamState>('idle');
  const [transcript, setTranscript] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── WS lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !orgId || typeof window === 'undefined') {
      socketRef.current = null;
      setConnected(false);
      return;
    }

    const url = resolveWsUrl();
    const socket: Socket = io(url, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      auth: { tenantId: orgId },
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => {
      setConnected(false);
      // Если на момент disconnect мы что-то писали/ждали ASR — фиксируем
      // ошибку, чтобы UI вышел из тупикового state='recording'.
      setState((prev) =>
        prev === 'recording' || prev === 'transcribing' ? 'error' : prev,
      );
      setError((prev) =>
        prev ?? humanizeError('ws_disconnected', 'Соединение прервано'),
      );
    });
    socket.on('connect_error', (err: Error) => {
      console.warn('[voice-ws] connect_error:', err.message);
    });

    socket.on('voice:transcribed', (payload: VoiceTranscribedPayload) => {
      setTranscript(payload.text);
      setLatencyMs(payload.latencyMs);
      setError(null);
      setState('idle');
    });
    socket.on('voice:error', (payload: VoiceErrorPayload) => {
      setError(humanizeError(payload.code, payload.message));
      setState('error');
      stopRecorderAndStream();
    });

    return () => {
      stopRecorderAndStream();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [orgId, enabled]);

  function stopRecorderAndStream(): void {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    streamRef.current = null;
  }

  // ── start ───────────────────────────────────────────────────────────
  const start = useCallback(async (): Promise<void> => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setState('error');
      setError(humanizeError('ws_disconnected', 'Нет соединения'));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      setError(humanizeError('mic_unsupported', 'Микрофон недоступен'));
      return;
    }

    setState('connecting');
    setError(null);
    setTranscript(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[voice-ws] getUserMedia failed:', msg);
      setState('error');
      setError(humanizeError('mic_denied', msg));
      return;
    }
    streamRef.current = stream;

    const mimeType = pickSupportedMimeType() ?? 'audio/webm';
    const sampleRate =
      stream.getAudioTracks()[0]?.getSettings().sampleRate ?? null;

    // Открыть сессию на бэке. ack — асинхронный, ждём ok.
    try {
      const ack = await new Promise<{ ok: boolean; error?: { message: string } }>(
        (resolve, reject) => {
          const t = window.setTimeout(
            () => reject(new Error('voice:start ack timeout')),
            5000,
          );
          socket.emit(
            'voice:start',
            { sampleRate, mimeType },
            (response: { ok: boolean; error?: { message: string } }) => {
              window.clearTimeout(t);
              resolve(response);
            },
          );
        },
      );
      if (!ack.ok) {
        setState('error');
        setError(ack.error?.message ?? 'Не удалось начать запись');
        stopRecorderAndStream();
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState('error');
      setError(humanizeError('ws_disconnected', msg));
      stopRecorderAndStream();
      return;
    }

    // MediaRecorder с timeslice 200ms — каждые 200ms dataavailable.
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState('error');
      setError(humanizeError('mic_unsupported', msg));
      stopRecorderAndStream();
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (!ev.data || ev.data.size === 0) return;
      // Blob → ArrayBuffer → socket.emit. socket.io сам сериализует binary.
      void ev.data
        .arrayBuffer()
        .then((buf) => {
          const s = socketRef.current;
          if (!s || !s.connected) return;
          s.emit('voice:chunk', { data: buf });
        })
        .catch((e: unknown) => {
          console.warn('[voice-ws] chunk arrayBuffer failed:', e);
        });
    };

    try {
      recorder.start(200);
      setState('recording');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState('error');
      setError(humanizeError('mic_unsupported', msg));
      stopRecorderAndStream();
    }
  }, []);

  // ── stop ────────────────────────────────────────────────────────────
  const stop = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    const socket = socketRef.current;
    if (!recorder || recorder.state === 'inactive') {
      // Уже остановлено / нечего останавливать.
      return;
    }

    setState('transcribing');

    // Дождёмся onstop (последний dataavailable придёт до stop event).
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    recorderRef.current = null;

    // Освобождаем mic-stream сразу — индикатор браузера выключится.
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    streamRef.current = null;

    if (!socket || !socket.connected) {
      setState('error');
      setError(humanizeError('ws_disconnected', 'Соединение прервано'));
      return;
    }
    socket.emit('voice:end');
    // Дальше ждём voice:transcribed / voice:error из WS listener выше.
  }, []);

  // ── cancel ──────────────────────────────────────────────────────────
  const cancel = useCallback((): void => {
    const socket = socketRef.current;
    if (socket && socket.connected) {
      socket.emit('voice:cancel');
    }
    stopRecorderAndStream();
    setState('idle');
    setError(null);
  }, []);

  const reset = useCallback((): void => {
    setTranscript(null);
    setLatencyMs(null);
    setError(null);
    setState('idle');
  }, []);

  return {
    start,
    stop,
    cancel,
    reset,
    state,
    transcript,
    latencyMs,
    error,
    connected,
  };
}
