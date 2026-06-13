'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Brain,
  Building2,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  FolderKanban,
  Home,
  IdCard,
  Inbox,
  ListChecks,
  Loader2,
  MessageCircle,
  Mic,
  Network,
  Pin,
  PinOff,
  Settings,
  Sparkles,
  Square,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { searchApi, type SearchResponse } from '@/api/search.api';
import { conciergeApi } from '@/api/concierge.api';
import { chatV2Api, type ChatV2AskResponseApi } from '@/api/chat-v2.api';
import { voiceApi } from '@/api/voice.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/shadcn/command';
import { Command as CommandPrimitive } from 'cmdk';
import { Dialog, DialogContent } from '@/ui/shadcn/dialog';
import { Sheet, SheetContent } from '@/ui/shadcn/sheet';
import { cn } from '@/ui/shadcn/lib/utils';
import { useCommandPalette } from './CommandPaletteProvider';
import {
  loadPinned,
  loadRecent,
  pushRecent,
  togglePinned,
  type PaletteRecentItem,
} from './recent-storage';

/**
 * Глобальная командная палитра. Хоткей: ⌘K (mac) / Ctrl+K (win/linux).
 * Открытие/закрытие — через `useCommandPalette()` (Wave 2 B2 Provider).
 *
 * Режимы:
 *   - **Поиск (default)** — ввод → debounce 200мс → search.api по
 *     карточкам/встречам/задачам/ролям/отделам/людям/документам.
 *   - **Команда Concierge** — ввод начинается с `>` → запрос идёт в
 *     `conciergeApi.askOnce` (SBA γ-2). Результат — toast с возможным
 *     undo (action-toast). Параллельный γ-2 проект — не дублируем UX.
 *   - **AI помощник (Wave 2 B2)** — ввод начинается с `?` ИЛИ пользователь
 *     выбрал пункт «Спросить AI» в пустом списке → запрос идёт в
 *     `chatV2Api.ask({ scope:'org', mode:'synthetic' })`. Ответ
 *     показывается inline в палитре с цитатами и кнопкой «Открыть полный
 *     чат» (deep-link на `/chat-v2?conversationId=...`).
 *
 * Mobile (≤md): рендерится как bottom-sheet (Radix Sheet side="bottom"),
 * а не центрированный диалог. На md+ — обычный CommandDialog.
 */
