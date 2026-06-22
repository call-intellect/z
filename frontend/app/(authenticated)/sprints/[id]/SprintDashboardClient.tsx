"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import {
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Flag,
  ListChecks,
  Loader2,
  Network,
  Sparkles,
  Target,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, humanizeApiError } from "@/api/api-error";
import { goalsApi } from "@/api/goals.api";
import { meetingStatusLabel } from "@/domain/meeting";
import { meetingTypeLabel } from "@/domain/admin-prompt-template";
import type { MeetingTypeApi } from "@/api/admin-prompt-templates.api";
import { Button } from "@/ui/shadcn/button";
import { Progress } from "@/ui/shadcn/progress";
import { GoalPickerDialog } from "@/ui/components/shared/GoalPickerDialog";
import { useAuth } from "@/contexts/auth-context";
import { useCycle } from "@/hooks/tracker/useCycle";
import { cyclesApi } from "@/api/tracker/cycles.api";
import { sprintsApi } from "@/api/tracker/sprints.api";
import { sprintHintsApi } from "@/api/tracker/sprint-hints.api";
import {
  formatSprintDateRange,
  mapSprintDashboardApi,
  type SprintDashboardTaskRefApi,
  type SprintHintApi,
} from "@/domain/sprint";
import {
  ISSUE_STATE_CATEGORY_LABELS,
  type IssueStateCategory,
} from "@/domain/tracker";
import { AssigneeAvatarGroup } from "@/ui/tracker/AssigneeAvatar";
import { SprintHintCard } from "@/ui/tracker/SprintHintCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";
import { cn } from "@/ui/shadcn/lib/utils";
import { useRegisterBreadcrumb } from "@/ui/components/breadcrumbs/BreadcrumbContext";

import { SprintDailyPanel } from "./SprintDailyPanel";
import { SprintWeeklyPanel } from "./SprintWeeklyPanel";

