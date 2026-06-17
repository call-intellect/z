'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Newspaper, Check, ListChecks } from 'lucide-react';

import { coraFeedApi, probeControlApi } from '@/api/cora-feed.api';
import {
  CORA_FILTER_CHIPS,
  coraFeedViewFromApi,
  probeControlViewFromApi,
  type CoraFeedFilter,
  type CoraFeedItem,
  type CoraFeedTone,
  type ProbeControlItem,
} from '@/domain/cora-feed';
import { QueryGate } from '@/ui/components/shared/QueryGate';
import { EmptyState } from '@/ui/components/shared/EmptyState';

/**
 * «Лента Коры» как переиспользуемый виджет (ТЗ 2026-06-17 встройки ленты в
 * дашборды, Ф1 — вынос из страничного `FeedClient.tsx`).
 *
 * Живая лента-новости компании с анализом: идеи, сигналы, блокеры, решения,
 * конфликты, активность + вопросы Коры и вопросы людей. Переключатель-чипы
 * фильтруют по типу; счётчики — из `counters`. Под-вкладка «Контроль» (вопросы
 * Коры — кто ответил / молчит / не видел / протух) видна только при `canControl`
 * (владелец / админ / COO). Сортировка карточек — как пришла с бэка (по severity).
 *
 * Auth-гейт сюда НЕ входит — `orgId` и `canControl` считает вызывающая страница
 * и передаёт пропсами.
 *
 * variant:
 *  - `'full'`    — полная страничная раскладка: лимит 60, окно 30 дн, полная
 *    шапка, секция «Контроль» при `canControl`.
 *  - `'compact'` — для дашборда: начальный лимит `defaultLimit ?? 8`, компактная
 *    шапка и кнопка «Вся лента» внизу, которая разворачивает виджет на месте
 *    (поднимает лимит до 60 и сбрасывает фильтр в «Всё»).
 */

const TONE_CHIP: Record<CoraFeedTone, string> = {
  info: 'bg-chip-info-bg text-chip-info-fg',
  warning: 'bg-chip-warning-bg text-chip-warning-fg',
  danger: 'bg-chip-danger-bg text-chip-danger-fg',
};

const TONE_DOT: Record<CoraFeedTone, string> = {
  info: 'bg-chip-info-fg',
  warning: 'bg-chip-warning-fg',
  danger: 'bg-chip-danger-fg',
};

/** Окно ленты в днях по умолчанию (свежие новости компании). */
const FEED_WINDOW_DAYS = 30;
const FEED_LIMIT = 60;
/** Начальный лимит компактного виджета (для дашборда). */
const COMPACT_DEFAULT_LIMIT = 8;

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatScore(score: number): string {
  // payload.score приходит 0..1; рендерим как проценты.
  const pct = score <= 1 ? Math.round(score * 100) : Math.round(score);
  return `${pct}%`;
}

// ─── Виджет ──────────────────────────────────────────────────────────────────

