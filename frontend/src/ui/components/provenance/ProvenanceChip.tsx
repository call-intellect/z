"use client";

import { useState } from "react";
import { FileSearch } from "lucide-react";

import { cn } from "@/ui/shadcn/lib/utils";
import type { ProvenanceEntityTypeApi } from "@/api/provenance.api";

import { ProvenanceDrawer } from "./ProvenanceDrawer";

type Props = {
  orgId: string | null | undefined;
  entityType: ProvenanceEntityTypeApi;
  entityId: string | null | undefined;
  label?: string;
  title?: string;
  className?: string;
};

export function ProvenanceChip({
  orgId,
  entityType,
  entityId,
  label = "Откуда это",
  title,
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-bg-muted px-2.5 py-1 text-xs text-fg-secondary",
          "transition-colors hover:bg-bg-hover hover:text-fg-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className,
        )}
      >
        <FileSearch size={12} strokeWidth={1.75} aria-hidden />
        {label}
      </button>
      <ProvenanceDrawer
        open={open}
        onOpenChange={setOpen}
        orgId={orgId}
        entityType={entityType}
        entityId={entityId}
        title={title}
      />
    </>
  );
}
