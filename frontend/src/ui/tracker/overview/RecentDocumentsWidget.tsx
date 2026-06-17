"use client";

import type { ProjectRecentDocument } from "@/domain/tracker/overview";

function fmt(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

export function RecentDocumentsWidget({
  documents,
}: {
  documents: ProjectRecentDocument[];
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <h3 className="text-sm font-medium text-fg-primary">Документы проекта</h3>

      {documents.length === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">Документов пока нет.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 rounded border border-border-subtle bg-bg-base p-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                {d.title}
              </span>
              <span className="shrink-0 text-xs text-fg-tertiary">
                {fmt(d.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
