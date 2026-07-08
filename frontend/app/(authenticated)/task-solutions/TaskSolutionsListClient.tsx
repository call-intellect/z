"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  History,
  Quote,
  Search,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  taskSolutionsApi,
  type TaskSolutionStatusApi,
  type TaskSolutionsListResponseApi,
} from "@/api/task-solutions.api";
import { useAuth } from "@/contexts/auth-context";
import {
  TASK_SOLUTION_STATUS_LABEL,
  isInstructionCandidate,
  mapTaskSolutionDetail,
  mapTaskSolutionListItem,
  mapTaskSolutionSources,
  mapTaskSolutionSummary,
  mapTaskSolutionVersion,
  type TaskSolutionDetail,
  type TaskSolutionListItem,
  type TaskSolutionStatus,
} from "@/domain/task-solution";
import { Chip } from "@/ui/components/shared/Chip";
import { EmptyState } from "@/ui/components/shared/EmptyState";
import { ProvenancePreviewSnippet } from "@/ui/components/provenance/ProvenancePreviewSnippet";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { cn } from "@/ui/shadcn/lib/utils";

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from "@app/(admin)/admin/AdminStateViews";

export function TaskSolutionsListClient() {
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
  return <TaskSolutionsListContent />;
}

const STATUS_FILTERS: ReadonlyArray<{
  value: "all" | TaskSolutionStatusApi;
  label: string;
}> = [
  { value: "all", label: "Все статусы" },
  { value: "active", label: "Действует" },
  { value: "deprecated", label: "Устарел" },
  { value: "archived", label: "В архиве" },
];

const STATUS_CHIP: Record<TaskSolutionStatus, "success" | "warning" | "sand"> = {
  active: "success",
  deprecated: "warning",
  archived: "sand",
};

