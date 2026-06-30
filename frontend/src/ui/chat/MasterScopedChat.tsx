"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Mic,
  Send,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";

import {
  conciergeApi,
  conciergeStreamApi,
  type ConciergeStreamEvent,
} from "@/api/concierge.api";
import type { ChatV2ScopeApi } from "@/api/chat-v2.api";
import { tablesApi } from "@/api/tables.api";
import { voiceApi } from "@/api/voice.api";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import {
  isInferredTableSchema,
  type InferredTableSchema,
} from "@/domain/table";
import { toolNameLabel } from "@/domain/concierge";
import { AssistantMarkdown } from "@/ui/components/chat-v2/AssistantMarkdown";
import { TableSchemaPreview } from "@/ui/concierge/TableSchemaPreview";
import { Button } from "@/ui/shadcn/button";
import {
  masterRowsFromEvent,
  type MasterRow,
} from "./master-chat-events";
import { MasterCitations } from "./MasterCitations";

export interface MasterScopedChatProps {
  scope: ChatV2ScopeApi;
  scopeRefId?: string | null;
  orgId: string;
  placeholder?: string;
  emptyTitle?: string;
  emptyHint?: string;
  enableVoice?: boolean;
  enableTts?: boolean;
  suggestedPrompts?: string[];
  className?: string;
}

type RecState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "transcribing" };

type TtsState = {
  rowId: string | null;
  status: "idle" | "loading" | "playing";
};

