"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileSearch, Loader2, Lock, Volume2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/shadcn/sheet";
import { useProvenance } from "@/hooks/useProvenance";
import {
  provenanceCoverageLabel,
  type ProvenanceRef,
} from "@/domain/provenance";
import { provenanceApi } from "@/api/provenance.api";
import type { ProvenanceEntityTypeApi } from "@/api/provenance.api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null | undefined;
  entityType: ProvenanceEntityTypeApi;
  entityId: string | null | undefined;
  title?: string;
};

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
    : `${m}:${sec.toString().padStart(2, "0")}`;
}

function attributionLabel(attribution: ProvenanceRef["attribution"]): string {
  return attribution === "inferred" ? "〔вывод〕" : "〔цитата〕";
}

export function ProvenanceDrawer({
  open,
  onOpenChange,
  orgId,
  entityType,
  entityId,
  title,
}: Props) {
  const { provenance, isLoading, error } = useProvenance(
    orgId,
    entityType,
    entityId,
    open,
  );

  const nodes = provenance?.nodes ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSearch size={16} className="text-fg-tertiary" aria-hidden />
            Откуда это
          </SheetTitle>
          {title ? <SheetDescription>{title}</SheetDescription> : null}
          {provenance ? (
            <SheetDescription>
              {provenanceCoverageLabel(provenance.coverage)}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="-mx-2 flex-1 overflow-y-auto px-2">
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-fg-tertiary">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Загрузка…
            </div>
          ) : null}

          {!isLoading && error ? (
            <p className="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              Не удалось загрузить источники
            </p>
          ) : null}

          {!isLoading && !error && nodes.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-tertiary">
              Создано вручную — источника нет
            </p>
          ) : null}

          {!isLoading && !error && nodes.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {nodes.map((node, idx) => (
                <ProvenanceNodeCard
                  key={`${node.blockId}-${idx}`}
                  node={node}
                  orgId={orgId}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProvenanceNodeCard({
  node,
  orgId,
}: {
  node: ProvenanceRef;
  orgId: string | null | undefined;
}) {
  if (node.accessFiltered) {
    return (
      <li className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-overlay p-3 text-sm text-fg-tertiary">
        <Lock size={14} strokeWidth={1.75} aria-hidden />
        Источник скрыт правами доступа
      </li>
    );
  }

  const showDocConfidence =
    node.source.type === "document" && node.confidence !== null;

  return (
    <li className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {typeof node.startMs === "number" ? (
          <span className="font-mono text-accent">{fmtTime(node.startMs)}</span>
        ) : null}
        <span className="text-fg-secondary">{node.source.label}</span>
        <span className="text-fg-tertiary">
          {attributionLabel(node.attribution)}
        </span>
        {node.needsReview ? (
          <span className="rounded bg-chip-warning-bg px-1.5 py-0.5 text-[11px] text-chip-warning-fg">
            Требует проверки
          </span>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-fg-primary">«{node.quote}»</p>

      {node.attribution === "inferred" ? (
        <p className="mt-1 text-xs text-fg-tertiary">
          По AI-выжимке отчёта, не дословно
        </p>
      ) : null}

      {showDocConfidence ? (
        <p className="mt-1 text-xs text-fg-tertiary">
          Уверенность: {((node.confidence ?? 0) * 100).toFixed(0)}%
        </p>
      ) : null}

      {node.source.deepLink ? (
        <Link
          href={node.source.deepLink}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
        >
          <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden />
          Перейти к первоисточнику
        </Link>
      ) : null}

      {node.source.type === "voice_note" && node.hasAudio && node.rawEventId ? (
        <VoiceNotePlayer orgId={orgId} rawEventId={node.rawEventId} />
      ) : null}
    </li>
  );
}

function VoiceNotePlayer({
  orgId,
  rawEventId,
}: {
  orgId: string | null | undefined;
  rawEventId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  if (url) {
    return (
      <audio
        controls
        src={url}
        className="mt-2 h-9 w-full"
        aria-label="Оригинал голосового сообщения"
      />
    );
  }

  const onClick = async () => {
    if (!orgId) {
      setFailed(true);
      return;
    }
    setLoading(true);
    try {
      const res = await provenanceApi.voiceNoteAudio(orgId, rawEventId);
      setUrl(res.url);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-60"
    >
      {loading ? (
        <Loader2 size={12} className="animate-spin" aria-hidden />
      ) : (
        <Volume2 size={12} strokeWidth={1.75} aria-hidden />
      )}
      Послушать оригинал
    </button>
  );
}
