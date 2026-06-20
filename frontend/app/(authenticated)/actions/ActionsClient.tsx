"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  GitMerge,
  HelpCircle,
  Inbox,
  ListTodo,
  Mic,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  CardTitle,
  GlassCard,
  GRAD,
  MODERN_PAGE_BG,
} from "@/ui/components/dashboard/modern";
import { Button } from "@/ui/shadcn/button";
import { Badge } from "@/ui/shadcn/badge";
import { Textarea } from "@/ui/shadcn/textarea";
import { Progress } from "@/ui/shadcn/progress";

import { humanizeApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { usePendingActions } from "@/hooks/usePendingActions";
import { usePendingActionsCount } from "@/hooks/usePendingActionsCount";
import {
  formatPendingCite,
  formatPendingPriority,
  formatPendingWait,
  type PendingAction,
  type PendingActionCite,
} from "@/domain/pending-action";

function WaitChip({ ageDays }: { ageDays: number }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {formatPendingWait(ageDays)}
    </Badge>
  );
}

function PriorityChip({ severity }: { severity: PendingAction["severity"] }) {
  return (
    <Badge variant={severity === "urgent" ? "danger" : "warning"}>
      {formatPendingPriority(severity)}
    </Badge>
  );
}

function CiteChip({ cite }: { cite?: PendingActionCite }) {
  const text = formatPendingCite(cite);
  if (!text) return null;
  return (
    <Badge variant="default" className="font-normal">
      {text}
    </Badge>
  );
}

interface CardProps {
  action: PendingAction;
  onConfirm: (
    action: PendingAction,
    resolve?: {
      resolution?:
        | "keep_old"
        | "accept_new"
        | "merge"
        | "accept"
        | "reject"
        | "approve";
      answerText?: string;
    },
  ) => Promise<void>;
  onSnooze: (action: PendingAction, hours: number) => Promise<void>;
  onOpen: (action: PendingAction) => void;
}

function isTechnicalContext(ctx: string): boolean {
  if (ctx.includes("CompanyProfile")) return true;
  if (ctx.includes("(Document)")) return true;
  if (ctx.includes("без Mission")) return true;
  if (/«[a-z0-9]{20,}»/.test(ctx)) return true;
  return false;
}

