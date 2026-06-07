'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  ArrowDownRight,
  ArrowUpRight,
  List,
  Loader2,
  Minus,
  Network,
  Plus,
  Sparkles,
  Target,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';

import { ApiError } from '@/api/api-error';
import { goalsApi } from '@/api/goals.api';
import { usePersons } from '@/hooks/usePersons';
import { useAuth } from '@/contexts/auth-context';
import {
  CONFIDENCE_LEVEL_LABELS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_VALUES,
  alignmentBarColor,
  alignmentTextColor,
  buildTree,
  confidenceChipClasses,
  confidenceLevel,
  daysUntil,
  deltaTone,
  formatAlignment,
  formatDelta,
  goalFromApi,
  movementVerdict,
  movementVerdictChipClasses,
  statusBadgeVariant,
  targetDateLabel,
  type ConfidenceLevel,
  type GoalDomain,
  type GoalStatus,
} from '@/domain/goal';
import { GoalsTreeView } from './GoalsTreeView';
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
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';
import { cn } from '@/ui/shadcn/lib/utils';

type StatusFilter = GoalStatus | 'all';
type ViewMode = 'list' | 'tree';

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'paused', label: 'На паузе' },
  { value: 'achieved', label: 'Достигнутые' },
  { value: 'abandoned', label: 'Архив' },
];

