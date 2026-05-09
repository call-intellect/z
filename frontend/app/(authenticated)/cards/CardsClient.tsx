'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Briefcase,
  FolderKanban,
  Layers,
  Plus,
  Tag as TagIcon,
  User,
} from 'lucide-react';

import { cardsApi, type CardKindFilter } from '@/api/cards.api';
import {
  CARD_KIND_LABELS,
  type CardDomain,
  type CardKind,
  cardFromApi,
} from '@/domain/card';
import { CreateCardDialog } from '@/ui/components/cards/CreateCardDialog';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { cn } from '@/ui/shadcn/lib/utils';

type KindOption = { value: CardKindFilter | 'all'; label: string };
const KIND_OPTIONS: KindOption[] = [
  { value: 'all', label: 'Все' },
  { value: 'client', label: 'Клиенты' },
  { value: 'deal', label: 'Сделки' },
  { value: 'project', label: 'Проекты' },
  { value: 'topic', label: 'Темы' },
  { value: 'custom', label: 'Прочее' },
];

const KIND_ICONS: Record<CardKind, typeof FolderKanban> = {
  client: User,
  deal: Briefcase,
  project: Layers,
  topic: TagIcon,
  custom: FolderKanban,
};

export function CardsClient() {
  const [kind, setKind] = useState<CardKindFilter | 'all'>('all');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const swrKey = useMemo(
    () => ['cards', kind, q, showArchived] as const,
    [kind, q, showArchived],
  );

  const { data, mutate, isLoading } = useSWR(swrKey, async () => {
    const res = await cardsApi.list({
      ...(kind !== 'all' ? { kind } : {}),
      archived: showArchived,
      ...(q.trim() ? { q: q.trim() } : {}),
      sort: 'lastMeetingAt',
      limit: 100,
    });
    return res.items.map(cardFromApi);
  });

  const cards = data ?? [];
  const pinned = cards.filter((c) => c.pinned && !c.archivedAt);
  const others = cards.filter((c) => !c.pinned || c.archivedAt);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-2xl font-semibold">Карточки</h1>
          <p className="text-sm text-fg-tertiary">
            CRM-структура встреч: клиент, сделка, проект или тема. Создавайте
            встречу из карточки — она автоматически попадёт в её ленту.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus size={16} /> Новая карточка
        </Button>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Поиск по имени или контакту"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={kind} onValueChange={(v) => setKind(v as KindOption['value'])}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={showArchived ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowArchived((s) => !s)}
        >
          {showArchived ? 'Показаны архивные' : 'Без архива'}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-fg-tertiary">Загрузка…</div>
      ) : cards.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
                Закреплённые
              </h2>
              <CardsGrid items={pinned} />
            </section>
          )}
          <section>
            {pinned.length > 0 && (
              <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
                Все
              </h2>
            )}
            <CardsGrid items={others} />
          </section>
        </>
      )}

      <CreateCardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void mutate();
        }}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-subtle px-6 py-16 text-center">
      <FolderKanban
        size={42}
        strokeWidth={1.5}
        className="mb-3 text-fg-tertiary"
      />
      <h3 className="mb-2 text-lg font-medium">Пока нет карточек</h3>
      <p className="mb-5 max-w-md text-sm text-fg-tertiary">
        Создайте карточку клиента, сделки или проекта — и стартуйте встречу
        прямо из неё. Все встречи карточки будут собираться в её ленту, а AI
        соберёт сводку.
      </p>
      <Button onClick={onCreate} className="gap-2">
        <Plus size={16} /> Создать первую карточку
      </Button>
    </div>
  );
}

function CardsGrid({ items }: { items: CardDomain[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => (
        <CardListItem key={c.id} card={c} />
      ))}
    </div>
  );
}

function CardListItem({ card }: { card: CardDomain }) {
  const Icon = KIND_ICONS[card.kind] ?? FolderKanban;
  const dateLabel = card.lastMeetingAt
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
      }).format(card.lastMeetingAt)
    : '—';
  return (
    <Link
      href={`/cards/${encodeURIComponent(card.id)}`}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border border-border-subtle bg-bg-elevated p-4 transition-colors',
        'hover:border-accent/60 hover:bg-bg-overlay',
        card.archivedAt && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-fg-primary"
          style={{ backgroundColor: card.color + '22', color: card.color }}
        >
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-medium">{card.name}</h3>
            {card.pinned && (
              <span className="text-xs text-accent">Pinned</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-fg-tertiary">
            {CARD_KIND_LABELS[card.kind]} · {card.meetingCount} встреч
          </div>
        </div>
      </div>
      {card.contactName && (
        <div className="truncate text-sm text-fg-secondary">
          {card.contactName}
          {card.contactEmail ? ` · ${card.contactEmail}` : ''}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between text-xs text-fg-tertiary">
        <span>Последняя встреча: {dateLabel}</span>
        {card.archivedAt && <span>Архив</span>}
      </div>
    </Link>
  );
}
