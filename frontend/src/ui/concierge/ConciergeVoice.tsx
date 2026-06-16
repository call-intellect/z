"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useVoiceStream } from "../../hooks/concierge/useVoiceStream";
import { voiceApi } from "../../api/voice.api";
import { ApiError } from "../../api/api-error";
import { Button } from "../components/shared/Button";
import { pickSupportedMimeType } from "./audio-mime";

type State =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "processing" }
  | { kind: "ready"; transcript: string }
  | { kind: "speaking"; transcript: string }
  | { kind: "error"; message: string };

export interface ConciergeVoiceProps {
  orgId: string;
  onTranscribed?: (transcript: string) => void;
  reply?: string | null;
  className?: string;
  useWebSocket?: boolean;
}

export function ConciergeVoice({
  orgId,
  onTranscribed,
  reply,
  className,
  useWebSocket = true,
}: ConciergeVoiceProps) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const voiceWs = useVoiceStream(orgId, useWebSocket);
  const wsActive =
    useWebSocket && voiceWs.state !== "unavailable" && voiceWs.connected;

  const onTranscribedRef = useRef(onTranscribed);
  onTranscribedRef.current = onTranscribed;
  useEffect(() => {
    if (voiceWs.state === "idle" && voiceWs.transcript) {
      const t = voiceWs.transcript.trim();
      if (t.length === 0) {
        setState({
          kind: "error",
          message: "Не удалось распознать — попробуйте чуть громче",
        });
        return;
      }
      setState({ kind: "ready", transcript: t });
      onTranscribedRef.current?.(t);
      voiceWs.reset();
    } else if (voiceWs.state === "transcribing") {
      setState({ kind: "processing" });
    } else if (voiceWs.state === "error" && voiceWs.error) {
      setState({ kind: "error", message: voiceWs.error });
    }
  }, [voiceWs.state, voiceWs.transcript, voiceWs.error, voiceWs]);

  useEffect(() => {
    return () => {
      stopAllTracks(streamRef.current);
      revokeAudioUrl(audioUrlRef.current);
      audioUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!reply || reply.trim().length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        setState((prev) =>
          prev.kind === "ready"
            ? { kind: "speaking", transcript: prev.transcript }
            : prev,
        );
        const result = await voiceApi.synthesize({
          orgId,
          input: { text: reply, format: "mp3" },
        });
        if (cancelled) return;
        playAudio(result.audio, audioElRef, audioUrlRef);
      } catch (err) {
        if (cancelled) return;
        setState({ kind: "error", message: humanizeError(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, reply]);

  const startRecording = useCallback(async () => {
    if (wsActive) {
      await voiceWs.start();
      if (voiceWs.state !== "error") {
        setState({ kind: "recording", startedAt: Date.now() });
      }
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setState({
          kind: "error",
          message: "Браузер не поддерживает запись микрофона",
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
      setState({ kind: "recording", startedAt: Date.now() });
    } catch (err) {
      setState({ kind: "error", message: humanizeError(err) });
    }
  }, [wsActive, voiceWs]);

  const stopRecording = useCallback(async () => {
    if (wsActive) {
      setState({ kind: "processing" });
      await voiceWs.stop();
      return;
    }

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    setState({ kind: "processing" });

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

    const blobMime = recorder.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: blobMime });
    chunksRef.current = [];

    if (blob.size === 0) {
      setState({
        kind: "error",
        message: "Пустая запись — попробуйте ещё раз",
      });
      return;
    }

    try {
      const ext = blobMime.includes("ogg") ? "ogg" : "webm";
      const result = await voiceApi.transcribe({
        orgId,
        audio: blob,
        filename: `voice.${ext}`,
      });
      const transcript = result.text.trim();
      if (!transcript) {
        setState({
          kind: "error",
          message: "Не удалось распознать — попробуйте чуть громче",
        });
        return;
      }
      setState({ kind: "ready", transcript });
      onTranscribed?.(transcript);
    } catch (err) {
      setState({ kind: "error", message: humanizeError(err) });
    }
  }, [orgId, onTranscribed, wsActive, voiceWs]);

  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        {state.kind === "recording" ? (
          <Button variant="danger" onClick={() => void stopRecording()}>
            Остановить запись
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => void startRecording()}
            disabled={state.kind === "processing"}
            loading={state.kind === "processing"}
          >
            {state.kind === "processing" ? "Распознаю…" : "Записать голос"}
          </Button>
        )}
        <span className="text-sm text-fg-secondary">{stateLabel(state)}</span>
      </div>

      {state.kind === "ready" && (
        <p className="mt-2 rounded bg-bg-subtle p-2 text-sm text-fg-primary">
          {state.transcript}
        </p>
      )}

      {state.kind === "speaking" && (
        <p className="mt-2 rounded bg-bg-subtle p-2 text-sm text-fg-primary">
          {state.transcript}
        </p>
      )}

      {state.kind === "error" && (
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

function stateLabel(s: State): string {
  switch (s.kind) {
    case "idle":
      return "Готов записывать";
    case "recording":
      return "Идёт запись…";
    case "processing":
      return "Распознаю речь…";
    case "ready":
      return "Распознано";
    case "speaking":
      return "Озвучиваю ответ…";
    case "error":
      return "Ошибка распознавания";
    default:
      return "";
  }
}

function stopAllTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {}
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
    void el.play().catch(() => {});
  }
}

function revokeAudioUrl(url: string | null): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {}
}

function humanizeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "audio_required") return "Запись пустая";
    if (err.code === "audio_too_large") return "Запись слишком большая";
    if (err.code === "text_too_long")
      return "Текст слишком длинный (>500 символов)";
    if (err.code === "asr_failed")
      return "Не удалось распознать голос — попробуйте ещё раз";
    if (err.code === "tts_failed")
      return "Не удалось озвучить ответ — попробуйте ещё раз";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
