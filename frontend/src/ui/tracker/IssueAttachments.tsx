"use client";

import { useState, useRef } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/ui/shadcn/button";
import { issuesApi } from "@/api/tracker/issues.api";
import { humanizeApiError } from "@/api/api-error";

export function IssueAttachments({
  orgId,
  issueId,
  onUploaded,
}: {
  orgId: string;
  issueId: string;
  onUploaded?: () => Promise<unknown> | void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await issuesApi.uploadAttachment(orgId, issueId, file);
      await onUploaded?.();
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(humanizeApiError(err, "Не удалось загрузить файл"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm text-fg-tertiary">
        Файлы появятся здесь после загрузки.
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => void handleSelect(e)}
      />

      <Button
        variant="secondary"
        size="sm"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="gap-2"
      >
        {uploading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Upload size={14} />
        )}
        Загрузить файл
      </Button>
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
