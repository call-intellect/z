import Link from "next/link";

import { cn } from "@/ui/shadcn/lib/utils";
import { StatusDot, type StatusTone } from "./StatusDot";

export interface DrillListItem {
  id: string;
  title: string;
  meta?: string;
  tone?: StatusTone;
  href?: string;
}

function Row({ item }: { item: DrillListItem }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      {item.tone && <StatusDot tone={item.tone} />}
      <span className="min-w-0 flex-1 truncate text-fg-primary">
        {item.title}
      </span>
      {item.meta && (
        <span className="shrink-0 text-xs tabular-nums text-fg-tertiary">
          {item.meta}
        </span>
      )}
    </div>
  );
}

export function DrillList({ items }: { items: DrillListItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-bg-card">
      {items.map((item) => (
        <li key={item.id}>
          {item.href ? (
            <Link
              href={item.href}
              className={cn(
                "block transition-colors active:bg-bg-elevated",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              )}
            >
              <Row item={item} />
            </Link>
          ) : (
            <Row item={item} />
          )}
        </li>
      ))}
    </ul>
  );
}
