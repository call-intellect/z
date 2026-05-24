'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import {
  orchestratorApi,
  type OrchestratorRunDetailApi,
  type OrchestratorStreamEvent,
} from '@/api/orchestrator.api';

interface Props {
  runId: string;
}

/**
 * SBA δ-1 — клиент `/orchestrator/runs/[id]` (live view).
 *
 * Принцип:
 *   1) загружаем GET /runs/:id для базового состояния.
 *   2) если status терминальный (done|failed) — просто рендерим.
 *   3) если активный — polling каждые 2с (для простоты MVP; vNext —
 *      SSE replay через /events).
 *
 * Отображение:
 *   - timeline: план, subagent-ы с их статусом, synthesis, verification.
 *   - кнопка «Отменить» (только для активного status).
 */
export function OrchestratorRunClient({ runId }: Props): ReactElement {
  const [run, setRun] = useState<OrchestratorRunDetailApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<OrchestratorStreamEvent[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await orchestratorApi.getRun(runId);
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!run) return;
    if (run.status === 'done' || run.status === 'failed') return;
    const t = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [run, refresh]);

  const onCancel = async () => {
    try {
      await orchestratorApi.cancel(runId);
      setEvents((prev) => [...prev, { type: 'cancelled' as const }]);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-fg-primary">
        <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          Ошибка: {error}
        </div>
      </div>
    );
  }
  if (!run) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-fg-primary">Загрузка…</div>
    );
  }

  const isActive = run.status !== 'done' && run.status !== 'failed';
  const synthesisText = run.synthesisJson?.text ?? '';

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 text-fg-primary">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Research-run</h1>
          <p className="mt-1 text-sm text-fg-tertiary">
            <span className="font-mono">{run.id}</span> ·{' '}
            <StatusBadge status={run.status} />
          </p>
        </div>
        {isActive && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-chip-danger-bg px-3 py-1.5 text-sm text-chip-danger-fg hover:bg-chip-danger-bg"
          >
            Отменить
          </button>
        )}
      </header>

      <section className="rounded-md border border-border-subtle bg-bg-overlay p-4">
        <h2 className="mb-2 text-sm font-semibold text-fg-primary">Запрос</h2>
        <p className="whitespace-pre-wrap text-sm text-fg-secondary">
          {run.task}
        </p>
      </section>

      {run.planJson && (
        <section className="rounded-md border border-border-subtle bg-bg-overlay p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg-primary">План</h2>
          <p className="mb-3 text-xs text-fg-tertiary">
            {run.planJson.rationale}
          </p>
          <ol className="flex flex-col gap-2">
            {run.planJson.steps.map((s) => {
              const job = run.jobs.find((j) => j.stepIndex === s.stepIndex);
              return (
                <li
                  key={s.stepIndex}
                  className="rounded-md border border-border-subtle bg-bg-base p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {s.stepIndex + 1}. {s.description}
                      </div>
                      <div className="mt-1 text-xs text-fg-tertiary">
                        Стратегия: <span className="font-mono">{s.agentType}</span>
                      </div>
                      <div className="mt-1 text-xs text-fg-tertiary">
                        Focus: {s.contextSlice.focus}
                      </div>
                    </div>
                    {job && <StatusBadge status={job.status} />}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {run.synthesisJson && (
        <section className="rounded-md border border-border-subtle bg-bg-overlay p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg-primary">
            Финальный синтез
          </h2>
          <pre className="whitespace-pre-wrap break-words text-sm text-fg-primary">
            {synthesisText}
          </pre>
          {run.synthesisJson.citations.length > 0 && (
            <div className="mt-3 border-t border-border-subtle pt-3 text-xs text-fg-tertiary">
              Citations: {run.synthesisJson.citations.length}
              <ul className="mt-1 flex flex-wrap gap-1">
                {run.synthesisJson.citations.slice(0, 20).map((c, i) => (
                  <li
                    key={`${c.type}_${c.id}_${i}`}
                    className="rounded bg-bg-base px-2 py-0.5 font-mono text-xs"
                  >
                    {c.type}:{c.id.slice(0, 12)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {run.verificationJson && (
        <section className="rounded-md border border-border-subtle bg-bg-overlay p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg-primary">
            Верификация
          </h2>
          <p className="text-sm text-fg-secondary">
            Confidence:{' '}
            <span
              className={
                run.verificationJson.confidence >= 0.6
                  ? 'font-bold text-success'
                  : 'font-bold text-warning'
              }
            >
              {run.verificationJson.confidence.toFixed(2)}
            </span>
            {run.verificationJson.retried && (
              <span className="ml-2 text-xs text-warning">(retried)</span>
            )}
          </p>
          <p className="mt-2 text-xs text-fg-tertiary">
            {run.verificationJson.reasoning}
          </p>
        </section>
      )}

      {run.errorMessage && (
        <section className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          Ошибка: {run.errorMessage}
        </section>
      )}

      {events.length > 0 && (
        <section className="rounded-md border border-border-subtle bg-bg-overlay p-3 text-xs text-fg-tertiary">
          Live events: {events.length}
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): ReactElement {
  const cls =
    status === 'done'
      ? 'bg-chip-success-bg text-chip-success-fg'
      : status === 'failed'
        ? 'bg-chip-danger-bg text-chip-danger-fg'
        : status === 'running'
          ? 'bg-chip-warning-bg text-chip-warning-fg animate-pulse'
          : 'bg-bg-subtle text-fg-secondary';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-mono ${cls}`}>
      {status}
    </span>
  );
}
