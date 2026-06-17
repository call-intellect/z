"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import { feedbackApi } from "@/api/feedback.api";
import {
  toFeedbackMessagesList,
  type FeedbackMessage,
  type FeedbackStatus,
} from "@/domain/feedback";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Skeleton } from "@/ui/shadcn/skeleton";

const PAGE_SIZE = 20;
const TEXT_PREVIEW_LIMIT = 200;

export function FeedbackHistory() {
  const [page, setPage] = useState(1);

  const { data, error, isLoading } = useSWR(
    ["feedback-history", page, PAGE_SIZE],
    () =>
      feedbackApi
        .listMine({ page, pageSize: PAGE_SIZE })
        .then(toFeedbackMessagesList),
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  }, [data]);

  return (
    <section>
      <h2 className="mb-3 text-base font-medium text-fg-primary">
        История обращений
      </h2>

      {error ? (
        <ErrorView error={error} />
      ) : isLoading && !data ? (
        <HistorySkeleton />
      ) : !data || data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <HistoryTable items={data.items} />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={data.total}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}

function HistoryTable({ items }: { items: FeedbackMessage[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle bg-bg-card">
      <table className="w-full text-sm">
        <thead className="bg-bg-muted/60 text-left text-xs uppercase tracking-wider text-fg-tertiary">
          <tr>
            <th className="px-4 py-2 font-medium">Дата</th>
            <th className="px-4 py-2 font-medium">Текст</th>
            <th className="px-4 py-2 font-medium">Статус</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({ item }: { item: FeedbackMessage }) {
  const [expanded, setExpanded] = useState(false);
  const needsTrim = item.text.length > TEXT_PREVIEW_LIMIT;
  const visibleText =
    !needsTrim || expanded
      ? item.text
      : `${item.text.slice(0, TEXT_PREVIEW_LIMIT)}…`;

  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-4 py-3 text-xs text-fg-secondary">
        {formatDate(item.createdAt)}
      </td>
      <td className="px-4 py-3 text-fg-primary">
        <p className="whitespace-pre-wrap break-words">{visibleText}</p>
        {needsTrim && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-accent hover:underline"
          >
            {expanded ? "свернуть" : "развернуть"}
          </button>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge status={item.status} />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  if (status === "received") {
    return <Badge variant="secondary">получено</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) {
    return <p className="mt-3 text-xs text-fg-tertiary">Всего: {total}.</p>;
  }
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-fg-tertiary">
      <span>
        Страница {page} из {totalPages}. Всего: {total}.
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Назад
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Вперёд
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border-subtle bg-bg-card px-6 py-10 text-center text-sm text-fg-tertiary">
      Вы пока не отправляли предложений.
    </div>
  );
}

function ErrorView({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : "Не удалось загрузить историю обращений.";
  return (
    <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function formatDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
