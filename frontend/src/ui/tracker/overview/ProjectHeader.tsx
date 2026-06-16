"use client";

import type {
  OverviewProjectMiniApi,
  OverviewUserMiniApi,
} from "@/domain/tracker/overview";

function avatarInitials(name: string | null, email: string | null): string {
  const src = name?.trim() || email?.split("@")[0] || "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] ?? "") + (parts[1][0] ?? "");
  }
  return src.slice(0, 2).toUpperCase();
}

export function ProjectHeader({
  project,
  members,
  totalMembersCount,
}: {
  project: OverviewProjectMiniApi;
  members: OverviewUserMiniApi[];
  totalMembersCount?: number;
}) {
  const isArchived = Boolean(project.archivedAt);
  const visible = members.slice(0, 8);
  const overflow = Math.max(
    0,
    (totalMembersCount ?? members.length) - visible.length,
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-fg-primary">
          {project.name}
        </h2>
        <span className="rounded bg-bg-overlay px-2 py-0.5 text-xs text-fg-tertiary">
          {project.identifier}
        </span>
        <span
          className={
            isArchived
              ? "rounded bg-chip-warning-bg px-2 py-0.5 text-xs text-chip-warning-fg"
              : "rounded bg-chip-success-bg px-2 py-0.5 text-xs text-chip-success-fg"
          }
        >
          {isArchived ? "Архив" : "В работе"}
        </span>
      </div>

      {project.description ? (
        <p className="text-sm text-fg-secondary line-clamp-3">
          {project.description}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-tertiary">Участники:</span>
          <div className="flex -space-x-2">
            {visible.map((m) => (
              <span
                key={m.id}
                title={m.name ?? m.email ?? m.id}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-bg-base bg-bg-overlay text-[11px] font-medium text-fg-secondary"
              >
                {avatarInitials(m.name, m.email)}
              </span>
            ))}
            {overflow > 0 ? (
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-bg-base bg-bg-overlay px-2 text-[11px] font-medium text-fg-secondary">
                +{overflow}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
