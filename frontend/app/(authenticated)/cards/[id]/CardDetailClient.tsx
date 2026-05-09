'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import {
  Archive,
  ArchiveRestore,
  Briefcase,
  Calendar,
  ChevronLeft,
  FolderKanban,
  Layers,
  Mail,
  Phone,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  User,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { toast } from 'sonner';

import { cardsApi } from '@/api/cards.api';
import { ApiError } from '@/api/api-error';
import { CARD_KIND_LABELS, type CardKind, cardFromApi } from '@/domain/card';
import { CardChat } from '@/ui/components/cards/CardChat';
import { Button } from '@/ui/shadcn/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';
import { cn } from '@/ui/shadcn/lib/utils';

const KIND_ICONS: Record<CardKind, typeof FolderKanban> = {
  client: User,
  deal: Briefcase,
  project: Layers,
  topic: TagIcon,
  custom: FolderKanban,
};

export function CardDetailClient({ cardId }: { cardId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<'overview' | 'chat'>('overview');

  const cardSwr = useSWR(['card', cardId], async () => {
    const api = await cardsApi.get(cardId);
    return cardFromApi(api);
  });

  const meetingsSwr = useSWR(
    cardSwr.data ? ['card-meetings', cardId] : null,
    () => cardsApi.listMeetings(cardId, 1, 50),
  );

  if (cardSwr.error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Карточка не найдена или у вас нет доступа.
        </div>
        <Button asChild variant="ghost" className="mt-3">
          <Link href="/cards">
            <ChevronLeft size={16} /> Все карточки
          </Link>
        </Button>
      </div>
    );
  }

  const card = cardSwr.data;
  if (!card) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8 text-fg-tertiary">
        Загрузка…
      </div>
    );
  }

  const Icon = KIND_ICONS[card.kind] ?? FolderKanban;

  async function togglePin() {
    if (!card) return;
    try {
      const updated = await cardsApi.update(card.id, { pinned: !card.pinned });
      await cardSwr.mutate(cardFromApi(updated), { revalidate: false });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Ошибка');
    }
  }

  async function toggleArchive() {
    if (!card) return;
    try {
      const updated = await cardsApi.update(card.id, {
        archived: !card.archivedAt,
      });
      await cardSwr.mutate(cardFromApi(updated), { revalidate: false });
      toast.success(card.archivedAt ? 'Карточка восстановлена' : 'Карточка в архиве');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Ошибка');
    }
  }

  async function deleteCard() {
    if (!card) return;
    if (!confirm('Удалить карточку? Восстановить можно в течение 30 дней.')) {
      return;
    }
    try {
      await cardsApi.remove(card.id);
      toast.success('Карточка удалена');
      router.push('/cards');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Ошибка удаления');
    }
  }

  const meetings = meetingsSwr.data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="gap-1 text-fg-tertiary">
          <Link href="/cards">
            <ChevronLeft size={16} /> Все карточки
          </Link>
        </Button>
      </div>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start gap-4">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: card.color + '22', color: card.color }}
        >
          <Icon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold truncate">{card.name}</h1>
            {card.pinned && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                Pinned
              </span>
            )}
            {card.archivedAt && (
              <span className="rounded-full bg-bg-overlay px-2 py-0.5 text-xs text-fg-tertiary">
                Архив
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-fg-tertiary">
            <span>{CARD_KIND_LABELS[card.kind]}</span>
            <span>·</span>
            <span>{card.meetingCount} встреч</span>
            {card.contactName && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <User size={14} /> {card.contactName}
                </span>
              </>
            )}
            {card.contactEmail && (
              <span className="inline-flex items-center gap-1">
                <Mail size={14} /> {card.contactEmail}
              </span>
            )}
            {card.contactPhone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={14} /> {card.contactPhone}
              </span>
            )}
          </div>
          {card.description && (
            <p className="mt-2 text-sm text-fg-secondary">{card.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="default"
            className="gap-2"
            title="Создать встречу из карточки"
          >
            <Link
              href={`/meetings/create?cardId=${encodeURIComponent(card.id)}`}
            >
              <Plus size={16} /> Запланировать встречу
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Меню карточки">
                <span className="text-lg leading-none">⋯</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => void togglePin()}>
                {card.pinned ? (
                  <>
                    <PinOff size={14} /> Открепить
                  </>
                ) : (
                  <>
                    <Pin size={14} /> Закрепить
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void toggleArchive()}>
                {card.archivedAt ? (
                  <>
                    <ArchiveRestore size={14} /> Из архива
                  </>
                ) : (
                  <>
                    <Archive size={14} /> В архив
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-danger focus:text-danger"
                onSelect={() => void deleteCard()}
              >
                <Trash2 size={14} /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'overview' | 'chat')}>
        <TabsList>
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="chat">AI-чат</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Timeline (2 columns) */}
            <section className="lg:col-span-2">
              <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
                Встречи в карточке
              </h2>
              {meetingsSwr.isLoading ? (
                <div className="text-fg-tertiary">Загрузка…</div>
              ) : meetings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-subtle p-6 text-center text-sm text-fg-tertiary">
                  В карточке пока нет встреч. Нажмите «Запланировать встречу» —
                  она автоматически попадёт сюда.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {meetings.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/meetings/${encodeURIComponent(m.id)}/result`}
                        className="flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-elevated p-3 transition-colors hover:border-accent/60 hover:bg-bg-overlay"
                      >
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-bg-overlay text-fg-secondary">
                          <Calendar size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {m.title}
                            </span>
                            <span className="text-xs text-fg-tertiary">
                              {m.type}
                            </span>
                            <StatusBadge status={m.status} />
                          </div>
                          <div className="mt-0.5 text-xs text-fg-tertiary">
                            {new Date(m.createdAt).toLocaleString('ru-RU')}
                          </div>
                          {m.summary && (
                            <p className="mt-1 line-clamp-2 text-xs text-fg-secondary">
                              {m.summary}
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Sidebar: rollup */}
            <aside>
              <RollupCard
                summary={card.summary}
                summaryUpdatedAt={card.summaryUpdatedAt}
              />
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <aside className="lg:col-span-1">
              <RollupCard
                summary={card.summary}
                summaryUpdatedAt={card.summaryUpdatedAt}
              />
            </aside>
            <div className="lg:col-span-2">
              <CardChat cardId={card.id} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RollupCard({
  summary,
  summaryUpdatedAt,
}: {
  summary: string | null;
  summaryUpdatedAt: Date | null;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-accent" />
        <h3 className="text-sm font-medium">AI-сводка по карточке</h3>
        {summaryUpdatedAt && (
          <span className="ml-auto text-xs text-fg-tertiary">
            {new Intl.DateTimeFormat('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }).format(summaryUpdatedAt)}
          </span>
        )}
      </div>
      {summary ? (
        <div className="prose prose-sm prose-invert max-w-none text-fg-primary [&>*]:my-2">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {summary}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-sm text-fg-tertiary">
          <RefreshCw size={14} className="mt-0.5 animate-spin-slow" />
          <span>
            Сводка собирается автоматически после первой обработанной встречи в
            карточке.
          </span>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes('failed')
    ? 'bg-danger/15 text-danger'
    : status === 'ai_ready'
      ? 'bg-accent/15 text-accent'
      : 'bg-bg-overlay text-fg-tertiary';
  return (
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', tone)}>
      {status}
    </span>
  );
}
