"use client";

import { Copy, Download, Printer } from "lucide-react";
import { toast } from "sonner";

import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { Button } from "@/ui/shadcn/button";

import { structuredReportToMarkdown } from "./structured-report";

export function ReportActions({
  output,
  title,
}: {
  output: unknown;
  title?: string;
}) {
  const md = structuredReportToMarkdown(output, title);

  const onCopy = async (): Promise<void> => {
    const ok = await copyToClipboard(md);
    if (ok) {
      toast.success("Текст отчёта скопирован");
    } else {
      toast.error("Не удалось скопировать");
    }
  };

  const onDownload = (): void => {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyFilename(title) || "отчёт"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onPrint = (): void => {
    window.print();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={onCopy}>
        <Copy size={14} aria-hidden />
        Скопировать текст
      </Button>
      <Button variant="secondary" size="sm" onClick={onDownload}>
        <Download size={14} aria-hidden />
        Скачать
      </Button>
      <Button variant="secondary" size="sm" onClick={onPrint}>
        <Printer size={14} aria-hidden />
        Печать
      </Button>
    </div>
  );
}

function slugifyFilename(title?: string): string {
  if (!title) return "";
  return title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}
