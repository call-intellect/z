"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ApiError } from "@/api/api-error";
import {
  experimentsApi,
  type ExperimentDetailApi,
  type ExperimentStatusApi,
  type ExperimentsListResponseApi,
} from "@/api/experiments.api";
import { useAuth } from "@/contexts/auth-context";
import {
  EXPERIMENT_LESSON_TYPE_LABEL,
  EXPERIMENT_LESSON_TYPE_TONE,
  EXPERIMENT_STATUS_LABEL,
  EXPERIMENT_STATUS_TONE,
  experimentRunningDurationDays,
  mapExperimentDetail,
  type ExperimentDetail,
} from "@/domain/experiment";
import { Input } from "@/ui/shadcn/input";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

export function ExperimentsListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  return <ExperimentsListContent />;
}

const STATUS_FILTERS: ReadonlyArray<{
  value: "all" | ExperimentStatusApi;
  label: string;
}> = [
  { value: "all", label: "Все статусы" },
  { value: "hypothesis", label: "Гипотезы" },
  { value: "running", label: "Идут" },
  { value: "completed", label: "Завершённые" },
  { value: "dropped", label: "Прекращённые" },
  { value: "paused", label: "На паузе" },
];

const TRANSITION_OPTIONS: ReadonlyArray<{
  to: "running" | "completed" | "dropped" | "paused";
  label: string;
}> = [
  { to: "running", label: "Запустить" },
  { to: "completed", label: "Завершить" },
  { to: "dropped", label: "Прекратить" },
  { to: "paused", label: "На паузу" },
];

const TONE_TO_CLASS: Record<string, string> = {
  info: "bg-chip-info-bg text-chip-info-fg",
  warning: "bg-chip-warning-bg text-chip-warning-fg",
  success: "bg-chip-success-bg text-chip-success-fg",
  neutral: "bg-bg-subtle text-fg-secondary",
  danger: "bg-chip-danger-bg text-chip-danger-fg",
};

