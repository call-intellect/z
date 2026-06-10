'use client';

/**
 * Production-версия журнала встреч (master-detail).
 * Слева — список с фильтрами, поиском, группировкой по датам и
 * массовыми действиями. Справа — детальная карточка выбранной встречи.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUpRight,
  Calendar,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Filter,
  ListChecks,
  LogIn,
  MoreVertical,
  Plus,
  Search,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  Upload,
  UserPlus,
  Users,
  UserSquare2,
  X,
} from 'lucide-react';

import { meetingsApi } from '@/api/meetings.api';
import { tagsApi } from '@/api/tags.api';
import { exportsApi } from '@/api/exports.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  meetingSummaryFromApi,
  meetingDurationSeconds,
  isJoinableStatus,
  MEETING_TYPE_LABEL_RU,
} from '@/domain/meeting';
import { pickPrimarySummary } from '@/domain/ai-result';
import { tagFromApi, type TagDomain } from '@/domain/tag';
import { pickPrimaryTasks } from '@/domain/task';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useMeetingTasks } from '@/hooks/use-meeting-tasks';
import {
  MEETING_STATUSES,
  MEETING_TYPES,
  type MeetingStatus,
  type MeetingType,
} from '@/domain/enums';

import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Input } from '@/ui/shadcn/input';
import { Separator } from '@/ui/shadcn/separator';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/shadcn/popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { toast } from '@/ui/shadcn/toast';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { cn } from '@/ui/shadcn/lib/utils';
import { InviteDialog } from '@/ui/shared/InviteDialog';
import { copyToClipboard } from '@/lib/copy-to-clipboard';

import { fmtDurationCompact } from '@/ui/components/meeting-result-v2/format-utils';

const STATUS_LABEL: Partial<Record<MeetingStatus, string>> = {
  scheduled: 'Запланирована',
  active: 'Идёт',
  completed: 'Завершена',
  recording_processing: 'Обработка записи',
  recording_ready: 'Запись готова',
  transcription_processing: 'Транскрипция',
  transcription_ready: 'Транскрипция готова',
  ai_processing: 'Готовим отчёт',
  ai_ready: 'Готово',
  failed: 'Ошибка',
  // Запись в порядке, упала только AI-ветка (транскрибация/отчёт).
  ai_failed: 'Отчёт не готов',
  // Загруженная запись распознана — ждём подписи говорящих (ТЗ-5 Ф5).
  awaiting_speakers: 'Подпишите говорящих',
};

type Group = 'today' | 'week' | 'earlier';
const GROUP_LABEL: Record<Group, string> = {
  today: 'Сегодня',
  week: 'На неделе',
  earlier: 'Ранее',
};

function classifyGroup(d: Date): Group {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) return 'today';
  const weekAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
  if (d >= weekAgo) return 'week';
  return 'earlier';
}

function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

async function copyMeetingLink(meetingId: string): Promise<void> {
  const url = `${window.location.origin}/m/${meetingId}`;
  const ok = await copyToClipboard(url);
  if (ok) toast.success('Ссылка скопирована');
  else toast.error('Не удалось скопировать ссылку');
}

export function MeetingsJournalReal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('selected');
  const isMobile = useIsMobile();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [typeFilters, setTypeFilters] = useState<MeetingType[]>([]);
  const [statusFilters, setStatusFilters] = useState<MeetingStatus[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const { data: tagsData } = useSWR('tags-list', () => tagsApi.list(), {
    revalidateOnFocus: false,
  });
  const allTags: TagDomain[] = useMemo(
    () => (tagsData?.items ? tagsData.items.map(tagFromApi) : []),
    [tagsData],
  );

  const queryKey = useMemo(
    () => [
      'meetings-list-v2',
      debouncedSearch,
      typeFilters.join(','),
      statusFilters.join(','),
      tagFilters.join(','),
      dateFrom,
      dateTo,
    ],
    [debouncedSearch, typeFilters, statusFilters, tagFilters, dateFrom, dateTo],
  );

  const { data, isLoading, mutate } = useSWR(
    queryKey,
    () =>
      meetingsApi.list({
        page: 1,
        limit: 50,
        ...(debouncedSearch ? { query: debouncedSearch } : {}),
        ...(typeFilters.length ? { type: typeFilters } : {}),
        ...(statusFilters.length ? { status: statusFilters } : {}),
        ...(tagFilters.length ? { tagIds: tagFilters } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      }),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const items = useMemo(
    () => (data?.items ? data.items.map(meetingSummaryFromApi) : []),
    [data],
  );

  const grouped = useMemo(() => {
    const out: Record<Group, typeof items> = { today: [], week: [], earlier: [] };
    for (const m of items) {
      const ref = m.startedAt ?? m.createdAt;
      out[classifyGroup(ref)].push(m);
    }
    return out;
  }, [items]);

  const onSelect = (id: string) => {
    if (isMobile) {
      // На мобильном detail-панель не помещается рядом со списком — открываем
      // полноценную страницу результата встречи. Кнопка «Назад» возвращает к
      // списку.
      router.push(`/meetings/${encodeURIComponent(id)}/result`);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set('selected', id);
    router.replace(`/meetings?${params.toString()}`);
  };

  const toggleType = (t: MeetingType) =>
    setTypeFilters((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  const toggleStatus = (s: MeetingStatus) =>
    setStatusFilters((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  const toggleTag = (id: string) =>
    setTagFilters((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const allCheckedOnPage = items.length > 0 && items.every((m) => checked.has(m.id));
  const toggleAll = () => {
    if (allCheckedOnPage) {
      setChecked(new Set());
    } else {
      setChecked(new Set(items.map((m) => m.id)));
    }
  };

  const onBulkDelete = async () => {
    if (checked.size === 0) return;
    const ok = await ask({
      title: `Удалить ${checked.size} встреч?`,
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    const ids = [...checked];
    try {
      await Promise.all(ids.map((id) => meetingsApi.softDelete(id)));
      toast.success(`Удалено ${ids.length}`);
      setChecked(new Set());
      void mutate();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка удаления');
      toast.error(msg);
    }
  };

  const onDeleteOne = async (id: string) => {
    const ok = await ask({
      title: 'Удалить встречу?',
      description:
        'Встреча и её запись исчезнут из списка. Восстановить её самостоятельно нельзя.',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await meetingsApi.softDelete(id);
      toast.success('Встреча удалена');
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      // Если удалили встречу, открытую в detail-панели — сбрасываем выбор.
      if (selectedId === id) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('selected');
        const qs = params.toString();
        router.replace(`/meetings${qs ? `?${qs}` : ''}`);
      }
      void mutate();
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка удаления');
      toast.error(msg);
    }
  };

  const onBulkSetTags = async (tagIds: string[]) => {
    if (checked.size === 0) return;
    const ids = [...checked];
    try {
      await Promise.all(
        ids.map((id) => tagsApi.setForMeeting(id, { tagIds })),
      );
      toast.success(`Теги обновлены у ${ids.length}`);
      setChecked(new Set());
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка');
      toast.error(msg);
    }
  };

  const onBulkExport = async (opts: {
    includeTranscript: boolean;
    includeAudio: boolean;
    includeVideo: boolean;
  }) => {
    if (checked.size === 0) return;
    try {
      await exportsApi.bulk({
        meetingIds: [...checked],
        ...opts,
      });
      toast.success('Экспорт запущен. Готовый ZIP появится в /settings/exports.');
      setChecked(new Set());
    } catch (e) {
      const msg = humanizeApiError(e, 'Ошибка экспорта');
      toast.error(msg);
    }
  };

  return (
    <div className="grid h-[calc(100vh-var(--header-h,0px))] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* Master / list */}
      <div className="flex h-full min-h-0 flex-col border-r border-border-subtle bg-bg-elevated">
        <div className="flex flex-col gap-3 px-5 pb-4 pt-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">Мои встречи</h1>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{data?.total ?? items.length}</Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <Plus size={13} />
                    Новая
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onSelect={() => router.push('/meetings/create')}
                  >
                    <Plus size={14} />
                    Создать встречу
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => router.push('/meetings/upload')}
                  >
                    <Upload size={14} />
                    Загрузить запись
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="relative">
            <Search
              size={14}
              strokeWidth={1.75}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию или транскрипту..."
              className="pl-8"
            />
          </div>

          <FilterChips
            typeFilters={typeFilters}
            statusFilters={statusFilters}
            tagFilters={tagFilters}
            allTags={allTags}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onToggleType={toggleType}
            onToggleStatus={toggleStatus}
            onToggleTag={toggleTag}
            onClearTypes={() => setTypeFilters([])}
            onClearStatuses={() => setStatusFilters([])}
            onClearTags={() => setTagFilters([])}
            setDateFrom={setDateFrom}
            setDateTo={setDateTo}
          />

          <div className="flex items-center gap-2 text-xs text-fg-tertiary">
            <Checkbox
              id="select-all"
              checked={allCheckedOnPage}
              onCheckedChange={() => toggleAll()}
            />
            <label htmlFor="select-all" className="cursor-pointer">
              Выбрать все на странице
            </label>
            {checked.size > 0 && (
              <BulkActionsToolbar
                count={checked.size}
                allTags={allTags}
                onDelete={() => void onBulkDelete()}
                onSetTags={(ids) => void onBulkSetTags(ids)}
                onExport={(opts) => void onBulkExport(opts)}
              />
            )}
          </div>
        </div>

        <Separator />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div className="text-sm font-medium text-fg-primary">
                Встреч пока нет
              </div>
              <div className="mt-1 max-w-xs text-xs text-fg-secondary">
                Создайте первую встречу, чтобы появилась запись и отчёт.
              </div>
              <Button asChild className="mt-4" size="sm">
                <Link href="/meetings/create">Создать встречу</Link>
              </Button>
            </div>
          ) : (
            (['today', 'week', 'earlier'] as Group[]).map((group) => {
              const groupItems = grouped[group];
              if (groupItems.length === 0) return null;
              return (
                <div key={group} className="pb-3">
                  <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg-elevated/80 px-5 py-2 backdrop-blur-glass">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-tertiary">
                      {GROUP_LABEL[group]}
                    </div>
                  </div>
                  <ul className="px-2 pt-2">
                    {groupItems.map((m) => (
                      <li key={m.id}>
                        <MeetingRowCard
                          item={m}
                          active={m.id === selectedId}
                          checked={checked.has(m.id)}
                          onToggleCheck={() => {
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else next.add(m.id);
                              return next;
                            });
                          }}
                          onClick={() => onSelect(m.id)}
                          onDelete={() => void onDeleteOne(m.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Detail — на mobile скрыт, выбор открывает /meetings/[id]/result */}
      <div className="hidden h-full min-h-0 flex-col overflow-hidden bg-bg-base lg:flex">
        <AnimatePresence mode="wait">
          {selectedId ? (
            <motion.div
              key={selectedId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <MeetingDetailPane meetingId={selectedId} />
            </motion.div>
          ) : (
            <DetailEmpty />
          )}
        </AnimatePresence>
      </div>
      {confirmDialog}
    </div>
  );
}

// ─────────────── List row ───────────────

function MeetingRowCard({
  item,
  active,
  checked,
  onToggleCheck,
  onClick,
  onDelete,
}: {
  item: ReturnType<typeof meetingSummaryFromApi>;
  active: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onClick: () => void;
  onDelete: () => void;
}) {
  const durSec = meetingDurationSeconds(item);
  const durMs = durSec ? durSec * 1000 : null;
  const date = item.startedAt ?? item.createdAt;
  const typeLabel = MEETING_TYPE_LABEL_RU[item.type] ?? item.type;
  const joinable = isJoinableStatus(item.status);
  const isProcessing =
    item.status === 'recording_processing' ||
    item.status === 'transcription_processing' ||
    item.status === 'ai_processing';
  const isFailed = item.status === 'failed';
  // Запись есть, но AI-отчёт не сформирован — мягкий «warning», не «danger».
  const isAiFailed = item.status === 'ai_failed';
  // Загруженная запись распознана — ждём подписи говорящих (ТЗ-5 Ф5).
  const isAwaitingSpeakers = item.status === 'awaiting_speakers';

  return (
    <div
      className={cn(
        'group relative flex w-full flex-col gap-1.5 rounded-md px-3 py-3 text-left transition-colors',
        active ? 'bg-bg-overlay' : 'hover:bg-bg-overlay/60',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent shadow-glow-mint"
        />
      )}
      <div className="flex items-start gap-2">
        <Checkbox
          checked={checked}
          onCheckedChange={() => onToggleCheck()}
          onClick={(e) => e.stopPropagation()}
          aria-label="Выбрать встречу"
          className="mt-0.5"
        />
        <button
          type="button"
          onClick={onClick}
          className="min-w-0 flex-1 text-left"
        >
          <div className="line-clamp-2 text-sm font-medium leading-snug text-fg-primary">
            {item.title}
          </div>
        </button>
        {isProcessing && (
          <span
            aria-label="Обрабатывается"
            className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning"
          />
        )}
        {isFailed && (
          <span
            aria-label="Ошибка"
            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
          />
        )}
        {isAiFailed && (
          <span
            aria-label="Отчёт не готов"
            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
          />
        )}
        {isAwaitingSpeakers && (
          <span
            aria-label="Нужно подписать говорящих"
            className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning"
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              aria-label="Действия со встречей"
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-fg-tertiary opacity-100 transition-colors hover:bg-bg-overlay hover:text-fg-primary focus-visible:opacity-100 data-[state=open]:bg-bg-overlay data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <MoreVertical size={14} strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onSelect={() => void copyMeetingLink(item.id)}>
              <Copy size={14} />
              Скопировать ссылку
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDelete()}
              className="text-danger focus:text-danger"
            >
              <Trash2 size={14} />
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-6 text-xs text-fg-tertiary">
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {typeLabel}
        </Badge>
        {item.status === 'active' && (
          <Badge className="bg-chip-info-bg px-1.5 py-0 text-[10px] text-chip-info-fg">
            Идёт
          </Badge>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock size={10} strokeWidth={1.75} />
          <span className="font-mono">{fmtDurationCompact(durMs)}</span>
        </span>
        <span>{date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
      </div>
      {joinable && (
        <div className="flex flex-wrap items-center gap-2 pl-6 pt-1">
          <Button
            asChild
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <Link href={`/m/${item.id}`}>
              <LogIn size={12} /> Войти
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              void copyMeetingLink(item.id);
            }}
          >
            <Copy size={12} /> Скопировать ссылку
          </Button>
        </div>
      )}
      {isAwaitingSpeakers && (
        <div className="flex flex-wrap items-center gap-2 pl-6 pt-1">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-7 gap-1 border-chip-warning-fg/40 px-2 text-xs text-chip-warning-fg"
            onClick={(e) => e.stopPropagation()}
          >
            <Link href={`/meetings/${item.id}/speakers`}>
              <UserSquare2 size={12} /> Подписать говорящих →
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────── Filter chips ───────────────

function FilterChips({
  typeFilters,
  statusFilters,
  tagFilters,
  allTags,
  dateFrom,
  dateTo,
  onToggleType,
  onToggleStatus,
  onToggleTag,
  onClearTypes,
  onClearStatuses,
  onClearTags,
  setDateFrom,
  setDateTo,
}: {
  typeFilters: MeetingType[];
  statusFilters: MeetingStatus[];
  tagFilters: string[];
  allTags: TagDomain[];
  dateFrom: string;
  dateTo: string;
  onToggleType: (t: MeetingType) => void;
  onToggleStatus: (s: MeetingStatus) => void;
  onToggleTag: (id: string) => void;
  onClearTypes: () => void;
  onClearStatuses: () => void;
  onClearTags: () => void;
  setDateFrom: (s: string) => void;
  setDateTo: (s: string) => void;
}) {
  const typeActive = typeFilters.length > 0;
  const statusActive = statusFilters.length > 0;
  const tagActive = tagFilters.length > 0;
  const dateActive = Boolean(dateFrom || dateTo);

  return (
    <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none snap-x px-1 md:mx-0 md:flex-wrap md:overflow-visible md:snap-none md:px-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 snap-start items-center gap-1.5 rounded-xs border px-2.5 py-1 text-xs transition-colors',
              typeActive
                ? 'border-accent-border bg-accent-muted text-accent'
                : 'border-border-subtle bg-bg-overlay text-fg-secondary hover:text-fg-primary',
            )}
          >
            <Filter size={11} strokeWidth={1.75} />
            {typeActive ? `${typeFilters.length} тип(ов)` : 'Тип'}
            {typeActive && (
              <X
                size={11}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClearTypes();
                }}
              />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuLabel>Тип встречи</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {MEETING_TYPES.map((t) => (
            <DropdownMenuCheckboxItem
              key={t}
              checked={typeFilters.includes(t)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggleType(t)}
            >
              {MEETING_TYPE_LABEL_RU[t]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 snap-start items-center gap-1.5 rounded-xs border px-2.5 py-1 text-xs transition-colors',
              statusActive
                ? 'border-accent-border bg-accent-muted text-accent'
                : 'border-border-subtle bg-bg-overlay text-fg-secondary hover:text-fg-primary',
            )}
          >
            <Filter size={11} strokeWidth={1.75} />
            {statusActive ? `${statusFilters.length} статусов` : 'Статус'}
            {statusActive && (
              <X
                size={11}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClearStatuses();
                }}
              />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Статус</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {MEETING_STATUSES.map((s) => (
            <DropdownMenuCheckboxItem
              key={s}
              checked={statusFilters.includes(s)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggleStatus(s)}
            >
              {STATUS_LABEL[s] ?? s}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 snap-start items-center gap-1.5 rounded-xs border px-2.5 py-1 text-xs transition-colors',
              dateActive
                ? 'border-accent-border bg-accent-muted text-accent'
                : 'border-border-subtle bg-bg-overlay text-fg-secondary hover:text-fg-primary',
            )}
          >
            <Calendar size={11} strokeWidth={1.75} />
            {dateActive ? 'Дата ✓' : 'Любая дата'}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-secondary">От</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-secondary">До</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
          >
            Сбросить
          </Button>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 snap-start items-center gap-1.5 rounded-xs border px-2.5 py-1 text-xs transition-colors',
              tagActive
                ? 'border-accent-border bg-accent-muted text-accent'
                : 'border-border-subtle bg-bg-overlay text-fg-secondary hover:text-fg-primary',
            )}
          >
            <TagIcon size={11} strokeWidth={1.75} />
            {tagActive ? `${tagFilters.length} тег(ов)` : 'Теги'}
            {tagActive && (
              <X
                size={11}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onClearTags();
                }}
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2">
          {allTags.length === 0 ? (
            <div className="text-xs text-fg-tertiary">
              Тегов пока нет. Создайте в /settings/tags.
            </div>
          ) : (
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {allTags.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-bg-overlay"
                >
                  <Checkbox
                    checked={tagFilters.includes(t.id)}
                    onCheckedChange={() => onToggleTag(t.id)}
                  />
                  <span className="text-fg-primary">{t.name}</span>
                </label>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─────────────── Bulk actions ───────────────

function BulkActionsToolbar({
  count,
  allTags,
  onDelete,
  onSetTags,
  onExport,
}: {
  count: number;
  allTags: TagDomain[];
  onDelete: () => void;
  onSetTags: (tagIds: string[]) => void;
  onExport: (opts: {
    includeTranscript: boolean;
    includeAudio: boolean;
    includeVideo: boolean;
  }) => void;
}) {
  const [tagSelection, setTagSelection] = useState<Set<string>>(new Set());
  const [includeTranscript, setIncludeTranscript] = useState(true);
  const [includeAudio, setIncludeAudio] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(false);

  return (
    <div className="ml-auto flex items-center gap-1.5 rounded border border-border-subtle bg-bg-card px-2 py-1 text-xs">
      <span className="font-mono text-accent">{count}</span>
      <Button variant="ghost" size="sm" onClick={onDelete} className="h-6 px-2 text-xs">
        <Trash2 size={11} />
        Удалить
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary"
          >
            <TagIcon size={11} />
            Теги
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2" align="end">
          {allTags.length === 0 ? (
            <div className="text-xs text-fg-tertiary">Тегов нет</div>
          ) : (
            <>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {allTags.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-bg-overlay"
                  >
                    <Checkbox
                      checked={tagSelection.has(t.id)}
                      onCheckedChange={() => {
                        setTagSelection((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        });
                      }}
                    />
                    <span>{t.name}</span>
                  </label>
                ))}
              </div>
              <Button
                size="sm"
                onClick={() => {
                  onSetTags([...tagSelection]);
                  setTagSelection(new Set());
                }}
              >
                Применить
              </Button>
            </>
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary"
          >
            <ArrowUpRight size={11} />
            Экспорт ZIP
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3" align="end">
          <div className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
            Что включить
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeTranscript}
              onCheckedChange={(v) => setIncludeTranscript(v === true)}
            />
            Транскрипт
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeAudio}
              onCheckedChange={(v) => setIncludeAudio(v === true)}
            />
            Аудио (раздельные дорожки)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeVideo}
              onCheckedChange={(v) => setIncludeVideo(v === true)}
            />
            Видео
          </label>
          <Button
            size="sm"
            onClick={() =>
              onExport({ includeTranscript, includeAudio, includeVideo })
            }
          >
            Запустить экспорт
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─────────────── Detail pane ───────────────

function DetailEmpty() {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center text-fg-tertiary">
      <div>
        <ListChecks size={32} className="mx-auto opacity-40" />
        <div className="mt-3 text-sm">Выберите встречу слева</div>
      </div>
    </div>
  );
}

function MeetingDetailPane({ meetingId }: { meetingId: string }) {
  const { data, isLoading, error } = useSWR(
    ['meeting-result-mini', meetingId],
    () => meetingsApi.result(meetingId),
    { revalidateOnFocus: false },
  );
  const { tasks: taskRows } = useMeetingTasks(meetingId);
  const [inviteOpen, setInviteOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-3 p-8">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="grid h-full place-items-center px-6 py-16 text-center">
        <div>
          <div className="text-sm text-fg-secondary">Не удалось загрузить детали</div>
        </div>
      </div>
    );
  }

  const meeting = data.meeting;
  const joinable = isJoinableStatus(meeting.status);
  const participants = data.participants ?? [];
  const recording = data.recording;
  const aiResult = data.aiResult;
  // Р6: единый селектор канонической сводки (summaryFast ?? summary),
  // чтобы превью журнала совпадало со страницей результата (конец «дубля сводок»).
  const summary = pickPrimarySummary(aiResult)?.markdown ?? null;
  // S6-03: задачи из таблицы Task (тот же источник, что страница результата),
  // а НЕ из устаревшего пустого aiResult.tasks. pickPrimaryTasks объединяет fast+main.
  const tasks = pickPrimaryTasks(taskRows);

  const durMs =
    typeof meeting.durationMs === 'number'
      ? meeting.durationMs
      : recording?.durationSeconds
        ? recording.durationSeconds * 1000
        : null;

  const typeLabel = MEETING_TYPE_LABEL_RU[meeting.type as MeetingType] ?? meeting.type;
  const isProcessing =
    meeting.status === 'recording_processing' ||
    meeting.status === 'transcription_processing' ||
    meeting.status === 'ai_processing';
  const isFailed = meeting.status === 'failed';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-8 pb-5 pt-6">
        <div className="min-w-0 flex-1">
          <nav className="mb-2 flex items-center gap-1.5 text-xs text-fg-tertiary">
            <Link href="/meetings" className="hover:text-fg-secondary">
              Встречи
            </Link>
            <ChevronRight size={11} />
            <span className="text-fg-secondary">{typeLabel}</span>
          </nav>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">
            {meeting.title}
          </h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-secondary">
            <Badge>{typeLabel}</Badge>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={12} strokeWidth={1.75} />
              <span className="font-mono">{fmtDurationCompact(durMs)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users size={12} strokeWidth={1.75} />
              {participants.length} участников
            </span>
            {meeting.startedAt && (
              <>
                <span className="text-fg-tertiary">·</span>
                <span>{new Date(meeting.startedAt).toLocaleString('ru-RU')}</span>
              </>
            )}
          </div>
        </div>
        {joinable ? (
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
            <Button asChild size="sm">
              <Link href={`/m/${meeting.id}`}>
                <LogIn size={14} /> Войти в встречу
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyMeetingLink(meeting.id)}
            >
              <Copy size={14} /> Скопировать ссылку
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus size={14} /> Пригласить
            </Button>
          </div>
        ) : (
          <Button asChild size="sm">
            <Link href={`/meetings/${meeting.id}/result`}>
              Открыть полную страницу
            </Link>
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {isProcessing ? (
          <DetailProcessing />
        ) : isFailed ? (
          <DetailFailed />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex flex-col gap-6">
              {summary ? (
                <section>
                  <SectionHeader icon={<Sparkles size={14} />} title="Краткое содержание" />
                  <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
                    <p className="m-0 text-sm leading-relaxed text-fg-primary">
                      {summary}
                    </p>
                  </div>
                </section>
              ) : (
                <section>
                  <SectionHeader title="Краткое содержание" />
                  <div className="rounded-lg border border-border-subtle bg-bg-card p-5 text-sm text-fg-tertiary">
                    Кора ещё не сформировала краткое содержание.
                  </div>
                </section>
              )}

              {participants.length > 0 && (
                <section>
                  <SectionHeader title="Участники" />
                  <div className="flex flex-wrap items-center gap-3">
                    {participants.map((p) => (
                      <span
                        key={p.id}
                        className="rounded-full border border-border-subtle bg-bg-card px-3 py-1 text-sm text-fg-secondary"
                      >
                        {p.name}
                        {p.role === 'host' && (
                          <span className="ml-1 rounded bg-accent-muted px-1 text-[10px] text-accent">
                            ведущий
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
            <div className="flex flex-col gap-6">
              <section>
                <SectionHeader
                  icon={<ListChecks size={14} />}
                  title="Задачи"
                  right={
                    <span className="text-xs text-fg-tertiary">
                      {tasks.length} всего
                    </span>
                  }
                />
                <div className="rounded-lg border border-border-subtle bg-bg-card p-2">
                  {tasks.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-fg-tertiary">
                      Задач не найдено
                    </div>
                  ) : (
                    <ul className="flex flex-col">
                      {tasks.slice(0, 5).map((t) => {
                        const title = t.title || '—';
                        const assignee = t.assignee ?? undefined;
                        const due = t.dueDate
                          ? t.dueDate.toLocaleDateString('ru-RU')
                          : undefined;
                        return (
                          <li
                            key={t.id}
                            className="flex items-start gap-2.5 rounded-md px-3 py-2.5 transition-colors hover:bg-bg-overlay"
                          >
                            <Circle
                              size={14}
                              strokeWidth={1.5}
                              className="mt-0.5 shrink-0 text-fg-tertiary"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm leading-snug text-fg-primary">
                                {title}
                              </div>
                              {(assignee || due) && (
                                <div className="mt-1 flex items-center gap-2 text-xs text-fg-tertiary">
                                  {assignee && (
                                    <span className="font-mono">{assignee}</span>
                                  )}
                                  {due && (
                                    <>
                                      <span>·</span>
                                      <span>до {due}</span>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle bg-bg-elevated/50 px-8 py-4">
        <Button asChild>
          <Link href={`/meetings/${meeting.id}/result`}>
            <ArrowUpRight size={14} strokeWidth={2} />
            Открыть полную страницу результата
          </Link>
        </Button>
      </div>

      <InviteDialog
        meetingId={meeting.id}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  );
}

function DetailProcessing() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent-muted">
        <Sparkles size={20} className="animate-pulse text-accent" strokeWidth={1.5} />
      </div>
      <div className="text-base font-medium text-fg-primary">Кора обрабатывает запись</div>
      <div className="mt-1 max-w-sm text-sm text-fg-secondary">
        Транскрипция и анализ занимают 2–4 минуты.
      </div>
    </div>
  );
}

function DetailFailed() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-danger/15">
        <span className="text-xl text-danger">!</span>
      </div>
      <div className="text-base font-medium text-fg-primary">
        Не удалось обработать запись
      </div>
      <div className="mt-1 max-w-sm text-sm text-fg-secondary">
        Обработка прервалась. Откройте полную страницу и нажмите «Регенерировать».
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  right,
}: {
  icon?: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-fg-tertiary">{icon}</span>}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
          {title}
        </h3>
      </div>
      {right}
    </div>
  );
}

