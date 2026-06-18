"use client";

import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, MoreHorizontal } from "lucide-react";

import {
  FEEDBACK_TOPIC_STATUS_LABEL,
  type FeedbackSort,
  type FeedbackTopicSummary,
} from "@/domain/admin-feedback";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";

export type TopicAction = "rename" | "merge" | "archive";

interface TopicsTableProps {
  topics: FeedbackTopicSummary[];
  sort: FeedbackSort;
  onSortChange: (s: FeedbackSort) => void;
  onAction: (action: TopicAction, topicId: string) => void;
}

export function TopicsTable({
  topics,
  sort,
  onSortChange,
  onAction,
}: TopicsTableProps) {
  const router = useRouter();

  function goToTopic(id: string) {
    router.push(`/admin/feedback/${encodeURIComponent(id)}`);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
      <table className="w-full text-sm">
        <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Тема</th>
            <th className="px-3 py-2 text-left font-medium">Описание</th>
            <th className="w-20 px-3 py-2 text-right font-medium">
              <SortHeader label="Items" active={false} ariaLabel="Items" />
            </th>
            <th className="w-24 px-3 py-2 text-right font-medium">
              <SortHeader
                label="Юзеров"
                active={sort === "users"}
                onClick={() => onSortChange("users")}
                ariaLabel="Сортировать по числу юзеров"
              />
            </th>
            <th className="w-20 px-3 py-2 text-right font-medium">
              <SortHeader
                label="%"
                active={sort === "percent"}
                onClick={() => onSortChange("percent")}
                ariaLabel="Сортировать по доле"
              />
            </th>
            <th className="w-36 px-3 py-2 text-left font-medium">
              <SortHeader
                label="Последнее"
                active={sort === "recent"}
                onClick={() => onSortChange("recent")}
                ariaLabel="Сортировать по свежести"
              />
            </th>
            <th className="w-24 px-3 py-2 text-left font-medium">Статус</th>
            <th className="w-12 px-3 py-2 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((t) => (
            <TopicRow
              key={t.id}
              topic={t}
              onOpen={() => goToTopic(t.id)}
              onAction={onAction}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  active,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
  ariaLabel: string;
}) {
  if (!onClick) {
    return <span aria-label={ariaLabel}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 hover:text-fg-primary ${
        active ? "text-fg-primary" : ""
      }`}
    >
      {label}
      {active ? (
        <ArrowDown size={12} />
      ) : (
        <ArrowUp size={12} className="opacity-30" />
      )}
    </button>
  );
}

function TopicRow({
  topic,
  onOpen,
  onAction,
}: {
  topic: FeedbackTopicSummary;
  onOpen: () => void;
  onAction: (action: TopicAction, id: string) => void;
}) {
  const isArchived = topic.status === "archived";
  const rowClass = isArchived
    ? "border-t border-border-subtle bg-bg-subtle text-fg-tertiary"
    : "border-t border-border-subtle hover:bg-bg-subtle";

  return (
    <tr className={`${rowClass} cursor-pointer`} onClick={onOpen}>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          {isArchived && <Archive size={12} className="text-fg-tertiary" />}
          <span
            className={
              isArchived ? "line-through" : "font-medium text-fg-primary"
            }
          >
            {topic.title}
          </span>
        </div>
      </td>
      <td className="max-w-md px-3 py-2 align-top">
        <span className="line-clamp-2 text-xs text-fg-secondary">
          {topic.description}
        </span>
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {topic.itemsCount}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {topic.uniqueUsersCount}
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">
        {topic.percentOfWindow.toFixed(1)}%
      </td>
      <td className="px-3 py-2 align-top text-xs text-fg-secondary">
        {topic.lastItemAt ? topic.lastItemAt.toLocaleDateString("ru-RU") : "—"}
      </td>
      <td className="px-3 py-2 align-top">
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
      </td>
      <td className="px-3 py-2 text-right align-top">
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Действия"
                className="h-7 w-7 p-0"
              >
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAction("rename", topic.id)}>
                Переименовать
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("merge", topic.id)}>
                Объединить
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction("archive", topic.id)}>
                {isArchived ? "Восстановить" : "В архив"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}