function TaskSolutionsListContent() {
  const { currentOrgRole } = useAuth();
  const canWrite = ["owner", "admin"].includes(currentOrgRole ?? "");
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const [data, setData] = useState<TaskSolutionsListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskSolutionStatusApi>(
    "all",
  );
  const [candidatesOnly, setCandidatesOnly] = useState(false);
  const [deletedFilter, setDeletedFilter] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskSolutionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await taskSolutionsApi.list({
        ...(qDebounced ? { q: qDebounced } : {}),
        ...(statusFilter !== "all" ? { status: statusFilter } : {}),
        ...(candidatesOnly ? { candidateInstruction: true } : {}),
        ...(deletedFilter ? { deleted: true } : {}),
        limit: 50,
      });
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        setForbidden(true);
      } else {
        setError(humanizeApiError(e, "Ошибка загрузки"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [qDebounced, statusFilter, candidatesOnly, deletedFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError(null);
    setSourcesOpen(false);
    setHistoryOpen(false);
    try {
      const dto = await taskSolutionsApi.get(selectedId);
      setDetail(mapTaskSolutionDetail(dto));
    } catch (e) {
      setDetailError(humanizeApiError(e, "Ошибка загрузки"));
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) void loadDetail();
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const handleConfirm = useCallback(async () => {
    if (!selectedId) return;
    try {
      await taskSolutionsApi.confirm(selectedId);
      toast.success("Актуальность подтверждена");
      await loadDetail();
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        toast.error("Изменять решения задач могут только owner / admin");
      } else {
        toast.error(humanizeApiError(e, "Не удалось подтвердить"));
      }
    }
  }, [selectedId, loadDetail]);

  const handleDelete = useCallback(async () => {
    if (!selectedId) return;
    const ok = await ask({
      title: "Удалить решение задачи?",
      description: "Восстановить можно в течение 30 дней.",
      confirmLabel: "Удалить",
      destructive: true,
    });
    if (!ok) return;
    try {
      await taskSolutionsApi.remove(selectedId);
      toast.success("Решение задачи удалено");
      setSelectedId(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        toast.error("Удалять решения задач могут только owner / admin");
      } else {
        toast.error(humanizeApiError(e, "Не удалось удалить"));
      }
    }
  }, [selectedId, ask, load]);

  const handleRestore = useCallback(async () => {
    if (!selectedId) return;
    try {
      await taskSolutionsApi.restore(selectedId);
      toast.success("Решение задачи восстановлено");
      setSelectedId(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "forbidden") {
        toast.error("Восстанавливать решения задач могут только owner / admin");
      } else {
        toast.error(humanizeApiError(e, "Не удалось восстановить"));
      }
    }
  }, [selectedId, load]);

  const items = useMemo(
    () => (data?.items ?? []).map(mapTaskSolutionListItem),
    [data],
  );

  const summarySwr = useSWR(
    "task-solutions-summary",
    async () => mapTaskSolutionSummary(await taskSolutionsApi.getSummary()),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const summary = summarySwr.data ?? null;

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  const filtersBlock = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative max-w-md flex-1">
        <Search
          className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по задаче или решению"
          className="pl-8"
        />
      </div>
      <select
        value={statusFilter}
        onChange={(e) =>
          setStatusFilter(e.target.value as "all" | TaskSolutionStatusApi)
        }
        className="rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
      >
        {STATUS_FILTERS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant={candidatesOnly ? "default" : "outline"}
        size="sm"
        onClick={() => {
          setSelectedId(null);
          setCandidatesOnly((v) => !v);
        }}
      >
        Только кандидаты в инструкцию
      </Button>
      {canWrite ? (
        <Button
          type="button"
          variant={deletedFilter ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setSelectedId(null);
            setDeletedFilter((v) => !v);
          }}
        >
          {deletedFilter ? "Показаны удалённые" : "Удалённые"}
        </Button>
      ) : null}
    </div>
  );

  const listBlock =
    items.length === 0 ? (
      <EmptyState
        title="Решений задач пока нет"
        description="Когда сотрудники закрывают задачи и рассказывают, как их решали, Кора собирает эти решения сюда — раз в сутки."
      />
    ) : (
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
        {items.map((s) => {
          const isSelected = selectedId === s.id;
          const candidate = isInstructionCandidate(s);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "flex w-full flex-col gap-1 px-4 py-3 text-left transition",
                  isSelected ? "bg-accent/5" : "hover:bg-bg-overlay/40",
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip variant={STATUS_CHIP[s.status]} size="sm">
                    {TASK_SOLUTION_STATUS_LABEL[s.status]}
                  </Chip>
                  {candidate ? (
                    <Chip variant="warning" size="sm">
                      🔁 похожих ×{s.repeatGroupSize} — оформить инструкцию
                    </Chip>
                  ) : null}
                  {s.skillTags.slice(0, 3).map((tag) => (
                    <Chip key={tag} variant="info" size="sm">
                      {tag}
                    </Chip>
                  ))}
                </div>
                <div className="truncate text-sm font-medium text-fg-primary">
                  {s.title}
                </div>
                {s.taskDescription ? (
                  <div className="line-clamp-2 text-xs text-fg-tertiary">
                    {s.taskDescription}
                  </div>
                ) : null}
                <div className="text-xs text-fg-tertiary">
                  {s.ownerName ? `${s.ownerName} · ` : ""}
                  Обновлено {s.updatedAt.toLocaleDateString("ru-RU")}
                </div>
              </button>
              <ProvenancePreviewSnippet
                preview={s.provenancePreview}
                className="mt-1 px-4 pb-3"
              />
            </li>
          );
        })}
      </ul>
    );

  const detailBlock = !selectedId ? (
    <p className="text-sm text-fg-tertiary">
      Выберите решение слева, чтобы увидеть, как задачу решали, и источники.
    </p>
  ) : detailLoading ? (
    <AdminLoading rows={3} />
  ) : detailError ? (
    <AdminError message={detailError} onRetry={loadDetail} />
  ) : !detail ? null : (
    <TaskSolutionDetailView
      detail={detail}
      canWrite={canWrite}
      deletedFilter={deletedFilter}
      sourcesOpen={sourcesOpen}
      onToggleSources={() => setSourcesOpen((v) => !v)}
      historyOpen={historyOpen}
      onToggleHistory={() => setHistoryOpen((v) => !v)}
      onConfirm={() => void handleConfirm()}
      onDelete={() => void handleDelete()}
      onRestore={() => void handleRestore()}
    />
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Решения задач</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Как команда решала конкретные задачи — Кора собирает это из ответов на
          опрос «как решал» и упоминаний за день.
          {summary ? (
            <span className="ml-1 text-fg-tertiary">
              Всего {summary.total} · кандидатов {summary.candidates}
              {summary.weekDelta > 0 ? ` · +${summary.weekDelta} за неделю` : ""}
            </span>
          ) : null}
        </p>
      </header>

      <div className="mb-4">{filtersBlock}</div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>{listBlock}</div>
        <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
          {detailBlock}
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}

function TaskSolutionDetailView({
  detail,
  canWrite,
  deletedFilter,
  sourcesOpen,
  onToggleSources,
  historyOpen,
  onToggleHistory,
  onConfirm,
  onDelete,
  onRestore,
}: {
  detail: TaskSolutionDetail;
  canWrite: boolean;
  deletedFilter: boolean;
  sourcesOpen: boolean;
  onToggleSources: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onConfirm: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const candidate = isInstructionCandidate(detail);
  return (
    <article className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant={STATUS_CHIP[detail.status]} size="sm">
            {TASK_SOLUTION_STATUS_LABEL[detail.status]}
          </Chip>
          {detail.skillTags.map((tag) => (
            <Chip key={tag} variant="info" size="sm">
              {tag}
            </Chip>
          ))}
        </div>
        <h2 className="text-lg font-semibold">{detail.title}</h2>
        <dl className="grid grid-cols-1 gap-1 text-xs text-fg-tertiary sm:grid-cols-2">
          {detail.ownerName ? (
            <div>
              <dt className="inline text-fg-secondary">Кто решал: </dt>
              <dd className="inline">{detail.ownerName}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline text-fg-secondary">Подтверждено: </dt>
            <dd className="inline">
              {detail.lastConfirmedAt
                ? detail.lastConfirmedAt.toLocaleDateString("ru-RU")
                : "—"}
            </dd>
          </div>
        </dl>
      </header>

      <section className="rounded-md border border-border-subtle bg-bg-overlay/20 px-3 py-2.5">
        <p className="text-sm text-fg-primary">
          <span className="font-medium text-fg-secondary">Задача: </span>
          {detail.taskDescription}
        </p>
        <Link
          href={detail.issueDeepLink}
          className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Открыть задачу
          {detail.sourceIssueIdentifier ? ` ${detail.sourceIssueIdentifier}` : ""}
        </Link>
      </section>

      {candidate ? (
        <section className="rounded-md border border-chip-warning-fg/30 bg-chip-warning-bg px-3 py-2.5">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-chip-warning-fg">
            <span aria-hidden>🔁</span>
            Кандидат в инструкцию
          </h3>
          <p className="mt-1 text-xs text-chip-warning-fg">
            Похожих решений: {detail.repeatGroupSize}. Возможно, пора оформить
            инструкцию.
          </p>
        </section>
      ) : null}

      <SourcesAccordion
        solutionId={detail.id}
        count={detail.sourceBlockIds.length}
        open={sourcesOpen}
        onToggle={onToggleSources}
      />

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">Как решалась</h3>
        {detail.solutionMd ? (
          <SolutionMarkdown text={detail.solutionMd} />
        ) : (
          <p className="text-sm text-fg-tertiary">Описание пока не заполнено.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">Действия</h3>
        <div className="flex flex-wrap gap-2">
          {deletedFilter ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onConfirm}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Подтвердить актуальность
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleHistory}
          >
            <History className="mr-1.5 h-4 w-4" />
            {historyOpen ? "Скрыть историю" : "История версий"}
          </Button>
          {canWrite && deletedFilter ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRestore}
            >
              <ArchiveRestore className="mr-1.5 h-4 w-4" />
              Восстановить
            </Button>
          ) : null}
          {canWrite && !deletedFilter ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              onClick={onDelete}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Удалить
            </Button>
          ) : null}
        </div>
      </section>

      {historyOpen ? (
        <HistorySection solutionId={detail.id} />
      ) : null}
    </article>
  );
}

function HistorySection({ solutionId }: { solutionId: string }) {
  const swr = useSWR(
    ["task-solution-history", solutionId],
    async () =>
      (await taskSolutionsApi.history(solutionId)).items.map(
        mapTaskSolutionVersion,
      ),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const versions = swr.data;
  return (
    <section className="rounded-md border border-border-subtle bg-bg-overlay/20 p-3">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
        История изменений
      </h4>
      {swr.isLoading ? (
        <AdminLoading rows={2} />
      ) : swr.error ? (
        <p className="text-xs text-fg-tertiary">Не удалось загрузить историю.</p>
      ) : !versions || versions.length === 0 ? (
        <p className="text-xs text-fg-tertiary">История пуста.</p>
      ) : (
        <ol className="space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="border-l-2 border-border-subtle pl-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-fg-primary">
                  Версия {v.version}
                </span>
                <span className="text-xs font-normal text-fg-tertiary">
                  · {v.createdAt.toLocaleDateString("ru-RU")}
                </span>
              </div>
              {v.changeReason ? (
                <p className="mt-0.5 text-xs text-fg-secondary">
                  <span className="font-medium text-fg-primary">
                    Причина изменения:{" "}
                  </span>
                  {v.changeReason}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SourcesAccordion({
  solutionId,
  count,
  open,
  onToggle,
}: {
  solutionId: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const swr = useSWR(
    open ? ["task-solution-sources", solutionId] : null,
    async () => mapTaskSolutionSources(await taskSolutionsApi.getSources(solutionId)),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const sources = swr.data;

  return (
    <section className="rounded-md border border-border-subtle bg-bg-overlay/20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-fg-primary">
          <Quote className="h-4 w-4 text-fg-tertiary" aria-hidden />
          Источники
          <span className="text-xs font-normal text-fg-tertiary">· {count}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-fg-tertiary transition-transform",
            open ? "rotate-180" : "",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-border-subtle px-3 py-2">
          {swr.isLoading ? (
            <AdminLoading rows={2} />
          ) : swr.error ? (
            <p className="text-xs text-fg-tertiary">
              Не удалось загрузить источники.
            </p>
          ) : !sources || sources.length === 0 ? (
            <p className="text-xs text-fg-tertiary">
              Дословные цитаты-источники пока недоступны.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {sources.map((s) => (
                <li
                  key={s.blockId}
                  className="border-l-2 border-border-subtle pl-3"
                >
                  <blockquote className="text-sm text-fg-secondary">
                    «{s.quote}»
                  </blockquote>
                  {s.meeting ? (
                    <Link
                      href={s.deepLink ?? `/meetings/${s.meeting.id}`}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      {s.meeting.title}
                      <span className="text-fg-tertiary">
                        · {s.meeting.date.toLocaleDateString("ru-RU")}
                      </span>
                      {s.startMs !== null ? (
                        <span className="text-fg-tertiary">
                          · перейти к моменту
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="mt-1 block text-xs text-fg-tertiary">
                      Источник встречи неизвестен
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function SolutionMarkdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none text-sm text-fg-primary [&>*]:my-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border border-border-subtle">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-bg-subtle">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border-subtle last:border-0">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="border-r border-border-subtle px-3 py-2 text-left font-semibold last:border-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-r border-border-subtle px-3 py-2 align-top last:border-0">
              {children}
            </td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
