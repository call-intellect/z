"use client";

import Link from "next/link";

import {
  activityVerbLabel,
  type ProjectActivityItem,
} from "@/domain/tracker/overview";

function timeAgo(d: Date): string {
  const now = Date.now();
  const diffSec = Math.floor((now - d.getTime()) / 1000);
  if (diffSec < 60) return "только что";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч. назад`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} дн. назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function ActivityFeedWidget({
  projectSlug,
  items,
}: {
  projectSlug: string;
  items: ProjectActivityItem[];
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <h3 className="text-sm font-medium text-fg-primary">
        Последняя активность
      </h3>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">
          В проекте пока не было активности.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-baseline gap-1 text-sm text-fg-secondary"
            >
              <span className="text-fg-primary">
                {a.actorUserId ?? "Система"}
              </span>
              <span>{activityVerbLabel(a.verb)}</span>
              {a.issueIdentifier ? (
                <Link
                  href={`/projects/${encodeURIComponent(projectSlug)}/list?search=${encodeURIComponent(a.issueIdentifier)}`}
                  className="font-medium text-accent hover:underline"
                >
                  {a.issueIdentifier}
                </Link>
              ) : null}
              <span className="ml-auto text-xs text-fg-tertiary">
                {timeAgo(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
