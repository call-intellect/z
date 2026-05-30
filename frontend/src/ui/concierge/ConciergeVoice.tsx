'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useVoiceStream } from '../../hooks/concierge/useVoiceStream';
import { voiceApi } from '../../api/voice.api';
import { ApiError } from '../../api/api-error';
import { Button } from '../components/shared/Button';
import { pickSupportedMimeType } from './audio-mime';

type State =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'processing' }
  | { kind: 'ready'; transcript: string }
  | { kind: 'speaking'; transcript: string }
  | { kind: 'error'; message: string };

export interface ConciergeVoiceProps {
  /** Текущий tenantId — обязателен для X-Org-Id. */
  orgId: string;
  /**
   * Колбэк после успешного транскрибирования. Вызывается ПОСЛЕ того, как
   * пользователь записал и распознал голос. Дальше родительский компонент
   * (γ-2 Concierge) сам решает: послать в LLM-чат, в free_note и т.п.
   *
   * TODO γ-2: когда `ConciergeFloatingButton` будет готов, повесить сюда
   * `concierge.send({ text })`.
   */
  onTranscribed?: (transcript: string) => void;
  /**
   * Опц. — если задано, после транскрипта тут же синтезируем озвучку
   * этого текста (например, ответ ассистента). Включать только когда есть
   * текст ответа. На δ-3 — без auto-loop; γ-2 свяжет.
   *
   * NB: Concierge сам по правилу отвечает ТОЛЬКО текстом — этот prop
   * НЕ используется для ответов AI-помощника, только для технических
   * сценариев (например, демо TTS в админке).
   */
  reply?: string | null;
  className?: string;
  /**
   * Использовать WebSocket-стриминг (T4 / δ-3). По умолчанию `true`.
   * При недоступности WS (disconnect / unsupported) хук падает на 'error'/
   * 'unavailable' и компонент сам делает graceful degradation: REST upload
   * через `voiceApi.transcribe`.
   *
   * Тесты могут передать `false` чтобы заставить REST-flow.
   */
  useWebSocket?: boolean;
}

/**
 * `ConciergeVoice` (SBA δ-3) — клиентский voice IO для concierge:
 *   1. push-to-talk: пользователь жмёт «🎤», MediaRecorder пишет webm/opus;
 *   2. при отпускании — отправляем blob в `/api/v1/voice/transcribe`;
 *   3. показываем распознанный текст и зовём `onTranscribed`;
 *   4. опц. `reply` синтезируется и проигрывается через `<audio>`.
 *
 * NB на δ-3: WebSocket-канал в concierge ещё не создан (γ-2 модуль в
 * работе — `ConciergeModule` без WS-handler'а). Поэтому используем REST.
 * При появлении γ-2 WS endpoint'а (`/api/v1/concierge/voice`) этот компонент
 * расширим: WS-стриминг чанков MediaRecorder + auto-reconnect.
 *
 * Auto-reconnect (δ-3 §17): на REST flow это retry при ошибке — пользователь
 * жмёт ту же кнопку повторно. Для WS — отдельная логика в γ-2.
 */
