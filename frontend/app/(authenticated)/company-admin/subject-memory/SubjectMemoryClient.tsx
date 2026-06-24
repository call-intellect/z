"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, CheckCircle2, XCircle, Sparkles } from "lucide-react";

import { humanizeApiError } from "@/api/api-error";
import {
  subjectMemoryApi,
  type SubjectMemoryListApi,
} from "@/api/subject-memory.api";
import {
  mapSubjectMemoryRule,
  SUBJECT_MEMORY_STATUS_LABELS,
  SUBJECT_MEMORY_STATUSES,
  type SubjectMemoryRule,
  type SubjectMemoryStatus,
  type SubjectMemoryStatusTone,
} from "@/domain/subject-memory";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/ui/shadcn/lib/utils";

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

const TONE_CHIP: Record<SubjectMemoryStatusTone, string> = {
  success: "bg-chip-success-bg text-chip-success-fg",
  info: "bg-chip-info-bg text-chip-info-fg",
  warning: "bg-chip-warning-bg text-chip-warning-fg",
  muted: "bg-bg-muted text-fg-tertiary",
};

function formatRuDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function SubjectMemoryClient() {
  const { currentOrgRole, isLoading: authLoading } = useAuth();
  const canSee =
    currentOrgRole === "owner" ||
    currentOrgRole === "admin" ||
    currentOrgRole === "coo";

  const [data, setData] = useState<SubjectMemoryListApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SubjectMemoryStatus | null>(
    null,
  );

  const load = useCallback(async (status: SubjectMemoryStatus | null) => {
    setLoading(true);
    setError(null);
    try {
      const dto = await subjectMemoryApi.list(
        status ? { status } : undefined,
      );
      setData(dto);
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось загрузить выученное"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canSee) void load(statusFilter);
  }, [canSee, load, statusFilter]);

  const rules: SubjectMemoryRule[] = useMemo(
    () => (data?.items ?? []).map(mapSubjectMemoryRule),
    [data],
  );

  const counts = data?.countsByStatus ?? {};

  if (authLoading) return <AdminLoading rows={4} />;
  if (!canSee) {
    return (
      <AdminForbidden
        title="Раздел доступен только руководителям"
        description="Что Кора выучила из ответов команды, видят владелец, администратор или операционный директор организации."
      />
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-muted text-accent">
            <Sparkles size={20} strokeWidth={1.75} />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Что Кора выучила</h1>
            <p className="max-w-2xl text-sm text-fg-secondary">
              Здесь то, что Кора усвоила из ваших ответов и теперь применяет
              сама, чтобы не переспрашивать.
            </p>
          </div>
        </div>
      </header>

      {!loading && !error && (
        <StatusCounters
          counts={counts}
          active={statusFilter}
          onSelect={setStatusFilter}
        />
      )}

      {loading ? (
        <AdminLoading rows={4} />
      ) : error ? (
        <AdminError message={error} onRetry={() => void load(statusFilter)} />
      ) : rules.length === 0 ? (
        <AdminEmpty
          title="Кора пока ничего не выучила"
          description="Это появится, когда вы начнёте отвечать на её уточняющие вопросы."
        />
      ) : (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusCounters({
  counts,
  active,
  onSelect,
}: {
  counts: Record<string, number>;
  active: SubjectMemoryStatus | null;
  onSelect: (next: SubjectMemoryStatus | null) => void;
}) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const present = SUBJECT_MEMORY_STATUSES.filter((s) => (counts[s] ?? 0) > 0);

  return (
    <div className="flex flex-wrap gap-2">
      <CounterChip
        label="Всё"
        value={total}
        selected={active === null}
        onClick={() => onSelect(null)}
      />
      {present.map((status) => (
        <CounterChip
          key={status}
          label={SUBJECT_MEMORY_STATUS_LABELS[status]}
          value={counts[status] ?? 0}
          selected={active === status}
          onClick={() => onSelect(active === status ? null : status)}
        />
      ))}
    </div>
  );
}

function CounterChip({
  label,
  value,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
        selected
          ? "border-accent bg-accent-muted text-fg-primary"
          : "border-border-subtle bg-bg-card text-fg-secondary hover:text-fg-primary",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 text-xs font-medium",
          selected ? "bg-accent text-accent-fg" : "bg-bg-muted text-fg-tertiary",
        )}
      >
        {value}
      </span>
    </button>
  );
}

function RuleCard({ rule }: { rule: SubjectMemoryRule }) {
  return (
    <li className="rounded-xl border border-border-subtle bg-bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-bg-muted px-2 py-0.5 text-xs font-medium text-fg-secondary">
              <Brain size={12} strokeWidth={2} />
              {rule.kindLabel}
            </span>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-medium",
                TONE_CHIP[rule.statusTone],
              )}
            >
              {rule.statusLabel}
            </span>
          </div>

          <p className="text-sm text-fg-primary">
            На вопрос про{" "}
            <span className="font-medium">«{rule.contextText}»</span> Кора теперь
            отвечает:{" "}
            <span className="font-medium text-accent">«{rule.ruleText}»</span>
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-tertiary">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2
                size={13}
                strokeWidth={2}
                className="text-success"
              />
              Подтверждено {rule.confirmCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <XCircle size={13} strokeWidth={2} className="text-danger" />
              Опровергнуто {rule.refuteCount}
            </span>
            <span>Применено {rule.appliedCount} раз</span>
            <span>Уверенность {rule.confidencePercent}%</span>
            <span>{formatRuDate(rule.occurredAt)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}
