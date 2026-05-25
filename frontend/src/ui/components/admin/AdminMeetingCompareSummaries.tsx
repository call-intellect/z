'use client';

import Link from 'next/link';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import useSWR from 'swr';

import { adminApi, type AdminMeetingDetailsApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

type Props = {
  meetingId: string;
};

type TabKey = 'summary' | 'chapters' | 'tasks';

type Version = 'v2' | 'fast';

const VERSION_LABEL: Record<Version, string> = {
  v2: 'v2 (meeting-analyze-v2)',
  fast: 'fast (meeting-report-fast)',
};

/**
 * Фаза 5 ТЗ meeting-report-split-from-block-ingest: admin compare UI.
 *
 * Двухколонный layout с тремя табами:
 *  - «Сводка» — markdown `aiResult.summaryV2` vs `aiResult.summaryFast`
 *  - «Главы» — `chapters` отфильтрованные по `extractorVersion`
 *  - «Задачи» — `tasks` отфильтрованные по `extractorVersion`
 *
 * Цель: продакт-менеджер видит обе версии рядом и решает, какая лучше
 * на dev-трафике.
 */
export function AdminMeetingCompareSummaries({ meetingId }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('summary');

  const { data, error, isLoading, mutate } = useSWR(
    ['admin:meeting:compare', meetingId],
    () => adminApi.getMeeting(meetingId),
    { revalidateOnFocus: false },
  );

  if (error) {
    return (
      <ErrorState
        message={
          error instanceof ApiError ? error.message : 'Не удалось загрузить встречу'
        }
        onRetry={() => mutate()}
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-6 w-1/3" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const m = data.meeting;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/admin/media/meetings/${encodeURIComponent(meetingId)}`}
            className="text-sm text-info hover:underline"
          >
            ← К деталям встречи
          </Link>
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-fg-primary">
            Сравнение отчётов: v2 vs fast
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {m.title}{' '}
            <span className="font-mono text-xs text-fg-secondary">
              ({m.id})
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge label="v2" status={data.reportStatuses.analyzeV2.status} />
          <StatusBadge
            label="fast"
            status={data.reportStatuses.reportFast.status}
          />
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="summary">Сводка</TabsTrigger>
          <TabsTrigger value="chapters">Главы</TabsTrigger>
          <TabsTrigger value="tasks">Задачи</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SummaryColumn version="v2" data={data} />
            <SummaryColumn version="fast" data={data} />
          </div>
          <QualityScoreBlock qualityScore={m.qualityScore} />
        </TabsContent>

        <TabsContent value="chapters">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ChaptersColumn version="v2" data={data} />
            <ChaptersColumn version="fast" data={data} />
          </div>
        </TabsContent>

        <TabsContent value="tasks">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TasksColumn version="v2" data={data} />
            <TasksColumn version="fast" data={data} />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

// ───────────────────── Summary column ─────────────────────

function SummaryColumn({
  version,
  data,
}: {
  version: Version;
  data: AdminMeetingDetailsApi;
}) {
  const ai = data.aiResult;
  const summary = version === 'v2' ? ai?.summaryV2 ?? null : ai?.summaryFast ?? null;
  const model =
    version === 'v2' ? ai?.summaryV2Model ?? null : ai?.summaryFastModel ?? null;
  const generatedAt =
    version === 'v2'
      ? ai?.summaryV2GeneratedAt ?? null
      : ai?.summaryFastGeneratedAt ?? null;

  const status =
    version === 'v2'
      ? data.reportStatuses.analyzeV2
      : data.reportStatuses.reportFast;

  return (
    <Column title={VERSION_LABEL[version]}>
      <MetaBlock
        model={model}
        generatedAt={generatedAt}
        status={status.status}
        error={status.error}
      />
      <div className="mt-3 border-t border-border-subtle pt-3">
        {summary ? (
          <div className="prose prose-sm max-w-none text-fg-primary [&>*]:my-2">
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{summary}</ReactMarkdown>
          </div>
        ) : (
          <EmptyVersionState
            generatedAt={status.generatedAt}
            error={status.error}
          />
        )}
      </div>
    </Column>
  );
}

// ───────────────────── Chapters column ─────────────────────

function ChaptersColumn({
  version,
  data,
}: {
  version: Version;
  data: AdminMeetingDetailsApi;
}) {
  // v2: extractorVersion === 'v2' либо null (исторически до миграции).
  // fast: только extractorVersion === 'fast'.
  const items = data.chapters.filter((c) =>
    version === 'v2' ? c.extractorVersion === 'v2' : c.extractorVersion === 'fast',
  );

  return (
    <Column title={VERSION_LABEL[version]}>
      <p className="mb-2 text-xs text-fg-secondary">
        Всего глав: <span className="font-semibold">{items.length}</span>
      </p>
      {items.length === 0 ? (
        <EmptyVersionState />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-border-subtle bg-white p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg-primary">
                  {c.title}
                </h3>
                <span className="shrink-0 font-mono text-xs text-fg-secondary">
                  {formatTimeRange(c.startMs, c.endMs)}
                </span>
              </div>
              {c.summary ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">
                  {c.summary}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Column>
  );
}

// ───────────────────── Tasks column ─────────────────────

function TasksColumn({
  version,
  data,
}: {
  version: Version;
  data: AdminMeetingDetailsApi;
}) {
  const items = data.tasks.filter((t) =>
    version === 'v2' ? t.extractorVersion === 'v2' : t.extractorVersion === 'fast',
  );

  return (
    <Column title={VERSION_LABEL[version]}>
      <p className="mb-2 text-xs text-fg-secondary">
        Всего задач: <span className="font-semibold">{items.length}</span>
      </p>
      {items.length === 0 ? (
        <EmptyVersionState />
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="rounded-md border border-border-subtle bg-white p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg-primary">
                  {t.title}
                </h3>
                <span className="shrink-0 font-mono text-xs uppercase text-fg-secondary">
                  {t.status}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-secondary">
                {t.assigneeRaw ? (
                  <span>
                    Исполнитель:{' '}
                    <span className="text-fg-primary">{t.assigneeRaw}</span>
                    {t.assigneeUserId ? (
                      <span className="ml-1 font-mono text-fg-secondary">
                        ({t.assigneeUserId.slice(0, 8)})
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {t.dueDate ? (
                  <span>
                    Срок:{' '}
                    <span className="text-fg-primary">
                      {new Date(t.dueDate).toLocaleDateString('ru-RU')}
                    </span>
                  </span>
                ) : null}
                {t.confidence !== null && t.confidence >= 0 ? (
                  <span>
                    Уверенность:{' '}
                    <span className="text-fg-primary">
                      {Math.round(t.confidence * 100)}%
                    </span>
                  </span>
                ) : null}
              </div>
              {t.description ? (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-xs text-fg-secondary">
                    Описание
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-fg-primary">
                    {t.description}
                  </p>
                </details>
              ) : null}
              {t.sourceQuote ? (
                <details className="mt-1 text-sm">
                  <summary className="cursor-pointer text-xs text-fg-secondary">
                    Цитата из транскрипта
                  </summary>
                  <blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-border-subtle pl-2 text-xs text-fg-secondary">
                    {t.sourceQuote}
                  </blockquote>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Column>
  );
}

// ───────────────────── Quality score (общий блок) ─────────────────────

/**
 * Единый collapsed-блок quality_score под обеими колонками сводки.
 * Генерируется только fast-цепочкой (meeting-report-fast.worker), поэтому
 * нет смысла дублировать по колонкам v2/fast. NULL = ещё не посчитано.
 */
function QualityScoreBlock({
  qualityScore,
}: {
  qualityScore: Record<string, unknown> | null;
}) {
  if (!qualityScore) return null;
  return (
    <details className="mt-4 rounded-md border border-border-subtle bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-fg-secondary">
        Оценка качества встречи (quality_score)
      </summary>
      <pre className="mt-3 overflow-x-auto rounded bg-bg-subtle p-3 text-xs">
        {JSON.stringify(qualityScore, null, 2)}
      </pre>
    </details>
  );
}

// ───────────────────── helpers / shared ─────────────────────

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-md border border-border-subtle bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-secondary">
        {title}
      </h2>
      {children}
    </article>
  );
}

function MetaBlock({
  model,
  generatedAt,
  status,
  error,
}: {
  model: string | null;
  generatedAt: string | null;
  status: string | null;
  error: string | null;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-fg-secondary">Модель</dt>
      <dd className="font-mono text-fg-primary">{model ?? '—'}</dd>
      <dt className="text-fg-secondary">Статус</dt>
      <dd className="text-fg-primary">{status ?? '—'}</dd>
      <dt className="text-fg-secondary">Сгенерировано</dt>
      <dd className="text-fg-primary">
        {generatedAt ? new Date(generatedAt).toLocaleString('ru-RU') : '—'}
      </dd>
      {error ? (
        <>
          <dt className="text-fg-secondary">Ошибка</dt>
          <dd className="whitespace-pre-wrap text-chip-danger-fg">{error}</dd>
        </>
      ) : null}
    </dl>
  );
}

function EmptyVersionState({
  generatedAt,
  error,
}: {
  generatedAt?: string | null;
  error?: string | null;
}) {
  return (
    <div className="rounded-md border border-dashed border-border-subtle bg-bg-subtle p-4 text-sm text-fg-secondary">
      <p>Отчёт не сгенерирован.</p>
      {generatedAt ? (
        <p className="mt-1 text-xs">
          Последняя попытка:{' '}
          <span className="text-fg-primary">
            {new Date(generatedAt).toLocaleString('ru-RU')}
          </span>
        </p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs">
          Ошибка: <span className="text-chip-danger-fg">{error}</span>
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({
  label,
  status,
}: {
  label: string;
  status: string | null;
}) {
  const tone = statusTone(status);
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
        tone,
      ].join(' ')}
    >
      <span className="font-semibold uppercase">{label}</span>
      <span className="font-mono">{status ?? 'не запускался'}</span>
    </span>
  );
}

function statusTone(status: string | null): string {
  switch (status) {
    case 'ready':
      return 'border-chip-success-bg bg-chip-success-bg text-chip-success-fg';
    case 'failed':
      return 'border-chip-danger-bg bg-chip-danger-bg text-chip-danger-fg';
    case 'partial':
      return 'border-chip-warning-bg bg-chip-warning-bg text-chip-warning-fg';
    case 'processing':
    case 'queued':
      return 'border-chip-info-bg bg-chip-info-bg text-chip-info-fg';
    default:
      return 'border-border-subtle bg-bg-subtle text-fg-secondary';
  }
}

function formatTimeRange(startMs: number, endMs: number): string {
  return `${formatMmSs(startMs)}–${formatMmSs(endMs)}`;
}

function formatMmSs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
