'use client';

/**
 * IntakeClient — расширенная страница триажа входящих задач
 * (Phase 3 frontend Sprint 6, ТЗ Фича 3).
 *
 * Главные отличия от существующего `IntakeBoard` (он используется внутри
 * проекта):
 *   - Глобальный inbox: все pending без фильтра по проекту.
 *   - Карточка показывает source-бейдж с иконкой, rawContent с разворотом,
 *     все suggested* поля как chip'ы и confidence-процент.
 *   - 4 действия: Принять / Отклонить (с reason-диалогом) / Отложить
 *     (с date-picker) / Дубликат (с поиском существующих задач).
 *   - Доступ только для owner / admin — у остальных читать можно, но
 *     кнопки заблокированы.
 *
 * Все строки — только русский (правило admin_ui_russian_only).
 */

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Inbox,
  Mail,
  MessageCircle,
  Mic2,
  PencilLine,
  Search,
  Tag,
  Target,
  User,
  X,
} from 'lucide-react';

import { mutate as globalMutate } from 'swr';

import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { useIntake } from '@/hooks/tracker/useIntake';
import { useProjects } from '@/hooks/tracker/useProjects';
import { intakeApi } from '@/api/tracker/intake.api';
import { humanizeApiError } from '@/api/api-error';
import {
  INTAKE_SOURCE_LABELS,
  INTAKE_STATUS_LABELS,
  ISSUE_PRIORITY_LABELS,
  intakeDisplayTitle,
  resolveAcceptTargetProjectId,
  type Intake,
  type IntakeSource,
  type IssuePriority,
  type TriageDecision,
} from '@/domain/tracker';
import { pluralRu } from '@/domain/contribution';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Textarea } from '@/ui/shadcn/textarea';
import { cn } from '@/ui/shadcn/lib/utils';

// ─── Source-иконки и эмоджи (mobile-friendly) ───────────────────────────────

const SOURCE_ICON: Record<IntakeSource, React.ReactNode> = {
  in_app: <PencilLine size={12} aria-hidden />,
  email: <Mail size={12} aria-hidden />,
  telegram: <MessageCircle size={12} aria-hidden />,
  checkin: <CheckCircle2 size={12} aria-hidden />,
  meeting: <Mic2 size={12} aria-hidden />,
  api: <Inbox size={12} aria-hidden />,
  concierge: <MessageCircle size={12} aria-hidden />,
};

// Эмоджи-префикс по ТЗ. Локализованы в источниках — текст бейджа уже
// русский (INTAKE_SOURCE_LABELS).
const SOURCE_EMOJI: Record<IntakeSource, string> = {
  in_app: '📝',
  email: '📧',
  telegram: '📞',
  checkin: '✅',
  meeting: '🎤',
  api: '📥',
  concierge: '💬',
};

// ─── Главный компонент ─────────────────────────────────────────────────────

