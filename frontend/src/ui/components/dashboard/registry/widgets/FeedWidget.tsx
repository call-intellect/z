"use client";

import type { FC, ReactNode } from "react";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import useSWR from "swr";

import {
  coraFeedApi,
  type CoraFeedTypeApi,
} from "@/api/cora-feed.api";
import { useAuth } from "@/contexts/auth-context";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";
import { Skeleton } from "@/ui/shadcn/skeleton";

import type { Rhythm } from "../types";
import { SourceLink } from "../_kit";

const TYPE_ICON: Record<CoraFeedTypeApi, ReactNode> = {
  idea: <Lightbulb size={15} />,
  insight: <Sparkles size={15} />,
  decision: <CheckCircle2 size={15} />,
  conflict: <AlertTriangle size={15} />,
  blocker: <ShieldAlert size={15} />,
  activity: <Zap size={15} />,
  probe_question: <HelpCircle size={15} />,
  open_question: <HelpCircle size={15} />,
};

const TYPE_BADGE: Record<CoraFeedTypeApi, { label: string; bg: string; fg: string }> = {
  idea: {
    label: "Идея",
    bg: "var(--chip-success-bg)",
    fg: "var(--chip-success-fg)",
  },
  decision: {
    label: "Решение",
    bg: "var(--chip-success-bg)",
    fg: "var(--chip-success-fg)",
  },
  activity: {
    label: "Событие",
    bg: "var(--surface-inset-strong)",
    fg: "var(--text-secondary)",
  },
  open_question: {
    label: "Вопрос Коры",
    bg: "var(--chip-warning-bg)",
    fg: "var(--chip-warning-fg)",
  },
  probe_question: {
    label: "Вопрос Коры",
    bg: "var(--chip-warning-bg)",
    fg: "var(--chip-warning-fg)",
  },
  insight: {
    label: "Риск/Инсайт",
    bg: "var(--chip-danger-bg)",
    fg: "var(--chip-danger-fg)",
  },
  blocker: {
    label: "Блокер",
    bg: "var(--chip-danger-bg)",
    fg: "var(--chip-danger-fg)",
  },
  conflict: {
    label: "Конфликт",
    bg: "var(--chip-danger-bg)",
    fg: "var(--chip-danger-fg)",
  },
};

type FeedFilter = "all" | "events" | "questions" | "risks";

const FILTER_GROUPS: Record<Exclude<FeedFilter, "all">, CoraFeedTypeApi[]> = {
  events: ["activity", "decision", "idea"],
  questions: ["open_question", "probe_question"],
  risks: ["insight", "blocker", "conflict"],
};

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "events", label: "События" },
  { key: "questions", label: "Вопросы" },
  { key: "risks", label: "Риски" },
];

function windowForRhythm(rhythm: Rhythm): number {
  return rhythm === "today" ? 1 : rhythm === "week" ? 7 : 30;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export const FeedWidget: FC<{ rhythm: Rhythm }> = ({ rhythm }) => {
  const { currentOrgId } = useAuth();
  const window = windowForRhythm(rhythm);
  const [filter, setFilter] = useState<FeedFilter>("all");

  const swr = useSWR(
    currentOrgId ? ["cora-feed", currentOrgId, window] : null,
    async () =>
      coraFeedApi.list(currentOrgId, { window, limit: 12 }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (swr.isLoading) {
    return (
      <GlassCard>
        <CardTitle icon={<Activity size={16} />} grad={GRAD.blue}>
          Лента
        </CardTitle>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </GlassCard>
    );
  }

  const items = swr.data?.items ?? [];
  if (items.length === 0) return null;

  const filtered =
    filter === "all"
      ? items
      : items.filter((item) => FILTER_GROUPS[filter].includes(item.type));

  return (
    <GlassCard>
      <CardTitle icon={<Activity size={16} />} grad={GRAD.blue}>
        Лента
      </CardTitle>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className="rounded-full px-3 py-1 text-xs font-medium transition hover:brightness-110"
            style={
              filter === f.key
                ? {
                    background: "var(--surface-inset-strong)",
                    color: CHART.text,
                  }
                : { background: "var(--surface-inset)", color: CHART.faint }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p
          className="mt-4 py-4 text-center text-sm"
          style={{ color: CHART.faint }}
        >
          За период событий этого типа нет.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((item) => {
            const meetingId = item.sourceRef?.meetingId;
            const badge = TYPE_BADGE[item.type];
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-xl p-3"
                style={{ background: "var(--surface-inset)" }}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: "var(--surface-inset-strong)",
                    color: CHART.dim,
                  }}
                  aria-hidden
                >
                  {TYPE_ICON[item.type]}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: badge.bg, color: badge.fg }}
                  >
                    {badge.label}
                  </span>
                  <span
                    className="block truncate text-sm font-medium"
                    style={{ color: CHART.text }}
                  >
                    {item.title}
                  </span>
                  <span
                    className="mt-0.5 block text-xs"
                    style={{ color: CHART.faint }}
                  >
                    {formatRelative(item.createdAt)}
                  </span>
                </span>
                {meetingId ? (
                  <SourceLink
                    href={`/meetings/${meetingId}/result`}
                    label="К встрече"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
};