export function SprintDashboardClient({ cycleId }: { cycleId: string }) {
  const { currentOrgId, currentOrgRole } = useAuth();
  const router = useRouter();
  const canEdit = currentOrgRole === "owner" || currentOrgRole === "admin";

  const {
    cycle,
    isLoading: cycleLoading,
    mutate: mutateCycle,
  } = useCycle(currentOrgId, cycleId);

  useRegisterBreadcrumb(cycle ? { label: cycle.name } : null);

  const [goalDialogOpen, setGoalDialogOpen] = useState(false);

  const primaryGoalId = cycle?.primaryGoalId ?? null;
  const { data: primaryGoal } = useSWR(
    primaryGoalId && currentOrgId
      ? (["sprint-primary-goal", currentOrgId, primaryGoalId] as const)
      : null,
    async ([, oid, gid]) => goalsApi.get(oid, gid),
  );

  const handleLinkGoal = async (goalId: string | null) => {
    if (!currentOrgId) {
      toast.error("Сначала выберите организацию");
      return;
    }
    try {
      await cyclesApi.update(currentOrgId, cycleId, { primaryGoalId: goalId });
      toast.success(
        goalId ? "Спринт привязан к цели" : "Спринт отвязан от цели",
      );
      await mutateCycle();
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        toast.error("Привязывать цель могут только owner / admin");
      } else if (e instanceof ApiError && e.code === "goal_not_found") {
        toast.error("Выбранная цель не найдена");
      } else {
        toast.error(humanizeApiError(e, "Не удалось привязать цель"));
      }
      throw e;
    }
  };

  const dashboardKey =
    currentOrgId && cycleId
      ? ["tracker.sprint.dashboard", currentOrgId, cycleId]
      : null;
  const dashboardSwr = useSWR(
    dashboardKey,
    async () => {
      if (!currentOrgId) throw new Error("orgId required");
      return sprintsApi.dashboard(currentOrgId, cycleId);
    },
    { refreshInterval: 30_000, revalidateOnFocus: false },
  );
  const dashboard = useMemo(
    () => (dashboardSwr.data ? mapSprintDashboardApi(dashboardSwr.data) : null),
    [dashboardSwr.data],
  );

  const hintsKey =
    currentOrgId && cycleId
      ? ["tracker.sprint.hints", currentOrgId, cycleId]
      : null;
  const hintsSwr = useSWR(
    hintsKey,
    async () => {
      if (!currentOrgId) throw new Error("orgId required");
      return sprintHintsApi.listByCycle(currentOrgId, cycleId);
    },
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  const [meetingPending, setMeetingPending] = useState(false);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [completePending, setCompletePending] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"main" | "daily" | "weekly">(
    "main",
  );

  const handleStartMeeting = async () => {
    if (!currentOrgId) return;
    setMeetingPending(true);
    setMeetingError(null);
    try {
      const res = await sprintsApi.startMeeting(currentOrgId, cycleId, {
        type: "sprint_review",
      });
      const url =
        res.meetingUrl || `/meetings/${encodeURIComponent(res.meetingId)}`;
      router.push(url);
    } catch (e) {
      setMeetingError(
        e instanceof Error ? e.message : "Не удалось запустить встречу",
      );
      setMeetingPending(false);
    }
  };

  const handleComplete = async () => {
    if (!currentOrgId) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Завершить спринт и подготовить итоговый отчёт? Незакрытые задачи будут перенесены.",
      );
      if (!ok) return;
    }
    setCompletePending(true);
    setCompleteError(null);
    try {
      await cyclesApi.complete(currentOrgId, cycleId);
      router.push(`/sprints/${encodeURIComponent(cycleId)}/review`);
    } catch (e) {
      setCompleteError(
        e instanceof Error ? e.message : "Не удалось завершить спринт",
      );
      setCompletePending(false);
    }
  };

  const handleDismissHint = async (hintId: string) => {
    if (!currentOrgId) return;
    await sprintHintsApi.dismiss(currentOrgId, hintId);
    await hintsSwr.mutate();
    await dashboardSwr.mutate();
  };

  const handleResolveHint = async (hintId: string) => {
    if (!currentOrgId) return;
    await sprintHintsApi.resolve(currentOrgId, hintId);
    await hintsSwr.mutate();
    await dashboardSwr.mutate();
  };

  if (cycleLoading || dashboardSwr.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4 md:p-6">
        <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
        <div className="h-40 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      </div>
    );
  }

  if (!cycle || !dashboard) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
        <div className="rounded-md border border-border-subtle bg-bg-elevated p-6 text-sm text-fg-tertiary">
          Спринт не найден или у вас нет доступа.
        </div>
      </div>
    );
  }

  const hints = hintsSwr.data?.items ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      {}
      <header className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded bg-mint-500 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
              <Flag size={11} strokeWidth={2.25} />
              {dashboard.scope.badgeLabel}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
              <CalendarRange size={12} />
              {formatSprintDateRange(cycle.startDate, cycle.endDate)}
            </span>
          </div>
          <h1 className="truncate text-xl font-semibold text-fg-primary md:text-2xl">
            {cycle.name}
          </h1>
          {cycle.description && (
            <p className="text-sm text-fg-secondary">{cycle.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-fg-tertiary">
              <Target size={12} className="text-accent" />
              Продвигает цель:
            </span>
            {cycle.primaryGoalId ? (
              <Link
                href={`/goals/${encodeURIComponent(cycle.primaryGoalId)}`}
                className="font-medium text-accent hover:underline"
              >
                {primaryGoal?.name ?? "Открыть цель"}
              </Link>
            ) : (
              <span className="text-fg-tertiary">— не задана —</span>
            )}
            {canEdit ? (
              <button
                type="button"
                onClick={() => setGoalDialogOpen(true)}
                className="text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline"
              >
                {cycle.primaryGoalId ? "Изменить" : "Привязать цель…"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 md:items-end">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleStartMeeting()}
              disabled={meetingPending}
              className="gap-2"
            >
              {meetingPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Video size={14} />
              )}
              Создать видеовстречу
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleComplete()}
              disabled={completePending || cycle.isCompleted}
              className="gap-2"
            >
              {completePending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              {cycle.isCompleted ? "Спринт завершён" : "Завершить спринт"}
            </Button>
          </div>
          {meetingError && (
            <div className="text-xs text-danger">{meetingError}</div>
          )}
          {completeError && (
            <div className="text-xs text-danger">{completeError}</div>
          )}
        </div>
      </header>

      {}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "main" | "daily" | "weekly")}
      >
        <TabsList className="w-full justify-start overflow-x-auto scrollbar-none">
          <TabsTrigger value="main">Обзор</TabsTrigger>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
        </TabsList>

        <TabsContent value="main" className="mt-4 flex flex-col gap-4">
          {}
          <ProgressBlock dashboard={dashboard} />

          {}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
              Задачи спринта
            </h2>
            <TaskSection
              title="Без срока"
              tasks={dashboard.tasksWithoutDueDate}
              emptyHint="Все задачи спринта имеют срок выполнения."
            />
            <TaskSection
              title="Срок горит"
              tasks={dashboard.tasksAtRisk}
              emptyHint="Просроченных задач нет."
            />
            <TaskSection
              title="Без движения более 3 дней"
              tasks={dashboard.tasksWithoutMovement}
              emptyHint="Все задачи в работе или закрыты."
            />
          </section>

          {}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
                <Sparkles size={14} className="text-accent" />
                Помощник предлагает
              </h2>
              {hints.length > 0 && (
                <span className="text-[11px] text-fg-tertiary">
                  Активных: {hints.length}
                </span>
              )}
            </div>
            {hintsSwr.isLoading ? (
              <div className="h-20 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
            ) : hints.length === 0 ? (
              <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-6 text-center text-xs text-fg-tertiary">
                Подсказок пока нет — помощник ещё анализирует спринт.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {hints.map((h: SprintHintApi) => (
                  <li key={h.id}>
                    <SprintHintCard
                      hint={h}
                      onDismiss={handleDismissHint}
                      onResolve={handleResolveHint}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {}
          {dashboard.linkedMeetings.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
                Связанные встречи
              </h2>
              <ul className="flex flex-col gap-2">
                {dashboard.linkedMeetings.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/meetings/${encodeURIComponent(m.id)}/result`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 transition-colors hover:border-border hover:bg-bg-card"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg-primary">
                          {m.title || "Встреча"}
                        </div>
                        <div className="text-[11px] text-fg-tertiary">
                          {meetingTypeLabel(m.type as MeetingTypeApi) ?? m.type}{" "}
                          · {meetingStatusLabel(m.status)}
                        </div>
                      </div>
                      <ChevronRight
                        size={14}
                        className="shrink-0 text-fg-tertiary"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </TabsContent>

        <TabsContent value="daily" className="mt-4">
          {currentOrgId ? (
            <SprintDailyPanel orgId={currentOrgId} cycleId={cycleId} />
          ) : (
            <div className="rounded-md border border-border-subtle bg-bg-elevated px-4 py-6 text-center text-xs text-fg-tertiary">
              Сначала выберите организацию.
            </div>
          )}
        </TabsContent>

        <TabsContent value="weekly" className="mt-4">
          {currentOrgId ? (
            <SprintWeeklyPanel orgId={currentOrgId} cycleId={cycleId} />
          ) : (
            <div className="rounded-md border border-border-subtle bg-bg-elevated px-4 py-6 text-center text-xs text-fg-tertiary">
              Сначала выберите организацию.
            </div>
          )}
        </TabsContent>
      </Tabs>

      {currentOrgId && canEdit ? (
        <GoalPickerDialog
          open={goalDialogOpen}
          onOpenChange={setGoalDialogOpen}
          orgId={currentOrgId}
          currentGoalId={cycle.primaryGoalId}
          onPick={handleLinkGoal}
          title="Продвигает цель"
          description="Выберите цель компании, на которую работает этот спринт."
        />
      ) : null}
    </div>
  );
}

function ProgressBlock({
  dashboard,
}: {
  dashboard: ReturnType<typeof mapSprintDashboardApi>;
}) {
  const { progress } = dashboard;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg-primary">Прогресс</span>
        <span className="text-xs text-fg-tertiary">
          День {Math.min(progress.elapsedDays, progress.durationDays)} из{" "}
          {progress.durationDays}
        </span>
      </div>
      <Progress value={progress.percent} className="h-2" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-tertiary">
        <span>
          {progress.completed} из {progress.total} задач выполнено
        </span>
        <span>{progress.percent}%</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-fg-tertiary">
        <span>В работе: {progress.started}</span>
        <span>К работе: {progress.unstarted}</span>
        <span>Бэклог: {progress.backlog}</span>
        <span>Отменено: {progress.cancelled}</span>
        {dashboard.carryOverCount > 0 && (
          <span>Перенесено в этот спринт: {dashboard.carryOverCount}</span>
        )}
      </div>
    </section>
  );
}

function TaskSection({
  title,
  tasks,
  emptyHint,
}: {
  title: string;
  tasks: SprintDashboardTaskRefApi[];
  emptyHint: string;
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-3 text-xs text-fg-tertiary">
        <span className="font-medium text-fg-secondary">{title}.</span>{" "}
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated">
      <div className="border-b border-border-subtle px-4 py-2 text-xs font-medium uppercase tracking-wider text-fg-secondary">
        {title} · {tasks.length}
      </div>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {tasks.map((t) => (
          <li key={t.id}>
            <Link
              href={`/issues/${encodeURIComponent(t.id)}`}
              className="flex flex-col gap-1 px-4 py-2.5 transition-colors hover:bg-bg-overlay md:flex-row md:items-center md:gap-3"
            >
              <span className="shrink-0 font-mono text-[11px] text-fg-tertiary">
                {t.identifier}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                {t.title}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <StateBadge category={t.stateCategory} />
                {t.board && (
                  <Badge
                    label={t.board.name}
                    bg="bg-bg-overlay"
                    fg="text-fg-secondary"
                    icon={<Network size={10} />}
                  />
                )}
                {t.checklistTotalCount > 0 && (
                  <Badge
                    label={`☑ ${t.checklistDoneCount}/${t.checklistTotalCount}`}
                    bg="bg-bg-overlay"
                    fg="text-fg-secondary"
                    icon={<ListChecks size={10} />}
                  />
                )}
                {t.childrenCount > 0 && (
                  <Badge
                    label={`✓ ${t.childrenCount}`}
                    bg="bg-bg-overlay"
                    fg="text-fg-secondary"
                  />
                )}
              </div>
              {t.dueDate && (
                <span className="shrink-0 text-[11px] text-fg-tertiary">
                  до{" "}
                  {new Date(t.dueDate).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              )}
              <AssigneeAvatarGroup userIds={t.assigneeUserIds} size={20} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATE_BADGE_STYLE: Record<
  IssueStateCategory,
  { bg: string; fg: string }
> = {
  backlog: { bg: "bg-bg-overlay", fg: "text-fg-secondary" },
  unstarted: { bg: "bg-slate-200", fg: "text-slate-900" },
  started: { bg: "bg-amber-500", fg: "text-white" },
  completed: { bg: "bg-mint-500", fg: "text-white" },
  cancelled: { bg: "bg-rose-500", fg: "text-white" },
};

function StateBadge({ category }: { category: IssueStateCategory | null }) {
  const c: IssueStateCategory = category ?? "backlog";
  const style = STATE_BADGE_STYLE[c];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        style.bg,
        style.fg,
      )}
    >
      {ISSUE_STATE_CATEGORY_LABELS[c]}
    </span>
  );
}

function Badge({
  label,
  bg,
  fg,
  icon,
}: {
  label: string;
  bg: string;
  fg: string;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
        bg,
        fg,
      )}
    >
      {icon}
      {label}
    </span>
  );
}
