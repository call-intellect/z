'use client';

/**
 * `/sprints/[id]/review` — экран финального отчёта спринта.
 *
 * Источник: `GET /api/v1/cycles/:id/review` (discriminated union ready /
 * pending / failed). При pending — SWR с авто-refresh каждые 10с.
 */

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  Rocket,
  XCircle,
} from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { useAuth } from '@/contexts/auth-context';
import { sprintsApi } from '@/api/tracker/sprints.api';
import type { SprintReviewPayloadApi } from '@/domain/sprint';

export function SprintReviewClient({ cycleId }: { cycleId: string }) {
  const { currentOrgId } = useAuth();
  const key =
    currentOrgId && cycleId
      ? ['tracker.sprint.review', currentOrgId, cycleId]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!currentOrgId) throw new Error('orgId required');
      return sprintsApi.getReview(currentOrgId, cycleId);
    },
    {
      revalidateOnFocus: false,
      // При pending — авто-poll каждые 10с (см. ниже refreshInterval-функцию).
      refreshInterval: (latestData) =>
        latestData?.status === 'pending' ? 10_000 : 0,
    },
  );

  const [regenPending, setRegenPending] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const handleRegenerate = async () => {
    if (!currentOrgId) return;
    setRegenPending(true);
    setRegenError(null);
    try {
      await sprintsApi.regenerateReview(currentOrgId, cycleId);
      await swr.mutate();
    } catch (e) {
      setRegenError(
        e instanceof Error
          ? e.message
          : 'Не удалось перегенерировать отчёт. Попробуйте позже.',
      );
    } finally {
      setRegenPending(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <Link
            href={`/sprints/${encodeURIComponent(cycleId)}`}
            className="inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
          >
            <ArrowLeft size={12} />К дашборду спринта
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-fg-primary md:text-2xl">
            Итоги спринта
          </h1>
        </div>
      </header>

      {swr.isLoading || !swr.data ? (
        <SkeletonState />
      ) : swr.data.status === 'pending' ? (
        <PendingState />
      ) : swr.data.status === 'failed' ? (
        <FailedState
          error={swr.data.error}
          onRegenerate={() => void handleRegenerate()}
          regenPending={regenPending}
          regenError={regenError}
        />
      ) : (
        <ReadyState
          review={swr.data.review}
          cycleId={cycleId}
          onRegenerate={() => void handleRegenerate()}
          regenPending={regenPending}
          regenError={regenError}
        />
      )}
    </div>
  );
}

function SkeletonState() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      <div className="h-40 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
    </div>
  );
}

function PendingState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-6 py-10 text-center">
      <Loader2 size={28} className="animate-spin text-accent" />
      <div className="text-sm font-medium text-fg-primary">
        Генерируем отчёт…
      </div>
      <p className="max-w-md text-xs text-fg-tertiary">
        Помощник анализирует встречи и задачи спринта. Обычно это занимает
        от 30 секунд до нескольких минут. Страница обновится автоматически.
      </p>
    </div>
  );
}

function FailedState({
  error,
  onRegenerate,
  regenPending,
  regenError,
}: {
  error: string;
  onRegenerate: () => void;
  regenPending: boolean;
  regenError: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-danger/30 bg-danger/10 px-6 py-10 text-center">
      <XCircle size={28} className="text-danger" />
      <div className="text-sm font-medium text-fg-primary">
        Кора недоступна, попробуйте позже
      </div>
      <p className="text-xs text-fg-tertiary">Причина: {error}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={onRegenerate}
        disabled={regenPending}
        className="mt-2 gap-2"
      >
        {regenPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCcw size={14} />
        )}
        Сгенерировать ещё раз
      </Button>
      {regenError && <p className="text-xs text-danger">{regenError}</p>}
    </div>
  );
}

function ReadyState({
  review,
  cycleId,
  onRegenerate,
  regenPending,
  regenError,
}: {
  review: SprintReviewPayloadApi;
  cycleId: string;
  onRegenerate: () => void;
  regenPending: boolean;
  regenError: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Narrative */}
      <section className="rounded-md border border-border-subtle bg-bg-elevated p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
            <CheckCircle2 size={14} className="text-mint-500" />
            Резюме спринта
          </h2>
          <span className="text-[11px] text-fg-tertiary">
            Уверенность: {Math.round(review.confidence * 100)}%
          </span>
        </div>
        {review.goal && (
          <div className="mt-2 text-xs text-fg-tertiary">
            Цель: <span className="text-fg-secondary">{review.goal}</span>
          </div>
        )}
        <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-fg-primary">
          {review.narrative}
        </p>
      </section>

      {/* 4 списка: planned / completed / notCompleted / carriedOver */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ListBlock title="План" items={review.planned} />
        <ListBlock
          title="Готово"
          items={review.completed}
          accent="mint"
        />
        <ListBlock
          title="Не закрыто"
          items={review.notCompleted}
          accent="amber"
        />
        <ListBlock
          title="Перенесено"
          items={review.carriedOver}
          accent="slate"
        />
      </section>

      {/* Blockers / Reasons / Hints */}
      <section className="grid gap-3 md:grid-cols-3">
        <ListBlock
          title="Что мешало"
          items={review.blockers}
          accent="rose"
        />
        <ListBlock title="Почему не закрыто" items={review.reasons} />
        <ListBlock title="Подсказки помощника" items={review.hints} />
      </section>

      {/* Next plan candidates */}
      {review.nextPlanCandidates.length > 0 && (
        <section className="rounded-md border border-border-subtle bg-bg-elevated p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
            <Rocket size={14} className="text-accent" />
            Что взять в следующий спринт
          </h2>
          <ul className="mt-3 flex flex-col gap-1.5">
            {review.nextPlanCandidates.map((t, i) => (
              <li
                key={`${i}-${t.slice(0, 24)}`}
                className="text-sm text-fg-primary"
              >
                · {t}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button asChild variant="default" size="sm" className="gap-2">
              <Link href="/sprints">
                <Rocket size={14} />
                Создать спринт на основе плана
              </Link>
            </Button>
            <span className="text-[11px] text-fg-tertiary">
              Передача плана в мастер — в следующей итерации.
            </span>
          </div>
        </section>
      )}

      {/* Regenerate */}
      <section className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-fg-tertiary">
          Отчёт можно перегенерировать — например, если в спринт добавились
          новые встречи или задачи. Спринт ID: {cycleId.slice(0, 8)}…
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={regenPending}
            className="gap-2"
          >
            {regenPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCcw size={14} />
            )}
            Сгенерировать ещё раз
          </Button>
          {regenError && <p className="text-xs text-danger">{regenError}</p>}
        </div>
      </section>
    </div>
  );
}

function ListBlock({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent?: 'mint' | 'amber' | 'rose' | 'slate';
}) {
  const dotClass =
    accent === 'mint'
      ? 'bg-mint-500'
      : accent === 'amber'
        ? 'bg-amber-500'
        : accent === 'rose'
          ? 'bg-rose-500'
          : accent === 'slate'
            ? 'bg-slate-400'
            : 'bg-accent';
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {title} · {items.length}
      </h3>
      {items.length === 0 ? (
        <p className="text-[11px] text-fg-tertiary">—</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((t, i) => (
            <li
              key={`${i}-${t.slice(0, 32)}`}
              className="text-sm text-fg-primary"
            >
              · {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
