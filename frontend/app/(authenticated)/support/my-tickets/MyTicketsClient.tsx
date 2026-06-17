"use client";

import Link from "next/link";

import { ApiError } from "@/api/api-error";
import { useMyTickets } from "@/hooks/useMyTickets";
import type { SupportTicketListItem } from "@/domain/support";
import { Badge } from "@/ui/shadcn/badge";
import { Skeleton } from "@/ui/shadcn/skeleton";

export function MyTicketsClient() {
  const { data, error, isLoading } = useMyTickets();

  if (error) return <ErrorView error={error} />;
  if (isLoading && !data) return <ListSkeleton />;
  if (!data || data.length === 0) return <EmptyState />;

  return (
    <ul className="flex flex-col gap-2">
      {data.map((t) => (
        <TicketRow key={t.ticketId} ticket={t} />
      ))}
    </ul>
  );
}

function TicketRow({ ticket }: { ticket: SupportTicketListItem }) {
  return (
    <li>
      <Link
        href={`/support/my-tickets/${ticket.ticketId}`}
        className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-card px-4 py-3 transition-colors hover:bg-bg-overlay"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-fg-tertiary">
              {ticket.ticketNumber}
            </span>
            {ticket.status && (
              <Badge variant="secondary">{ticket.status}</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm font-medium text-fg-primary">
            {ticket.subject}
          </p>
        </div>
        <span className="shrink-0 text-xs text-fg-tertiary">
          {formatDate(ticket.updatedAt)}
        </span>
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card px-6 py-12 text-center text-sm text-fg-tertiary">
      У вас пока нет обращений.
    </div>
  );
}

function ErrorView({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : "Не удалось загрузить обращения.";
  return (
    <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
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
