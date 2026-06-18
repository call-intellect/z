"use client";

import { useState } from "react";
import {
  Calendar,
  Flag,
  Tag,
  Target,
  Users,
  Layers,
  CornerUpRight,
  FolderInput,
} from "lucide-react";
import { toast } from "sonner";
import {
  ISSUE_PRIORITY_LABELS,
  dueDateLabel,
  type Issue,
} from "@/domain/tracker";
import { issuesApi } from "@/api/tracker/issues.api";
import { humanizeApiError } from "@/api/api-error";
import { useProjects } from "@/hooks/tracker/useProjects";
import { IssuePriorityIcon } from "./IssuePriorityIcon";
import { AssigneeAvatarGroup } from "./AssigneeAvatar";
import { StartMeetingButton } from "./StartMeetingButton";
import { ProjectPickerDialog } from "./ProjectPickerDialog";

export function IssueSidebar({
  issue,
  orgId,
  onMoved,
}: {
  issue: Issue;
  orgId: string;
  onMoved?: () => void;
}) {
  const due = dueDateLabel(issue.dueDate);

  return (
    <aside className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm">
      <Row icon={<Users size={14} />} label="Исполнители">
        <AssigneeAvatarGroup
          userIds={issue.assigneeUserIds}
          max={6}
          size={22}
        />
      </Row>

      <Row icon={<FolderInput size={14} />} label="Проект">
        <ProjectMoveRow issue={issue} orgId={orgId} onMoved={onMoved} />
      </Row>

      <Row
        icon={<IssuePriorityIcon priority={issue.priority} />}
        label="Приоритет"
      >
        <span className="text-fg-primary">
          {ISSUE_PRIORITY_LABELS[issue.priority]}
        </span>
      </Row>

      <Row icon={<Flag size={14} />} label="Срок">
        <span
          className={due && issue.isOverdue ? "text-danger" : "text-fg-primary"}
        >
          {due ?? "—"}
        </span>
      </Row>

      <Row icon={<Tag size={14} />} label="Метки">
        <span className="text-fg-primary">
          {issue.labelIds.length > 0 ? `${issue.labelIds.length} меток` : "—"}
        </span>
      </Row>

      <Row icon={<Layers size={14} />} label="Спринт">
        <span className="text-fg-primary">{issue.cycleId ?? "—"}</span>
      </Row>

      <Row icon={<Target size={14} />} label="Цель">
        <span className="text-fg-primary">{issue.goalId ?? "—"}</span>
      </Row>

      <Row icon={<Calendar size={14} />} label="Создана">
        <span className="text-fg-secondary text-xs">
          {issue.createdAt.toLocaleDateString("ru-RU")}
        </span>
      </Row>

      {}
      <Row icon={<CornerUpRight size={14} />} label="Родитель">
        <ParentTaskSelector issue={issue} orgId={orgId} />
      </Row>

      <div className="mt-2 border-t border-border-subtle pt-3">
        <StartMeetingButton orgId={orgId} issueId={issue.id} />
      </div>
    </aside>
  );
}

function ParentTaskSelector({ issue, orgId }: { issue: Issue; orgId: string }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const id = draft.trim();
    if (!id) return;
    setSaving(true);
    setErrorText(null);
    try {
      let parentId = id;
      try {
        const parent = await issuesApi.getByIdentifier(orgId, id);
        parentId = parent.id;
      } catch {}
      await issuesApi.update(orgId, issue.id, { parentId });
      setDraft("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось обновить";
      setErrorText(msg);
    } finally {
      setSaving(false);
    }
  };

  const clearParent = async (): Promise<void> => {
    setSaving(true);
    setErrorText(null);
    try {
      await issuesApi.update(orgId, issue.id, { parentId: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось снять родителя";
      setErrorText(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {issue.parentId ? (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-fg-primary">
            {issue.parentId.slice(0, 12)}
          </span>
          <button
            type="button"
            className="text-xs text-fg-tertiary hover:text-danger disabled:opacity-50"
            onClick={() => void clearParent()}
            disabled={saving}
            aria-label="Сделать самостоятельной"
          >
            ✕
          </button>
        </div>
      ) : (
        <span className="text-xs text-fg-tertiary">Самостоятельная</span>
      )}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="KORA-100 — сделать подзадачей"
        disabled={saving}
        className="rounded border border-border-subtle bg-bg-card px-1.5 py-1 text-xs text-fg-primary placeholder:text-fg-tertiary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
      />
      {errorText ? (
        <span className="text-[10px] text-danger">{errorText}</span>
      ) : null}
    </div>
  );
}

function ProjectMoveRow({
  issue,
  orgId,
  onMoved,
}: {
  issue: Issue;
  orgId: string;
  onMoved?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const { projects } = useProjects(orgId);
  const currentProject = projects.find((p) => p.id === issue.projectId) ?? null;
  const currentLabel = currentProject?.name ?? issue.projectId;

  const handlePick = async (targetProjectId: string): Promise<void> => {
    if (moving) return;
    setPickerOpen(false);
    setMoving(true);
    try {
      await issuesApi.move(orgId, issue.id, targetProjectId);
      toast.success("Задача перенесена в другой проект.");
      onMoved?.();
    } catch (e) {
      toast.error(
        `Не удалось перенести задачу: ${humanizeApiError(e, "попробуйте ещё раз")}`,
        { duration: 5000 },
      );
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-fg-primary">
        {currentLabel}
      </span>
      <button
        type="button"
        className="shrink-0 text-xs text-accent hover:underline disabled:opacity-50"
        onClick={() => setPickerOpen(true)}
        disabled={moving}
      >
        {moving ? "Переносим…" : "Перенести"}
      </button>
      <ProjectPickerDialog
        orgId={orgId}
        open={pickerOpen}
        excludeProjectId={issue.projectId}
        title="Перенести задачу"
        description="Выберите проект, в который перенести задачу. У задачи сменится код (идентификатор)."
        onClose={() => setPickerOpen(false)}
        onPick={(projectId) => void handlePick(projectId)}
      />
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-fg-tertiary">{icon}</span>
      <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-fg-tertiary">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
