"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Check, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";
import { issuesApi } from "@/api/tracker/issues.api";
import { humanizeApiError } from "@/api/api-error";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import type { Issue } from "@/domain/tracker";
import { IssueStateBadge } from "./IssueStateBadge";

export function IssueHeader({
  issue,
  orgId,
  onUpdated,
}: {
  issue: Issue;
  orgId: string;
  onUpdated?: () => Promise<unknown> | void;
}) {
  const router = useRouter();
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(issue.title);
  const [saving, setSaving] = useState(false);

  const handleDelete = async () => {
    const ok = await ask({
      title: "Удалить задачу?",
      description: "Восстановить можно в течение 30 дней.",
      confirmLabel: "Удалить",
      destructive: true,
    });
    if (!ok) return;
    try {
      await issuesApi.remove(orgId, issue.id);
      toast.success("Задача удалена");
      router.push(
        issue.projectSlug ? `/projects/${issue.projectSlug}/board` : "/projects",
      );
    } catch (err) {
      toast.error(humanizeApiError(err, "Ошибка удаления"));
    }
  };

  const handleSave = async () => {
    const next = value.trim();
    if (!next || next === issue.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await issuesApi.update(orgId, issue.id, { title: next });
      await onUpdated?.();
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const category = issue.isCompleted
    ? "completed"
    : issue.isArchived
      ? "cancelled"
      : "unstarted";

  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle pb-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg-tertiary">
          {issue.identifier}
        </span>
        <IssueStateBadge category={category} />
      </div>

      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              } else if (e.key === "Escape") {
                setEditing(false);
                setValue(issue.title);
              }
            }}
            disabled={saving}
            className="text-lg font-medium"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleSave()}
            disabled={saving}
            aria-label="Сохранить"
          >
            <Check size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setEditing(false);
              setValue(issue.title);
            }}
            disabled={saving}
            aria-label="Отмена"
          >
            <X size={16} />
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 break-words text-xl font-semibold text-fg-primary md:text-2xl">
            {issue.title}
          </h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditing(true)}
            aria-label="Переименовать"
          >
            <Pencil size={14} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Меню задачи">
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                className="text-danger focus:text-danger"
                onSelect={() => void handleDelete()}
              >
                <Trash2 size={14} /> Удалить задачу
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
