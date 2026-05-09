'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  FolderKanban,
  ListChecks,
  Search,
  type LucideIcon,
} from 'lucide-react';

import { searchApi, type SearchResponse } from '@/api/search.api';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/shadcn/command';

/**
 * Глобальная командная палитра. Хоткей: ⌘K (mac) / Ctrl+K (win/linux).
 *
 * Ищет по карточкам, встречам и задачам через `GET /api/v1/search`.
 * Группирует результаты по типу. Enter переходит в нужный объект.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Hotkey: ⌘K (mac) / Ctrl+K (others).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = e.key === 'k' && (e.metaKey || e.ctrlKey);
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Сбрасываем стейт при закрытии.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(null);
    }
  }, [open]);

  // Debounce-поиск.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchApi
        .query(trimmed)
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
  }, [query]);

  function go(href: string): void {
    setOpen(false);
    router.push(href);
  }

  const cards = results?.cards ?? [];
  const meetings = results?.meetings ?? [];
  const tasks = results?.tasks ?? [];
  const empty =
    !loading && results !== null && cards.length === 0 && meetings.length === 0 && tasks.length === 0;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Поиск карточек, встреч и задач…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {!query && (
          <div className="px-4 py-6 text-center text-xs text-fg-tertiary">
            Начните вводить название карточки, встречи или задачи.
            <br />
            Подсказка: <kbd className="rounded border border-border-subtle bg-bg-overlay px-1">⌘K</kbd>
            {' / '}
            <kbd className="rounded border border-border-subtle bg-bg-overlay px-1">Ctrl+K</kbd>{' '}
            открывает поиск.
          </div>
        )}
        {loading && query && (
          <div className="px-4 py-3 text-xs text-fg-tertiary">Поиск…</div>
        )}
        {empty && <CommandEmpty>Ничего не найдено</CommandEmpty>}
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
                onSelect={() => go(`/meetings/${encodeURIComponent(m.id)}/result`)}
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
      </CommandList>
    </CommandDialog>
  );
}

function ResultRow({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={14} className="text-fg-tertiary" />
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
