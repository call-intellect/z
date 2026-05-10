'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Minus,
  Plus,
  RefreshCcw,
  Sparkles,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { goalsApi } from '@/api/goals.api';
import { themesApi } from '@/api/themes.api';
import { useAuth } from '@/contexts/auth-context';
import {
  GOAL_STATUS_LABELS,
  GOAL_THEME_SOURCE_LABELS,
  alignmentBarColor,
  alignmentTextColor,
  daysUntil,
  deltaTone,
  formatAlignment,
  formatDelta,
  goalDetailFromApi,
  statusBadgeVariant,
  targetDateLabel,
  type GoalAlignmentSnapshotDomain,
  type GoalThemeLinkDomain,
} from '@/domain/goal';
import { themeFromApi } from '@/domain/theme';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { cn } from '@/ui/shadcn/lib/utils';

import { EditGoalDialog } from '../GoalsClient';

export function GoalDetailClient({ goalId }: { goalId: string }) {
  const { currentOrgId, currentOrgRole, isSuperAdmin } = useAuth();
  const isOwner = currentOrgRole === 'owner';
  const canRecompute = isOwner || currentOrgRole === 'admin' || isSuperAdmin;

  const swrKey = currentOrgId
    ? (['goal', currentOrgId, goalId] as const)
    : null;

  const { data, isLoading, error, mutate } = useSWR(
    swrKey,
    async ([, orgId, id]) => {
      const api = await goalsApi.get(orgId, id);
      return goalDetailFromApi(api);
    },
  );

  const [editOpen, setEditOpen] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [addThemesOpen, setAddThemesOpen] = useState(false);

  if (!currentOrgId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <p className="text-sm text-fg-tertiary">Не определена организация.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          {error instanceof ApiError ? error.message : 'Цель не найдена или у вас нет доступа.'}
        </div>
        <Button asChild variant="ghost" className="mt-3">
          <Link href="/goals">
            <ChevronLeft size={16} /> Все цели
          </Link>
        </Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8 text-fg-tertiary">
        <Loader2 size={14} className="mr-2 inline animate-spin" /> Загрузка…
      </div>
    );
  }

  const goal = data;
  const dDays = daysUntil(goal.targetDate);
  const overdue = dDays !== null && dDays < 0;
  const targetLabel = targetDateLabel(goal.targetDate);
  const alignmentClamped =
    goal.cachedAlignment === null
      ? null
      : Math.max(0, Math.min(100, goal.cachedAlignment));

  async function handleRecompute() {
    if (!currentOrgId || recomputing) return;
    setRecomputing(true);
    try {
      await goalsApi.recompute(currentOrgId, goal.id);
      toast.success('Пересчёт запущен — обновится через несколько секунд');
      // Через 5 сек обновляем (snapshot обычно за 5-10 сек).
      setTimeout(() => {
        void mutate();
      }, 5000);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'quota_exceeded') {
        toast.error('Quota exceeded — попробуйте завтра');
      } else {
        const msg = err instanceof ApiError ? err.message : 'Не удалось запустить';
        toast.error(msg);
      }
    } finally {
      setRecomputing(false);
    }
  }

  async function handleArchive() {
    if (!currentOrgId || archiving) return;
    if (!window.confirm('Архивировать цель? Она будет помечена как abandoned.')) {
      return;
    }
    setArchiving(true);
    try {
      await goalsApi.archive(currentOrgId, goal.id);
      toast.success('Цель архивирована');
      void mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось архивировать';
      toast.error(msg);
    } finally {
      setArchiving(false);
    }
  }

  async function handleRemoveTheme(themeId: string) {
    if (!currentOrgId) return;
    try {
      await goalsApi.removeTheme(currentOrgId, goal.id, themeId);
      toast.success('Тема отвязана');
      void mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось отвязать';
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="gap-1 text-fg-tertiary">
          <Link href="/goals">
            <ChevronLeft size={16} /> Все цели
          </Link>
        </Button>
      </div>

      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-accent/20 text-accent">
          <Target size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-fg-primary">
              {goal.name}
            </h1>
            <Badge variant={statusBadgeVariant(goal.status)}>
              {GOAL_STATUS_LABELS[goal.status]}
            </Badge>
            {targetLabel && (
              <span
                className={cn(
                  'text-xs',
                  overdue ? 'text-danger font-medium' : 'text-fg-tertiary',
                )}
              >
                {targetLabel}
              </span>
            )}
          </div>
          {goal.description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-fg-secondary">
              {goal.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRecompute && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRecompute()}
              disabled={recomputing}
            >
              {recomputing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCcw size={14} />
              )}
              <span className="ml-1.5">Пересчитать сейчас</span>
            </Button>
          )}
          {isOwner && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              Редактировать
            </Button>
          )}
          {isOwner && goal.status !== 'abandoned' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              onClick={() => void handleArchive()}
              disabled={archiving}
            >
              {archiving ? 'Архивируем…' : 'Архивировать'}
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Alignment card */}
        <section className="lg:col-span-2">
          <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
            <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
              Текущая согласованность
            </h2>
            <div className="flex flex-wrap items-center gap-4">
              <div
                className={cn(
                  'text-5xl font-semibold tabular-nums',
                  alignmentTextColor(alignmentClamped),
                )}
              >
                {formatAlignment(alignmentClamped)}
              </div>
              <DeltaPill delta={goal.cachedAlignmentDelta} />
              <div className="flex-1 min-w-[160px]">
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-overlay">
                  {alignmentClamped !== null && (
                    <div
                      className={cn(
                        'h-full rounded-full',
                        alignmentBarColor(alignmentClamped),
                      )}
                      style={{ width: `${alignmentClamped}%` }}
                    />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-fg-tertiary">
                  AI-индикатор движения, точность ±10 пунктов.
                </p>
              </div>
            </div>
            {alignmentClamped === null && (
              <p className="mt-3 text-sm text-fg-tertiary">
                Согласованность ещё не рассчитана. Дождитесь cron&apos;а
                04:00 или нажмите «Пересчитать сейчас».
              </p>
            )}
            {goal.latestSnapshot?.explanation && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-fg-secondary">
                {goal.latestSnapshot.explanation}
              </p>
            )}
            {goal.latestSnapshot?.alertPending && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Резкое падение согласованности. Проверьте темы цели и
                  обсудите с командой.
                </span>
              </div>
            )}
          </div>

          {/* Signals pro/contra */}
          {goal.latestSnapshot && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SignalsList
                title="Что движет к цели"
                items={goal.latestSnapshot.signals.pro}
                tone="success"
              />
              <SignalsList
                title="Что мешает"
                items={goal.latestSnapshot.signals.contra}
                tone="danger"
              />
            </div>
          )}

          {/* Timeline */}
          <div className="mt-6 rounded-xl border border-border-subtle bg-bg-elevated p-4">
            <h2 className="mb-3 text-sm font-medium text-fg-tertiary">
              Timeline согласованности
            </h2>
            {goal.timeline.length >= 3 ? (
              <TimelineChart snapshots={goal.timeline} />
            ) : (
              <p className="text-xs text-fg-tertiary">
                Недостаточно данных, нужно ≥3 snapshots.
              </p>
            )}

            {goal.timeline.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                  История snapshots ({goal.timeline.length})
                </h3>
                <ul className="flex flex-col divide-y divide-border-subtle">
                  {goal.timeline.slice(0, 30).map((s) => (
                    <SnapshotRow key={s.id} snapshot={s} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* Themes */}
        <aside>
          <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-fg-tertiary">
                Связанные темы ({goal.themes.length})
              </h2>
              {isOwner && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setAddThemesOpen(true)}
                >
                  <Plus size={12} /> Добавить
                </Button>
              )}
            </div>
            {goal.themes.length === 0 ? (
              <p className="text-sm text-fg-tertiary">
                Нет связанных тем. Подключите хотя бы одну — иначе AI не
                сможет оценить движение.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {goal.themes.map((t) => (
                  <ThemeLinkItem
                    key={t.themeId}
                    link={t}
                    canRemove={isOwner}
                    onRemove={() => void handleRemoveTheme(t.themeId)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {isOwner && (
        <EditGoalDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          orgId={currentOrgId}
          goal={goal}
          onUpdated={() => {
            setEditOpen(false);
            void mutate();
          }}
          onArchived={() => {
            setEditOpen(false);
            void mutate();
          }}
        />
      )}

      {isOwner && (
        <AddThemesDialog
          open={addThemesOpen}
          onOpenChange={setAddThemesOpen}
          orgId={currentOrgId}
          goalId={goal.id}
          existingThemeIds={goal.themes.map((t) => t.themeId)}
          onAdded={() => {
            setAddThemesOpen(false);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

// ─── Delta pill ─────────────────────────────────────────────────────────────

function DeltaPill({ delta }: { delta: number | null }) {
  const tone = deltaTone(delta);
  const text = formatDelta(delta);
  if (!tone || !text) return null;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'up' && 'bg-success/15 text-success',
        tone === 'down' && 'bg-danger/15 text-danger',
        tone === 'flat' && 'bg-bg-overlay text-fg-tertiary',
      )}
      title="Изменение относительно предыдущего snapshot"
    >
      {tone === 'up' && <ArrowUpRight size={12} />}
      {tone === 'down' && <ArrowDownRight size={12} />}
      {tone === 'flat' && <Minus size={12} />}
      {text}
    </div>
  );
}

// ─── Signals list ───────────────────────────────────────────────────────────

function SignalsList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'success' | 'danger';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        tone === 'success' && 'border-success/30 bg-success/5',
        tone === 'danger' && 'border-danger/30 bg-danger/5',
      )}
    >
      <h3
        className={cn(
          'mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {tone === 'success' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-fg-tertiary">Не зафиксировано</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm text-fg-secondary">
          {items.map((s, idx) => (
            <li key={idx} className="leading-snug">
              · {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Theme link ─────────────────────────────────────────────────────────────

function ThemeLinkItem({
  link,
  canRemove,
  onRemove,
}: {
  link: GoalThemeLinkDomain;
  canRemove: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border-subtle bg-bg-card p-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
        <Sparkles size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <Link
          href={`/themes/${encodeURIComponent(link.themeId)}`}
          className="block truncate text-sm font-medium text-fg-primary hover:underline"
        >
          {link.themeName}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-tertiary">
          <Badge variant="outline" className="text-[10px]">
            {GOAL_THEME_SOURCE_LABELS[link.source]}
          </Badge>
          <span>вес {link.weight.toFixed(2)}</span>
        </div>
      </div>
      {canRemove && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 text-fg-tertiary hover:text-danger"
          onClick={onRemove}
          aria-label="Отвязать тему"
        >
          <Trash2 size={12} />
        </Button>
      )}
    </li>
  );
}

// ─── Timeline chart (simple SVG) ────────────────────────────────────────────

function TimelineChart({
  snapshots,
}: {
  snapshots: GoalAlignmentSnapshotDomain[];
}) {
  // Снапшоты в API приходят DESC; для графика нужно ASC по времени.
  const series = useMemo(() => {
    return [...snapshots].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }, [snapshots]);

  if (series.length < 3) return null;

  const W = 600;
  const H = 140;
  const PADDING_X = 24;
  const PADDING_Y = 16;
  const innerW = W - 2 * PADDING_X;
  const innerH = H - 2 * PADDING_Y;
  const n = series.length;
  const xStep = innerW / Math.max(1, n - 1);

  const minScore = 0;
  const maxScore = 100;
  const yFor = (score: number) =>
    PADDING_Y + innerH - ((score - minScore) / (maxScore - minScore)) * innerH;
  const xFor = (i: number) => PADDING_X + i * xStep;

  const path = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(s.score).toFixed(1)}`)
    .join(' ');

  function pointColor(score: number): string {
    if (score < 40) return 'fill-danger';
    if (score < 70) return 'fill-warning';
    return 'fill-success';
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[140px] w-full min-w-[480px]"
        role="img"
        aria-label="График согласованности по дням"
      >
        {/* gridlines */}
        {[0, 40, 70, 100].map((g) => (
          <line
            key={g}
            x1={PADDING_X}
            x2={W - PADDING_X}
            y1={yFor(g)}
            y2={yFor(g)}
            className="stroke-border-subtle"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}
        {/* line */}
        <path
          d={path}
          className="fill-none stroke-fg-tertiary"
          strokeWidth={1.5}
        />
        {/* points */}
        {series.map((s, i) => (
          <circle
            key={s.id}
            cx={xFor(i)}
            cy={yFor(s.score)}
            r={3.5}
            className={pointColor(s.score)}
          >
            <title>
              {s.createdAt.toLocaleDateString('ru', {
                day: '2-digit',
                month: 'short',
              })}
              : {s.score}
              {s.delta !== null ? ` (Δ ${s.delta > 0 ? '+' : ''}${s.delta})` : ''}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// ─── Snapshot row ───────────────────────────────────────────────────────────

function SnapshotRow({ snapshot }: { snapshot: GoalAlignmentSnapshotDomain }) {
  const tone = deltaTone(snapshot.delta);
  const deltaText = formatDelta(snapshot.delta);
  const dateLabel = snapshot.createdAt.toLocaleDateString('ru', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <div className="w-24 shrink-0 text-xs text-fg-tertiary tabular-nums">
        {dateLabel}
      </div>
      <div
        className={cn(
          'w-12 shrink-0 text-right font-semibold tabular-nums',
          alignmentTextColor(snapshot.score),
        )}
      >
        {snapshot.score}
      </div>
      <div className="w-14 shrink-0 text-right text-xs">
        {tone && deltaText && (
          <span
            className={cn(
              tone === 'up' && 'text-success',
              tone === 'down' && 'text-danger',
              tone === 'flat' && 'text-fg-tertiary',
            )}
          >
            {deltaText}
          </span>
        )}
      </div>
      <div className="flex-1 line-clamp-2 text-xs text-fg-secondary">
        {snapshot.explanation || '—'}
      </div>
    </li>
  );
}

// ─── Add themes dialog ──────────────────────────────────────────────────────

function AddThemesDialog({
  open,
  onOpenChange,
  orgId,
  goalId,
  existingThemeIds,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  goalId: string;
  existingThemeIds: string[];
  onAdded: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Загрузка тем активных тем org для выбора (без X-Org-Id — themesApi
  // использует cookie session, но тут мы не передаём orgId. Это ОК — backend
  // сам определит tenantId из cookie/первой Org.).
  const { data: themesData, isLoading } = useSWR(
    open ? ['themes-for-goal', search] : null,
    async () => {
      const res = await themesApi.list({
        status: 'active',
        ...(search.trim() ? { q: search.trim() } : {}),
        limit: 50,
      });
      return res.items.map(themeFromApi);
    },
  );

  const themes = useMemo(() => themesData ?? [], [themesData]);

  const availableThemes = useMemo(() => {
    const existing = new Set(existingThemeIds);
    return themes.filter((t) => !existing.has(t.id));
  }, [themes, existingThemeIds]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (submitting) return;
    if (selected.size === 0) {
      toast.error('Выберите хотя бы одну тему');
      return;
    }
    setSubmitting(true);
    try {
      const res = await goalsApi.addThemes(orgId, goalId, {
        themeIds: Array.from(selected),
      });
      toast.success(
        `Добавлено: ${res.added}${res.skipped > 0 ? `, пропущено: ${res.skipped}` : ''}`,
      );
      setSelected(new Set());
      setSearch('');
      onAdded();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось добавить';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setSelected(new Set());
      setSearch('');
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить темы</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Поиск темы по названию"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border-subtle">
            {isLoading ? (
              <p className="p-3 text-sm text-fg-tertiary">Загрузка…</p>
            ) : availableThemes.length === 0 ? (
              <p className="p-3 text-sm text-fg-tertiary">
                Нет тем для добавления. Возможно, все уже привязаны.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {availableThemes.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => toggle(t.id)}
                      className={cn(
                        'flex w-full items-start gap-2 p-2 text-left text-sm transition-colors hover:bg-bg-overlay',
                        selected.has(t.id) && 'bg-accent/10',
                      )}
                    >
                      <div
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0 rounded border',
                          selected.has(t.id)
                            ? 'border-accent bg-accent'
                            : 'border-border',
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium text-fg-primary">
                          {t.name}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-fg-tertiary">
                          {t.blocksCount} блоков · {t.entitiesCount} сущностей
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[11px] text-fg-tertiary">
            Выбрано: {selected.size}. После сохранения запустите «Пересчитать
            сейчас», чтобы AI учёл новые темы.
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            type="button"
            disabled={submitting || selected.size === 0}
            onClick={() => void handleSubmit()}
          >
            {submitting ? 'Добавляем…' : `Добавить (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

