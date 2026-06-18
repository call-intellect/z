"use client";

export function IssueDescription({
  description,
}: {
  description: string | null;
}) {
  if (!description || description.trim().length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-6 text-sm text-fg-tertiary">
        Описание пока не заполнено.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated px-4 py-3 text-sm leading-relaxed text-fg-primary">
      <p className="whitespace-pre-wrap break-words">{description}</p>
    </div>
  );
}
