"use client";

import { Archive, Pencil, Shuffle } from "lucide-react";

import {
  FEEDBACK_TOPIC_STATUS_LABEL,
  FEEDBACK_WINDOW_LABEL,
  type FeedbackTopicDetail as FeedbackTopicDetailModel,
  type FeedbackWindow,
} from "@/domain/admin-feedback";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Checkbox } from "@/ui/shadcn/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

const WINDOWS: FeedbackWindow[] = ["30", "90", "all"];

interface TopicDetailProps {
  topic: FeedbackTopicDetailModel;
  window: FeedbackWindow;
  onWindowChange: (w: FeedbackWindow) => void;
  groupByUser: boolean;
  onGroupByUserChange: (v: boolean) => void;
  onAction: (action: "rename" | "merge" | "archive") => void;
}

export function TopicDetail({
  topic,
  window,
  onWindowChange,
  groupByUser,
  onGroupByUserChange,
  onAction,
}: TopicDetailProps) {
  const isArchived = topic.status === "archived";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant="outline"
          className={
            topic.status === "active"
              ? "border-chip-success-bg bg-chip-success-bg text-chip-success-fg"
              : "border-border-subtle bg-bg-subtle text-fg-secondary"
          }
        >
          {FEEDBACK_TOPIC_STATUS_LABEL[topic.status]}
        </Badge>

        <Select
          value={window}
          onValueChange={(v) => onWindowChange(v as FeedbackWindow)}
        >
          <SelectTrigger className="h-9 w-44 bg-bg-card text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w} value={w}>
                {FEEDBACK_WINDOW_LABEL[w]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAction("rename")}
          >
            <Pencil size={14} className="mr-1" /> Переименовать
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAction("merge")}>
            <Shuffle size={14} className="mr-1" /> Объединить с…
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAction("archive")}
          >
            <Archive size={14} className="mr-1" />
            {isArchived ? "Восстановить" : "В архив"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Items за окно" value={String(topic.itemsCount)} />
        <MetricCard
          label="Уникальных юзеров"
          value={String(topic.uniqueUsersCount)}
        />
        <MetricCard
          label="Доля от общего"
          value={`${topic.percentOfWindow.toFixed(1)}%`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-fg-tertiary">
        <span>
          Создан:{" "}
          <span className="text-fg-secondary">
            {topic.createdAt.toLocaleDateString("ru-RU")}
          </span>
        </span>
        <span>
          Последнее item:{" "}
          <span className="text-fg-secondary">
            {topic.lastItemAt
              ? topic.lastItemAt.toLocaleDateString("ru-RU")
              : "—"}
          </span>
        </span>
        {topic.archivedAt && (
          <span>
            Архивирован:{" "}
            <span className="text-fg-secondary">
              {topic.archivedAt.toLocaleDateString("ru-RU")}
            </span>
          </span>
        )}
        {topic.mergedIntoId && (
          <span>
            Слит в блок:{" "}
            <span className="font-mono text-fg-secondary">
              {topic.mergedIntoId}
            </span>
          </span>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <Checkbox
          checked={groupByUser}
          onCheckedChange={(v) => onGroupByUserChange(v === true)}
        />
        Группировать по пользователю
      </label>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-3">
      <div className="text-xs uppercase text-fg-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-fg-primary">
        {value}
      </div>
    </div>
  );
}