export function GoalsClient() {
  const { currentOrgId, currentOrgRole } = useAuth();
  const isOwner = currentOrgRole === 'owner';

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalDomain | null>(null);

  // Debounce поиска по имени.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const swrKey = currentOrgId
    ? (['goals', currentOrgId, statusFilter] as const)
    : null;

  const { data, isLoading, error, mutate } = useSWR(
    swrKey,
    async ([, orgId, status]) => {
      const res = await goalsApi.list(orgId, {
        status,
        limit: 100,
      });
      return res.items.map(goalFromApi);
    },
  );

  const goals = useMemo(() => data ?? [], [data]);

  const filteredGoals = useMemo(() => {
    if (!debouncedSearch) return goals;
    const needle = debouncedSearch.toLowerCase();
    return goals.filter((g) => g.name.toLowerCase().includes(needle));
  }, [goals, debouncedSearch]);

  // Дерево строим из всех загруженных целей (по текущему статус-фильтру),
  // игнорируя поиск по названию — иначе фильтр обрезал бы родителей и ломал
  // иерархию (сирота → корень в buildTree).
  const tree = useMemo(() => buildTree(goals), [goals]);

  if (!currentOrgId) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <p className="text-sm text-fg-tertiary">
          Не определена организация. Перейдите на главную.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg-primary">
            <Target size={22} className="text-accent" />
            Цели компании
          </h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            Кора оценивает движение компании к каждой цели по связанным темам и
            свежим сигналам. Раз в сутки — суточный пересчёт.
          </p>
        </div>
        {isOwner && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus size={16} /> Создать цель
          </Button>
        )}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {viewMode === 'list' && (
          <Input
            placeholder="Поиск по названию"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-xs"
          />
        )}
        <div className="ml-auto inline-flex items-center rounded-md border border-border-subtle bg-bg-card p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1 transition-colors',
              viewMode === 'list'
                ? 'bg-accent text-accent-fg'
                : 'text-fg-secondary hover:text-fg-primary',
            )}
            aria-pressed={viewMode === 'list'}
          >
            <List size={14} />
            Список
          </button>
          <button
            type="button"
            onClick={() => setViewMode('tree')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm px-3 py-1 transition-colors',
              viewMode === 'tree'
                ? 'bg-accent text-accent-fg'
                : 'text-fg-secondary hover:text-fg-primary',
            )}
            aria-pressed={viewMode === 'tree'}
          >
            <Network size={14} />
            Дерево
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error instanceof ApiError ? error.message : 'Не удалось загрузить цели'}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-fg-tertiary">
          <Loader2 size={14} className="animate-spin" /> Загрузка…
        </div>
      ) : viewMode === 'tree' ? (
        goals.length === 0 ? (
          <EmptyState isOwner={isOwner} />
        ) : (
          <GoalsTreeView nodes={tree} />
        )
      ) : filteredGoals.length === 0 ? (
        <EmptyState isOwner={isOwner} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredGoals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              canEdit={isOwner}
              onEdit={() => setEditingGoal(g)}
            />
          ))}
        </ul>
      )}

      {isOwner && (
        <CreateGoalDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          orgId={currentOrgId}
          onCreated={() => {
            void mutate();
          }}
        />
      )}

      {isOwner && editingGoal && (
        <EditGoalDialog
          open={editingGoal !== null}
          onOpenChange={(v) => {
            if (!v) setEditingGoal(null);
          }}
          orgId={currentOrgId}
          goal={editingGoal}
          onUpdated={() => {
            setEditingGoal(null);
            void mutate();
          }}
          onArchived={() => {
            setEditingGoal(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-subtle px-6 py-16 text-center">
      <Target
        size={42}
        strokeWidth={1.5}
        className="mb-3 text-fg-tertiary"
      />
      <h3 className="mb-2 text-lg font-medium">Нет целей по этому фильтру</h3>
      <p className="max-w-md text-sm text-fg-tertiary">
        {isOwner
          ? 'Цели компании не заданы. Owner может создать первую цель — это включит еженедельный мониторинг движения компании к стратегии.'
          : 'Цели компании не заданы. Только владелец Org может создавать цели.'}
      </p>
    </div>
  );
}

// ─── Goal card ──────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  canEdit,
  onEdit,
}: {
  goal: GoalDomain;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const dDays = daysUntil(goal.targetDate);
  const targetLabel = targetDateLabel(goal.targetDate);
  const overdueTarget = dDays !== null && dDays < 0;
  const alignmentClamped =
    goal.cachedAlignment === null
      ? null
      : Math.max(0, Math.min(100, goal.cachedAlignment));
  const tone = deltaTone(goal.cachedAlignmentDelta);
  const deltaText = formatDelta(goal.cachedAlignmentDelta);
  const confLevel: ConfidenceLevel = confidenceLevel(
    goal.themesCount,
    goal.blocksCount,
  );
  const confChip = confidenceChipClasses(confLevel);
  const verdict = movementVerdict(goal.cachedAlignment, goal.progressStatus);
  const verdictChip = movementVerdictChipClasses(verdict.tone);

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-bg-elevated p-4 transition-colors hover:border-accent/60">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/goals/${encodeURIComponent(goal.id)}`}
          className="flex-1 min-w-0"
        >
          <h3 className="truncate text-base font-medium text-fg-primary">
            {goal.name}
          </h3>
        </Link>
        <Badge variant={statusBadgeVariant(goal.status)} className="shrink-0">
          {GOAL_STATUS_LABELS[goal.status]}
        </Badge>
      </div>

      {(goal.source === 'ai' || goal.promotionState === 'suggested') && (
        <SuggestedByKoraBadge />
      )}

      {goal.description && (
        <p className="line-clamp-3 text-sm text-fg-secondary">
          {goal.description.length > 200
            ? `${goal.description.slice(0, 200)}…`
            : goal.description}
        </p>
      )}

      <div>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
            verdictChip.bg,
            verdictChip.fg,
          )}
        >
          {verdict.label}
        </span>
      </div>

      {/* Alignment progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-fg-tertiary">Согласованность</span>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'tabular-nums font-semibold',
                alignmentTextColor(alignmentClamped),
              )}
            >
              {formatAlignment(alignmentClamped)}
            </span>
            {tone && deltaText && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-[11px] tabular-nums',
                  tone === 'up' && 'text-success',
                  tone === 'down' && 'text-danger',
                  tone === 'flat' && 'text-fg-tertiary',
                )}
              >
                {tone === 'up' && <ArrowUpRight size={10} />}
                {tone === 'down' && <ArrowDownRight size={10} />}
                {tone === 'flat' && <Minus size={10} />}
                {deltaText}
              </span>
            )}
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-overlay">
          {alignmentClamped !== null ? (
            <div
              className={cn('h-full rounded-full', alignmentBarColor(alignmentClamped))}
              style={{ width: `${alignmentClamped}%` }}
            />
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-fg-tertiary">Достоверность:</span>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
              confChip.bg,
              confChip.fg,
            )}
          >
            {CONFIDENCE_LEVEL_LABELS[confLevel]}
          </span>
        </div>
        {alignmentClamped === null && (
          <p className="text-[11px] text-fg-tertiary">
            Пока не рассчитано. Кора обновляет оценку каждую ночь, либо
            нажмите «Пересчитать» внутри цели.
          </p>
        )}
      </div>

      {goal.ownerPersonName && (
        <div className="flex items-center gap-1 text-xs text-fg-tertiary">
          <span className="text-fg-tertiary">Ответственный:</span>
          <span className="font-medium text-fg-secondary">{goal.ownerPersonName}</span>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between text-xs text-fg-tertiary">
        <span>
          {goal.themesCount} {pluralizeRu(goal.themesCount, ['тема', 'темы', 'тем'])}
        </span>
        {targetLabel && (
          <span className={cn(overdueTarget && 'text-danger font-medium')}>
            {targetLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="flex-1 justify-center"
        >
          <Link href={`/goals/${encodeURIComponent(goal.id)}`}>Открыть</Link>
        </Button>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            Редактировать
          </Button>
        )}
      </div>
    </li>
  );
}

/** Маркер AI-кандидата цели. Парные токены chip-info (bg + fg). */
function SuggestedByKoraBadge() {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-chip-info-bg px-2 py-0.5 text-[11px] font-medium text-chip-info-fg">
      <Sparkles size={11} />
      Предложено Корой
    </span>
  );
}

function pluralizeRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

// ─── Create goal dialog ─────────────────────────────────────────────────────

function CreateGoalDialog({
  open,
  onOpenChange,
  orgId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [weight, setWeight] = useState('1');
  const [ownerPersonId, setOwnerPersonId] = useState('__none__');
  const [submitting, setSubmitting] = useState(false);
  const { persons } = usePersons(orgId);

  function reset() {
    setName('');
    setDescription('');
    setTargetDate('');
    setWeight('1');
    setOwnerPersonId('__none__');
  }

  function handleOpenChange(v: boolean) {
    if (v) reset();
    onOpenChange(v);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim() || !description.trim()) {
      toast.error('Укажите название и описание');
      return;
    }
    const w = Number(weight);
    if (Number.isNaN(w) || w < 0.001 || w > 1) {
      toast.error('Вес должен быть в диапазоне 0.001..1.0');
      return;
    }
    setSubmitting(true);
    try {
      const targetIso = targetDate
        ? new Date(`${targetDate}T00:00:00.000Z`).toISOString()
        : null;
      await goalsApi.create(orgId, {
        name: name.trim(),
        description: description.trim(),
        ...(targetIso ? { targetDate: targetIso } : {}),
        weight: w,
        ...(ownerPersonId !== '__none__' ? { ownerPersonId } : {}),
      });
      toast.success('Цель создана');
      onOpenChange(false);
      onCreated();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось создать цель';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Создать цель</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="goal-create-name">Название</Label>
            <Input
              id="goal-create-name"
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="goal-create-desc">Описание</Label>
            <Textarea
              id="goal-create-desc"
              required
              maxLength={2000}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что именно вы хотите достичь и зачем."
            />
            <p className="mt-1 text-[11px] text-fg-tertiary">
              {description.length} / 2000
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="goal-create-target">Дедлайн (опц.)</Label>
              <Input
                id="goal-create-target"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="goal-create-weight">Вес (0.001 — 1.0)</Label>
              <Input
                id="goal-create-weight"
                type="number"
                min={0.001}
                max={1}
                step={0.05}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="goal-create-owner">Ответственный (опц.)</Label>
            <Select value={ownerPersonId} onValueChange={setOwnerPersonId}>
              <SelectTrigger id="goal-create-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Не назначен</SelectItem>
                {persons.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName || 'Без имени'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Сохраняем…' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit goal dialog ───────────────────────────────────────────────────────

function EditGoalDialog({
  open,
  onOpenChange,
  orgId,
  goal,
  onUpdated,
  onArchived,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orgId: string;
  goal: GoalDomain;
  onUpdated: () => void;
  onArchived: () => void;
}) {
  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description);
  const [targetDate, setTargetDate] = useState(
    goal.targetDate ? formatDateInput(goal.targetDate) : '',
  );
  const [status, setStatus] = useState<GoalStatus>(goal.status);
  const [weight, setWeight] = useState(String(goal.weight));
  const [ownerPersonId, setOwnerPersonId] = useState(
    goal.ownerPersonId ?? '__none__',
  );
  const [submitting, setSubmitting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const { persons } = usePersons(orgId);

  // Сброс на текущие значения при открытии.
  const lastGoalIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && lastGoalIdRef.current !== goal.id) {
      lastGoalIdRef.current = goal.id;
      setName(goal.name);
      setDescription(goal.description);
      setTargetDate(goal.targetDate ? formatDateInput(goal.targetDate) : '');
      setStatus(goal.status);
      setWeight(String(goal.weight));
      setOwnerPersonId(goal.ownerPersonId ?? '__none__');
    }
  }, [open, goal]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim() || !description.trim()) {
      toast.error('Название и описание обязательны');
      return;
    }
    const w = Number(weight);
    if (Number.isNaN(w) || w < 0.001 || w > 1) {
      toast.error('Вес должен быть 0.001..1.0');
      return;
    }
    setSubmitting(true);
    try {
      const targetIso = targetDate
        ? new Date(`${targetDate}T00:00:00.000Z`).toISOString()
        : null;
      await goalsApi.update(orgId, goal.id, {
        name: name.trim(),
        description: description.trim(),
        targetDate: targetIso,
        weight: w,
        status,
        ownerPersonId: ownerPersonId === '__none__' ? null : ownerPersonId,
      });
      toast.success('Цель обновлена');
      onUpdated();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось обновить';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive() {
    if (archiving) return;
    const ok = await ask({
      title: 'Архивировать цель?',
      description: 'Она будет помечена как abandoned.',
      confirmLabel: 'Архивировать',
      destructive: true,
    });
    if (!ok) return;
    setArchiving(true);
    try {
      await goalsApi.archive(orgId, goal.id);
      toast.success('Цель архивирована');
      onArchived();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось архивировать';
      toast.error(msg);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактировать цель</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="goal-edit-name">Название</Label>
            <Input
              id="goal-edit-name"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="goal-edit-desc">Описание</Label>
            <Textarea
              id="goal-edit-desc"
              required
              maxLength={2000}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-fg-tertiary">
              {description.length} / 2000
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="goal-edit-target">Дедлайн</Label>
              <Input
                id="goal-edit-target"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="goal-edit-weight">Вес</Label>
              <Input
                id="goal-edit-weight"
                type="number"
                min={0.001}
                max={1}
                step={0.05}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Статус</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as GoalStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_STATUS_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {GOAL_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="goal-edit-owner">Ответственный (опц.)</Label>
            <Select value={ownerPersonId} onValueChange={setOwnerPersonId}>
              <SelectTrigger id="goal-edit-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Не назначен</SelectItem>
                {persons.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName || 'Без имени'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="text-danger hover:text-danger"
              disabled={archiving || submitting}
              onClick={() => void handleArchive()}
            >
              {archiving ? 'Архивируем…' : 'Архивировать'}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting || archiving}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={submitting || archiving}>
                {submitting ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
      {confirmDialog}
    </Dialog>
  );
}

function formatDateInput(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Экспорт служебных компонентов для overlay-страниц.
export { EditGoalDialog };
