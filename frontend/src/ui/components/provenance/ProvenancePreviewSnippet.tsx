"use client";

import { useRouter } from "next/navigation";

import { cn } from "@/ui/shadcn/lib/utils";
import type { ProvenanceRef } from "@/domain/provenance";

const ATTRIBUTION_LABEL: Record<ProvenanceRef["attribution"], string> = {
  quoted: "〔цитата〕",
  inferred: "〔вывод〕",
};

export function ProvenancePreviewSnippet({
  preview,
  className,
}: {
  preview: ProvenanceRef | null | undefined;
  className?: string;
}) {
  const router = useRouter();

  if (!preview || !preview.quote.trim()) return null;

  const deepLink = preview.source.deepLink;
  const marker = ATTRIBUTION_LABEL[preview.attribution];

  const body = (
    <>
      <span className="not-italic text-fg-tertiary">{marker}</span>{" "}
      <span className="italic">«{preview.quote}»</span>
    </>
  );

  if (deepLink) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          router.push(deepLink);
        }}
        title="Открыть момент-источник"
        className={cn(
          "line-clamp-2 text-left text-xs text-fg-tertiary transition-colors hover:text-accent",
          "focus-visible:outline-none focus-visible:underline",
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={cn("line-clamp-2 text-xs text-fg-tertiary", className)}>
      {body}
    </div>
  );
}
