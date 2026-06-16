"use client";

import { useCallback } from "react";

import {
  buildCsv,
  type CsvColumn,
} from "@/ui/components/admin/AdminCsvDownloadButton";

type Args<TRow extends Record<string, unknown>> = {
  rows: TRow[];
  columns: CsvColumn<TRow>[];
  filename: string;
};

export function useAdminCsvExport<TRow extends Record<string, unknown>>({
  rows,
  columns,
  filename,
}: Args<TRow>): () => void {
  return useCallback(() => {
    if (typeof window === "undefined") return;
    if (rows.length === 0) return;

    const csv = buildCsv(rows, columns);
    const blob = new Blob(["﻿", csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, columns, filename]);
}