export function MasterScopedChat({
  scope,
  scopeRefId,
  orgId,
  placeholder = "Что нужно сделать?",
  emptyTitle = "Я Мастер Кора",
  emptyHint = "Спросите о памяти компании или попросите выполнить действие — каждый ответ подкреплён цитатами из источников.",
  enableVoice = false,
  enableTts = false,
  suggestedPrompts,
  className,
}: MasterScopedChatProps): ReactElement {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const [rows, setRows] = useState<MasterRow[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [creatingTable, setCreatingTable] = useState(false);
  const [currentConv, setCurrentConv] = useState<string | undefined>(undefined);
  const [rec, setRec] = useState<RecState>({ kind: "idle" });
  const [recError, setRecError] = useState<string | null>(null);
  const [ttsState, setTtsState] = useState<TtsState>({
    rowId: null,
    status: "idle",
  });

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const idCounter = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);

  const nextId = useCallback(() => {
    idCounter.current += 1;
    return `r-${idCounter.current}`;
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopAllTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      const audio = ttsAudioRef.current;
      if (audio) {
        try {
          audio.pause();
        } catch {}
      }
      revokeTtsUrl(ttsUrlRef.current);
      ttsUrlRef.current = null;
    };
  }, []);

  const handleUndo = useCallback(async (logId: string) => {
    try {
      const res = await conciergeApi.undo(logId);
      if (res.ok) {
        toast.success("Действие отменено");
      } else {
        toast.error(res.message ?? "Не удалось отменить");
      }
    } catch {
      toast.error("Ошибка отмены");
    }
  }, []);

  const handleCreateFromSchema = useCallback(
    async (schema: InferredTableSchema) => {
      if (!currentOrgId) {
        toast.error("Не выбрана организация");
        return;
      }
      setCreatingTable(true);
      try {
        const created = await tablesApi.createFromSchema(currentOrgId, schema);
        toast.success("Таблица создана", {
          action: {
            label: "Открыть",
            onClick: () => router.push(`/tables/${created.id}`),
          },
        });
        router.push(`/tables/${created.id}`);
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.code === "feature_tables_text_to_schema_disabled"
        ) {
          toast.error(
            "Создание таблиц по описанию пока отключено в этой организации",
          );
        } else {
          toast.error(humanizeApiError(e, "Не удалось создать таблицу"));
        }
      } finally {
        setCreatingTable(false);
      }
    },
    [currentOrgId, router],
  );

  const applyEvent = useCallback(
    (ev: ConciergeStreamEvent) => {
      setRows((prev) => {
        const res = masterRowsFromEvent(
          prev,
          ev,
          nextId,
          isInferredTableSchema,
          toolNameLabel,
        );
        if (res.startedConversationId && !currentConv) {
          setCurrentConv(res.startedConversationId);
        }
        if (res.undo) {
          const { toolName, undoLogId } = res.undo;
          toast.success(`Готово: ${toolNameLabel(toolName)}`, {
            action: {
              label: "Отменить",
              onClick: () => void handleUndo(undoLogId),
            },
          });
        }
        if (res.quota) {
          toast.error(
            res.quota === "daily"
              ? "Дневная квота Мастера исчерпана"
              : "Месячная квота Мастера исчерпана",
          );
        }
        if (res.error) toast.error(res.error);
        return res.rows;
      });
    },
    [currentConv, handleUndo, nextId],
  );

  const sendMaster = useCallback(
    async (trimmed: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      let sseFailed = false;
      try {
        for await (const ev of conciergeStreamApi(
          {
            userMessage: trimmed,
            ...(currentConv ? { conversationId: currentConv } : {}),
            scope,
            ...(scopeRefId ? { scopeRefId } : {}),
          },
          controller.signal,
        )) {
          applyEvent(ev);
        }
      } catch (err) {
        sseFailed = true;
        console.warn("Master scoped SSE failed, fallback to once:", err);
      } finally {
        abortRef.current = null;
      }

      if (sseFailed) {
        try {
          const r = await conciergeApi.askOnce({
            userMessage: trimmed,
            ...(currentConv ? { conversationId: currentConv } : {}),
            scope,
            ...(scopeRefId ? { scopeRefId } : {}),
          });
          if (r.quotaExceeded) {
            toast.error(
              r.quotaExceeded === "daily"
                ? "Дневная квота Мастера исчерпана"
                : "Месячная квота Мастера исчерпана",
            );
          } else if (r.error) {
            toast.error(r.error.message);
          } else {
            if (!currentConv && r.conversationId) {
              setCurrentConv(r.conversationId);
            }
            for (const tc of r.toolCalls) {
              setRows((prev) => [
                ...prev,
                {
                  id: nextId(),
                  role: "tool",
                  text: `${toolNameLabel(tc.toolName)} (${tc.ok ? "ок" : "ошибка"})`,
                  meta: {
                    toolName: tc.toolName,
                    ok: tc.ok,
                    ...(tc.undoLogId ? { undoLogId: tc.undoLogId } : {}),
                  },
                },
              ]);
              if (tc.undoLogId) {
                const undoLogId = tc.undoLogId;
                toast.success(`Готово: ${toolNameLabel(tc.toolName)}`, {
                  action: {
                    label: "Отменить",
                    onClick: () => void handleUndo(undoLogId),
                  },
                });
              }
            }
            if (r.text) {
              setRows((prev) => [
                ...prev,
                {
                  id: nextId(),
                  role: "assistant",
                  text: r.text,
                  ...(r.citations ? { citations: r.citations } : {}),
                },
              ]);
            }
          }
        } catch {
          toast.error("Мастер временно недоступен");
        }
      }
    },
    [applyEvent, currentConv, handleUndo, nextId, scope, scopeRefId],
  );

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);
    setRows((prev) => [...prev, { id: nextId(), role: "user", text: trimmed }]);
    try {
      await sendMaster(trimmed);
    } finally {
      setBusy(false);
    }
  }, [busy, input, nextId, sendMaster]);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void send();
    },
    [send],
  );

  const speakRow = useCallback(
    async (row: MasterRow) => {
      if (
        ttsState.rowId === row.id &&
        (ttsState.status === "playing" || ttsState.status === "loading")
      ) {
        const audio = ttsAudioRef.current;
        if (audio) {
          try {
            audio.pause();
            audio.currentTime = 0;
          } catch {}
        }
        revokeTtsUrl(ttsUrlRef.current);
        ttsUrlRef.current = null;
        setTtsState({ rowId: null, status: "idle" });
        return;
      }

      const prevAudio = ttsAudioRef.current;
      if (prevAudio) {
        try {
          prevAudio.pause();
        } catch {}
      }
      revokeTtsUrl(ttsUrlRef.current);
      ttsUrlRef.current = null;

      setTtsState({ rowId: row.id, status: "loading" });

      const text =
        row.text.length > 480 ? `${row.text.slice(0, 480)}…` : row.text;

      try {
        const result = await voiceApi.synthesize({
          orgId,
          input: { text, format: "mp3" },
        });
        const url = URL.createObjectURL(result.audio);
        ttsUrlRef.current = url;
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        audio.onended = () => {
          revokeTtsUrl(ttsUrlRef.current);
          ttsUrlRef.current = null;
          setTtsState({ rowId: null, status: "idle" });
        };
        audio.onerror = () => {
          revokeTtsUrl(ttsUrlRef.current);
          ttsUrlRef.current = null;
          setTtsState({ rowId: null, status: "idle" });
          toast.error("Не удалось воспроизвести озвучку");
        };
        setTtsState({ rowId: row.id, status: "playing" });
        await audio.play();
      } catch (err) {
        revokeTtsUrl(ttsUrlRef.current);
        ttsUrlRef.current = null;
        setTtsState({ rowId: null, status: "idle" });
        const apiCode = err instanceof ApiError ? err.code : null;
        const friendly =
          apiCode === "http_404"
            ? "TTS пока недоступен"
            : apiCode === "tts_failed"
              ? "Не удалось озвучить"
              : apiCode === "text_too_long"
                ? "Ответ слишком длинный для озвучки"
                : "Не удалось озвучить";
        toast.error(friendly);
      }
    },
    [orgId, ttsState],
  );

  const startRecording = useCallback(async () => {
    setRecError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setRecError("Браузер не поддерживает запись микрофона");
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        setRecError("Браузер не поддерживает запись микрофона");
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
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.start();
      setRec({ kind: "recording" });
    } catch (err) {
      setRecError(humanizeVoiceError(err));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setRec({ kind: "transcribing" });
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
      setRec({ kind: "idle" });
      setRecError("Пустая запись — попробуйте ещё раз");
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
      setRec({ kind: "idle" });
      if (!transcript) {
        setRecError("Не удалось распознать — попробуйте чуть громче");
        return;
      }
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    } catch (err) {
      setRec({ kind: "idle" });
      setRecError(humanizeVoiceError(err));
    }
  }, [orgId]);

  const micSupported =
    enableVoice &&
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const sendDisabled = busy || !input.trim() || rec.kind !== "idle";

  return (
    <div
      className={
        className
          ? `flex flex-col gap-3 ${className}`
          : "flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated"
      }
    >
      <div
        ref={scrollRef}
        className="flex max-h-[420px] min-h-[160px] flex-col gap-3 overflow-y-auto px-4 py-3 text-sm"
      >
        {rows.length === 0 && !busy ? (
          <div className="m-auto max-w-md text-center text-fg-tertiary">
            <div className="text-sm font-medium text-fg-primary">
              {emptyTitle}
            </div>
            <div className="mt-1 text-xs text-fg-tertiary">{emptyHint}</div>
            {suggestedPrompts && suggestedPrompts.length > 0 ? (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {suggestedPrompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setInput(p)}
                    className="rounded-full border border-border-subtle bg-bg-elevated px-3 py-1.5 text-xs text-fg-secondary transition-colors hover:border-accent/60 hover:text-accent"
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {rows.map((row) =>
          row.kind === "table_schema_preview" && row.schema ? (
            <TableSchemaPreview
              key={row.id}
              schema={row.schema}
              onConfirm={handleCreateFromSchema}
              busy={creatingTable}
            />
          ) : row.role === "user" ? (
            <div key={row.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg">
                {row.text}
              </div>
            </div>
          ) : row.role === "assistant" ? (
            <div key={row.id} className="flex justify-start">
              <div className="max-w-[85%] break-words rounded-lg border border-border-subtle bg-bg px-3 py-2 text-sm text-fg-primary">
                <div className="mb-1 text-[11px] text-fg-tertiary">
                  ✨ Мастер Кора
                </div>
                <AssistantMarkdown text={row.text} />
                {enableTts ? (
                  <button
                    type="button"
                    onClick={() => void speakRow(row)}
                    disabled={
                      ttsState.rowId === row.id && ttsState.status === "loading"
                    }
                    className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-tertiary hover:bg-bg-overlay hover:text-fg-primary disabled:opacity-60"
                    aria-label={
                      ttsState.rowId === row.id && ttsState.status === "playing"
                        ? "Остановить озвучку"
                        : ttsState.rowId === row.id &&
                            ttsState.status === "loading"
                          ? "Озвучивается"
                          : "Озвучить ответ"
                    }
                    title={
                      ttsState.rowId === row.id && ttsState.status === "playing"
                        ? "Остановить"
                        : ttsState.rowId === row.id &&
                            ttsState.status === "loading"
                          ? "Озвучивается…"
                          : "Озвучить"
                    }
                  >
                    {ttsState.rowId === row.id &&
                    ttsState.status === "loading" ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Озвучивается…
                      </>
                    ) : ttsState.rowId === row.id &&
                      ttsState.status === "playing" ? (
                      <>
                        <VolumeX size={12} />
                        Остановить
                      </>
                    ) : (
                      <>
                        <Volume2 size={12} />
                        Озвучить
                      </>
                    )}
                  </button>
                ) : null}
                {row.citations && row.citations.length > 0 ? (
                  <MasterCitations citations={row.citations} />
                ) : null}
              </div>
            </div>
          ) : (
            <div
              key={row.id}
              className="rounded-md bg-bg-subtle px-3 py-1.5 text-xs text-fg-tertiary"
            >
              {row.text}
            </div>
          ),
        )}

        {busy ? (
          <div className="flex items-center gap-2 text-xs text-fg-tertiary">
            <Loader2 size={14} className="animate-spin" />
            Кора печатает ответ…
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 border-t border-border-subtle p-3"
      >
        <div className="flex items-end gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border border-border-subtle bg-bg px-3 py-2 text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            placeholder={
              rec.kind === "recording"
                ? "Идёт запись… нажмите квадрат, чтобы остановить"
                : rec.kind === "transcribing"
                  ? "Распознаю…"
                  : placeholder
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy || rec.kind !== "idle"}
            aria-label="Вопрос к Коре"
          />

          {micSupported ? (
            <Button
              type="button"
              variant={rec.kind === "recording" ? "destructive" : "outline"}
              size="icon"
              onClick={
                rec.kind === "recording"
                  ? () => void stopRecording()
                  : () => void startRecording()
              }
              disabled={busy || rec.kind === "transcribing"}
              aria-label={
                rec.kind === "recording"
                  ? "Остановить запись"
                  : "Записать голос"
              }
              title={
                rec.kind === "recording"
                  ? "Остановить запись"
                  : "Записать голос"
              }
            >
              {rec.kind === "transcribing" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : rec.kind === "recording" ? (
                <Square size={16} />
              ) : (
                <Mic size={16} />
              )}
            </Button>
          ) : null}

          <Button
            type="submit"
            disabled={sendDisabled}
            size="icon"
            aria-label="Отправить вопрос"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </Button>
        </div>

        {recError ? (
          <div className="rounded bg-danger/10 px-3 py-1.5 text-xs text-danger">
            {recError}
          </div>
        ) : null}
      </form>
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

function revokeTtsUrl(url: string | null): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {}
}

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {}
  }
  return null;
}

function humanizeVoiceError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "audio_required") return "Запись пустая";
    if (err.code === "audio_too_large") return "Запись слишком длинная";
    if (err.code === "asr_failed")
      return "Не удалось распознать голос — попробуйте ещё раз";
    return err.message;
  }
  if (err instanceof Error) {
    if (err.name === "NotAllowedError")
      return "Доступ к микрофону запрещён в настройках браузера";
    if (err.name === "NotFoundError") return "Микрофон не найден";
    return err.message;
  }
  return String(err);
}
