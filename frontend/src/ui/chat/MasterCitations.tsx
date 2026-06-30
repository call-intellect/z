"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { ChatV2CitationApi } from "@/api/chat-v2.api";
import { meetingsApi } from "@/api/meetings.api";
import { ApiError } from "@/api/api-error";
import {
  citationDeepLink,
  formatTimestamp,
  toChatV2Citation,
  type ChatV2Citation,
} from "@/domain/chat-v2";

const SOURCE_UNAVAILABLE_CODES = new Set([
  "meeting_not_found",
  "not_found",
  "db_not_found",
  "forbidden",
  "not_authorized",
]);

function isSourceUnavailableCode(code: string): boolean {
  return SOURCE_UNAVAILABLE_CODES.has(code);
}

export function MasterCitations({
  citations,
}: {
  citations: ChatV2CitationApi[];
}): ReactElement {
  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-2">
      <div className="text-xs font-medium text-fg-tertiary">Источники:</div>
      {citations.map((c, idx) => (
        <div
          key={`${c.documentId ?? c.meetingId}-${c.startMs}-${idx}`}
          className="rounded bg-bg px-2 py-1.5 text-xs"
        >
          <MasterCitationSource citation={toChatV2Citation(c)} />
          {c.snippet ? (
            <div className="mt-0.5 italic text-fg-secondary">
              &laquo;{c.snippet}&raquo;
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MasterCitationSource({
  citation,
}: {
  citation: ChatV2Citation;
}): ReactElement {
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);
  const [checking, setChecking] = useState(false);

  if (citation.documentId) {
    return (
      <div className="font-medium">
        <Link
          href={`/documents/${encodeURIComponent(citation.documentId)}`}
          className="text-accent hover:underline"
        >
          Документ: {citation.documentName ?? "без названия"}
        </Link>
      </div>
    );
  }

  const href = citationDeepLink(citation);

  if (!href || unavailable) {
    return (
      <div className="font-medium text-fg-tertiary">
        {citation.meetingTitle}{" "}
        <span className="not-italic">(источник недоступен)</span>
      </div>
    );
  }

  async function openMeeting(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    if (checking) return;
    setChecking(true);
    try {
      await meetingsApi.access(citation.meetingId);
      router.push(href as string);
    } catch (err) {
      if (err instanceof ApiError && !isSourceUnavailableCode(err.code)) {
        router.push(href as string);
      } else {
        setUnavailable(true);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="font-medium">
      <a
        href={href}
        onClick={(e) => void openMeeting(e)}
        aria-busy={checking}
        className="text-accent hover:underline aria-busy:opacity-60"
      >
        {citation.meetingTitle}{" "}
        <span className="text-fg-tertiary">
          [{formatTimestamp(citation.startMs)}]
        </span>
      </a>
    </div>
  );
}
