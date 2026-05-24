'use client';

/**
 * IssueChat — чат-в-задаче поверх chat-v2 (Wave 2 B1).
 *
 * Реализация: тонкая обёртка над `chatV2Api.ask` с локальной историей
 * сообщений (single-question UX, как `ChatPanel`) + кнопка голосового
 * ввода через серверный ASR `/api/v1/voice/transcribe`.
 *
 * Архитектурные решения:
 *   - scope = 'card' — в chat-v2 enum нет 'issue'; ближайший
 *     семантический аналог — карточка в knowledge-core. scopeRefId = issueId.
 *     Backend (synthesis.service) сам подтягивает контекст по scopeRefId;
 *     если в графе ещё нет знаний по этому id, synthetic-режим честно
 *     ответит «недостаточно контекста». TODO: расширить enum в backend
 *     значением 'issue' и завести трекер-специалиста в card-specialist-registry.
 *   - mode = 'synthetic' — задаче чаще нужен синтез/совет, а не дословные цитаты.
 *   - ChatPanel не используем напрямую: нужна кнопка микрофона рядом с input,
 *     а ChatPanel держит input в своём state без props для управления извне.
 *     Дублирование тривиальное (форма + список бабблов), переиспользуем
 *     domain-форматтеры и API-клиент.
 *   - Голос: серверный Vox/Whisper через voiceApi.transcribe (готовое,
 *     production-grade, работает во всех браузерах). Web Speech API не берём —
 *     нестабильно в Edge/Firefox/Safari, в проде у нас Vox/GigaAM.
 */

import {
  Loader2,
  MessageCircle,
  Mic,
  Send,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { chatV2Api } from '@/api/chat-v2.api';
import { voiceApi } from '@/api/voice.api';
import { ApiError } from '@/api/api-error';
import { Button } from '@/ui/shadcn/button';
import { useToast } from '@/contexts/toast-context';
import {
  chatV2ModeLabel,
  formatTimestamp,
  type ChatV2Citation,
  type ChatV2Mode,
} from '@/domain/chat-v2';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: ChatV2Citation[];
  uncertaintyNote?: string | null;
  mode?: ChatV2Mode;
}

type RecState =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'transcribing' };

export interface IssueChatProps {
  issueId: string;
  orgId: string;
}

