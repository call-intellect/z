"use client";

import Link from "next/link";
import { useState } from "react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import type { DeskView } from "@/api/support.api";
import { useDeskTickets } from "@/hooks/useDeskTickets";
import { useSupportStatus } from "@/hooks/useSupportStatus";
import type { DeskTicketListItem } from "@/domain/support";
import { Badge } from "@/ui/shadcn/badge";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { cn } from "@/ui/shadcn/lib/utils";

const VIEWS: { id: DeskView; label: string }[] = [
  { id: "unassigned", label: "Новые" },
  { id: "mine", label: "Мои" },
  { id: "all", label: "Все" },
  { id: "closed", label: "Закрытые" },
  { id: "spam", label: "Спам" },
];

export function DeskClient() {
  const { isAgent, isLoading: statusLoading } = useSupportStatus();
  const [view, setView] = useState<DeskView>("unassigned");

  const { data, error, isLoading } = useDeskTickets(view, isAgent);

  if (statusLoading) return <ListSkeleton />;
  if (!isAgent) return <NotAgent />;

  return (
    <div>
      <nav aria-label="Фильтр очереди" className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              view === v.id
                ? "bg-accent/15 text-accent-fg"
                : "bg-bg-overlay/60 text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary",
            )}
            aria-current={view === v.id ? "page" : undefined}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {error ? (
        <ErrorView error={error} />
      ) : isLoading && !data ? (
        <ListSkeleton />
      ) : !data || data.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((t) => (
            <DeskTicketRow key={t.ticketId} ticket={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DeskTicketRow({ ticket }: { ticket: DeskTicketListItem }) {
  const slaBreached = ticket.slaBreachedAt !== null;
  return (
    <li>
      <Link
        href={`/support/desk/${ticket.ticketId}`}
        className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-card px-4 py-3 transition-colors hover:bg-bg-overlay"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-fg-tertiary">
              {ticket.ticketNumber}
            </span>
            {ticket.status && (
              <Badge variant="secondary">{ticket.status}</Badge>
            )}
            {slaBreached && <Badge variant="danger">SLA нарушен</Badge>}
            {ticket.assigneeUserIds.length === 0 && (
              <Badge variant="warning">Без исполнителя</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm font-medium text-fg-primary">
            {ticket.subject}
          </p>
          {ticket.customerContact && (
            <p className="mt-0.5 truncate text-xs text-fg-tertiary">
              {ticket.customerContact}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs text-fg-tertiary">
          {formatDate(ticket.updatedAt)}
        </span>
      </Link>
    </li>
  );
}

function NotAgent() {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card px-6 py-12 text-center text-sm text-fg-tertiary">
      Вы не сотрудник поддержки.
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card px-6 py-12 text-center text-sm text-fg-tertiary">
      В этой очереди нет обращений.
    </div>
  );
}

function ErrorView({ error }: { error: unknown }) {
  const message = humanizeApiError(error, "Не удалось загрузить очередь.");
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
