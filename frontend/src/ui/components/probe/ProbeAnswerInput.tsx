"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Pencil, Send, Square } from "lucide-react";

import { ApiError } from "@/api/api-error";
import { transcribeProbeAnswer } from "@/api/probe-voice.api";
import { useAuth } from "@/contexts/auth-context";
import { pickSupportedMimeType } from "@/ui/concierge/audio-mime";
import { Button } from "@/ui/shadcn/button";
import { Textarea } from "@/ui/shadcn/textarea";
import { toast } from "sonner";

export interface ProbeAnswerInputProps {
  question: string;
  onSubmit: (answer: string) => Promise<void>;
  voiceEnabled?: boolean;
  isSubmitting?: boolean;
  placeholder?: string;
}

type Mode = "text" | "voice";
type VoiceState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

const DEFAULT_PLACEHOLDER = "Ответьте своими словами…";

export function ProbeAnswerInput({
  question,
  onSubmit,
  voiceEnabled = true,
  isSubmitting = false,
  placeholder = DEFAULT_PLACEHOLDER,
}: ProbeAnswerInputProps) {
  const { currentOrgId } = useAuth();
  const [mode, setMode] = useState<Mode>("text");
  const [answer, setAnswer] = useState("");
  const [voice, setVoice] = useState<VoiceState>({ kind: "idle" });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      stopAllTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  const trimmed = answer.trim();
  const canSubmit =
    trimmed.length > 0 &&
    !isSubmitting &&
    voice.kind !== "recording" &&
    voice.kind !== "transcribing";

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
      const { text } = await transcribeProbeAnswer({
        orgId: currentOrgId,
        audio: blob,
        filename: `probe-answer.${ext}`,
      });
      const cleaned = text.trim();
      if (!cleaned) {
        setVoice({
          kind: "error",
          message: "Не удалось распознать голос, введите ответ текстом",
        });
        toast.error("Не удалось распознать голос, введите ответ текстом");
        setMode("text");
        return;
      }
      setAnswer((prev) =>
        prev.trim().length > 0 ? `${prev}\n${cleaned}` : cleaned,
      );
      setMode("text");
      setVoice({ kind: "idle" });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Не удалось распознать голос, введите ответ текстом";
      setVoice({ kind: "error", message });
      toast.error("Не удалось распознать голос, введите ответ текстом");
      setMode("text");
    }
  }, [currentOrgId]);

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    await onSubmit(trimmed);
    setAnswer("");
  }

  function handleModeChange(next: Mode): void {
    if (next === "text" && voice.kind === "recording") {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {}
      }
      stopAllTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      chunksRef.current = [];
      setVoice({ kind: "idle" });
    }
    setMode(next);
  }

  return (
    <div className="space-y-3 rounded-md border border-border-subtle bg-bg-card p-4">
      {}
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-fg-tertiary">
          Уточняющий вопрос
        </div>
        <p className="whitespace-pre-wrap text-sm font-medium text-fg-primary">
          {question}
        </p>
      </div>

      {}
      {voiceEnabled && (
        <div
          role="tablist"
          aria-label="Способ ответа"
          className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-elevated p-1 text-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "text"}
            onClick={() => handleModeChange("text")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
              mode === "text"
                ? "bg-accent text-accent-fg"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            Текст
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "voice"}
            onClick={() => handleModeChange("voice")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 transition-colors ${
              mode === "voice"
                ? "bg-accent text-accent-fg"
                : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            Голос
          </button>
        </div>
      )}

      {}
      {voiceEnabled && mode === "voice" && (
        <div className="space-y-2 rounded-md border border-dashed border-border-subtle bg-bg-elevated p-3">
          {voice.kind !== "recording" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void startRecording()}
              disabled={voice.kind === "transcribing"}
            >
              {voice.kind === "transcribing" ? (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Mic className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {voice.kind === "transcribing"
                ? "Распознаём голос…"
                : "Записать голосом"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => void stopRecording()}
            >
              <Square className="mr-2 h-4 w-4" aria-hidden="true" />
              Остановить запись
            </Button>
          )}
          {voice.kind === "recording" && (
            <p className="text-xs text-fg-tertiary">
              Идёт запись… говорите свободно.
            </p>
          )}
          {voice.kind === "error" && (
            <p className="rounded bg-chip-danger-bg px-2 py-1 text-xs text-chip-danger-fg">
              {voice.message}
            </p>
          )}
        </div>
      )}

      {}
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-fg-tertiary">
          Ваш ответ
        </label>
        <Textarea
          rows={3}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={placeholder}
          disabled={isSubmitting || voice.kind === "transcribing"}
        />
      </div>

      {}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Отправить
        </Button>
      </div>
    </div>
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
