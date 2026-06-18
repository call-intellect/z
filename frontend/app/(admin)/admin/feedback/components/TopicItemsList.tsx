"use client";

import { useMemo } from "react";

import { formatAuthor, type FeedbackItem } from "@/domain/admin-feedback";
import { Button } from "@/ui/shadcn/button";

import { ItemRow } from "./ItemRow";

interface TopicItemsListProps {
  topicId: string;
  items: FeedbackItem[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  groupByUser: boolean;
}

export function TopicItemsList({
  topicId,
  items,
  total,
  page,
  pageSize,
  onPageChange,
  groupByUser,
}: TopicItemsListProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const userGroups = useMemo(() => {
    if (!groupByUser)
      return [] as Array<{
        userId: string;
        label: string;
        count: number;
      }>;
    const map = new Map<
      string,
      { userId: string; label: string; count: number }
    >();
    for (const it of items) {
      const existing = map.get(it.user.id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(it.user.id, {
          userId: it.user.id,
          label: formatAuthor(it.user),
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [items, groupByUser]);

  return (
    <div className="space-y-4">
      {groupByUser && userGroups.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-subtle p-3">
          <div className="mb-2 text-xs uppercase text-fg-tertiary">
            Кто сколько раз писал на этой странице
          </div>
          <ul className="flex flex-wrap gap-2 text-xs">
            {userGroups.map((g) => (
              <li
                key={g.userId}
                className="rounded-md border border-border-subtle bg-bg-card px-2 py-1"
              >
                <span className="font-medium text-fg-primary">{g.label}</span>
                <span className="ml-2 text-fg-secondary">×{g.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-card">
        <table className="w-full text-sm">
          <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
            <tr>
              <th className="w-32 px-3 py-2 text-left font-medium">Дата</th>
              <th className="px-3 py-2 text-left font-medium">Пользователь</th>
              <th className="w-40 px-3 py-2 text-left font-medium">Org</th>
              <th className="px-3 py-2 text-left font-medium">Тезис</th>
              <th className="w-28 px-3 py-2 text-right font-medium">
                Развернуть
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <ItemRow key={it.id} topicId={topicId} item={it} />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            Назад
          </Button>
          <span className="text-xs text-fg-tertiary">
            Стр. {page} из {totalPages} · всего {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          >
            Вперёд
          </Button>
        </div>
      )}
    </div>
  );
}