export function IntakeClient() {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();
  const canTriage = currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const { intake, total, isLoading, error, mutate } = useIntake(currentOrgId, {
    status: 'pending',
    limit: 100,
  });

  const [busyId, setBusyId] = useState<string | null>(null);

  // ─── Состояния для диалогов «Отклонить» / «Отложить» / «Дубликат» ─────
  const [rejectingItem, setRejectingItem] = useState<Intake | null>(null);
  const [snoozingItem, setSnoozingItem] = useState<Intake | null>(null);
  const [duplicatingItem, setDuplicatingItem] = useState<Intake | null>(null);
  // Выбор проекта вручную, когда проект для accept не резолвится.
  const [pickingProjectFor, setPickingProjectFor] = useState<Intake | null>(
    null,
  );

  // ─── Триаж (single source of truth для accept без диалога) ────────────
  const triage = async (
    item: Intake,
    body: Parameters<typeof intakeApi.triage>[2],
  ): Promise<void> => {
    if (!currentOrgId) return;
    setBusyId(item.id);
    try {
      await intakeApi.triage(currentOrgId, item.id, body);
      await mutate();
      toast.success(triageSuccessMessage(body.decision));
      // A7: обновить бейдж «Входящие» (отдельный SWR-ключ счётчика).
      void globalMutate(
        (key) => Array.isArray(key) && key[0] === 'tracker.intake.count',
      );
    } catch (e) {
      toast.error(`Не удалось выполнить триаж: ${humanizeApiError(e, 'попробуйте ещё раз')}`, { duration: 5000 });
    } finally {
      setBusyId(null);
    }
  };

  const handleAccept = (item: Intake) => {
    const resolved = resolveAcceptTargetProjectId(item);
    if (resolved) {
      void triage(item, { decision: 'accept', targetProjectId: resolved });
    } else {
      // Проект не определён — спрашиваем у пользователя через пикер.
      setPickingProjectFor(item);
    }
  };

  // ─── Заглушки до загрузки ──────────────────────────────────────────────
  if (authLoading || !currentOrgId) {
    return (
      <PageShell>
        <div className="text-sm text-fg-tertiary">Загружаем аккаунт…</div>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
            />
          ))}
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Не удалось загрузить входящие. Обнови страницу.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell total={total}>
      {!canTriage && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertCircle size={14} aria-hidden />
          Только владелец или администратор организации могут принимать
          входящие. Ты видишь список в режиме просмотра.
        </div>
      )}

      {intake.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
          Входящих задач пока нет.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {intake.map((item) => (
            <IntakeCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              canTriage={canTriage}
              onAccept={() => void handleAccept(item)}
              onReject={() => setRejectingItem(item)}
              onSnooze={() => setSnoozingItem(item)}
              onDuplicate={() => setDuplicatingItem(item)}
            />
          ))}
        </ul>
      )}

      {/* ─── Диалоги ─────────────────────────────────────────────────── */}
      <RejectDialog
        item={rejectingItem}
        onClose={() => setRejectingItem(null)}
        onSubmit={(reason) => {
          if (!rejectingItem) return;
          const target = rejectingItem;
          setRejectingItem(null);
          void triage(target, {
            decision: 'reject',
            ...(reason ? { reason } : {}),
          });
        }}
      />
      <SnoozeDialog
        item={snoozingItem}
        onClose={() => setSnoozingItem(null)}
        onSubmit={(snoozedUntil) => {
          if (!snoozingItem) return;
          const target = snoozingItem;
          setSnoozingItem(null);
          void triage(target, { decision: 'snooze', snoozedUntil });
        }}
      />
      <DuplicateDialog
        item={duplicatingItem}
        onClose={() => setDuplicatingItem(null)}
        onSubmit={(duplicateOfIssueId) => {
          if (!duplicatingItem) return;
          const target = duplicatingItem;
          setDuplicatingItem(null);
          void triage(target, { decision: 'duplicate', duplicateOfIssueId });
        }}
      />
      <ProjectPickerDialog
        orgId={currentOrgId}
        item={pickingProjectFor}
        onClose={() => setPickingProjectFor(null)}
        onSelect={(projectId) => {
          if (!pickingProjectFor) return;
          const target = pickingProjectFor;
          setPickingProjectFor(null);
          void triage(target, { decision: 'accept', targetProjectId: projectId });
        }}
      />
    </PageShell>
  );
}

function triageSuccessMessage(decision: TriageDecision): string {
  switch (decision) {
    case 'accept':
      return 'Принято: задача создана.';
    case 'reject':
      return 'Входящая отклонена.';
    case 'snooze':
      return 'Входящая отложена.';
    case 'duplicate':
      return 'Помечено как дубликат.';
    default:
      return 'Готово.';
  }
}

// ─── Page shell (контейнер + heading) ───────────────────────────────────────

function PageShell({
  total,
  children,
}: {
  total?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <header className="mb-4 flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-bg-overlay">
          <Inbox size={18} className="text-fg-secondary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-fg-primary md:text-xl">
            Входящие
          </h1>
          <p className="text-xs text-fg-tertiary">
            Разбор входящих задач из писем, чатов, встреч и внешних сервисов. Кора
            заранее заполнила подсказки — ваша задача — подтвердить или поправить.
            {typeof total === 'number' && total > 0 ? (
              <>
                {' · '}
                <span className="text-fg-secondary">
                  {total} ожидает триажа
                </span>
              </>
            ) : null}
          </p>
        </div>
      </header>
      {children}
    </div>
  );
}

// ─── Карточка одной входящей ───────────────────────────────────────────────