function ProbeCard({ action, onConfirm, onSnooze }: CardProps) {
  const d = action.detail?.kind === "probe" ? action.detail : undefined;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const question = d?.question ?? action.title;
  const cite: PendingActionCite | undefined =
    d?.cite ?? (d?.meetingTitle ? { meetingTitle: d.meetingTitle } : undefined);

  const handleAnswer = async () => {
    const answer = text.trim();
    if (!answer || busy) return;
    setBusy(true);
    try {
      await onConfirm(action, { answerText: answer });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      <CardTitle icon={<HelpCircle size={17} />} grad={GRAD.amber}>
        {question}
      </CardTitle>

      {d?.context && !isTechnicalContext(d.context) && (
        <p className="text-sm leading-relaxed text-fg-secondary">{d.context}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <CiteChip cite={cite} />
        <PriorityChip severity={action.severity} />
        <WaitChip ageDays={action.ageDays} />
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ответьте своими словами — например: «Отвечает Петров, Иванов помогает с тестами»"
        className="min-h-[64px]"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!text.trim() || busy}
          onClick={() => void handleAnswer()}
        >
          Ответить
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void onSnooze(action, 72)}
        >
          Пропустить
        </Button>
        <span className="ml-auto flex items-center gap-1 text-[11.5px] text-fg-tertiary">
          <Mic size={13} className="opacity-70" />
          или надиктуйте голосом
        </span>
      </div>
    </GlassCard>
  );
}

function ConflictCard({ action, onConfirm }: CardProps) {
  const d = action.detail?.kind === "conflict" ? action.detail : undefined;
  const [busy, setBusy] = useState(false);

  const resolve = async (resolution: "keep_old" | "accept_new" | "merge") => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(action, { resolution });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      <CardTitle icon={<AlertTriangle size={17} />} grad={GRAD.pink}>
        {action.title}
      </CardTitle>

      {d?.summary && (
        <p className="text-sm leading-relaxed text-fg-secondary">{d.summary}</p>
      )}

      {d && (
        <div className="grid gap-3 sm:grid-cols-2">
          {}
          <div className="rounded-xl border border-border-subtle bg-bg-overlay/40 p-4">
            <Badge variant="secondary" className="mb-2 font-normal">
              старая{d.oldVersion.date ? ` · ${d.oldVersion.date}` : ""}
            </Badge>
            <p className="text-[13.5px] leading-relaxed text-fg-primary">
              {d.oldVersion.text}
            </p>
            {formatPendingCite(d.oldVersion.cite) && (
              <p className="mt-2 text-[11.5px] text-fg-tertiary">
                источник: {formatPendingCite(d.oldVersion.cite)}
              </p>
            )}
          </div>
          {}
          <div className="rounded-xl border border-success/30 bg-success/10 p-4">
            <Badge variant="success" className="mb-2 font-normal">
              новая{d.newVersion.date ? ` · ${d.newVersion.date}` : ""}
            </Badge>
            <p className="text-[13.5px] leading-relaxed text-fg-primary">
              {d.newVersion.text}
            </p>
            {formatPendingCite(d.newVersion.cite) && (
              <p className="mt-2 text-[11.5px] text-fg-tertiary">
                источник: {formatPendingCite(d.newVersion.cite)}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityChip severity={action.severity} />
        <WaitChip ageDays={action.ageDays} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void resolve("keep_old")}
        >
          Оставить старую
        </Button>
        <Button
          size="sm"
          className="gap-1 bg-success text-success-fg hover:bg-success/90"
          disabled={busy}
          onClick={() => void resolve("accept_new")}
        >
          Принять новую
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={busy}
          onClick={() => void resolve("merge")}
        >
          <GitMerge size={14} />
          Объединить обе
        </Button>
      </div>
    </GlassCard>
  );
}

function IntakeCard({ action, onConfirm }: CardProps) {
  const d = action.detail?.kind === "intake" ? action.detail : undefined;
  const [busy, setBusy] = useState(false);

  const title = d?.title ?? action.title;
  const cite = d?.cite;
  const confidence = d?.confidencePct;

  const resolve = async (resolution: "accept" | "reject") => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(action, { resolution });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      <CardTitle icon={<ListTodo size={17} />} grad={GRAD.blue}>
        {title}
      </CardTitle>

      {d?.description && (
        <p className="text-sm leading-relaxed text-fg-secondary">
          {d.description}
        </p>
      )}

      {(d?.assigneeName || d?.dueLabel) && (
        <p className="text-sm text-fg-secondary">
          {d?.assigneeName && (
            <span className="font-medium text-fg-primary">
              Исполнитель: {d.assigneeName}
            </span>
          )}
          {d?.assigneeName && d?.dueLabel && (
            <span className="text-fg-tertiary"> · </span>
          )}
          {d?.dueLabel && (
            <span className="text-fg-tertiary">срок: {d.dueLabel}</span>
          )}
        </p>
      )}

      {confidence != null && (
        <div className="flex items-center gap-2.5">
          <span className="whitespace-nowrap text-xs text-fg-tertiary">
            Уверенность Коры
          </span>
          <Progress value={confidence} className="h-2 flex-1" />
          <span className="text-[13px] font-semibold text-fg-primary">
            {confidence}%
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <CiteChip cite={cite} />
        <WaitChip ageDays={action.ageDays} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void resolve("accept")}
        >
          В задачи
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-danger hover:text-danger"
          disabled={busy}
          onClick={() => void resolve("reject")}
        >
          Отклонить
        </Button>
      </div>
    </GlassCard>
  );
}

function CurationCard({ action, onConfirm, onOpen }: CardProps) {
  const d = action.detail?.kind === "curation" ? action.detail : undefined;
  const [busy, setBusy] = useState(false);

  const title = d?.cardTitle ?? action.title;
  const cite = d?.cite;
  const closingSoon = action.severity === "urgent" || action.ageDays >= 14;

  const resolve = async (resolution: "approve" | "reject") => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(action, { resolution });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      <CardTitle icon={<ShieldCheck size={17} />} grad={GRAD.teal}>
        {title}
      </CardTitle>

      {d?.preview && (
        <div className="rounded-xl border border-border-subtle bg-bg-overlay/40 p-4">
          <p className="text-[13px] leading-relaxed text-fg-secondary">
            {d.preview}
          </p>
          {formatPendingCite(cite) && (
            <p className="mt-2 text-[11.5px] text-fg-tertiary">
              источник: {formatPendingCite(cite)}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {!d?.preview && <CiteChip cite={cite} />}
        {closingSoon ? (
          <Badge variant="danger" className="font-normal">
            {formatPendingWait(action.ageDays)} · скоро закроется автоматически
          </Badge>
        ) : (
          <WaitChip ageDays={action.ageDays} />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="bg-success text-success-fg hover:bg-success/90"
          disabled={busy}
          onClick={() => void resolve("approve")}
        >
          Принять в память
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-danger hover:text-danger"
          disabled={busy}
          onClick={() => void resolve("reject")}
        >
          Отклонить
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1"
          onClick={() => onOpen(action)}
        >
          <ExternalLink size={14} />
          Открыть
        </Button>
      </div>
    </GlassCard>
  );
}

function TaskClosureCard({ action, onSnooze, onOpen }: CardProps) {
  const d = action.detail?.kind === "task_closure" ? action.detail : undefined;
  const taskTitle = d?.taskTitle ?? action.title;
  const confidence = d?.confidencePct;

  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      <CardTitle icon={<CheckCircle2 size={17} />} grad={GRAD.teal}>
        {taskTitle}
      </CardTitle>

      {d?.rationale && (
        <p className="text-sm leading-relaxed text-fg-secondary">
          {d.rationale}
        </p>
      )}

      {d?.evidenceQuote && (
        <div className="rounded-xl border border-border-subtle bg-bg-overlay/40 p-4">
          <p className="text-[13px] italic leading-relaxed text-fg-secondary">
            «{d.evidenceQuote}»
          </p>
        </div>
      )}

      {confidence != null && (
        <div className="flex items-center gap-2.5">
          <span className="whitespace-nowrap text-xs text-fg-tertiary">
            Уверенность Коры
          </span>
          <Progress value={confidence} className="h-2 flex-1" />
          <span className="text-[13px] font-semibold text-fg-primary">
            {confidence}%
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <WaitChip ageDays={action.ageDays} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-1" onClick={() => onOpen(action)}>
          <ExternalLink size={14} />
          Открыть в трекере
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onSnooze(action, 72)}
        >
          Позже
        </Button>
      </div>
    </GlassCard>
  );
}

function TaskReviewCard({ action, onSnooze, onOpen }: CardProps) {
  const d = action.detail?.kind === "task_review" ? action.detail : undefined;
  const taskTitle = d?.taskTitle ?? action.title;

  return (
    <GlassCard className="flex flex-col gap-3 p-5">
      <CardTitle icon={<HelpCircle size={17} />} grad={GRAD.violet}>
        {taskTitle}
      </CardTitle>

      {d?.reason && (
        <p className="text-sm leading-relaxed text-fg-secondary">{d.reason}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <WaitChip ageDays={action.ageDays} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-1" onClick={() => onOpen(action)}>
          <ExternalLink size={14} />
          Проверить в трекере
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onSnooze(action, 72)}
        >
          Позже
        </Button>
      </div>
    </GlassCard>
  );
}

function GroupHeader({
  label,
  hint,
  variant,
}: {
  label: string;
  hint: string;
  variant: "warning" | "danger" | "default" | "success";
}) {
  return (
    <div className="mt-8 mb-3 flex flex-wrap items-center gap-2">
      <Badge variant={variant}>{label}</Badge>
      <span className="text-sm text-fg-tertiary">{hint}</span>
    </div>
  );
}

export function ActionsClient() {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const { items, isLoading, error, snooze, confirm } = usePendingActions(
    currentOrgId,
    50,
    Boolean(currentOrgId),
  );
  const { bySource, mutate: mutateCount } = usePendingActionsCount(
    currentOrgId,
    Boolean(currentOrgId),
  );

  const groups = useMemo(() => {
    const by = (s: PendingAction["source"]) =>
      items.filter((it) => it.source === s);
    return {
      probe: by("probe"),
      conflict: by("conflict"),
      intake: by("intake"),
      curation: by("curation"),
      task_closure: by("task_closure"),
      task_review: by("task_review"),
    };
  }, [items]);

  const total = items.length;
  const oldestDays = useMemo(
    () => items.reduce((max, it) => Math.max(max, it.ageDays), 0),
    [items],
  );

  const handleOpen = (action: PendingAction) => {
    router.push(action.actionUrl);
  };

  const handleSnooze = async (action: PendingAction, hours: number) => {
    try {
      await snooze({
        source: action.source,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
        hours,
      });
      await mutateCount();
      toast.success("Отложено.");
    } catch {
      toast.error("Не удалось отложить.");
    }
  };

  const handleConfirm: CardProps["onConfirm"] = async (action, resolve) => {
    try {
      await confirm(action, resolve);
      await mutateCount();
      toast.success("Готово.");
    } catch (e) {
      toast.error(
        humanizeApiError(
          e,
          "Не удалось — возможно, уже решено. Обновите страницу.",
        ),
      );
      throw new Error("confirm failed");
    }
  };

  const cardProps = {
    onConfirm: handleConfirm,
    onSnooze: handleSnooze,
    onOpen: handleOpen,
  };

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: "100vh" }}>
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
        {}
        {isLoading && (
          <GlassCard className="px-4 py-10 text-center text-sm text-fg-tertiary">
            Загрузка…
          </GlassCard>
        )}

        {}
        {!isLoading && Boolean(error) && (
          <div className="rounded-lg border border-danger/30 bg-danger/15 px-4 py-10 text-center text-sm text-danger">
            Не удалось загрузить. Попробуйте обновить страницу.
          </div>
        )}

        {}
        {!isLoading && !error && total === 0 && (
          <GlassCard className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <Inbox size={32} className="text-fg-tertiary" />
            <div>
              <p className="text-base font-medium text-fg-primary">
                Всё разобрано
              </p>
              <p className="mt-1 text-sm text-fg-tertiary">
                Сейчас ничего не ждёт вашего решения. Кора сама закрывает рутину
                — здесь появляется только то, что требует человека.
              </p>
            </div>
          </GlassCard>
        )}

        {}
        {!isLoading && !error && total > 0 && (
          <>
            {}
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-success/25 bg-success/10 px-4 py-3">
              <Sparkles size={18} className="shrink-0 text-success" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg-primary">
                  Очередь стала короче — Кора сама решает рутину
                </p>
                <p className="mt-0.5 text-xs text-fg-tertiary">
                  Дубли-конфликты и повторные вопросы закрываются автоматически
                  — здесь только то, что требует человека.
                </p>
              </div>
            </div>

            {}
            <GlassCard glow className="p-6">
              <h1 className="text-lg font-semibold tracking-tight text-fg-primary">
                Требует вас
              </h1>
              <div className="mt-3 flex items-baseline gap-4">
                <span className="text-[44px] font-semibold leading-none tracking-tight text-fg-primary">
                  {total}
                </span>
                <span className="text-sm text-fg-tertiary">
                  {total === 1 ? "решение ждёт вас" : "решений ждут вас"}
                  <br />
                  старейшее{" "}
                  <b className="text-fg-primary">
                    {formatPendingWait(oldestDays)}
                  </b>
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {bySource.probe > 0 && (
                  <Badge variant="warning">
                    {bySource.probe} вопросов Коры
                  </Badge>
                )}
                {bySource.conflict > 0 && (
                  <Badge variant="danger">{bySource.conflict} конфликтов</Badge>
                )}
                {bySource.intake > 0 && (
                  <Badge variant="default">{bySource.intake} в задачи</Badge>
                )}
                {bySource.curation > 0 && (
                  <Badge variant="success">
                    {bySource.curation} на проверке
                  </Badge>
                )}
              </div>
            </GlassCard>

            {}
            {groups.probe.length > 0 && (
              <>
                <GroupHeader
                  label="Вопросы Коры"
                  hint="Кора не уверена и спрашивает — ответьте своими словами"
                  variant="warning"
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  {groups.probe.map((it) => (
                    <ProbeCard
                      key={`${it.source}:${it.resourceId}`}
                      action={it}
                      {...cardProps}
                    />
                  ))}
                </div>
              </>
            )}

            {}
            {groups.conflict.length > 0 && (
              <>
                <GroupHeader
                  label="Конфликты карточек"
                  hint="Память нашла два противоречащих факта — выберите, что верно"
                  variant="danger"
                />
                <div className="flex flex-col gap-3">
                  {groups.conflict.map((it) => (
                    <ConflictCard
                      key={`${it.source}:${it.resourceId}`}
                      action={it}
                      {...cardProps}
                    />
                  ))}
                </div>
              </>
            )}

            {}
            {groups.intake.length > 0 && (
              <>
                <GroupHeader
                  label="Кандидаты в задачи"
                  hint="Кора услышала обещание — поставить как задачу?"
                  variant="default"
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  {groups.intake.map((it) => (
                    <IntakeCard
                      key={`${it.source}:${it.resourceId}`}
                      action={it}
                      {...cardProps}
                    />
                  ))}
                </div>
              </>
            )}

            {}
            {groups.curation.length > 0 && (
              <>
                <GroupHeader
                  label="Карточки на проверке"
                  hint="Новое знание перед добавлением в память компании"
                  variant="success"
                />
                <div className="flex flex-col gap-3">
                  {groups.curation.map((it) => (
                    <CurationCard
                      key={`${it.source}:${it.resourceId}`}
                      action={it}
                      {...cardProps}
                    />
                  ))}
                </div>
              </>
            )}

            {}
            {groups.task_closure.length > 0 && (
              <>
                <GroupHeader
                  label="Задачи к закрытию"
                  hint="Кора услышала, что это сделано — проверьте и закройте в трекере"
                  variant="success"
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  {groups.task_closure.map((it) => (
                    <TaskClosureCard
                      key={`${it.source}:${it.resourceId}`}
                      action={it}
                      {...cardProps}
                    />
                  ))}
                </div>
              </>
            )}

            {}
            {groups.task_review.length > 0 && (
              <>
                <GroupHeader
                  label="Задачи под вопросом"
                  hint="Связанное решение изменилось — проверьте, актуальна ли задача"
                  variant="warning"
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  {groups.task_review.map((it) => (
                    <TaskReviewCard
                      key={`${it.source}:${it.resourceId}`}
                      action={it}
                      {...cardProps}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
