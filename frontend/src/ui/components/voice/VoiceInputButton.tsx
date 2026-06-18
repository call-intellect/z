"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { ApiError } from "@/api/api-error";
import { voiceApi } from "@/api/voice.api";
import { useAuth } from "@/contexts/auth-context";
import { pickSupportedMimeType } from "@/ui/concierge/audio-mime";

type VoiceState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

function hasMediaRecording(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  className?: string;
  title?: string;
}

export function VoiceInputButton({
  onTranscript,
  className,
  title = "Голосовой ввод",
}: VoiceInputButtonProps) {
  const { currentOrgId } = useAuth();
  const [supported, setSupported] = useState(false);
  const [voice, setVoice] = useState<VoiceState>({ kind: "idle" });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setSupported(hasMediaRecording());
  }, []);

  useEffect(() => {
    return () => {
      stopAllTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
    };
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    if (!currentOrgId) {
      setVoice({ kind: "error", message: "Нет активной организации" });
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setVoice({
        kind: "error",
        message: "Браузер не поддерживает запись микрофона",
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickSupportedMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.start();
      setVoice({ kind: "recording" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setVoice({
        kind: "error",
        message: `Не удалось начать запись: ${message}`,
      });
    }
  }, [currentOrgId]);

  const stopRecording = useCallback(async (): Promise<void> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setVoice({ kind: "transcribing" });
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
      setVoice({
        kind: "error",
        message: "Запись пустая — попробуйте ещё раз",
      });
      return;
    }
    if (!currentOrgId) {
      setVoice({ kind: "error", message: "Нет активной организации" });
      return;
    }
    try {
      const ext = blobMime.includes("ogg")
        ? "ogg"
        : blobMime.includes("mp4")
          ? "m4a"
          : "webm";
      const { text } = await voiceApi.transcribe({
        orgId: currentOrgId,
        audio: blob,
        filename: `checkin-voice.${ext}`,
      });
      const cleaned = text.trim();
      if (!cleaned) {
        setVoice({
          kind: "error",
          message: "Не удалось распознать голос, введите текстом",
        });
        return;
      }
      onTranscript(cleaned);
      setVoice({ kind: "idle" });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Не удалось распознать голос, введите текстом";
      setVoice({ kind: "error", message });
    }
  }, [currentOrgId, onTranscript]);

  const toggle = useCallback(() => {
    if (voice.kind === "recording") {
      void stopRecording();
    } else if (voice.kind === "idle" || voice.kind === "error") {
      void startRecording();
    }
  }, [voice.kind, startRecording, stopRecording]);

  if (!supported) return null;

  const recording = voice.kind === "recording";
  const transcribing = voice.kind === "transcribing";
  const disabled = transcribing || !currentOrgId;

  const tooltip = recording
    ? "Остановить запись"
    : voice.kind === "error"
      ? voice.message
      : !currentOrgId
        ? "Нет активной организации"
        : title;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      aria-label={title}
      aria-pressed={recording}
      title={tooltip}
      className={[
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
        recording
          ? "animate-pulse border-chip-danger-bg bg-chip-danger-bg text-chip-danger-fg"
          : "border-border-subtle bg-bg-elevated text-fg-secondary hover:text-fg-primary",
        disabled ? "cursor-not-allowed opacity-50" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {transcribing ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : recording ? (
        <Square className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Mic className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

function stopAllTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {}
  }
}

export function appendTranscript(prev: string, transcript: string): string {
  const piece = transcript.trim();
  if (!piece) return prev;
  if (!prev) return piece;
  const needsSpace = !/\s$/.test(prev);
  return `${prev}${needsSpace ? " " : ""}${piece}`;
}
