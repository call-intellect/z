"use client";

import { ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { useActivityDigest } from "@/hooks/tracker/useActivityDigest";
import { Button } from "@/ui/shadcn/button";

export interface IssueActivityDigestProps {
  orgId: string;
  issueId: string;
}

export function IssueActivityDigest({
  orgId,
  issueId,
}: IssueActivityDigestProps) {
  const { digest, isLoading, error, load } = useActivityDigest(orgId, issueId);
  const [open, setOpen] = useState(false);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !digest && !isLoading) {
      void load();
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-elevated p-3">
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-2 text-left text-sm font-medium text-fg-primary"
        aria-expanded={open}
      >
        <Sparkles size={14} className="shrink-0 text-accent" aria-hidden />
        <span>Что произошло по задаче</span>
        <span className="ml-auto text-fg-tertiary">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-fg-tertiary">
            Кора соберёт короткую сводку изменений с вашего прошлого захода — без
            оценки людей.
          </p>

          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-fg-tertiary">
              <Loader2 size={14} className="animate-spin" />
              Собираю сводку…
            </div>
          ) : error ? (
            <div className="flex flex-col items-start gap-2">
              <div className="text-sm text-danger">{error}</div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void load()}
              >
                Повторить
              </Button>
            </div>
          ) : digest ? (
            <div className="flex flex-col gap-2">
              <p className="whitespace-pre-wrap break-words text-sm text-fg-primary">
                {digest.summary}
              </p>
              {digest.hasChanges && digest.points.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {digest.points.map((p, i) => (
                    <li
                      key={`${i}-${p.slice(0, 16)}`}
                      className="text-xs text-fg-secondary"
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void load()}
              className="self-start"
            >
              Собрать сводку
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