export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();

  const { currentOrgId } = useAuth();
  const {
    isOpen,
    initialQuery,
    initialMode,
    close,
    open: openPalette,
    consumeInitial,
  } = useCommandPalette();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<ChatV2AskResponseApi | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [lastAskedQuestion, setLastAskedQuestion] = useState<string | null>(
    null,
  );
  const [isMobile, setIsMobile] = useState(false);
  // Recent / Pinned (Wave 2 finishing task 4).
  const [recent, setRecent] = useState<PaletteRecentItem[]>([]);
  const [pinned, setPinned] = useState<PaletteRecentItem[]>([]);
  // Голосовой ввод (Wave 2 finishing task 3) — MediaRecorder + voiceApi.transcribe.
  const [voiceState, setVoiceState] = useState<
    'idle' | 'recording' | 'transcribing'
  >('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const voiceStreamRef = useRef<MediaStream | null>(null);

  const trimmed = query.trim();
  const isCommandMode = trimmed.startsWith('>');
  const isAiMode = trimmed.startsWith('?');
  const isSearchMode = !isCommandMode && !isAiMode && trimmed.length > 0;
  const isIdle = trimmed.length === 0;

  // Mobile-detect (Tailwind `md` = 768px). Без сторонних хуков, чтобы не
  // тянуть зависимости — слушаем matchMedia.
  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = (): void => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Применяем initialQuery/initialMode из Provider'а при открытии.
  useEffect(() => {
    if (!isOpen) return;
    if (initialQuery !== null) {
      const prefix = initialMode === 'ai' ? '? ' : '';
      setQuery(prefix + initialQuery);
      consumeInitial();
    } else if (initialMode === 'ai' && trimmed.length === 0) {
      setQuery('? ');
      consumeInitial();
    }
  }, [isOpen, initialQuery, initialMode, consumeInitial, trimmed.length]);

  // Сбрасываем стейт при закрытии.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults(null);
      setAiAnswer(null);
      setAiError(null);
      setLastAskedQuestion(null);
    }
  }, [isOpen]);

  // Debounce-поиск (только в Search-режиме).
  useEffect(() => {
    if (!isSearchMode) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchApi
        .query(trimmed, [
          'cards',
          'meetings',
          'tasks',
          'roles',
          'departments',
          'persons',
          'documents',
          'role-profiles',
        ])
        .then((res) => {
          if (cancelled) return;
          setResults(res);
        })
        .catch(() => {
          if (cancelled) return;
          setResults({ cards: [], meetings: [], tasks: [] });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [trimmed, isSearchMode]);

  // Перезагружаем Recent / Pinned при каждом открытии палитры — другая
  // вкладка / другая сессия могла поменять localStorage.
  useEffect(() => {
    if (!isOpen) return;
    setRecent(loadRecent());
    setPinned(loadPinned());
  }, [isOpen]);

  // Cleanup для микрофона на размонтирование и закрытие палитры.
  useEffect(() => {
    if (!isOpen && voiceState !== 'idle') {
      // Аккуратно прерываем запись если палитра закрылась во время её ведения.
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // ignore
      }
      stopAllTracks(voiceStreamRef.current);
      voiceStreamRef.current = null;
      mediaRecorderRef.current = null;
      voiceChunksRef.current = [];
      setVoiceState('idle');
    }
  }, [isOpen, voiceState]);

  useEffect(() => {
    return () => {
      stopAllTracks(voiceStreamRef.current);
    };
  }, []);

  const startVoice = useCallback(async () => {
    if (!currentOrgId) {
      toast.error('Нет активной организации');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('Браузер не поддерживает запись микрофона');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      const mime = pickSupportedMimeType();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };
      recorder.start();
      setVoiceState('recording');
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Доступ к микрофону запрещён в настройках браузера'
          : err instanceof Error
            ? err.message
            : 'Не удалось включить микрофон';
      toast.error(message);
    }
  }, [currentOrgId]);

  const stopVoice = useCallback(async () => {
    if (!currentOrgId) return;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    setVoiceState('transcribing');
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    stopAllTracks(voiceStreamRef.current);
    voiceStreamRef.current = null;
    mediaRecorderRef.current = null;

    const blobMime = recorder.mimeType || 'audio/webm';
    const blob = new Blob(voiceChunksRef.current, { type: blobMime });
    voiceChunksRef.current = [];
    if (blob.size === 0) {
      setVoiceState('idle');
      toast.error('Пустая запись — попробуйте ещё раз');
      return;
    }
    try {
      const ext = blobMime.includes('ogg') ? 'ogg' : 'webm';
      const res = await voiceApi.transcribe({
        orgId: currentOrgId,
        audio: blob,
        filename: `voice.${ext}`,
      });
      const transcript = res.text.trim();
      setVoiceState('idle');
      if (!transcript) {
        toast.error('Не удалось распознать — попробуйте чуть громче');
        return;
      }
      // Дописываем к существующему запросу — пользователь мог начать печатать.
      setQuery((prev) => (prev ? `${prev} ${transcript}` : transcript));
    } catch (err) {
      setVoiceState('idle');
      const message =
        humanizeApiError(err, 'Не удалось распознать голос');
      toast.error(message);
    }
  }, [currentOrgId]);

  /** Записать факт использования команды в Recent (max 10, дедуп). */
  const trackRecent = useCallback(
    (item: Omit<PaletteRecentItem, 'lastUsedAt'>) => {
      pushRecent(item);
      setRecent(loadRecent());
    },
    [],
  );

  const handlePinToggle = useCallback(
    (item: Omit<PaletteRecentItem, 'lastUsedAt'>) => {
      const { pinned: nowPinned } = togglePinned(item);
      setPinned(loadPinned());
      toast.success(nowPinned ? 'Закреплено' : 'Откреплено');
    },
    [],
  );

  function go(href: string): void {
    close();
    router.push(href);
  }

  /** Запустить ранее сохранённую запись из Recent / Pinned. */
  function runRecentItem(item: PaletteRecentItem): void {
    trackRecent({
      id: item.id,
      label: item.label,
      subtitle: item.subtitle,
      action: item.action,
    });
    if (item.action.kind === 'navigate') {
      go(item.action.value);
    } else {
      setQuery(item.action.value);
    }
  }

  /** SBA γ-2 — Concierge tool calls (action-режим, `>` префикс). */
  async function runCommand(): Promise<void> {
    const text = trimmed.replace(/^>+\s*/, '');
    if (!text || commandBusy) return;
    setCommandBusy(true);
    try {
      const res = await conciergeApi.askOnce({
        userMessage: text,
        pageContext: { clientPath: pathname ?? undefined },
      });
      if (res.quotaExceeded) {
        toast.error(res.quotaExceeded === 'daily'
              ? 'Дневная квота Concierge исчерпана'
              : 'Месячная квота Concierge исчерпана');
      } else if (res.error) {
        toast.error(res.error.message);
      } else {
        if (res.text) {
          toast(res.text);
        }
        for (const tc of res.toolCalls) {
          if (tc.undoLogId) {
            const logId = tc.undoLogId;
            toast.success(`Готово: ${tc.toolName}`, { action: {
                label: 'Отменить',
                onClick: async () => {
                  try {
                    await conciergeApi.undo(logId);
                    toast.success('Отменено');
                  } catch {
                    toast.error('Не удалось отменить');
                  }
                },
              } });
          }
        }
      }
      close();
      setQuery('');
    } catch {
      toast.error('Concierge недоступен');
    } finally {
      setCommandBusy(false);
    }
  }

  /**
   * Wave 2 B2 — Q&A через chat-v2 (`?` префикс или кнопка «Спросить AI»).
   * Ответ остаётся внутри палитры — не закрываем и не делаем toast.
   */
  async function runAiAsk(rawQuestion?: string): Promise<void> {
    const text = (rawQuestion ?? trimmed.replace(/^\?+\s*/, '')).trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiAnswer(null);
    setLastAskedQuestion(text);
    try {
      const res = await chatV2Api.ask({
        question: text,
        scope: 'org',
        mode: 'synthetic',
      });
      setAiAnswer(res);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Не удалось получить ответ от Коры';
      setAiError(message);
    } finally {
      setAiBusy(false);
    }
  }

  const cards = results?.cards ?? [];
  const meetings = results?.meetings ?? [];
  const tasks = results?.tasks ?? [];
  const roles = results?.roles ?? [];
  const departments = results?.departments ?? [];
  const persons = results?.persons ?? [];
  const documents = results?.documents ?? [];
  const roleProfiles = results?.roleProfiles ?? [];
  const empty =
    !loading &&
    isSearchMode &&
    results !== null &&
    cards.length === 0 &&
    meetings.length === 0 &&
    tasks.length === 0 &&
    roles.length === 0 &&
    departments.length === 0 &&
    persons.length === 0 &&
    documents.length === 0 &&
    roleProfiles.length === 0;

  const quickNav = useMemo(() => QUICK_NAV_ITEMS, []);

  const onOpenChange = (next: boolean): void => {
    if (next) {
      openPalette();
    } else {
      close();
    }
  };

  const body = (
    <CommandPrimitive
      // Отключаем встроенную cmdk-фильтрацию: у нас собственный search.api
      // и список целиком формируется снаружи.
      shouldFilter={false}
      className="flex h-full w-full flex-col overflow-hidden rounded-md bg-bg-card text-fg-primary [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-tertiary [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
    >
      <div className="relative">
        <CommandInput
          placeholder="Поиск, ? — спросить Кору, > — действие Concierge"
          value={query}
          onValueChange={setQuery}
        />
        {/* Голосовой ввод — Wave 2 finishing task 3. Иконка справа в инпуте;
            не блокирует клавиатурный ввод. */}
        <button
          type="button"
          onClick={() =>
            voiceState === 'recording' ? void stopVoice() : void startVoice()
          }
          disabled={voiceState === 'transcribing' || !currentOrgId}
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-tertiary transition-colors hover:bg-bg-overlay hover:text-fg-primary disabled:opacity-50',
            voiceState === 'recording' && 'bg-danger/15 text-danger hover:bg-danger/20',
          )}
          aria-label={
            voiceState === 'recording'
              ? 'Остановить запись'
              : voiceState === 'transcribing'
                ? 'Распознаю…'
                : 'Голосовой ввод'
          }
          title={
            voiceState === 'recording'
              ? 'Остановить запись'
              : voiceState === 'transcribing'
                ? 'Распознаю…'
                : 'Голосовой ввод'
          }
        >
          {voiceState === 'transcribing' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : voiceState === 'recording' ? (
            <Square size={14} />
          ) : (
            <Mic size={14} />
          )}
        </button>
      </div>
      <CommandList className="max-h-[60vh] md:max-h-[420px]">
        {/* idle: «Закреплено» (если есть) → «Недавнее» (если есть) →
            «Перейти к» + подсказки. Wave 2 finishing task 4. */}
        {isIdle && (
          <>
            {pinned.length > 0 && (
              <CommandGroup heading="Закреплено">
                {pinned.map((item) => (
                  <CommandItem
                    key={`pinned-${item.id}`}
                    value={`pinned-${item.id}-${item.label}`}
                    onSelect={() => runRecentItem(item)}
                  >
                    <ResultRow
                      icon={Pin}
                      title={item.label}
                      subtitle={item.subtitle ?? 'Закреплённая команда'}
                      rightSlot={
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePinToggle(item);
                          }}
                          className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay hover:text-fg-primary"
                          aria-label="Открепить"
                          title="Открепить"
                        >
                          <PinOff size={12} />
                        </button>
                      }
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {recent.length > 0 && (
              <CommandGroup heading="Недавнее">
                {recent.slice(0, 5).map((item) => {
                  const isItemPinned = pinned.some((p) => p.id === item.id);
                  return (
                    <CommandItem
                      key={`recent-${item.id}`}
                      value={`recent-${item.id}-${item.label}`}
                      onSelect={() => runRecentItem(item)}
                    >
                      <ResultRow
                        icon={Clock}
                        title={item.label}
                        subtitle={item.subtitle ?? 'Использовано недавно'}
                        rightSlot={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePinToggle(item);
                            }}
                            className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay hover:text-fg-primary"
                            aria-label={
                              isItemPinned ? 'Открепить' : 'Закрепить'
                            }
                            title={isItemPinned ? 'Открепить' : 'Закрепить'}
                          >
                            {isItemPinned ? (
                              <PinOff size={12} />
                            ) : (
                              <Pin size={12} />
                            )}
                          </button>
                        }
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            <CommandGroup heading="Перейти к">
              {quickNav.map((nav) => (
                <CommandItem
                  key={`nav-${nav.href}`}
                  value={`nav-${nav.href}-${nav.label}`}
                  onSelect={() => {
                    trackRecent({
                      id: `nav:${nav.href}`,
                      label: nav.label,
                      subtitle: nav.subtitle,
                      action: { kind: 'navigate', value: nav.href },
                    });
                    go(nav.href);
                  }}
                >
                  <ResultRow
                    icon={nav.icon}
                    title={nav.label}
                    subtitle={nav.subtitle}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Помощник">
              <CommandItem
                value="ai-open-prompt"
                onSelect={() => {
                  trackRecent({
                    id: 'mode:ai',
                    label: 'Спросить Кору…',
                    subtitle: 'Q&A по памяти компании',
                    action: { kind: 'set-query', value: '? ' },
                  });
                  setQuery('? ');
                }}
              >
                <ResultRow
                  icon={Sparkles}
                  title="Спросить Кору…"
                  subtitle="? — задать вопрос ассистенту по второму мозгу"
                />
              </CommandItem>
              <CommandItem
                value="concierge-open-prompt"
                onSelect={() => {
                  trackRecent({
                    id: 'mode:concierge',
                    label: 'Дать команду Concierge…',
                    subtitle: 'Действие',
                    action: { kind: 'set-query', value: '> ' },
                  });
                  setQuery('> ');
                }}
              >
                <ResultRow
                  icon={MessageCircle}
                  title="Дать команду Concierge…"
                  subtitle="> — действие (создать задачу, перенести встречу и т.п.)"
                />
              </CommandItem>
            </CommandGroup>
            <div className="px-4 py-3 text-center text-xs text-fg-tertiary">
              Подсказка:{' '}
              <kbd className="rounded border border-border-subtle bg-bg-overlay px-1">
                ⌘K
              </kbd>{' '}
              /{' '}
              <kbd className="rounded border border-border-subtle bg-bg-overlay px-1">
                Ctrl+K
              </kbd>{' '}
              открывает палитру в любой момент.
            </div>
          </>
        )}

        {/* AI режим */}
        {isAiMode && (
          <CommandGroup heading="Помощник компании">
            <CommandItem
              value="ai-ask-execute"
              onSelect={() => void runAiAsk()}
              disabled={aiBusy}
            >
              <ResultRow
                icon={aiBusy ? Loader2 : Sparkles}
                iconClassName={aiBusy ? 'animate-spin' : undefined}
                title={
                  aiBusy
                    ? 'Кора ищет ответ…'
                    : `Спросить Кору: «${trimmed.replace(/^\?+\s*/, '')}»`
                }
                subtitle="Enter — отправить (chat-v2 · org · synthetic)"
              />
            </CommandItem>
          </CommandGroup>
        )}

        {/* Command (Concierge) режим */}
        {isCommandMode && (
          <CommandGroup heading="Concierge — действие">
            <CommandItem
              value="concierge-execute"
              onSelect={() => void runCommand()}
              disabled={commandBusy}
            >
              <ResultRow
                icon={commandBusy ? Loader2 : MessageCircle}
                iconClassName={commandBusy ? 'animate-spin' : undefined}
                title={
                  commandBusy
                    ? 'Concierge выполняет…'
                    : `Спросить Concierge: «${trimmed.replace(/^>+\s*/, '')}»`
                }
                subtitle="Enter — отправить"
              />
            </CommandItem>
          </CommandGroup>
        )}

        {/* AI ответ inline */}
        {(aiAnswer || aiError) && (
          <CommandGroup heading="Ответ Коры">
            <div className="px-3 py-3">
              {lastAskedQuestion && (
                <div className="mb-2 text-xs text-fg-tertiary">
                  Вопрос: «{lastAskedQuestion}»
                </div>
              )}
              {aiError && (
                <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                  <div className="mb-2">{aiError}</div>
                  <button
                    type="button"
                    onClick={() => void runAiAsk(lastAskedQuestion ?? undefined)}
                    className="rounded border border-danger/40 px-2 py-1 text-xs hover:bg-danger/20"
                  >
                    Повторить
                  </button>
                </div>
              )}
              {aiAnswer && (
                <div className="space-y-2">
                  <div className="whitespace-pre-wrap text-sm text-fg-primary">
                    {aiAnswer.text}
                  </div>
                  {aiAnswer.uncertaintyNote && (
                    <div className="text-xs text-fg-tertiary">
                      {aiAnswer.uncertaintyNote}
                    </div>
                  )}
                  {aiAnswer.citations.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-fg-tertiary">
                        Источники:
                      </div>
                      <ul className="space-y-1">
                        {aiAnswer.citations.slice(0, 5).map((c, idx) => (
                          <li
                            key={`${c.meetingId}-${idx}`}
                            className="rounded border border-border-subtle bg-bg-overlay/40 px-2 py-1 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                go(
                                  `/meetings/${encodeURIComponent(
                                    c.meetingId,
                                  )}/result`,
                                )
                              }
                              className="block w-full text-left hover:text-fg-primary"
                            >
                              <div className="truncate font-medium text-fg-secondary">
                                {c.meetingTitle}
                              </div>
                              <div className="truncate text-fg-tertiary">
                                {c.snippet}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    {aiAnswer.cacheHit && (
                      <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">
                        из кэша
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        go(
                          `/chat-v2?conversationId=${encodeURIComponent(
                            aiAnswer.conversationId,
                          )}`,
                        )
                      }
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-xs text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary"
                    >
                      Открыть полный чат
                      <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </CommandGroup>
        )}

        {loading && isSearchMode && (
          <div className="px-4 py-3 text-xs text-fg-tertiary">Поиск…</div>
        )}
        {empty && <CommandEmpty>Ничего не найдено</CommandEmpty>}

        {/* Search-результаты — рендерятся только в search-режиме */}
        {isSearchMode && (
          <>
            {/* Подсказка: «Спросить AI про <query>» — параллельно поиску */}
            <CommandGroup heading="Помощник">
              <CommandItem
                value={`ai-ask-fallback-${trimmed}`}
                onSelect={() => void runAiAsk(trimmed)}
                disabled={aiBusy}
              >
                <ResultRow
                  icon={aiBusy ? Loader2 : Sparkles}
                  iconClassName={aiBusy ? 'animate-spin' : undefined}
                  title={`Спросить Кору: «${trimmed}»`}
                  subtitle="Ответ из второго мозга компании"
                />
              </CommandItem>
            </CommandGroup>
            {cards.length > 0 && (
              <CommandGroup heading="Карточки">
                {cards.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`card-${c.id}-${c.name}`}
                    onSelect={() => go(`/cards/${encodeURIComponent(c.id)}`)}
                  >
                    <ResultRow
                      icon={FolderKanban}
                      title={c.name}
                      subtitle={`${c.kind} · ${c.meetingCount} встреч`}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {meetings.length > 0 && (
              <CommandGroup heading="Встречи">
                {meetings.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`meeting-${m.id}-${m.title}`}
                    onSelect={() =>
                      go(`/meetings/${encodeURIComponent(m.id)}/result`)
                    }
                  >
                    <ResultRow
                      icon={Calendar}
                      title={m.title}
                      subtitle={`${m.type} · ${formatDate(m.createdAt)}`}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {tasks.length > 0 && (
              <CommandGroup heading="Задачи">
                {tasks.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`task-${t.id}-${t.title}`}
                    onSelect={() =>
                      go(`/meetings/${encodeURIComponent(t.meetingId)}/result`)
                    }
                  >
                    <ResultRow
                      icon={ListChecks}
                      title={t.title}
                      subtitle={`${t.status}`}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {roles.length > 0 && (
              <CommandGroup heading="Должности">
                {roles.map((r) => (
                  <CommandItem
                    key={`role-${r.id}`}
                    value={`role-${r.id}-${r.name}`}
                    onSelect={() => go(`/roles/${encodeURIComponent(r.id)}`)}
                  >
                    <ResultRow
                      icon={IdCard}
                      title={r.name}
                      subtitle={r.departmentName ?? 'Без отдела'}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {departments.length > 0 && (
              <CommandGroup heading="Отделы">
                {departments.map((d) => (
                  <CommandItem
                    key={`dept-${d.id}`}
                    value={`dept-${d.id}-${d.name}`}
                    onSelect={() => go('/structure?tab=departments')}
                  >
                    <ResultRow icon={Building2} title={d.name} subtitle="Отдел" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {persons.length > 0 && (
              <CommandGroup heading="Сотрудники">
                {persons.map((p) => (
                  <CommandItem
                    key={`person-${p.id}`}
                    value={`person-${p.id}-${p.fullName}`}
                    onSelect={() => go('/structure?tab=persons')}
                  >
                    <ResultRow
                      icon={UserRound}
                      title={p.fullName}
                      subtitle={p.roleName ?? 'Без должности'}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {documents.length > 0 && (
              <CommandGroup heading="Документы">
                {documents.map((d) => (
                  <CommandItem
                    key={`doc-${d.id}`}
                    value={`doc-${d.id}-${d.name}`}
                    onSelect={() => go(`/documents/${encodeURIComponent(d.id)}`)}
                  >
                    <ResultRow
                      icon={FileText}
                      title={d.name}
                      subtitle={d.kind ?? 'документ'}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {roleProfiles.length > 0 && (
              <CommandGroup heading="Карты должностей">
                {roleProfiles.map((rp) => (
                  <CommandItem
                    key={`rp-${rp.roleId}`}
                    value={`rp-${rp.roleId}-${rp.roleName}`}
                    onSelect={() => go(`/roles/${encodeURIComponent(rp.roleId)}`)}
                  >
                    <ResultRow
                      icon={Sparkles}
                      title={rp.roleName}
                      subtitle="карта должности"
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandPrimitive>
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn(
            // Сбрасываем дефолтный padding (Sheet — `p-6`), чтобы Command
            // занимал всю ширину. Высота — до 85vh, чтобы оставить hint
            // на закрытие свайпом/тапом по overlay.
            'h-[85vh] max-h-[85vh] rounded-t-xl border-t border-border-subtle p-0',
          )}
        >
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-modal sm:max-w-2xl">
        {body}
      </DialogContent>
    </Dialog>
  );
}

type QuickNavItem = {
  href: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
};

const QUICK_NAV_ITEMS: QuickNavItem[] = [
  {
    href: '/dashboard',
    label: 'Главная',
    subtitle: 'Дашборд компании',
    icon: Home,
  },
  {
    href: '/me',
    label: 'Мой день',
    subtitle: 'Личный инбокс и задачи',
    icon: Inbox,
  },
  {
    href: '/projects',
    label: 'Проекты',
    subtitle: 'Все проекты трекера',
    icon: FolderKanban,
  },
  {
    href: '/memory',
    label: 'Память',
    subtitle: 'Спросить, Лента Коры и реестры',
    icon: Network,
  },
  {
    href: '/meetings',
    label: 'Встречи',
    subtitle: 'Календарь и история встреч',
    icon: Calendar,
  },
  {
    href: '/dump',
    label: 'Дамп',
    subtitle: 'Быстрая запись мысли',
    icon: Brain,
  },
  {
    href: '/chat-v2',
    label: 'Помощник компании',
    subtitle: 'Полноценный диалог с памятью компании',
    icon: Sparkles,
  },
  {
    href: '/settings',
    label: 'Настройки',
    subtitle: 'Профиль, интеграции, тариф',
    icon: Settings,
  },
];

function ResultRow({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  rightSlot,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  subtitle: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-2.5">
      <Icon size={14} className={cn('text-fg-tertiary', iconClassName)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{title}</span>
        <span className="truncate text-xs text-fg-tertiary">{subtitle}</span>
      </div>
      {rightSlot ? (
        <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─────────────────────── voice helpers (Wave 2 finishing) ────────────────

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