function ExperimentsListContent() {
  const [data, setData] = useState<ExperimentsListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ExperimentStatusApi>(
    "all",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);

  const fetchList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await experimentsApi.list({
        page: 1,
        limit: 100,
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(q.trim().length > 0 ? { q: q.trim() } : {}),
      });
      setData(resp);
      if (!selectedId && resp.items.length > 0) {
        setSelectedId(resp.items[0]?.id ?? null);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "forbidden") {
          setForbidden(true);
        } else {
          setError(err.message);
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Не удалось загрузить эксперименты");
      }
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, q]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    experimentsApi
      .get(selectedId)
      .then((d) => setDetail(mapExperimentDetail(d)))
      .catch((err) => {
        if (err instanceof Error) setError(err.message);
      })
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const handleTransition = useCallback(
    async (to: "running" | "completed" | "dropped" | "paused") => {
      if (!detail) return;
      setTransitionBusy(true);
      try {
        const updated = await experimentsApi.transition(detail.id, { to });
        setDetail(mapExperimentDetail(updated));
        await fetchList();
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      } finally {
        setTransitionBusy(false);
      }
    },
    [detail, fetchList],
  );

  const items = useMemo(() => data?.items ?? [], [data]);

  if (forbidden) {
    return (
      <AdminForbidden
        title="Нет прав на просмотр экспериментов"
        description="Попросите владельца или администратора организации выдать вам право `experiment:read`."
      />
    );
  }
  if (error) {
    return <AdminError message={error} onRetry={() => void fetchList()} />;
  }
  if (isLoading && !data) return <AdminLoading rows={6} />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-6">
      {}
      <section className="space-y-4">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Эксперименты</h1>
          <p className="text-sm text-fg-secondary">
            Институциональная память компании: что попробовали, что вышло, чему
            научились.
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Поиск по гипотезе или названию…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | ExperimentStatusApi)
            }
            className="rounded-md border border-border bg-bg-card px-3 py-2 text-sm"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-sm text-fg-secondary">
              Пока нет экспериментов. Они появятся автоматически, как только в
              ваших встречах прозвучат гипотезы и результаты.
            </div>
          ) : (
            items.map((item) => {
              const isSelected = item.id === selectedId;
              const tone = EXPERIMENT_STATUS_TONE[item.status];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-md border p-3 text-left text-sm transition ${
                    isSelected
                      ? "border-accent bg-chip-info-bg"
                      : "border-border-subtle bg-bg-card hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-fg-primary">
                      {item.name}
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        TONE_TO_CLASS[tone] ?? TONE_TO_CLASS.neutral
                      }`}
                    >
                      {EXPERIMENT_STATUS_LABEL[item.status]}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-fg-secondary">
                    {item.hypothesisText}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-fg-secondary">
                    <span>Уроков: {item.lessonsCount}</span>
                    <span>Блоков: {item.sourceBlocksCount}</span>
                    <span>
                      Уверенность: {Math.round(item.confidence * 100)}%
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {}
      <section className="rounded-md border border-border-subtle bg-bg-card p-5">
        {!detail && !detailLoading ? (
          <div className="text-sm text-fg-secondary">
            Выберите эксперимент слева.
          </div>
        ) : detailLoading ? (
          <AdminLoading rows={6} />
        ) : (
          detail && (
            <ExperimentDetailView
              detail={detail}
              busy={transitionBusy}
              onTransition={handleTransition}
            />
          )
        )}
      </section>
    </div>
  );
}

function ExperimentDetailView({
  detail,
  busy,
  onTransition,
}: {
  detail: ExperimentDetail;
  busy: boolean;
  onTransition: (
    to: "running" | "completed" | "dropped" | "paused",
  ) => Promise<void>;
}) {
  const tone = EXPERIMENT_STATUS_TONE[detail.status];
  const days = experimentRunningDurationDays(detail);
  return (
    <article className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{detail.name}</h2>
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              TONE_TO_CLASS[tone] ?? TONE_TO_CLASS.neutral
            }`}
          >
            {EXPERIMENT_STATUS_LABEL[detail.status]}
          </span>
        </div>
        <Link
          href={`/experiments/${detail.id}`}
          className="text-xs text-info hover:underline"
        >
          Открыть отдельной страницей →
        </Link>
      </header>

      <section>
        <h3 className="text-sm font-medium text-fg-secondary">Гипотеза</h3>
        <p className="mt-1 text-sm text-fg-primary whitespace-pre-wrap">
          {detail.hypothesisText}
        </p>
      </section>

      {detail.currentResult && (
        <section>
          <h3 className="text-sm font-medium text-fg-secondary">
            Текущий результат
          </h3>
          <p className="mt-1 text-sm text-fg-primary whitespace-pre-wrap">
            {detail.currentResult}
          </p>
        </section>
      )}

      <section>
        <h3 className="text-sm font-medium text-fg-secondary">Уроки</h3>
        {detail.lessons.length === 0 ? (
          <p className="mt-1 text-sm text-fg-secondary">
            Уроки ещё не зафиксированы.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {detail.lessons.map((l, idx) => {
              const lessonTone = EXPERIMENT_LESSON_TYPE_TONE[l.type];
              return (
                <li
                  key={`${l.type}-${idx}`}
                  className="rounded-md border border-border-subtle p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        TONE_TO_CLASS[lessonTone] ?? TONE_TO_CLASS.neutral
                      }`}
                    >
                      {EXPERIMENT_LESSON_TYPE_LABEL[l.type]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-fg-primary whitespace-pre-wrap">
                    {l.text}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 text-xs text-fg-secondary">
        <div>
          <div className="font-medium text-fg-secondary">Начат</div>
          <div>
            {detail.startedAt
              ? new Date(detail.startedAt).toLocaleString("ru-RU")
              : "—"}
          </div>
        </div>
        <div>
          <div className="font-medium text-fg-secondary">Завершён</div>
          <div>
            {detail.completedAt
              ? new Date(detail.completedAt).toLocaleString("ru-RU")
              : "—"}
          </div>
        </div>
        <div>
          <div className="font-medium text-fg-secondary">Длительность</div>
          <div>{days !== null ? `${days} дн.` : "—"}</div>
        </div>
        <div>
          <div className="font-medium text-fg-secondary">Блоков-источников</div>
          <div>{detail.sourceBlockIds.length}</div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium text-fg-secondary">Действия</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {TRANSITION_OPTIONS.map((opt) => (
            <button
              key={opt.to}
              type="button"
              disabled={busy || opt.to === detail.status}
              onClick={() => void onTransition(opt.to)}
              className="rounded-md border border-border bg-bg-card px-3 py-1.5 text-xs font-medium text-fg-primary hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>
    </article>
  );
}
