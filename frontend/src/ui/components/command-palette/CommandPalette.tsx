'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Brain,
  Building2,
  Calendar,
  ExternalLink,
  FileText,
  FolderKanban,
  Home,
  IdCard,
  Inbox,
  ListChecks,
  Loader2,
  MessageCircle,
  Network,
  Settings,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import { searchApi, type SearchResponse } from '@/api/search.api';
import { conciergeApi } from '@/api/concierge.api';
import { chatV2Api, type ChatV2AskResponseApi } from '@/api/chat-v2.api';
import { ApiError } from '@/api/api-error';
import { useToast } from '@/contexts/toast-context';
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
  const { addToast } = useToast();
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

  function go(href: string): void {
    close();
    router.push(href);
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
        addToast({
          type: 'error',
          message:
            res.quotaExceeded === 'daily'
              ? 'Дневная квота Concierge исчерпана'
              : 'Месячная квота Concierge исчерпана',
        });
      } else if (res.error) {
        addToast({ type: 'error', message: res.error.message });
      } else {
        if (res.text) {
          addToast({ type: 'info', message: res.text });
        }
        for (const tc of res.toolCalls) {
          if (tc.undoLogId) {
            const logId = tc.undoLogId;
            addToast({
              type: 'success',
              message: `Готово: ${tc.toolName}`,
              action: {
                label: 'Отменить',
                onClick: async () => {
                  try {
                    await conciergeApi.undo(logId);
                    addToast({ type: 'success', message: 'Отменено' });
                  } catch {
                    addToast({ type: 'error', message: 'Не удалось отменить' });
                  }
                },
              },
            });
          }
        }
      }
      close();
      setQuery('');
    } catch {
      addToast({ type: 'error', message: 'Concierge недоступен' });
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
          : 'Не удалось получить ответ от AI';
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
      <CommandInput
        placeholder="Поиск, ? — спросить AI, > — действие Concierge"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[60vh] md:max-h-[420px]">
        {/* idle: «Перейти к» + подсказки */}
        {isIdle && (
          <>
            <CommandGroup heading="Перейти к">
              {quickNav.map((nav) => (
                <CommandItem
                  key={`nav-${nav.href}`}
                  value={`nav-${nav.href}-${nav.label}`}
                  onSelect={() => go(nav.href)}
                >
                  <ResultRow
                    icon={nav.icon}
                    title={nav.label}
                    subtitle={nav.subtitle}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="AI помощник">
              <CommandItem
                value="ai-open-prompt"
                onSelect={() => setQuery('? ')}
              >
                <ResultRow
                  icon={Sparkles}
                  title="Спросить AI компании…"
                  subtitle="? — задать вопрос ассистенту по второму мозгу"
                />
              </CommandItem>
              <CommandItem
                value="concierge-open-prompt"
                onSelect={() => setQuery('> ')}
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
          <CommandGroup heading="AI помощник компании">
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
                    ? 'AI ищет ответ…'
                    : `Спросить AI: «${trimmed.replace(/^\?+\s*/, '')}»`
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
          <CommandGroup heading="Ответ AI">
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
            <CommandGroup heading="AI помощник">
              <CommandItem
                value={`ai-ask-fallback-${trimmed}`}
                onSelect={() => void runAiAsk(trimmed)}
                disabled={aiBusy}
              >
                <ResultRow
                  icon={aiBusy ? Loader2 : Sparkles}
                  iconClassName={aiBusy ? 'animate-spin' : undefined}
                  title={`Спросить AI: «${trimmed}»`}
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
    href: '/feed',
    label: 'Лента',
    subtitle: 'События и сигналы',
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
    label: 'AI-чат компании',
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
}: {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} className={cn('text-fg-tertiary', iconClassName)} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{title}</span>
        <span className="truncate text-xs text-fg-tertiary">{subtitle}</span>
      </div>
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