export function CoraFeedWidget({
  orgId,
  canControl,
  variant = 'full',
  defaultLimit,
}: {
  orgId: string;
  canControl: boolean;
  variant?: 'full' | 'compact';
  defaultLimit?: number;
}) {
  const isCompact = variant === 'compact';

  const [filter, setFilter] = useState<CoraFeedFilter>('all');
  // Лимит ленты. В full всегда FEED_LIMIT; в compact стартует с компактного
  // значения и поднимается до FEED_LIMIT по кнопке «Вся лента».
  const [limit, setLimit] = useState<number>(
    isCompact ? (defaultLimit ?? COMPACT_DEFAULT_LIMIT) : FEED_LIMIT,
  );
  // Развёрнут ли компактный виджет «на месте».
  const expanded = limit >= FEED_LIMIT;

  // Лента Коры.
  const feedSwr = useSWR(
    ['cora-feed', orgId, filter, limit] as const,
    async ([, , type, lim]) => {
      const dto = await coraFeedApi.list(orgId, {
        type,
        window: FEED_WINDOW_DAYS,
        limit: lim,
      });
      return coraFeedViewFromApi(dto);
    },
  );

  // Контроль вопросов Коры (probe/control) — грузим только при наличии прав
  // и когда пользователь смотрит на вопросы Коры.
  const controlActive = canControl && filter === 'probe_question';
  const controlSwr = useSWR(
    controlActive ? (['probe-control', orgId] as const) : null,
    async ([, oid]) => {
      const dto = await probeControlApi.list(oid, {
        window: FEED_WINDOW_DAYS,
        limit: FEED_LIMIT,
      });
      return probeControlViewFromApi(dto);
    },
  );

  // markSeen при первом успешном заходе в ленту (обнуляет unread на бэке).
  const [seen, setSeen] = useState(false);
  const [seenPending, setSeenPending] = useState(false);
  const unreadCount = feedSwr.data?.unreadCount ?? 0;

  const markSeen = useMemo(
    () => async () => {
      if (seenPending) return;
      setSeenPending(true);
      try {
        await coraFeedApi.markSeen(orgId);
        setSeen(true);
        await feedSwr.mutate();
      } catch {
        // тихо — отметка прочтения не критична для просмотра ленты
      } finally {
        setSeenPending(false);
      }
    },
    [orgId, seenPending, feedSwr],
  );

  // Авто-отметка прочтения один раз, когда лента загрузилась и есть unread.
  useEffect(() => {
    if (!seen && !seenPending && unreadCount > 0 && feedSwr.data) {
      void markSeen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, seenPending, unreadCount, feedSwr.data]);

  const counters = feedSwr.data?.counters ?? {};
  const items = feedSwr.data?.items ?? [];

  // «Вся лента» (только compact, пока не развёрнут): поднять лимит до полного
  // и сбросить активный чип-фильтр в «Всё» — разворот на месте, без перехода.
  const expandToFull = () => {
    setLimit(FEED_LIMIT);
    setFilter('all');
  };

  return (
    <div
      className={
        isCompact ? 'w-full' : 'mx-auto w-full max-w-4xl px-4 py-8'
      }
    >
      {/* Шапка */}
      {isCompact ? (
        <header className="mb-4 flex flex-wrap items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-chip-info-bg text-chip-info-fg">
            <Newspaper size={16} />
          </div>
          <h2 className="text-base font-semibold tracking-tight text-fg-primary">
            Лента Коры
          </h2>
          <button
            type="button"
            onClick={() => {
              void markSeen();
            }}
            disabled={seenPending || unreadCount === 0}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong disabled:cursor-default disabled:opacity-50"
          >
            <Check size={14} />
            {unreadCount > 0 ? `Прочитать (${unreadCount})` : 'Всё прочитано'}
          </button>
        </header>
      ) : (
        <header className="mb-6 flex flex-wrap items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-chip-info-bg text-chip-info-fg">
            <Newspaper size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
              Лента Коры
            </h1>
            <p className="mt-1 text-sm text-fg-secondary">
              Новости компании с анализом — читайте, что прибавилось в памяти за
              последние дни.
            </p>
            <CountersSummary counters={counters} />
          </div>
          <button
            type="button"
            onClick={() => {
              void markSeen();
            }}
            disabled={seenPending || unreadCount === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong disabled:cursor-default disabled:opacity-50"
          >
            <Check size={14} />
            {unreadCount > 0 ? `Прочитать (${unreadCount})` : 'Всё прочитано'}
          </button>
        </header>
      )}

      {/* Переключатель-чипы */}
      <div className="mb-5 flex flex-wrap gap-2">
        {CORA_FILTER_CHIPS.map((chip) => {
          const count =
            chip.value === 'all' ? undefined : counters[chip.value];
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => setFilter(chip.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                filter === chip.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-subtle text-fg-secondary hover:border-border-strong'
              }`}
            >
              {chip.label}
              {typeof count === 'number' && count > 0 ? (
                <span
                  className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] ${
                    filter === chip.value
                      ? 'bg-accent/20 text-accent'
                      : 'bg-bg-subtle text-fg-tertiary'
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Контроль вопросов Коры — отдельная секция при выбранном чипе */}
      {controlActive ? (
        <ControlSection
          isLoading={controlSwr.isLoading}
          error={controlSwr.error}
          items={controlSwr.data?.items ?? []}
          counts={controlSwr.data?.counts}
          onRetry={() => {
            void controlSwr.mutate();
          }}
        />
      ) : null}

      {/* Лента карточек (Б-6: loading / empty / error) */}
      <QueryGate
        isLoading={feedSwr.isLoading}
        error={feedSwr.error}
        isEmpty={items.length === 0}
        onRetry={() => {
          void feedSwr.mutate();
        }}
        empty={
          <EmptyState
            title="Пока тихо"
            description="Кора добавит сюда новости, как только что-то появится во встречах и разговорах."
          />
        }
      >
        <div className="space-y-3">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      </QueryGate>

      {/* «Вся лента» — разворот компактного виджета на месте */}
      {isCompact && !expanded ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={expandToFull}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong"
          >
            Вся лента
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Сводка-счётчики в шапке ────────────────────────────────────────────────

function CountersSummary({
  counters,
}: {
  counters: Record<string, number>;
}) {
  // Компактная строка: «+N сигналов, M блокеров, K идей …».
  const parts: string[] = [];
  const push = (key: string, one: string, few: string, many: string) => {
    const n = counters[key];
    if (!n) return;
    const mod10 = n % 10;
    const mod100 = n % 100;
    let word = many;
    if (mod10 === 1 && mod100 !== 11) word = one;
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
      word = few;
    parts.push(`${n} ${word}`);
  };
  push('insight', 'сигнал', 'сигнала', 'сигналов');
  push('blocker', 'блокер', 'блокера', 'блокеров');
  push('idea', 'идея', 'идеи', 'идей');
  push('decision', 'решение', 'решения', 'решений');
  push('conflict', 'конфликт', 'конфликта', 'конфликтов');

  if (parts.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-fg-tertiary">За период: {parts.join(' · ')}</p>
  );
}

// ─── Карточка ленты ──────────────────────────────────────────────────────────

function FeedCard({ item }: { item: CoraFeedItem }) {
  return (
    <article
      className={`relative rounded-xl border bg-bg-surface p-4 transition-colors ${
        item.unread
          ? 'border-accent/40 bg-accent/[0.03]'
          : 'border-border-subtle'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Индикатор unread */}
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            item.unread ? TONE_DOT[item.tone] : 'bg-transparent'
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CHIP[item.tone]}`}
            >
              {item.typeLabel}
            </span>
            {/* R9 — подсветка «спросил руководитель» на вопросах людей */}
            {item.type === 'open_question' && item.askedByManager ? (
              <span className="inline-flex items-center rounded-full bg-chip-info-bg px-2 py-0.5 text-[10px] font-medium text-chip-info-fg">
                Спросил руководитель
              </span>
            ) : null}
            {item.unread ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-accent">
                новое
              </span>
            ) : null}
          </div>

          <h3 className="text-sm font-medium leading-snug text-fg-primary">
            {item.title}
          </h3>

          {/* Инсайт «оценка%→рекомендация→срок», если payload несёт */}
          {item.insight ? (
            <p className="mt-1.5 text-xs text-fg-secondary">
              {item.insight.score !== undefined ? (
                <span className="font-medium text-fg-primary">
                  {formatScore(item.insight.score)}
                </span>
              ) : null}
              {item.insight.recommendation ? (
                <>
                  {item.insight.score !== undefined ? ' → ' : ''}
                  {item.insight.recommendation}
                </>
              ) : null}
              {item.insight.due ? (
                <span className="text-fg-tertiary"> · срок: {item.insight.due}</span>
              ) : null}
            </p>
          ) : item.analysis ? (
            <p className="mt-1.5 text-xs text-fg-secondary">{item.analysis}</p>
          ) : null}

          {/* Мета */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-tertiary">
            <span>{formatRelative(item.createdAtDate)}</span>
            {item.meetingId ? (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={`/meetings/${item.meetingId}`}
                  className="text-chip-info-fg hover:underline"
                >
                  {item.cite ? `встреча ${item.cite}` : 'встреча'}
                </Link>
              </>
            ) : item.cite ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.cite}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

// ─── Секция «Контроль» (вопросы Коры) ────────────────────────────────────────

function ControlSection({
  isLoading,
  error,
  items,
  counts,
  onRetry,
}: {
  isLoading: boolean;
  error: unknown;
  items: ProbeControlItem[];
  counts:
    | { answered: number; read_silent: number; unseen: number; expired: number }
    | undefined;
  onRetry: () => void;
}) {
  return (
    <section className="mb-6 rounded-xl border border-border-subtle bg-bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <ListChecks size={16} className="text-accent" />
        <h2 className="text-sm font-semibold text-fg-primary">
          Контроль вопросов Коры
        </h2>
        {counts ? (
          <div className="ml-auto flex flex-wrap gap-1.5 text-[10px]">
            <ControlCountChip
              tone="info"
              label={`✅ ${counts.answered} ответили`}
            />
            <ControlCountChip
              tone="warning"
              label={`👁 ${counts.read_silent} молчат`}
            />
            <ControlCountChip
              tone="warning"
              label={`🔕 ${counts.unseen} не видели`}
            />
            <ControlCountChip
              tone="danger"
              label={`⏰ ${counts.expired} протухли`}
            />
          </div>
        ) : null}
      </div>

      <QueryGate
        isLoading={isLoading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={onRetry}
        empty={
          <EmptyState
            title="Нет открытых вопросов"
            description="Кора пока ни о чём не спрашивала команду."
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wide text-fg-tertiary">
                <th className="py-2 pr-3 font-medium">Вопрос</th>
                <th className="py-2 pr-3 font-medium">Кому</th>
                <th className="py-2 pr-3 font-medium">Висит</th>
                <th className="py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr
                  key={q.notificationId}
                  className="border-b border-border-subtle/60 last:border-0"
                >
                  <td className="max-w-md py-2.5 pr-3 align-top text-fg-primary">
                    <span className="line-clamp-2">{q.question}</span>
                  </td>
                  <td className="py-2.5 pr-3 align-top text-fg-secondary">
                    {q.recipientName ?? '—'}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 align-top text-fg-secondary">
                    {q.waitingDays > 0 ? `${q.waitingDays} дн` : 'сегодня'}
                  </td>
                  <td className="whitespace-nowrap py-2.5 align-top">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CHIP[q.stateTone]}`}
                    >
                      {q.stateIcon} {q.stateLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryGate>
    </section>
  );
}

function ControlCountChip({
  tone,
  label,
}: {
  tone: CoraFeedTone;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${TONE_CHIP[tone]}`}
    >
      {label}
    </span>
  );
}
