"use client";

import Link from "next/link";
import { ArrowLeft, History, Loader2 } from "lucide-react";
import useSWR from "swr";

import { chatboxApi, type ChatboxSyncRunApi } from "@/api/chatbox.api";
import {
  CardTitle,
  GlassCard,
  GRAD,
  STATUS_TONE,
} from "@/ui/components/dashboard/modern";
import { TierGate } from "@/ui/components/TierGate";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("ru-RU");
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const SYNC_STATUS_META: Record<
  string,
  { label: string; tone: keyof typeof STATUS_TONE }
> = {
  success: { label: "Готово", tone: "ok" },
  failed: { label: "Ошибка", tone: "risk" },
  running: { label: "Идёт", tone: "warning" },
  skipped: { label: "Пропуск", tone: "warning" },
};

const SYNC_COUNT_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "newChats", label: "новых чатов" },
  { key: "newMessages", label: "новых сообщений" },
  { key: "chats", label: "чатов всего" },
  { key: "messages", label: "сообщений всего" },
  { key: "customers", label: "клиентов" },
  { key: "channelClients", label: "контактов" },
  { key: "members", label: "менеджеров" },
  { key: "channels", label: "каналов" },
  { key: "analysisEnqueued", label: "в граф" },
];

function syncCountParts(
  counts: Record<string, unknown> | null,
): Array<{ label: string; value: number }> {
  if (!counts) return [];
  const parts: Array<{ label: string; value: number }> = [];
  for (const { key, label } of SYNC_COUNT_LABELS) {
    const v = counts[key];
    if (typeof v === "number") parts.push({ label, value: v });
  }
  return parts;
}

function SyncLogRow({ run }: { run: ChatboxSyncRunApi }) {
  const started = toDate(run.startedAt);
  const meta = SYNC_STATUS_META[run.status] ?? {
    label: run.status,
    tone: "warning" as const,
  };
  const tone = STATUS_TONE[meta.tone];
  const duration =
    run.durationMs != null ? `${Math.round(run.durationMs / 1000)} с` : null;
  const parts = syncCountParts(run.counts);

  return (
    <div className="space-y-1 border-t border-border-subtle py-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
        <span className="text-fg-primary">{formatDate(started)}</span>
        <span className="text-fg-tertiary">·</span>
        <span className="text-fg-secondary">
          {run.trigger === "auto" ? "По расписанию" : "Ручная"}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ color: tone.c, background: tone.bg }}
        >
          {meta.label}
        </span>
        {duration && (
          <span className="text-xs text-fg-tertiary">{duration}</span>
        )}
      </div>
      {parts.length > 0 && (
        <p className="text-xs text-fg-tertiary">
          собрано:{" "}
          {parts
            .map((p) => `${p.label} ${p.value.toLocaleString("ru-RU")}`)
            .join(" · ")}
        </p>
      )}
      {run.status === "failed" && run.error && (
        <p className="text-xs text-danger">{run.error}</p>
      )}
    </div>
  );
}

export function ChatboxSyncLogClient() {
  return (
    <TierGate feature="feature.chatbox">
      <ChatboxSyncLogContent />
    </TierGate>
  );
}

function ChatboxSyncLogContent() {
  const { data, isLoading } = useSWR(["chatbox-sync-log"], () =>
    chatboxApi.syncLog(20),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        href="/chats/integrations/chatbox"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft size={14} /> К интеграции
      </Link>
      <header className="mb-6 flex items-center gap-2">
        <History size={20} className="text-accent" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Журнал синхронизаций
          </h1>
          <p className="text-sm text-fg-secondary">
            История запусков синхронизации Чат бокса.
          </p>
        </div>
      </header>

      <GlassCard className="space-y-3">
        <CardTitle icon={<History size={16} />} grad={GRAD.blue}>
          Журнал синхронизаций
        </CardTitle>
        {isLoading ? (
          <div className="flex items-center text-sm text-fg-tertiary">
            <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем...
          </div>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-fg-tertiary">Синхронизаций ещё не было.</p>
        ) : (
          <div className="flex flex-col">
            {data.map((run) => (
              <SyncLogRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
