"use client";

import { Clock, Loader2, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import { worklogsApi } from "@/api/tracker/worklogs.api";
import {
  formatWorklogMinutes,
  worklogDateLabel,
  type Worklog,
} from "@/domain/tracker";
import { useWorklogs } from "@/hooks/tracker/useWorklogs";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Textarea } from "@/ui/shadcn/textarea";

function todayInputValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface IssueWorklogProps {
  orgId: string;
  issueId: string;
}

export function IssueWorklog({ orgId, issueId }: IssueWorklogProps) {
  const { worklogs, totalMinutes, isLoading, error, mutate } = useWorklogs(
    orgId,
    issueId,
    true,
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm text-danger">
          Не удалось загрузить учёт времени.
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void mutate()}
          className="self-start"
        >
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-fg-secondary">
        <Clock size={14} className="shrink-0 text-fg-tertiary" aria-hidden />
        <span>
          Всего учтено:{" "}
          <span className="font-medium text-fg-primary">
            {formatWorklogMinutes(totalMinutes)}
          </span>
        </span>
      </div>

      {worklogs.length === 0 ? (
        <div className="text-sm text-fg-tertiary">
          Записей пока нет. Добавьте, сколько времени потратили на задачу.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {worklogs.map((w) => (
            <WorklogItem
              key={w.id}
              orgId={orgId}
              worklog={w}
              onChanged={() => void mutate()}
            />
          ))}
        </ul>
      )}

      <CreateWorklogForm
        orgId={orgId}
        issueId={issueId}
        onCreated={() => void mutate()}
      />
    </div>
  );
}

function WorklogItem({
  orgId,
  worklog,
  onChanged,
}: {
  orgId: string;
  worklog: Worklog;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleRemove = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await worklogsApi.remove(orgId, worklog.id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось удалить");
      setBusy(false);
    }
  }, [busy, onChanged, orgId, worklog.id]);

  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg-primary">
            {formatWorklogMinutes(worklog.minutes)}
          </span>
          <span className="text-[11px] text-fg-tertiary">
            {worklogDateLabel(worklog.startedAt)}
          </span>
        </div>
        {worklog.description ? (
          <p className="whitespace-pre-wrap break-words text-xs text-fg-secondary">
            {worklog.description}
          </p>
        ) : null}
        {err ? <span className="text-xs text-danger">{err}</span> : null}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => void handleRemove()}
        disabled={busy}
        aria-label="Удалить запись"
        className="shrink-0"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Trash2 size={14} />
        )}
      </Button>
    </li>
  );
}

function CreateWorklogForm({
  orgId,
  issueId,
  onCreated,
}: {
  orgId: string;
  issueId: string;
  onCreated: () => void;
}) {
  const [hours, setHours] = useState("");
  const [mins, setMins] = useState("");
  const [date, setDate] = useState(todayInputValue());
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const h = Number.parseInt(hours || "0", 10);
    const m = Number.parseInt(mins || "0", 10);
    const totalMinutes =
      (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    if (totalMinutes <= 0 || saving) {
      setErr("Укажите время больше нуля");
      return;
    }
    if (!date) {
      setErr("Укажите дату работы");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await worklogsApi.create(orgId, issueId, {
        minutes: totalMinutes,
        startedAt: new Date(`${date}T00:00:00`).toISOString(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setHours("");
      setMins("");
      setDescription("");
      setDate(todayInputValue());
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setSaving(false);
    }
  }, [date, description, hours, issueId, mins, onCreated, orgId, saving]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3">
      <span className="text-xs font-medium text-fg-secondary">
        Добавить запись
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-tertiary">Часы</span>
          <Input
            type="number"
            min={0}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            disabled={saving}
            placeholder="0"
            className="w-20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-tertiary">Минуты</span>
          <Input
            type="number"
            min={0}
            max={59}
            value={mins}
            onChange={(e) => setMins(e.target.value)}
            disabled={saving}
            placeholder="0"
            className="w-20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-tertiary">Дата работы</span>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={saving}
            className="w-40"
          />
        </label>
      </div>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        disabled={saving}
        placeholder="Что делали (необязательно)"
        className="resize-none"
      />
      {err ? <div className="text-xs text-danger">{err}</div> : null}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={saving}
          className="gap-2"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          Добавить
        </Button>
      </div>
    </div>
  );
}