function IntakeCard({
  item,
  busy,
  canTriage,
  onAccept,
  onReject,
  onSnooze,
  onDuplicate,
}: {
  item: Intake;
  busy: boolean;
  canTriage: boolean;
  onAccept: () => void;
  onReject: () => void;
  onSnooze: () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = intakeDisplayTitle(item);
  const raw = item.rawContent ?? '';
  const RAW_TRUNCATE = 200;
  const showExpand = raw.length > RAW_TRUNCATE;
  const rawDisplay = expanded ? raw : raw.slice(0, RAW_TRUNCATE);

  const confidencePct =
    item.confidence !== null
      ? Math.round(Math.max(0, Math.min(1, item.confidence)) * 100)
      : null;

  // Признаки наличия suggested-полей — рисуем chip только когда есть данные.
  const hasAnySuggestion =
    item.suggestedProjectId !== null ||
    item.suggestedAssigneeId !== null ||
    item.suggestedDueDate !== null ||
    item.suggestedGoalId !== null ||
    item.suggestedPriority !== null ||
    (item.suggestedLabels && item.suggestedLabels.length > 0) ||
    confidencePct !== null;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-3 md:p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <span aria-hidden>{SOURCE_EMOJI[item.source]}</span>
          {SOURCE_ICON[item.source]}
          {INTAKE_SOURCE_LABELS[item.source]}
        </Badge>
        <Badge variant="secondary">{INTAKE_STATUS_LABELS[item.status]}</Badge>
        {item.sourceEmail && (
          <span className="truncate text-xs text-fg-tertiary">
            {item.sourceEmail}
          </span>
        )}
        <span className="ml-auto text-[11px] text-fg-tertiary">
          {item.createdAt.toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </header>

      <div>
        <h3 className="text-sm font-medium text-fg-primary">{title}</h3>
        {raw.length > 0 && (
          <div className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-secondary">
            {rawDisplay}
            {!expanded && showExpand && '… '}
            {showExpand && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-1 text-xs text-accent hover:underline"
              >
                {expanded ? 'свернуть' : 'развернуть'}
              </button>
            )}
          </div>
        )}
      </div>

      {hasAnySuggestion && (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.suggestedProjectId && (
            <SuggestionChip>
              📌 Проект «{item.suggestedProjectName ?? 'без названия'}»
            </SuggestionChip>
          )}
          {item.suggestedAssigneeId && (
            <SuggestionChip>
              <User size={11} aria-hidden />
              Исполнитель {item.suggestedAssigneeName ?? 'не определён'}
            </SuggestionChip>
          )}
          {item.suggestedDueDate && (
            <SuggestionChip>
              📅 Срок{' '}
              {item.suggestedDueDate.toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'short',
              })}
            </SuggestionChip>
          )}
          {item.suggestedGoalId && (
            <SuggestionChip>
              <Target size={11} aria-hidden />
              Цель «{item.suggestedGoalTitle ?? 'без названия'}»
            </SuggestionChip>
          )}
          {item.suggestedPriority && (
            <SuggestionChip>
              🔺 Приоритет «
              {ISSUE_PRIORITY_LABELS[item.suggestedPriority as IssuePriority]}»
            </SuggestionChip>
          )}
          {item.suggestedLabels && item.suggestedLabels.length > 0 && (
            <SuggestionChip>
              <Tag size={11} aria-hidden />
              {pluralRu(item.suggestedLabels.length, 'метка', 'метки', 'меток')}
            </SuggestionChip>
          )}
          {confidencePct !== null && (
            <SuggestionChip muted>
              уверенность {confidencePct}%
            </SuggestionChip>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="default"
          disabled={busy || !canTriage}
          onClick={onAccept}
          className="gap-1"
        >
          <CheckCircle2 size={12} aria-hidden /> Принять
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !canTriage}
          onClick={onSnooze}
          className="gap-1"
        >
          <Clock size={12} aria-hidden /> Отложить
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !canTriage}
          onClick={onDuplicate}
          className="gap-1"
        >
          <Copy size={12} aria-hidden /> Дубликат
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !canTriage}
          onClick={onReject}
          className="gap-1 text-danger"
        >
          <X size={12} aria-hidden /> Отклонить
        </Button>
      </footer>
    </li>
  );
}

