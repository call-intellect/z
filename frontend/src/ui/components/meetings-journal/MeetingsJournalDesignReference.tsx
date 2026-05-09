'use client';

/**
 * Design reference. NOT production code, NOT wired to API.
 * Master-detail журнал встреч — калибровочный таргет для апрува.
 *
 * Использует те же design tokens (через Tailwind utilities → CSS-vars в tokens.css).
 * См. дизайн-документ: plans/analysis/2026-05-09-ai-meeting-workspace-design.md
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Filter,
  ListChecks,
  MoreHorizontal,
  Search,
  Share2,
  Sparkles,
  Tag as TagIcon,
  Users,
} from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Badge } from '@/ui/shadcn/badge';
import { Avatar, AvatarFallback } from '@/ui/shadcn/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { Separator } from '@/ui/shadcn/separator';
import { cn } from '@/ui/shadcn/lib/utils';

// ─── Mock data ──────────────────────────────────────────────────────────────

type MeetingType = 'sales' | 'discovery' | 'sync' | 'interview' | 'demo';
type MeetingStatus = 'processed' | 'processing' | 'failed';

type MeetingItem = {
  id: string;
  title: string;
  type: MeetingType;
  typeLabel: string;
  status: MeetingStatus;
  durationMs: number;
  participantCount: number;
  date: string; // pretty
  group: 'today' | 'week' | 'earlier';
  // detail
  summary: string[];
  tasks: { id: string; title: string; assignee: string; due: string; done: boolean }[];
  chapters: { id: string; startMs: number; title: string }[];
  participants: { initials: string; name: string; isHost?: boolean }[];
  tags: string[];
};

const MEETINGS: MeetingItem[] = [
  {
    id: 'm1',
    title: 'Демо для Acme Corp · стратегический звонок',
    type: 'demo',
    typeLabel: 'Demo',
    status: 'processed',
    durationMs: 7_338_000,
    participantCount: 4,
    date: 'Сегодня · 14:00',
    group: 'today',
    summary: [
      'Acme заинтересован в AI-отчёте под их sales-pipeline. Главная боль — ручной ввод данных в HubSpot после звонков, тратят 2–3 часа на менеджера в неделю.',
      'Демо прошли по полному сценарию: запись 2-часовой встречи, авто-транскрипт, отчёт под "Sales", action items, пуш в Slack-канал rev-ops.',
      'Озвучили потолок 500 000 ₽/мес при условии измеримого ROI в течение 3 месяцев. Готовы к 90-дневному пилоту с командой 12 человек.',
      'Compliance-блокер: нужен SOC2 Type 2 + DPA до подписания. Договорились пришлю SOC2-statement к 15 мая.',
    ],
    tasks: [
      { id: 't1', title: 'Прислать пример webhook-payload для HubSpot', assignee: 'Сергей', due: '10 мая', done: false },
      { id: 't2', title: 'Подготовить пилотный SOW с 90-дневным ROI', assignee: 'Сергей', due: '13 мая', done: false },
      { id: 't3', title: 'SOC2 Type 2 + DPA', assignee: 'Анна (Acme)', due: '15 мая', done: false },
      { id: 't4', title: 'Trial-доступ для 12 человек на 14 дней', assignee: 'Сергей', due: '9 мая', done: true },
    ],
    chapters: [
      { id: 'c1', startMs: 0, title: 'Знакомство и контекст' },
      { id: 'c2', startMs: 720_000, title: 'Демо платформы' },
      { id: 'c3', startMs: 2_580_000, title: 'Возражения и compliance' },
      { id: 'c4', startMs: 4_920_000, title: 'Бюджет и сроки пилота' },
      { id: 'c5', startMs: 6_360_000, title: 'Next steps' },
    ],
    participants: [
      { initials: 'СМ', name: 'Сергей Мазуренко', isHost: true },
      { initials: 'ИК', name: 'Иван Колесников' },
      { initials: 'АЛ', name: 'Анна Лесникова' },
      { initials: 'ВГ', name: 'Виктор Громов' },
    ],
    tags: ['enterprise', 'pilot-90d', 'hot'],
  },
  {
    id: 'm2',
    title: 'Discovery-звонок с Briskly — холодный лид',
    type: 'discovery',
    typeLabel: 'Discovery',
    status: 'processed',
    durationMs: 2_520_000,
    participantCount: 3,
    date: 'Сегодня · 11:30',
    group: 'today',
    summary: [
      'Briskly (75 человек, ритейл-аналитика). Используют Notion + Slack, без выделенного meeting-инструмента. Болей много, но бюджет на новые SaaS заморожен до Q3.',
      'Главный pain: кастдев-интервью (3-5 в неделю) распределяются между PM и продакт-аналитиком, отчёты делает каждый по-своему.',
    ],
    tasks: [
      { id: 't1', title: 'Прислать кейс по custdev-отчётам Z', assignee: 'Сергей', due: '11 мая', done: false },
      { id: 't2', title: 'Re-engage в августе, узнать про разморозку бюджета', assignee: 'Сергей', due: '1 авг', done: false },
    ],
    chapters: [
      { id: 'c1', startMs: 0, title: 'Знакомство' },
      { id: 'c2', startMs: 360_000, title: 'Текущий процесс кастдева' },
      { id: 'c3', startMs: 1_440_000, title: 'Бюджетные ограничения' },
    ],
    participants: [
      { initials: 'СМ', name: 'Сергей Мазуренко', isHost: true },
      { initials: 'ОК', name: 'Олег Климов' },
      { initials: 'НП', name: 'Наталья Пащенко' },
    ],
    tags: ['cold', 'q3-followup'],
  },
  {
    id: 'm3',
    title: 'Внутренний sync — релиз M5',
    type: 'sync',
    typeLabel: 'Team sync',
    status: 'processing',
    durationMs: 1_980_000,
    participantCount: 5,
    date: 'Сегодня · 10:00',
    group: 'today',
    summary: [
      'Обработка ещё идёт — отчёт появится через 2-3 минуты.',
    ],
    tasks: [],
    chapters: [],
    participants: [
      { initials: 'СМ', name: 'Сергей Мазуренко', isHost: true },
      { initials: 'ДК', name: 'Дима Карпов' },
      { initials: 'МШ', name: 'Маша Шаров' },
      { initials: 'АП', name: 'Аркадий Поздняков' },
      { initials: 'ВЛ', name: 'Влад Лебедев' },
    ],
    tags: ['internal', 'release'],
  },
  {
    id: 'm4',
    title: 'Custdev: Иван (CEO Lookery) о боли с meeting-tools',
    type: 'interview',
    typeLabel: 'Custdev',
    status: 'processed',
    durationMs: 3_540_000,
    participantCount: 2,
    date: 'Вчера · 16:00',
    group: 'week',
    summary: [
      'Lookery — saas для аналитики мобильных приложений, 25 человек. Используют Otter и Loom + ручные конспекты.',
      'Главная фрустрация: Otter не умеет в action items на русском, Loom не разбирает речь вообще.',
    ],
    tasks: [
      { id: 't1', title: 'Прислать инвайт на pilot когда будет готов', assignee: 'Сергей', due: '20 мая', done: false },
    ],
    chapters: [
      { id: 'c1', startMs: 0, title: 'Контекст компании' },
      { id: 'c2', startMs: 600_000, title: 'Текущий стек инструментов' },
      { id: 'c3', startMs: 2_100_000, title: 'Что хотел бы видеть' },
    ],
    participants: [
      { initials: 'СМ', name: 'Сергей Мазуренко', isHost: true },
      { initials: 'ИК', name: 'Иван Каркушин' },
    ],
    tags: ['custdev', 'hot'],
  },
  {
    id: 'm5',
    title: 'Sales follow-up: Procreate Studio',
    type: 'sales',
    typeLabel: 'Sales',
    status: 'processed',
    durationMs: 1_860_000,
    participantCount: 3,
    date: '5 мая · 12:00',
    group: 'week',
    summary: [
      'Procreate Studio — design-агентство 18 человек. Решили начать с месячной подписки на Standard, без enterprise-функций.',
      'Подписали договор, договорились о kick-off на 14 мая.',
    ],
    tasks: [
      { id: 't1', title: 'Отправить инвойс на май', assignee: 'Сергей', due: '6 мая', done: true },
      { id: 't2', title: 'Запланировать kick-off с командой', assignee: 'Сергей', due: '12 мая', done: true },
    ],
    chapters: [
      { id: 'c1', startMs: 0, title: 'Подтверждение условий' },
      { id: 'c2', startMs: 720_000, title: 'Коммерческие детали' },
      { id: 'c3', startMs: 1_440_000, title: 'Kick-off planning' },
    ],
    participants: [
      { initials: 'СМ', name: 'Сергей Мазуренко', isHost: true },
      { initials: 'АТ', name: 'Антон Тарасов' },
      { initials: 'ЛВ', name: 'Лена Ватутина' },
    ],
    tags: ['won', 'standard'],
  },
  {
    id: 'm6',
    title: 'Sync с командой ML — embeddings для cross-meeting search',
    type: 'sync',
    typeLabel: 'Team sync',
    status: 'processed',
    durationMs: 2_700_000,
    participantCount: 4,
    date: '28 апр · 15:00',
    group: 'earlier',
    summary: [
      'Решили: для V1 берём BGE-M3 локально (микросервис), fallback — OpenAI через прокси.',
      'pgvector index по `MeetingTranscriptChunk` с HNSW, m=16, ef_construction=64.',
    ],
    tasks: [
      { id: 't1', title: 'Поднять микросервис BGE-M3 в инфре', assignee: 'Дима К.', due: '5 мая', done: true },
      { id: 't2', title: 'Бенчмарк latency BGE vs OpenAI на 1000 chunks', assignee: 'Маша Ш.', due: '8 мая', done: true },
    ],
    chapters: [
      { id: 'c1', startMs: 0, title: 'Выбор embedding-модели' },
      { id: 'c2', startMs: 900_000, title: 'pgvector vs Qdrant' },
      { id: 'c3', startMs: 2_100_000, title: 'План внедрения' },
    ],
    participants: [
      { initials: 'СМ', name: 'Сергей Мазуренко', isHost: true },
      { initials: 'ДК', name: 'Дима Карпов' },
      { initials: 'МШ', name: 'Маша Шаров' },
      { initials: 'ВЛ', name: 'Влад Лебедев' },
    ],
    tags: ['internal', 'ml', 'archived'],
  },
  {
    id: 'm7',
    title: 'Demo для FinTrack — финтех, B2C',
    type: 'demo',
    typeLabel: 'Demo',
    status: 'processed',
    durationMs: 3_120_000,
    participantCount: 5,
    date: '22 апр · 11:00',
    group: 'earlier',
    summary: [
      'FinTrack — 60 человек, B2C-финтех. Заинтересованы, но просят kazakh-language support — уже отказались, не наш сегмент в V1.',
    ],
    tasks: [{ id: 't1', title: 'Записать в backlog: kazakh ASR', assignee: 'Сергей', due: '—', done: true }],
    chapters: [
      { id: 'c1', startMs: 0, title: 'Демо' },
      { id: 'c2', startMs: 1_500_000, title: 'Q&A про языки' },
    ],
    participants: [],
    tags: ['lost', 'language'],
  },
  {
    id: 'm8',
    title: 'Custdev: Елена (Head of Product, Wallabit)',
    type: 'interview',
    typeLabel: 'Custdev',
    status: 'processed',
    durationMs: 2_880_000,
    participantCount: 2,
    date: '18 апр · 17:00',
    group: 'earlier',
    summary: [
      'Wallabit — crypto-wallet, 35 человек. Интервью прошло отлично, много инсайтов про user-research workflow.',
    ],
    tasks: [],
    chapters: [
      { id: 'c1', startMs: 0, title: 'Текущий research workflow' },
      { id: 'c2', startMs: 1_200_000, title: 'Боли с инструментами' },
      { id: 'c3', startMs: 2_280_000, title: 'Что хотели бы попробовать' },
    ],
    participants: [
      { initials: 'СМ', name: 'Сергей Мазуренко', isHost: true },
      { initials: 'ЕК', name: 'Елена Калинина' },
    ],
    tags: ['custdev'],
  },
  {
    id: 'm9',
    title: 'Sales: AviaCore — авиаотрасль, enterprise',
    type: 'sales',
    typeLabel: 'Sales',
    status: 'failed',
    durationMs: 480_000,
    participantCount: 6,
    date: '15 апр · 10:00',
    group: 'earlier',
    summary: ['AI-pipeline упал на этапе транскрипции. Нужно перегенерировать.'],
    tasks: [],
    chapters: [],
    participants: [],
    tags: ['enterprise', 'failed'],
  },
];

const ALL_TYPES: { value: MeetingType | 'all'; label: string }[] = [
  { value: 'all', label: 'Все типы' },
  { value: 'sales', label: 'Sales' },
  { value: 'discovery', label: 'Discovery' },
  { value: 'demo', label: 'Demo' },
  { value: 'interview', label: 'Custdev' },
  { value: 'sync', label: 'Team sync' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}ч ${m.toString().padStart(2, '0')}м` : `${m}м`;
}

function fmtChapterTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`;
}

const GROUP_LABELS: Record<MeetingItem['group'], string> = {
  today: 'Сегодня',
  week: 'На неделе',
  earlier: 'Ранее',
};

// ─── Main component ─────────────────────────────────────────────────────────

export function MeetingsJournalDesignReference() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MeetingType | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string>(MEETINGS[0]!.id);

  const filtered = useMemo(() => {
    return MEETINGS.filter((m) => {
      if (typeFilter !== 'all' && m.type !== typeFilter) return false;
      if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [search, typeFilter]);

  const grouped = useMemo(() => {
    const out: Record<MeetingItem['group'], MeetingItem[]> = {
      today: [],
      week: [],
      earlier: [],
    };
    for (const m of filtered) out[m.group].push(m);
    return out;
  }, [filtered]);

  const selected = useMemo(
    () => MEETINGS.find((m) => m.id === selectedId) ?? MEETINGS[0]!,
    [selectedId],
  );

  return (
    <div className="grid h-[calc(100vh-0px)] grid-cols-[360px_minmax(0,1fr)] gap-0">
      {/* ── Master / list ── */}
      <div className="flex h-screen flex-col border-r border-border-subtle bg-bg-elevated">
        {/* Title + search */}
        <div className="flex flex-col gap-3 px-5 pb-4 pt-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold tracking-tight">Мои встречи</h1>
            <Badge variant="secondary">{filtered.length}</Badge>
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
          <FilterChips typeFilter={typeFilter} onTypeChange={setTypeFilter} />
        </div>

        <Separator />

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {(['today', 'week', 'earlier'] as const).map((group) => {
            const items = grouped[group];
            if (items.length === 0) return null;
            return (
              <div key={group} className="pb-3">
                <div className="sticky top-0 z-10 border-b border-border-subtle bg-bg-elevated/80 px-5 py-2 backdrop-blur-glass">
                  <div className="text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
                    {GROUP_LABELS[group]}
                  </div>
                </div>
                <ul className="px-2 pt-2">
                  {items.map((m) => (
                    <li key={m.id}>
                      <MeetingRowCard
                        item={m}
                        active={m.id === selectedId}
                        onClick={() => setSelectedId(m.id)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Detail ── */}
      <div className="flex h-screen flex-col overflow-hidden bg-bg-base">
        <AnimatePresence mode="wait">
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <DetailView item={selected} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Filter chips ───────────────────────────────────────────────────────────

function FilterChips({
  typeFilter,
  onTypeChange,
}: {
  typeFilter: MeetingType | 'all';
  onTypeChange: (t: MeetingType | 'all') => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xs border px-2.5 py-1 text-xs transition-colors',
              typeFilter === 'all'
                ? 'border-border-subtle bg-bg-overlay text-fg-secondary hover:text-fg-primary'
                : 'border-accent-border bg-accent-muted text-accent',
            )}
          >
            <Filter size={11} strokeWidth={1.75} />
            {ALL_TYPES.find((t) => t.value === typeFilter)?.label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuLabel>Тип встречи</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ALL_TYPES.map((t) => (
            <DropdownMenuItem key={t.value} onSelect={() => onTypeChange(t.value)}>
              {t.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-xs border border-border-subtle bg-bg-overlay px-2.5 py-1 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <Calendar size={11} strokeWidth={1.75} />
        Любая дата
      </button>

      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-xs border border-border-subtle bg-bg-overlay px-2.5 py-1 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <TagIcon size={11} strokeWidth={1.75} />
        Теги
      </button>
    </div>
  );
}

// ─── Row card ───────────────────────────────────────────────────────────────

function MeetingRowCard({
  item,
  active,
  onClick,
}: {
  item: MeetingItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex w-full flex-col gap-1.5 rounded-md px-3 py-3 text-left transition-colors',
        active
          ? 'bg-bg-overlay'
          : 'hover:bg-bg-overlay/60',
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent shadow-glow-mint"
        />
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium leading-snug text-fg-primary">
            {item.title}
          </div>
        </div>
        <StatusDot status={item.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-fg-tertiary">
        <Badge
          variant={item.type === 'sales' || item.type === 'demo' ? 'default' : 'secondary'}
          className="px-1.5 py-0 text-[10px]"
        >
          {item.typeLabel}
        </Badge>
        <span className="inline-flex items-center gap-1">
          <Clock size={10} strokeWidth={1.75} />
          <span className="font-mono">{fmtDuration(item.durationMs)}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Users size={10} strokeWidth={1.75} />
          {item.participantCount}
        </span>
        <span>{item.date}</span>
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: MeetingStatus }) {
  if (status === 'processing') {
    return (
      <span
        aria-label="Обрабатывается"
        className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-warning"
      />
    );
  }
  if (status === 'failed') {
    return (
      <span
        aria-label="Ошибка"
        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
      />
    );
  }
  return null;
}

// ─── Detail view ────────────────────────────────────────────────────────────

function DetailView({ item }: { item: MeetingItem }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-8 pb-5 pt-6">
        <div className="min-w-0 flex-1">
          <nav className="mb-2 flex items-center gap-1.5 text-xs text-fg-tertiary">
            <span>Встречи</span>
            <ChevronRight size={11} />
            <span className="text-fg-secondary">{item.typeLabel}</span>
          </nav>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">
            {item.title}
          </h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-secondary">
            <Badge>{item.typeLabel}</Badge>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={12} strokeWidth={1.75} />
              <span className="font-mono">{fmtDuration(item.durationMs)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users size={12} strokeWidth={1.75} />
              {item.participantCount} участников
            </span>
            <span className="text-fg-tertiary">·</span>
            <span>{item.date}</span>
          </div>
          {item.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  #{t}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm">
            <Share2 size={14} strokeWidth={1.75} />
            Поделиться
          </Button>
          <Button variant="ghost" size="icon" aria-label="Меню">
            <MoreHorizontal size={18} strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {item.status === 'processing' ? (
          <ProcessingState />
        ) : item.status === 'failed' ? (
          <FailedState />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="flex flex-col gap-6">
              <SummarySection lines={item.summary} />
              <ParticipantsSection participants={item.participants} />
            </div>
            <div className="flex flex-col gap-6">
              <TasksSection tasks={item.tasks} />
              <ChaptersSection chapters={item.chapters} />
            </div>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      {item.status === 'processed' && (
        <div className="border-t border-border-subtle bg-bg-elevated/50 px-8 py-4">
          <Button className="w-full sm:w-auto">
            <ArrowUpRight size={14} strokeWidth={2} />
            Открыть полную страницу результата
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

function SummarySection({ lines }: { lines: string[] }) {
  return (
    <section>
      <SectionHeader icon={<Sparkles size={14} />} title="Summary" />
      <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
        <div className="space-y-3">
          {lines.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-fg-primary">
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

function TasksSection({ tasks }: { tasks: MeetingItem['tasks'] }) {
  if (tasks.length === 0) {
    return (
      <section>
        <SectionHeader icon={<ListChecks size={14} />} title="Action items" />
        <div className="rounded-lg border border-border-subtle bg-bg-card p-5 text-center text-sm text-fg-tertiary">
          Задач не найдено
        </div>
      </section>
    );
  }
  const visible = tasks.slice(0, 5);
  const more = tasks.length - visible.length;
  return (
    <section>
      <SectionHeader
        icon={<ListChecks size={14} />}
        title="Action items"
        right={
          <span className="text-xs text-fg-tertiary">
            {tasks.filter((t) => !t.done).length} открыто
          </span>
        }
      />
      <div className="rounded-lg border border-border-subtle bg-bg-card p-2">
        <ul className="flex flex-col">
          {visible.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-2.5 rounded-md px-3 py-2.5 transition-colors hover:bg-bg-overlay"
            >
              {t.done ? (
                <CheckCircle2 size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
              ) : (
                <Circle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-fg-tertiary" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'text-sm leading-snug',
                    t.done ? 'text-fg-tertiary line-through' : 'text-fg-primary',
                  )}
                >
                  {t.title}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-fg-tertiary">
                  <span className="font-mono">{t.assignee}</span>
                  <span>·</span>
                  <span>до {t.due}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {more > 0 && (
          <div className="border-t border-border-subtle px-3 py-2 text-xs text-fg-tertiary">
            +{more} ещё
          </div>
        )}
      </div>
    </section>
  );
}

function ChaptersSection({ chapters }: { chapters: MeetingItem['chapters'] }) {
  if (chapters.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Smart chapters" />
      <ol className="relative flex flex-col gap-0.5 rounded-lg border border-border-subtle bg-bg-card p-3">
        {chapters.map((c, i) => (
          <li
            key={c.id}
            className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-bg-overlay"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-muted font-mono text-[10px] text-accent">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-fg-primary">{c.title}</div>
            </div>
            <span className="font-mono text-xs text-fg-tertiary">
              {fmtChapterTime(c.startMs)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ParticipantsSection({ participants }: { participants: MeetingItem['participants'] }) {
  if (participants.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Участники" />
      <div className="flex flex-wrap items-center gap-3">
        {participants.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <Avatar className="h-7 w-7">
              <AvatarFallback className={p.isHost ? 'bg-accent-muted text-accent' : ''}>
                {p.initials}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm text-fg-secondary">{p.name}</span>
            {p.isHost && (
              <Badge variant="secondary" className="text-[10px]">
                host
              </Badge>
            )}
          </div>
        ))}
      </div>
    </section>
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

// ─── Empty / failed states ─────────────────────────────────────────────────

function ProcessingState() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-accent-muted">
        <Sparkles size={20} className="animate-pulse text-accent" strokeWidth={1.5} />
      </div>
      <div className="text-base font-medium text-fg-primary">AI обрабатывает запись</div>
      <div className="mt-1 max-w-sm text-sm text-fg-secondary">
        Транскрипция и анализ занимают 2–4 минуты. Можно закрыть страницу — пришлём уведомление, когда будет готово.
      </div>
    </div>
  );
}

function FailedState() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-danger/15">
        <span className="text-xl text-danger">!</span>
      </div>
      <div className="text-base font-medium text-fg-primary">
        Не удалось обработать запись
      </div>
      <div className="mt-1 max-w-sm text-sm text-fg-secondary">
        AI-pipeline упал на одном из этапов. Можно перегенерировать.
      </div>
      <Button variant="outline" className="mt-5" size="sm">
        Перегенерировать отчёт
      </Button>
    </div>
  );
}