export function ConciergeVoice({
  orgId,
  onTranscribed,
  reply,
  className,
  useWebSocket = true,
}: ConciergeVoiceProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // ── T4 / δ-3 — WebSocket-стриминг voice ввода ─────────────────────
  // Hook сам управляет коннектом и реконнектом. Если useWebSocket=false
  // или коннект упал — fallback на REST flow ниже (не удалён, остаётся
  // как graceful degradation, см. docstring компонента).
  const voiceWs = useVoiceStream(orgId, useWebSocket);
  // Признак «надо ли пробовать WS прямо сейчас». Если хук в error/unavailable
  // — переходим на REST flow при следующем нажатии (без UI-флага юзеру).
  const wsActive =
    useWebSocket && voiceWs.state !== 'unavailable' && voiceWs.connected;

  // Прокидываем transcript из WS hook'а в локальный state + onTranscribed.
  // useRef для onTranscribed чтобы не пересоздавать эффект при ре-рендере.
  const onTranscribedRef = useRef(onTranscribed);
  onTranscribedRef.current = onTranscribed;
  useEffect(() => {
    if (voiceWs.state === 'idle' && voiceWs.transcript) {
      const t = voiceWs.transcript.trim();
      if (t.length === 0) {
        setState({
          kind: 'error',
          message: 'Не удалось распознать — попробуйте чуть громче',
        });
        return;
      }
      setState({ kind: 'ready', transcript: t });
      onTranscribedRef.current?.(t);
      // Сбросить, чтобы повторный transcript=== тот же не залип.
      voiceWs.reset();
    } else if (voiceWs.state === 'transcribing') {
      setState({ kind: 'processing' });
    } else if (voiceWs.state === 'error' && voiceWs.error) {
      setState({ kind: 'error', message: voiceWs.error });
    }
  }, [voiceWs.state, voiceWs.transcript, voiceWs.error, voiceWs]);

  // Cleanup на размонтирование: stop stream и revoke URL.
  useEffect(() => {
    return () => {
      stopAllTracks(streamRef.current);
      revokeAudioUrl(audioUrlRef.current);
      audioUrlRef.current = null;
    };
  }, []);

  // Авто-озвучка reply, если родитель передал текст ответа.
  useEffect(() => {
    if (!reply || reply.trim().length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        setState((prev) =>
          prev.kind === 'ready' ? { kind: 'speaking', transcript: prev.transcript } : prev,
        );
        const result = await voiceApi.synthesize({
          orgId,
          input: { text: reply, format: 'mp3' },
        });
        if (cancelled) return;
        playAudio(result.audio, audioElRef, audioUrlRef);
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'error', message: humanizeError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, reply]);

  /**
   * Начать запись. Приоритет — WebSocket-стриминг (T4 / δ-3). Если WS не
   * подключен (initial state / disconnect / unsupported) — fallback на REST
   * flow ниже (запись локально → POST /voice/transcribe в `stopRecording`).
   *
   * Mobile Safari quirk: `audio/webm` не поддерживается, fallback на
   * `audio/mp4` обрабатывается внутри `pickSupportedMimeType`.
   */
  const startRecording = useCallback(async () => {
    if (wsActive) {
      // WS-flow: вся работа в хуке, локальный state синхронизируется через
      // useEffect выше.
      await voiceWs.start();
      // Если хук сразу свалился в error — продолжим в локальном state,
      // следующее нажатие может попробовать REST fallback.
      if (voiceWs.state !== 'error') {
        setState({ kind: 'recording', startedAt: Date.now() });
      }
      return;
    }

    // ── REST fallback (graceful degradation) ───────────────────────
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setState({
          kind: 'error',
          message: 'Браузер не поддерживает запись микрофона',
        });
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mime = pickSupportedMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.start();
      setState({ kind: 'recording', startedAt: Date.now() });
    } catch (err) {
      setState({ kind: 'error', message: humanizeError(err) });
    }
  }, [wsActive, voiceWs]);

  const stopRecording = useCallback(async () => {
    if (wsActive) {
      // WS-flow: hook поднимет transcript через WS event listener.
      // useEffect выше переведёт state в 'processing' → 'ready'.
      setState({ kind: 'processing' });
      await voiceWs.stop();
      return;
    }

    // ── REST fallback ──────────────────────────────────────────────
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    setState({ kind: 'processing' });

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });

    stopAllTracks(streamRef.current);
    streamRef.current = null;
    mediaRecorderRef.current = null;

    const blobMime = recorder.mimeType || 'audio/webm';
    const blob = new Blob(chunksRef.current, { type: blobMime });
    chunksRef.current = [];

    if (blob.size === 0) {
      setState({ kind: 'error', message: 'Пустая запись — попробуйте ещё раз' });
      return;
    }

    try {
      const ext = blobMime.includes('ogg') ? 'ogg' : 'webm';
      const result = await voiceApi.transcribe({
        orgId,
        audio: blob,
        filename: `voice.${ext}`,
      });
      const transcript = result.text.trim();
      if (!transcript) {
        setState({
          kind: 'error',
          message: 'Не удалось распознать — попробуйте чуть громче',
        });
        return;
      }
      setState({ kind: 'ready', transcript });
      onTranscribed?.(transcript);
    } catch (err) {
      setState({ kind: 'error', message: humanizeError(err) });
    }
  }, [orgId, onTranscribed, wsActive, voiceWs]);

  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        {state.kind === 'recording' ? (
          <Button variant="danger" onClick={() => void stopRecording()}>
            Остановить запись
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => void startRecording()}
            disabled={state.kind === 'processing'}
            loading={state.kind === 'processing'}
          >
            {state.kind === 'processing' ? 'Распознаю…' : 'Записать голос'}
          </Button>
        )}
        <span className="text-sm text-fg-secondary">{stateLabel(state)}</span>
      </div>

      {state.kind === 'ready' && (
        <p className="mt-2 rounded bg-bg-subtle p-2 text-sm text-fg-primary">
          {state.transcript}
        </p>
      )}

      {state.kind === 'speaking' && (
        <p className="mt-2 rounded bg-bg-subtle p-2 text-sm text-fg-primary">
          {state.transcript}
        </p>
      )}

      {state.kind === 'error' && (
        <p className="mt-2 rounded bg-chip-danger-bg p-2 text-sm text-chip-danger-fg">
          {state.message}
        </p>
      )}

      <audio ref={audioElRef} controls className="mt-2 w-full">
        <track kind="captions" />
      </audio>
    </div>
  );
}

