'use client';

/**
 * `/integrations/import-tracker/:importId` — детали импорта
 * (Wave 3 / Tracker Phase 5 part 1).
 *
 * Источник данных: `useImportDetail` — SWR с conditional polling 2s +
 * подписка на WS-события `import.progress / completed / failed`.
 *
 * UI:
 *   - Прогресс-бар (processed / total из live overlay или REST).
 *   - Текстовая стадия (boards / issues / comments / attachments / finalizing).
 *   - Сводка по сущностям (создано: проектов / задач / комментариев / вложений).
 *   - Кнопка «Отменить» (только при status='running').
 *   - Раздел «Ошибки» (collapsed list первых 10).
 *   - Раздел «Не сопоставленные пользователи» (если есть).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Radio,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { importsApi } from '@/api/tracker/imports.api';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { useImportDetail } from '@/hooks/tracker/useImportDetail';
import {
  importPhaseLabel,
  importSourceLabel,
  importStatusLabel,
  type ImportStatus,
} from '@/domain/tracker';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Progress } from '@/ui/shadcn/progress';

const MAX_VISIBLE_ERRORS = 10;
const MAX_VISIBLE_UNMATCHED = 20;

export function ImportDetailClient({
  importLogId,
}: {
  importLogId: string;
}) {
  const router = useRouter();
  const { currentOrgId } = useAuth();

  const [cancelling, setCancelling] = useState(false);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [unmatchedExpanded, setUnmatchedExpanded] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const { importLog, live, error, isLoading, wsConnected, mutate } =
    useImportDetail(currentOrgId, importLogId, {
      onCompleted: (payload) => {
        const startedAt = importLog?.startedAt;
        const elapsedSec = startedAt
          ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000))
          : null;
        const msg = elapsedSec
          ? `Импорт завершён: ${payload.summary.totalIssues} задач за ${elapsedSec} сек`
          : `Импорт завершён: ${payload.summary.totalIssues} задач`;
        toast.success(msg);
      },
      onFailed: (payload) => {
        toast.error(`Ошибка импорта: ${payload.error}`);
      },
    });

  // ── Производные значения ───────────────────────────────────────────
  const effective = useMemo(() => {
    if (!importLog) return null;
    // Live overlay — мгновенное обновление в процессе работы.
    const processed = live.processed ?? importLog.processedItems;
    const phase = live.phase ?? null;
    // total: backend заполняет totalIssues после фазы issues; до этого
    // ничего точно неизвестно. Пока берём max(processed, totalIssues).
    const total = Math.max(processed, importLog.totalIssues);
    const percent =
      total > 0
        ? Math.min(100, Math.round((processed / total) * 100))
        : importLog.status === 'completed'
          ? 100
          : 0;
    return { processed, phase, total, percent };
  }, [importLog, live]);

  const isRunning = importLog?.status === 'running';

  // ── Cancel ─────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!currentOrgId || !importLog) return;
    const ok = await ask({
      title: 'Прервать импорт?',
      description: 'Уже созданные задачи останутся.',
      confirmLabel: 'Прервать',
      destructive: true,
    });
    if (!ok) return;
    setCancelling(true);
    try {
      await importsApi.cancel(currentOrgId, importLog.id);
      await mutate();
      toast('Запрос на отмену отправлен');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось отменить импорт');
    } finally {
      setCancelling(false);
    }
  };

  // ── Loading / error guards ─────────────────────────────────────────
  if (!currentOrgId) {
    return (
      <Shell>
        <div className="rounded-md border border-border-subtle bg-bg-card p-6 text-sm text-fg-secondary">
          Нужно войти в организацию.
        </div>
      </Shell>
    );
  }

  if (isLoading && !importLog) {
    return (
      <Shell>
        <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-card p-6 text-sm text-fg-tertiary">
          <Loader2 size={16} className="animate-spin" />
          Загружаем данные импорта…
        </div>
      </Shell>
    );
  }

  if (error && !importLog) {
    return (
      <Shell>
        <div className="flex items-start gap-3 rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          <XCircle size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">Не удалось загрузить импорт</div>
            <div className="mt-1 text-fg-tertiary">
              {error instanceof ApiError
                ? error.message
                : 'Проверьте, что ссылка корректна, или вернитесь к списку источников.'}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void mutate()}>
            <RefreshCw size={14} /> Повторить
          </Button>
        </div>
      </Shell>
    );
  }

  if (!importLog || !effective) {
    return (
      <Shell>
        <div className="rounded-md border border-border-subtle bg-bg-card p-6 text-sm text-fg-secondary">
          Импорт не найден.
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header card */}
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                  Источник: {importSourceLabel(importLog.source)}
                </div>
                <h1 className="mt-1 text-2xl font-semibold text-fg-primary">
                  {importStatusLabel(importLog.status)}
                </h1>
                <div className="mt-1 text-sm text-fg-secondary">
                  Запущен{' '}
                  {importLog.startedAt.toLocaleString('ru-RU', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {importLog.completedAt && (
                    <>
                      {' '}· завершён{' '}
                      {importLog.completedAt.toLocaleString('ru-RU', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={importLog.status} />
                <ConnectionIndicator connected={wsConnected} running={isRunning} />
              </div>
            </div>

            {/* Progress */}
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-xs text-fg-tertiary">
                <span>
                  {effective.phase
                    ? importPhaseLabel(effective.phase)
                    : isRunning
                      ? 'Подготовка'
                      : ''}
                </span>
                <span>
                  {effective.processed}
                  {effective.total > 0 && <> / {effective.total}</>}
                </span>
              </div>
              <Progress value={effective.percent} />
            </div>

            {/* Actions */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" size="sm" onClick={() => router.push('/integrations/import-tracker')}>
                <ArrowLeft size={14} /> К источникам
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void mutate()}
                  aria-label="Обновить"
                >
                  <RefreshCw size={14} /> Обновить
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!isRunning || cancelling}
                  onClick={() => void handleCancel()}
                >
                  {cancelling ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Отменяем…
                    </>
                  ) : (
                    <>
                      <X size={14} /> Отменить
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Counters */}
        <Card>
          <CardContent className="p-6">
            <h2 className="mb-3 text-sm font-semibold text-fg-primary">
              Создано в Коре
            </h2>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Counter label="Проектов" value={importLog.totalProjects} />
              <Counter label="Задач" value={importLog.totalIssues} />
              <Counter label="Комментариев" value={importLog.totalComments} />
              <Counter label="Вложений" value={importLog.totalAttachments} />
            </dl>
          </CardContent>
        </Card>

        {/* Errors */}
        {importLog.errors.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <button
                type="button"
                onClick={() => setErrorsExpanded((v) => !v)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-danger">
                  <AlertTriangle size={14} /> Ошибки: {importLog.errors.length}
                </span>
                {errorsExpanded ? (
                  <ChevronDown size={14} className="text-fg-tertiary" />
                ) : (
                  <ChevronRight size={14} className="text-fg-tertiary" />
                )}
              </button>
              {errorsExpanded && (
                <ul className="mt-3 space-y-2 text-xs">
                  {importLog.errors
                    .slice(0, MAX_VISIBLE_ERRORS)
                    .map((err, idx) => (
                      <li
                        key={`${err.stage}-${err.externalId ?? 'na'}-${idx}`}
                        className="rounded-md border border-danger/30 bg-danger/5 p-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-bg-overlay px-1.5 py-0.5 text-[10px] font-mono uppercase text-fg-tertiary">
                            {err.stage}
                          </span>
                          {err.externalId && (
                            <span className="font-mono text-fg-tertiary">
                              {err.externalId}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-fg-secondary">{err.message}</div>
                      </li>
                    ))}
                  {importLog.errors.length > MAX_VISIBLE_ERRORS && (
                    <li className="text-fg-tertiary">
                      …и ещё {importLog.errors.length - MAX_VISIBLE_ERRORS}{' '}
                      ошибок. Полный журнал доступен бэкенд-логом.
                    </li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Unmatched users */}
        {importLog.unmatched.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <button
                type="button"
                onClick={() => setUnmatchedExpanded((v) => !v)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-warn">
                  <Radio size={14} /> Не сопоставленные пользователи:{' '}
                  {importLog.unmatched.length}
                </span>
                {unmatchedExpanded ? (
                  <ChevronDown size={14} className="text-fg-tertiary" />
                ) : (
                  <ChevronRight size={14} className="text-fg-tertiary" />
                )}
              </button>
              {unmatchedExpanded && (
                <>
                  <p className="mt-2 text-xs text-fg-tertiary">
                    Эти email'ы из выгрузки не были замаплены на пользователей
                    организации. Их задачи импортировались без исполнителя.
                    Пригласите их в раздел «Команда» — тогда задачи можно будет
                    переназначить.
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {importLog.unmatched
                      .slice(0, MAX_VISIBLE_UNMATCHED)
                      .map((email) => (
                        <li
                          key={email}
                          className="rounded-full bg-bg-overlay px-2.5 py-1 text-xs text-fg-secondary"
                        >
                          {email}
                        </li>
                      ))}
                    {importLog.unmatched.length > MAX_VISIBLE_UNMATCHED && (
                      <li className="text-xs text-fg-tertiary">
                        …и ещё {importLog.unmatched.length - MAX_VISIBLE_UNMATCHED}
                      </li>
                    )}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Success CTA */}
        {importLog.status === 'completed' && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-success/15 text-success">
                  <CheckCircle2 size={18} />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-fg-primary">
                    Импорт завершён
                  </h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Все задачи перенесены. Откройте раздел «Проекты», чтобы
                    увидеть результаты.
                  </p>
                </div>
                <Button onClick={() => router.push('/projects')}>
                  К проектам
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      {confirmDialog}
    </Shell>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-4xl p-4 md:p-6">{children}</div>;
}

function StatusBadge({ status }: { status: ImportStatus }) {
  const cls =
    status === 'completed'
      ? 'bg-success/15 text-success'
      : status === 'failed'
        ? 'bg-danger/15 text-danger'
        : status === 'cancelled'
          ? 'bg-bg-overlay text-fg-tertiary'
          : 'bg-accent-muted text-accent';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      {status === 'running' && <Loader2 size={12} className="animate-spin" />}
      {importStatusLabel(status)}
    </span>
  );
}

function ConnectionIndicator({
  connected,
  running,
}: {
  connected: boolean;
  running: boolean;
}) {
  // Показываем индикатор только когда импорт активно идёт — на завершённых
  // он не нужен (мы не подписываемся на live-обновления готового импорта).
  if (!running) return null;
  return (
    <span
      className={
        'inline-flex items-center gap-1 text-[11px] ' +
        (connected ? 'text-fg-tertiary' : 'text-warn')
      }
      title={
        connected
          ? 'Подключено к live-обновлениям'
          : 'Live-обновления недоступны — данные обновляются раз в 2 секунды'
      }
    >
      {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {connected ? 'Live' : 'Polling'}
    </span>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated p-3">
      <div className="text-xs text-fg-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-fg-primary">{value}</div>
    </div>
  );
}
