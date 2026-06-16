"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import {
  adminPromptTemplatesApi,
  DEMO_MEETING_KEYS,
  type DemoMeetingKey,
  type PreviewResultApi,
} from "@/api/admin-prompt-templates.api";
import { DEMO_MEETING_LABEL } from "@/domain/admin-prompt-template";
import { ApiError } from "@/api/api-error";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

export function PromptPreviewModal({
  open,
  onOpenChange,
  templateId,
  activeVersionId,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  templateId: string;
  activeVersionId: string | null;
}) {
  const [meetingKey, setMeetingKey] = useState<DemoMeetingKey>("demo-sales");
  const [useDraft, setUseDraft] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PreviewResultApi | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await adminPromptTemplatesApi.preview(templateId, {
        demoMeetingKey: meetingKey,
        ...(!useDraft && activeVersionId ? { versionId: activeVersionId } : {}),
      });
      setResult(res);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Предпросмотр не удался";
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Предпросмотр на демо-встрече</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-fg-secondary">
              <span>Демо-встреча</span>
              <Select
                value={meetingKey}
                onValueChange={(v) => setMeetingKey(v as DemoMeetingKey)}
              >
                <SelectTrigger className="h-9 w-72 bg-bg-card text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEMO_MEETING_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {DEMO_MEETING_LABEL[k] ?? k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="mb-2 inline-flex items-center gap-1 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={useDraft}
                onChange={(e) => setUseDraft(e.target.checked)}
              />
              <span>Тестировать последний черновик</span>
            </label>
            <Button size="sm" onClick={run} disabled={running}>
              {running && <Loader2 size={14} className="mr-1 animate-spin" />}
              Сгенерировать
            </Button>
          </div>

          {result && (
            <div className="space-y-3 rounded-lg border border-border-subtle bg-bg-subtle p-4">
              <div className="flex flex-wrap items-center gap-4 text-xs text-fg-secondary">
                <span>
                  Модель:{" "}
                  <span className="font-mono text-fg-primary">
                    {result.modelUsed}
                  </span>
                </span>
                <span>
                  Длительность:{" "}
                  <span className="font-mono">{result.durationMs} мс</span>
                </span>
                <span>
                  Стоимость:{" "}
                  <span
                    className={
                      result.costOverBudget
                        ? "font-mono text-danger"
                        : "font-mono"
                    }
                  >
                    ${result.costUsd.toFixed(5)}
                  </span>
                  {result.costOverBudget && (
                    <span className="ml-1 text-danger">(превышен лимит)</span>
                  )}
                </span>
                <span>
                  Токены:{" "}
                  <span className="font-mono">{result.inputTokens}</span> →{" "}
                  <span className="font-mono">{result.outputTokens}</span>
                </span>
              </div>
              <details
                className="rounded border border-border-subtle bg-bg-card"
                open
              >
                <summary className="cursor-pointer p-2 text-sm font-medium text-fg-primary">
                  Ответ ИИ
                </summary>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-3 text-xs text-fg-primary">
                  {result.text}
                </pre>
              </details>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