/**
 * TODO γ-2: `ConciergeFloatingButton` пока минимальный плейсхолдер. Когда
 * γ-2 Concierge (`ConciergeModule` + REST/WS) будет готов, этот компонент
 * расширится: открытие панели, история диалога, tool-use chips. Сейчас —
 * только обёртка над `ConciergeVoice` для удобного импорта.
 */
export function ConciergeFloatingButton({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {!open && (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Кора
        </Button>
      )}
      {open && (
        <div className="w-80 rounded-lg border border-border-subtle bg-bg-card p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium text-fg-primary">Кора</span>
            <button
              type="button"
              className="text-fg-secondary hover:text-fg-secondary"
              onClick={() => setOpen(false)}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
          <ConciergeVoice
            orgId={orgId}
            onTranscribed={(t) => setLastTranscript(t)}
          />
          {lastTranscript && (
            <p className="mt-3 text-xs text-fg-secondary">
              Распознано: «{lastTranscript}»
              <br />
              <span className="italic">
                TODO γ-2: отправить в concierge.send и получить ответ.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── helpers ───────────────────────────────────

function stateLabel(s: State): string {
  switch (s.kind) {
    case 'idle':
      return 'Готов записывать';
    case 'recording':
      return 'Идёт запись…';
    case 'processing':
      return 'Распознаю речь…';
    case 'ready':
      return 'Распознано';
    case 'speaking':
      return 'Озвучиваю ответ…';
    case 'error':
      return 'Ошибка распознавания';
    default:
      return '';
  }
}

function stopAllTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // ignore
    }
  }
}

function playAudio(
  blob: Blob,
  elRef: React.MutableRefObject<HTMLAudioElement | null>,
  urlRef: React.MutableRefObject<string | null>,
): void {
  revokeAudioUrl(urlRef.current);
  const url = URL.createObjectURL(blob);
  urlRef.current = url;
  const el = elRef.current;
  if (el) {
    el.src = url;
    void el.play().catch(() => {
      // Браузер может заблокировать autoplay без user gesture — игнорим.
    });
  }
}

function revokeAudioUrl(url: string | null): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

function humanizeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'audio_required') return 'Запись пустая';
    if (err.code === 'audio_too_large') return 'Запись слишком большая';
    if (err.code === 'text_too_long') return 'Текст слишком длинный (>500 символов)';
    if (err.code === 'asr_failed')
      return 'Не удалось распознать голос — попробуйте ещё раз';
    if (err.code === 'tts_failed')
      return 'Не удалось озвучить ответ — попробуйте ещё раз';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
