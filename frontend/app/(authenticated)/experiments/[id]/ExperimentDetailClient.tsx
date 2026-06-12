'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { ApiError } from '@/api/api-error';
import { experimentsApi } from '@/api/experiments.api';
import { useAuth } from '@/contexts/auth-context';
import {
  EXPERIMENT_LESSON_TYPE_LABEL,
  EXPERIMENT_LESSON_TYPE_TONE,
  EXPERIMENT_STATUS_LABEL,
  EXPERIMENT_STATUS_TONE,
  experimentRunningDurationDays,
  mapExperimentDetail,
  type ExperimentDetail,
} from '@/domain/experiment';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

const TONE_TO_CLASS: Record<string, string> = {
  info: 'bg-chip-info-bg text-chip-info-fg',
  warning: 'bg-chip-warning-bg text-chip-warning-fg',
  success: 'bg-chip-success-bg text-chip-success-fg',
  neutral: 'bg-bg-subtle text-fg-secondary',
  danger: 'bg-chip-danger-bg text-chip-danger-fg',
};

const TRANSITION_OPTIONS: ReadonlyArray<{
  to: 'running' | 'completed' | 'dropped' | 'paused';
  label: string;
}> = [
  { to: 'running', label: 'Запустить' },
  { to: 'completed', label: 'Завершить' },
  { to: 'dropped', label: 'Прекратить' },
  { to: 'paused', label: 'На паузу' },
];

export function ExperimentDetailClient({ id }: { id: string }) {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dto = await experimentsApi.get(id);
      setDetail(mapExperimentDetail(dto));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'forbidden') setForbidden(true);
        else setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Не удалось загрузить эксперимент');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onTransition = useCallback(
    async (to: 'running' | 'completed' | 'dropped' | 'paused') => {
      if (!detail) return;
      setBusy(true);
      try {
        const updated = await experimentsApi.transition(detail.id, { to });
        setDetail(mapExperimentDetail(updated));
      } catch (err) {
        if (err instanceof Error) setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [detail],
  );

  if (authLoading) return <AdminLoading rows={5} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  if (forbidden) {
    return (
      <AdminForbidden
        title="Нет прав на просмотр эксперимента"
        description="Попросите владельца или администратора организации выдать вам право experiment:read."
      />
    );
  }
  if (error) return <AdminError message={error} onRetry={() => void load()} />;
  if (loading || !detail) return <AdminLoading rows={6} />;

  const tone = EXPERIMENT_STATUS_TONE[detail.status];
  const days = experimentRunningDurationDays(detail);

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <nav className="text-xs text-fg-secondary">
        <Link href="/experiments" className="hover:underline">
          ← К списку экспериментов
        </Link>
      </nav>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">{detail.name}</h1>
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              TONE_TO_CLASS[tone] ?? TONE_TO_CLASS.neutral
            }`}
          >
            {EXPERIMENT_STATUS_LABEL[detail.status]}
          </span>
        </div>
      </header>

      <section className="rounded-md border border-border-subtle bg-bg-card p-4">
        <h2 className="text-sm font-medium text-fg-secondary">Гипотеза</h2>
        <p className="mt-2 text-sm text-fg-primary whitespace-pre-wrap">
          {detail.hypothesisText}
        </p>
      </section>

      <section className="rounded-md border border-border-subtle bg-bg-card p-4">
        <h2 className="text-sm font-medium text-fg-secondary">Текущий результат</h2>
        <p className="mt-2 text-sm text-fg-primary whitespace-pre-wrap">
          {detail.currentResult ?? 'Результат пока не зафиксирован.'}
        </p>
      </section>

      <section className="rounded-md border border-border-subtle bg-bg-card p-4">
        <h2 className="text-sm font-medium text-fg-secondary">Уроки</h2>
        {detail.lessons.length === 0 ? (
          <p className="mt-2 text-sm text-fg-secondary">Уроков ещё нет.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.lessons.map((l, idx) => {
              const lessonTone = EXPERIMENT_LESSON_TYPE_TONE[l.type];
              return (
                <li
                  key={`${l.type}-${idx}`}
                  className="rounded-md border border-border-subtle p-3"
                >
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      TONE_TO_CLASS[lessonTone] ?? TONE_TO_CLASS.neutral
                    }`}
                  >
                    {EXPERIMENT_LESSON_TYPE_LABEL[l.type]}
                  </span>
                  <p className="mt-1 text-sm text-fg-primary whitespace-pre-wrap">
                    {l.text}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 text-xs text-fg-secondary sm:grid-cols-4">
        <div className="rounded border border-border-subtle bg-bg-subtle p-3">
          <div className="font-medium text-fg-secondary">Начат</div>
          <div>
            {detail.startedAt
              ? new Date(detail.startedAt).toLocaleString('ru-RU')
              : '—'}
          </div>
        </div>
        <div className="rounded border border-border-subtle bg-bg-subtle p-3">
          <div className="font-medium text-fg-secondary">Завершён</div>
          <div>
            {detail.completedAt
              ? new Date(detail.completedAt).toLocaleString('ru-RU')
              : '—'}
          </div>
        </div>
        <div className="rounded border border-border-subtle bg-bg-subtle p-3">
          <div className="font-medium text-fg-secondary">Длительность</div>
          <div>{days !== null ? `${days} дн.` : '—'}</div>
        </div>
        <div className="rounded border border-border-subtle bg-bg-subtle p-3">
          <div className="font-medium text-fg-secondary">Уверенность</div>
          <div>{Math.round(detail.confidence * 100)}%</div>
        </div>
      </section>

      <section className="rounded-md border border-border-subtle bg-bg-card p-4">
        <h2 className="text-sm font-medium text-fg-secondary">Действия</h2>
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