export function IssueChat({ issueId, orgId }: IssueChatProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined,
  );
  const [rec, setRec] = useState<RecState>({ kind: 'idle' });
  const [recError, setRecError] = useState<string | null>(null);
  // TTS: какое сообщение сейчас озвучивается / загружается.
  const [ttsState, setTtsState] = useState<{
    messageId: string | null;
    status: 'idle' | 'loading' | 'playing';
  }>({ messageId: null, status: 'idle' });
  const { addToast } = useToast();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // TTS: текущий audio-элемент и blob-URL, чтобы revoke при остановке.
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);

  // Cleanup на размонтирование — освобождаем микрофон, если запись активна,
  // а также останавливаем TTS-воспроизведение и revoke blob-URL.
  useEffect(() => {
    return () => {
      stopAllTracks(streamRef.current);
      streamRef.current = null;
      mediaRecorderRef.current = null;
      const audio = ttsAudioRef.current;
      if (audio) {
        try {
          audio.pause();
        } catch {
          // ignore
        }
      }
      revokeTtsUrl(ttsUrlRef.current);
      ttsUrlRef.current = null;
    };
  }, []);

  const speakMessage = useCallback(
    async (msg: LocalMessage) => {
      // Toggle: повторный клик по тому же сообщению — остановить.
      if (
        ttsState.messageId === msg.id &&
        (ttsState.status === 'playing' || ttsState.status === 'loading')
      ) {
        const audio = ttsAudioRef.current;
        if (audio) {
          try {
            audio.pause();
            audio.currentTime = 0;
          } catch {
            // ignore
          }
        }
        revokeTtsUrl(ttsUrlRef.current);
        ttsUrlRef.current = null;
        setTtsState({ messageId: null, status: 'idle' });
        return;
      }

      // Остановить предыдущее воспроизведение, если было.
      const prevAudio = ttsAudioRef.current;
      if (prevAudio) {
        try {
          prevAudio.pause();
        } catch {
          // ignore
        }
      }
      revokeTtsUrl(ttsUrlRef.current);
      ttsUrlRef.current = null;

      setTtsState({ messageId: msg.id, status: 'loading' });

      // Backend имеет лимит 500 символов на TTS — обрезаем длинный ответ
      // и пользователь увидит это как чуть укороченную озвучку (без ошибки).
      const text = msg.text.length > 480 ? `${msg.text.slice(0, 480)}…` : msg.text;

      try {
        const result = await voiceApi.synthesize({
          orgId,
          input: { text, format: 'mp3' },
        });
        const url = URL.createObjectURL(result.audio);
        ttsUrlRef.current = url;
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        audio.onended = () => {
          revokeTtsUrl(ttsUrlRef.current);
          ttsUrlRef.current = null;
          setTtsState({ messageId: null, status: 'idle' });
        };
        audio.onerror = () => {
          revokeTtsUrl(ttsUrlRef.current);
          ttsUrlRef.current = null;
          setTtsState({ messageId: null, status: 'idle' });
          addToast({
            type: 'error',
            message: 'Не удалось воспроизвести озвучку',
          });
        };
        setTtsState({ messageId: msg.id, status: 'playing' });
        await audio.play();
      } catch (err) {
        revokeTtsUrl(ttsUrlRef.current);
        ttsUrlRef.current = null;
        setTtsState({ messageId: null, status: 'idle' });
        // Грейсфул-фолбэк: если backend `/voice/synthesize` отсутствует
        // (404) или TTS не сконфигурирован (tts_failed) — показываем
        // мягкое сообщение, без красного стектрейса.
        const apiCode = err instanceof ApiError ? err.code : null;
        const friendly =
          apiCode === 'http_404'
            ? 'TTS пока недоступен'
            : apiCode === 'tts_failed'
              ? 'Не удалось озвучить'
              : apiCode === 'text_too_long'
                ? 'Ответ слишком длинный для озвучки'
                : 'Не удалось озвучить';
        addToast({ type: 'error', message: friendly });
      }
    },
    [orgId, ttsState, addToast],
  );

  const askQuestion = useCallback(
    async (question: string) => {
      setError(null);
      setLoading(true);
      const tempId = `local-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: tempId, role: 'user', text: question },
      ]);
      try {
        const response = await chatV2Api.ask({
          question,
          conversationId,
          scope: 'card',
          scopeRefId: issueId,
          mode: 'synthetic',
        });
        setConversationId(response.conversationId);
        setMessages((prev) => [
          ...prev,
          {
            id: response.messageId,
            role: 'assistant',
            text: response.text,
            citations: response.citations as ChatV2Citation[],
            uncertaintyNote: response.uncertaintyNote,
            mode: response.mode,
          },
        ]);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Не удалось получить ответ';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [conversationId, issueId],
  );

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const question = input.trim();
      if (!question || loading) return;
      setInput('');
      void askQuestion(question);
    },
    [askQuestion, input, loading],
  );

  const startRecording = useCallback(async () => {
    setRecError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setRecError('Браузер не поддерживает запись микрофона');
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        setRecError('Браузер не поддерживает запись микрофона');
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
      setRec({ kind: 'recording' });
    } catch (err) {
      setRecError(humanizeVoiceError(err));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setRec({ kind: 'transcribing' });
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
      setRec({ kind: 'idle' });
      setRecError('Пустая запись — попробуйте ещё раз');
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
      setRec({ kind: 'idle' });
      if (!transcript) {
        setRecError('Не удалось распознать — попробуйте чуть громче');
        return;
      }
      // Дописываем к тексту в input (а не затираем) — пользователь мог
      // начать печатать перед нажатием микрофона.
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    } catch (err) {
      setRec({ kind: 'idle' });
      setRecError(humanizeVoiceError(err));
    }
  }, [orgId]);

  const micSupported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const sendDisabled = loading || !input.trim() || rec.kind !== 'idle';

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated">
      <div className="flex max-h-[420px] min-h-[160px] flex-col gap-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !loading ? (
          <div className="m-auto max-w-md text-center">
            <div className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-full bg-bg-overlay">
              <MessageCircle size={16} className="text-fg-tertiary" />
            </div>
            <div className="text-sm font-medium text-fg-primary">
              Спросите AI про эту задачу
            </div>
            <div className="mt-1 text-xs text-fg-tertiary">
              Кора подтянет контекст из памяти компании и ответит со ссылками
              на источники.
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <ChatBubble
            key={m.id}
            message={m}
            ttsStatus={
              ttsState.messageId === m.id ? ttsState.status : 'idle'
            }
            onSpeak={speakMessage}
          />
        ))}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-fg-tertiary">
            <Loader2 size={14} className="animate-spin" />
            AI печатает ответ…
          </div>
        ) : null}

        {error ? (
          <div className="rounded bg-danger/10 px-3 py-2 text-xs text-danger">
            Ошибка: {error}
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
              rec.kind === 'recording'
                ? 'Идёт запись… нажмите квадрат, чтобы остановить'
                : rec.kind === 'transcribing'
                  ? 'Распознаю…'
                  : 'Спросить AI про эту задачу…'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading || rec.kind !== 'idle'}
            aria-label="Вопрос к AI"
          />

          {micSupported ? (
            <Button
              type="button"
              variant={rec.kind === 'recording' ? 'destructive' : 'outline'}
              size="icon"
              onClick={
                rec.kind === 'recording'
                  ? () => void stopRecording()
                  : () => void startRecording()
              }
              disabled={loading || rec.kind === 'transcribing'}
              aria-label={
                rec.kind === 'recording'
                  ? 'Остановить запись'
                  : 'Записать голос'
              }
              title={
                rec.kind === 'recording'
                  ? 'Остановить запись'
                  : 'Записать голос'
              }
            >
              {rec.kind === 'transcribing' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : rec.kind === 'recording' ? (
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
            {loading ? (
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

function ChatBubble({
  message,
  ttsStatus,
  onSpeak,
}: {
  message: LocalMessage;
  ttsStatus: 'idle' | 'loading' | 'playing';
  onSpeak: (msg: LocalMessage) => void | Promise<void>;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-accent text-accent-fg'
            : 'border border-border-subtle bg-bg text-fg-primary'
        }`}
      >
        {!isUser && message.mode ? (
          <div className="mb-1 text-[11px] text-fg-tertiary">
            Режим: {chatV2ModeLabel(message.mode)}
          </div>
        ) : null}
        <div>{message.text}</div>
        {!isUser ? (
          <button
            type="button"
            onClick={() => void onSpeak(message)}
            disabled={ttsStatus === 'loading'}
            className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-tertiary hover:bg-bg-overlay hover:text-fg-primary disabled:opacity-60"
            aria-label={
              ttsStatus === 'playing'
                ? 'Остановить озвучку'
                : ttsStatus === 'loading'
                  ? 'Озвучивается'
                  : 'Озвучить ответ'
            }
            title={
              ttsStatus === 'playing'
                ? 'Остановить'
                : ttsStatus === 'loading'
                  ? 'Озвучивается…'
                  : 'Озвучить'
            }
          >
            {ttsStatus === 'loading' ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Озвучивается…
              </>
            ) : ttsStatus === 'playing' ? (
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
        {!isUser && message.uncertaintyNote ? (
          <div className="mt-2 rounded bg-warning/10 px-2 py-1 text-[11px] text-warning">
            {message.uncertaintyNote}
          </div>
        ) : null}
        {!isUser && message.citations && message.citations.length > 0 ? (
          <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
            <div className="text-[11px] font-medium text-fg-tertiary">
              Источники:
            </div>
            {message.citations.map((c, idx) => (
              <div
                key={`${c.meetingId}-${c.startMs}-${idx}`}
                className="rounded bg-bg-elevated px-2 py-1 text-[11px]"
              >
                <div className="font-medium text-fg-primary">
                  {c.meetingTitle}{' '}
                  <span className="text-fg-tertiary">
                    [{formatTimestamp(c.startMs)}]
                  </span>
                </div>
                <div className="italic text-fg-secondary">"{c.snippet}"</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────── voice helpers ─────────────────────────────────

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

function revokeTtsUrl(url: string | null): void {
  if (!url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const t of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return null;
}

function humanizeVoiceError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'audio_required') return 'Запись пустая';
    if (err.code === 'audio_too_large') return 'Запись слишком длинная';
    if (err.code === 'asr_failed')
      return 'Не удалось распознать голос — попробуйте ещё раз';
    return err.message;
  }
  if (err instanceof Error) {
    if (err.name === 'NotAllowedError')
      return 'Доступ к микрофону запрещён в настройках браузера';
    if (err.name === 'NotFoundError') return 'Микрофон не найден';
    return err.message;
  }
  return String(err);
}
