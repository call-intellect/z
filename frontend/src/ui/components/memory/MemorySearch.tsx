"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";

import { knowledgeSearchApi } from "@/api/knowledge-search.api";
import { humanizeApiError } from "@/api/api-error";
import {
  knowledgeSearchResultsFromApi,
  type KnowledgeSearchResult,
} from "@/domain/knowledge-search";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { cn } from "@/ui/shadcn/lib/utils";

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "done";
      results: KnowledgeSearchResult[];
      tookMs: number;
      query: string;
    }
  | { kind: "error"; message: string };

function confidenceChipClass(confidence: number): string {
  const pct = confidence * 100;
  if (pct >= 80) return "bg-chip-success-bg text-chip-success-fg";
  if (pct >= 50) return "bg-chip-warning-bg text-chip-warning-fg";
  return "bg-bg-overlay text-fg-tertiary";
}

function fmtTimecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function MemorySearch() {
  const { currentOrgId } = useAuth();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });

  const runSearch = async () => {
    const q = query.trim();
    if (!q || !currentOrgId) return;
    setState({ kind: "loading" });
    try {
      const api = await knowledgeSearchApi.search(currentOrgId, {
        query: q,
        limit: 10,
      });
      const { items, tookMs } = knowledgeSearchResultsFromApi(api);
      setState({ kind: "done", results: items, tookMs, query: q });
    } catch (e) {
      const message = humanizeApiError(
        e,
        "Не получилось найти — мы уже чиним.",
      );
      setState({ kind: "error", message });
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch();
  };

  const canSubmit =
    state.kind !== "loading" &&
    query.trim().length > 0 &&
    Boolean(currentOrgId);

  return (
    <section className="rounded-xl border border-border-subtle bg-bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Search size={16} className="text-accent" />
        <h2 className="text-base font-medium text-fg-primary">
          Поиск по памяти компании
        </h2>
        <span className="ml-auto rounded-full bg-bg-overlay px-2 py-0.5 text-[11px] text-fg-tertiary">
          гибридный поиск
        </span>
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Что Кора знает про… (клиента, решение, риск)"
            className="pl-9"
            maxLength={500}
            aria-label="Поиск по памяти компании"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={!canSubmit}>
          {state.kind === "loading" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          Искать
        </Button>
      </form>

      <div className="mt-4">
        <MemorySearchBody state={state} hasOrg={Boolean(currentOrgId)} />
      </div>
    </section>
  );
}

function MemorySearchBody({
  state,
  hasOrg,
}: {
  state: SearchState;
  hasOrg: boolean;
}) {
  if (state.kind === "idle") {
    return (
      <p className="text-sm text-fg-secondary">
        {hasOrg
          ? "Спросите память компании одним запросом — Кора найдёт решения, факты и риски со ссылками на источники."
          : "Поиск доступен только в рамках организации."}
      </p>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-fg-tertiary">
        <Loader2 size={15} className="animate-spin" />
        Ищем по памяти…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-chip-danger-bg bg-chip-danger-bg px-4 py-3 text-sm text-chip-danger-fg">
        {state.message}
      </div>
    );
  }

  if (state.results.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-card px-4 py-6 text-center text-sm text-fg-secondary">
        Ничего не нашлось по запросу «{state.query}». Попробуйте
        переформулировать или задать вопрос помощнику в разделе «Спросить».
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-fg-tertiary">
        Найдено: {state.results.length} · {state.tookMs} мс
      </div>
      {state.results.map((r) => (
        <MemorySearchResultCard key={r.id} result={r} />
      ))}
    </div>
  );
}

function MemorySearchResultCard({ result }: { result: KnowledgeSearchResult }) {
  const pct = Math.round(result.confidence * 100);
  return (
    <article className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug text-fg-primary">
            {result.title}
          </div>
          {result.answer && result.answer !== result.title && (
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-fg-secondary">
              {result.answer}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-tertiary">
            <span className="rounded border border-border-subtle bg-bg-base px-1.5 py-0.5">
              {result.signalLabel}
            </span>
            {result.evidence && (
              <span className="inline-flex items-center gap-1">
                источник: {result.evidence.sourceLabel}
                {typeof result.evidence.startMs === "number" && (
                  <span className="font-mono text-accent">
                    [{fmtTimecode(result.evidence.startMs)}]
                  </span>
                )}
              </span>
            )}
          </div>
          {result.evidence && (
            <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs italic leading-relaxed text-fg-tertiary">
              «{result.evidence.quote}»
            </blockquote>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            confidenceChipClass(result.confidence),
          )}
        >
          уверенность {pct}%
        </span>
      </div>
    </article>
  );
}