function SuggestionChip({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]',
        muted
          ? 'border-border-subtle bg-bg-overlay text-fg-tertiary'
          : 'border-accent-border bg-accent-muted text-accent-fg',
      )}
    >
      {children}
    </span>
  );
}

// ─── Reject dialog ──────────────────────────────────────────────────────────

function RejectDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: Intake | null;
  onClose: () => void;
  onSubmit: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState('');

  // Reset при открытии/закрытии.
  const open = item !== null;
  useResetOnOpen(open, () => setReason(''));

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отклонить входящую</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-secondary">
          Укажи причину — она сохранится в истории intake. Можно оставить
          пустой.
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Не подходит под цели команды, дубль, спам и т. п."
          rows={3}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="default"
            onClick={() => onSubmit(reason.trim() || null)}
          >
            Отклонить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Snooze dialog (date-picker) ───────────────────────────────────────────

function SnoozeDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: Intake | null;
  onClose: () => void;
  onSubmit: (snoozedUntil: string) => void;
}) {
  // Default = завтра, 09:00 локально.
  const defaultDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toLocalInput(d);
  }, []);
  const [value, setValue] = useState(defaultDate);
  const open = item !== null;
  useResetOnOpen(open, () => setValue(defaultDate));

  if (!item) return null;

  const submit = () => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    onSubmit(parsed.toISOString());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отложить входящую</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-secondary">
          Когда вернуть её в список ожидания?
        </p>
        <Input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="default" onClick={submit}>
            Отложить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInput(d: Date): string {
  // datetime-local требует формат YYYY-MM-DDTHH:mm без таймзоны.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Duplicate dialog ───────────────────────────────────────────────────────
// Минимальная версия: пользователь вводит id или identifier существующей
// задачи. Полноценный поиск с autocomplete — задача отдельного спринта
// (это требует дополнительного API search /issues).

function DuplicateDialog({
  item,
  onClose,
  onSubmit,
}: {
  item: Intake | null;
  onClose: () => void;
  onSubmit: (duplicateOfIssueId: string) => void;
}) {
  const [value, setValue] = useState('');
  const open = item !== null;
  useResetOnOpen(open, () => setValue(''));

  if (!item) return null;

  const trimmed = value.trim();
  const submitDisabled = trimmed.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пометить как дубликат</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-secondary">
          Укажи id или идентификатор задачи (например, `KORA-123`), которой
          эта входящая дублирует. Поиск с подсказками появится в следующем
          обновлении.
        </p>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="KORA-123 или uuid задачи"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="default"
            disabled={submitDisabled}
            onClick={() => onSubmit(trimmed)}
          >
            Это дубликат
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Project picker dialog ──────────────────────────────────────────────────
// Открывается при accept, когда проект для входящей не определён
// (ни явного projectId, ни suggestedProjectId). Пользователь выбирает проект,
// в который создать задачу.

function ProjectPickerDialog({
  orgId,
  item,
  onClose,
  onSelect,
}: {
  orgId: string;
  item: Intake | null;
  onClose: () => void;
  onSelect: (projectId: string) => void;
}) {
  const open = item !== null;
  const [query, setQuery] = useState('');
  useResetOnOpen(open, () => setQuery(''));

  // Хук вызывается всегда (rules-of-hooks); ключ null, пока диалог закрыт.
  const { projects, isLoading } = useProjects(open ? orgId : null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  if (item === null) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Выбор проекта</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-fg-secondary">
          Для этой входящей не определён проект. Выберите, куда создать задачу.
        </p>
        <div className="relative">
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск проекта…"
            className="pl-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border-subtle">
          {isLoading ? (
            <div className="px-3 py-6 text-center text-sm text-fg-tertiary">
              Загружаем проекты…
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-fg-tertiary">
              Проекты не найдены.
            </div>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(project.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-primary hover:bg-bg-overlay"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {project.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-fg-tertiary">
                      {project.identifier}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Local helper: reset state on dialog open ───────────────────────────────

function useResetOnOpen(open: boolean, reset: () => void): void {
  // Простая реализация без useEffect-зависимостей: ловим переход open
  // false → true и в этот момент сбрасываем форму. Хук всегда вызывается
  // в одном и том же порядке, поэтому rules-of-hooks не нарушаются.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) reset();
  }
}
