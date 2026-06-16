"use client";

import { Check, ExternalLink, Loader2, X } from "lucide-react";
import { useState } from "react";

import {
  PENDING_PATCH_REASON_LABEL_RU,
  formatCellValue,
  formatConfidencePercent,
  type PendingPatchDomain,
  type TablePropertyDomain,
  type TableRowDomain,
} from "@/domain/table";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";

export interface PendingPatchesPanelProps {
  open: boolean;
  onClose: () => void;
  patches: PendingPatchDomain[];
  properties: TablePropertyDomain[];
  rows: TableRowDomain[];
  onApprove: (patchId: string) => Promise<void>;
  onReject: (patchId: string) => Promise<void>;
  onApproveAll: () => Promise<void>;
  onRejectAll: () => Promise<void>;
}

export function PendingPatchesPanel({
  open,
  onClose,
  patches,
  properties,
  rows,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
}: PendingPatchesPanelProps) {
  const [bulkBusy, setBulkBusy] = useState(false);

  const runBulk = async (fn: () => Promise<void>) => {
    setBulkBusy(true);
    try {
      await fn();
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Правки на подтверждении</DialogTitle>
          <DialogDescription>
            Значения, предложенные из памяти компании. Примите, чтобы записать
            их в таблицу, или отклоните.
          </DialogDescription>
        </DialogHeader>

        {patches.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-subtle bg-bg-subtle px-4 py-8 text-center text-sm text-fg-tertiary">
            Нет правок, ожидающих подтверждения
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-tertiary">
                Всего правок: {patches.length}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => void runBulk(onRejectAll)}
                >
                  Отклонить все
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={bulkBusy}
                  onClick={() => void runBulk(onApproveAll)}
                >
                  {bulkBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Принять все
                </Button>
              </div>
            </div>

            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {patches.map((patch) => (
                <PatchRow
                  key={patch.id}
                  patch={patch}
                  properties={properties}
                  rows={rows}
                  disabled={bulkBusy}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PatchRowProps {
  patch: PendingPatchDomain;
  properties: TablePropertyDomain[];
  rows: TableRowDomain[];
  disabled: boolean;
  onApprove: (patchId: string) => Promise<void>;
  onReject: (patchId: string) => Promise<void>;
}

function PatchRow({
  patch,
  properties,
  rows,
  disabled,
  onApprove,
  onReject,
}: PatchRowProps) {
  const [busy, setBusy] = useState(false);

  const property = properties.find((p) => p.id === patch.propertyId) ?? null;
  const propType = property?.type ?? "text";
  const propName = property?.name ?? "Колонка";

  const row = rows.find((r) => r.id === patch.tableRowId) ?? null;
  const rowTitle = rowPrimaryLabel(row, properties);

  const confidence = formatConfidencePercent(patch.confidence);
  const reasonLabel = patch.reason
    ? PENDING_PATCH_REASON_LABEL_RU[patch.reason]
    : null;

  const run = async (fn: (id: string) => Promise<void>) => {
    setBusy(true);
    try {
      await fn(patch.id);
    } finally {
      setBusy(false);
    }
  };

  const isBusy = busy || disabled;

  return (
    <li className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-fg-primary">{rowTitle}</span>
        <span className="text-fg-tertiary">·</span>
        <span className="text-fg-secondary">{propName}</span>
        {reasonLabel ? <Badge variant="warning">{reasonLabel}</Badge> : null}
        {confidence ? (
          <span className="text-fg-tertiary">уверенность {confidence}</span>
        ) : null}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded bg-bg-subtle px-2 py-0.5 text-fg-tertiary line-through">
          {formatCellValue(patch.currentValue, propType) || "—"}
        </span>
        <span className="text-fg-tertiary" aria-hidden>
          →
        </span>
        <span className="rounded bg-chip-success-bg/10 px-2 py-0.5 text-fg-primary">
          {formatCellValue(patch.proposedValue, propType) || "—"}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        {patch.sourceLink ? (
          <a
            href={patch.sourceLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent transition-colors hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            {patch.sourceLabel || "Источник"}
          </a>
        ) : (
          <span className="truncate text-xs text-fg-tertiary">
            {patch.sourceLabel || "Источник"}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => void run(onReject)}
          >
            <X className="h-4 w-4" />
            Отклонить
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={isBusy}
            onClick={() => void run(onApprove)}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Принять
          </Button>
        </div>
      </div>
    </li>
  );
}

function rowPrimaryLabel(
  row: TableRowDomain | null,
  properties: TablePropertyDomain[],
): string {
  if (!row) return "Строка";
  const primary = properties.find((p) => p.isPrimary);
  if (primary) {
    const v = formatCellValue(row.cells[primary.id], primary.type);
    if (v) return v;
  }
  const firstText = properties.find(
    (p) => p.type === "text" || p.type === "longtext",
  );
  if (firstText) {
    const v = formatCellValue(row.cells[firstText.id], firstText.type);
    if (v) return v;
  }
  return "Строка";
}
