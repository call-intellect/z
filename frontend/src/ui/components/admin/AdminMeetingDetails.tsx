'use client';

import useSWR from 'swr';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { t } from '@/lib/i18n';

import { AdminMeetingActions } from './AdminMeetingActions';

type Props = {
  meetingId: string;
};

export function AdminMeetingDetails({ meetingId }: Props) {
  const { data, error, isLoading, mutate } = useSWR(
    ['admin:meeting', meetingId],
    () => adminApi.getMeeting(meetingId),
    { revalidateOnFocus: false },
  );

  if (error) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : t('errors.unknown')}
        onRetry={() => mutate()}
      />
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-2 rounded-md border border-border-subtle bg-white p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  const m = data.meeting;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-fg-primary">{m.title}</h1>
          <p className="mt-1 text-xs text-fg-secondary">
            <span className="font-mono">{m.id}</span>
          </p>
        </div>
        <AdminMeetingActions meetingId={meetingId} onChanged={() => mutate()} />
      </header>

      <Card title="Сводка">
        <KeyValue k="Тип" v={m.type} />
        <KeyValue k="Статус" v={m.status} />
        <KeyValue k="Создана" v={new Date(m.createdAt).toLocaleString('ru-RU')} />
        <KeyValue
          k="Начата"
          v={m.startedAt ? new Date(m.startedAt).toLocaleString('ru-RU') : '—'}
        />
        <KeyValue
          k="Завершена"
          v={m.endedAt ? new Date(m.endedAt).toLocaleString('ru-RU') : '—'}
        />
        <KeyValue k="failureReason" v={m.failureReason ?? '—'} />
        <KeyValue
          k="Owner"
          v={`${m.owner.name} <${m.owner.email}>`}
          mono={false}
        />
        {m.customPrompt ? (
          <KeyValue k="customPrompt" v={m.customPrompt} mono multiline />
        ) : null}
      </Card>

      <Card title={t('admin.meetings.participants')}>
        {data.participants.length === 0 ? (
          <p className="text-sm text-fg-secondary">—</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-fg-secondary">
              <tr>
                <th className="py-1 pr-4">name</th>
                <th className="py-1 pr-4">role</th>
                <th className="py-1 pr-4">livekitIdentity</th>
                <th className="py-1 pr-4">joined</th>
                <th className="py-1 pr-4">left</th>
              </tr>
            </thead>
            <tbody>
              {data.participants.map((p) => (
                <tr key={p.id} className="border-t border-border-subtle">
                  <td className="py-1 pr-4 text-fg-primary">{p.name}</td>
                  <td className="py-1 pr-4 text-fg-secondary">{p.role}</td>
                  <td className="py-1 pr-4 font-mono text-xs text-fg-secondary">{p.livekitIdentity}</td>
                  <td className="py-1 pr-4 text-fg-secondary">
                    {p.joinedAt ? new Date(p.joinedAt).toLocaleTimeString('ru-RU') : '—'}
                  </td>
                  <td className="py-1 pr-4 text-fg-secondary">
                    {p.leftAt ? new Date(p.leftAt).toLocaleTimeString('ru-RU') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={t('admin.meetings.recording')}>
        {!data.recording ? (
          <p className="text-sm text-fg-secondary">{t('admin.meetings.no_recording')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <KeyValue k="status" v={data.recording.status} />
            <KeyValue k="retentionDays" v={String(data.recording.retentionDays)} />
            <KeyValue
              k="expiresAt"
              v={new Date(data.recording.expiresAt).toLocaleString('ru-RU')}
            />
            <KeyValue
              k="durationSec"
              v={String(data.recording.durationSeconds ?? '—')}
            />
            <KeyValue k="bytes" v={data.recording.bytesTotal ?? '—'} />
            <KeyValue
              k="mainVideoUrl"
              v={data.recording.mainVideoUrl ?? '—'}
              mono
              multiline
            />
            <KeyValue
              k="compositeEgressId"
              v={data.recording.compositeEgressId ?? '—'}
              mono
            />
            <div className="md:col-span-2">
              <h3 className="mt-2 text-xs font-semibold uppercase text-fg-secondary">
                audioTracks
              </h3>
              {data.recording.audioTracks.length === 0 ? (
                <p className="text-sm text-fg-secondary">—</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {data.recording.audioTracks.map((t) => (
                    <li key={t.id} className="font-mono text-fg-secondary">
                      {t.livekitIdentity} → {t.audioUrl} ({t.durationSeconds}s,{' '}
                      {t.bytes ?? '—'} bytes)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card title={t('admin.meetings.transcript')}>
        {!data.transcript ? (
          <p className="text-sm text-fg-secondary">{t('admin.meetings.no_transcript')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <KeyValue k="rawIndexS3Url" v={data.transcript.rawIndexS3Url} mono multiline />
            <KeyValue k="mergedS3Url" v={data.transcript.mergedS3Url ?? '—'} mono multiline />
            <KeyValue k="totalWords" v={String(data.transcript.totalWords ?? '—')} />
            <KeyValue
              k="totalDurationSeconds"
              v={String(data.transcript.totalDurationSeconds ?? '—')}
            />
          </div>
        )}
      </Card>

      <Card title={t('admin.meetings.ai_result')}>
        {!data.aiResult ? (
          <p className="text-sm text-fg-secondary">{t('admin.meetings.no_ai_result')}</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <KeyValue k="modelUsed" v={data.aiResult.modelUsed} />
            <KeyValue
              k="createdAt"
              v={new Date(data.aiResult.createdAt).toLocaleString('ru-RU')}
            />
            <div>
              <h3 className="text-xs font-semibold uppercase text-fg-secondary">summary</h3>
              <p className="whitespace-pre-wrap text-fg-primary">{data.aiResult.summary}</p>
            </div>
            {data.aiResult.followUpEmail ? (
              <div>
                <h3 className="text-xs font-semibold uppercase text-fg-secondary">
                  followUpEmail
                </h3>
                <p className="whitespace-pre-wrap text-fg-primary">
                  {data.aiResult.followUpEmail}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card title={t('admin.meetings.events')}>
        {data.events.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t('admin.meetings.no_events')}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {data.events.map((e) => (
              <li key={e.id} className="font-mono text-fg-secondary">
                <span className="text-fg-secondary">
                  {new Date(e.receivedAt).toLocaleString('ru-RU')}
                </span>
                {' — '}
                <span className="text-fg-primary">{e.eventType}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-md border border-border-subtle bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-secondary">
        {title}
      </h2>
      {children}
    </article>
  );
}

function KeyValue({
  k,
  v,
  mono = false,
  multiline = false,
}: {
  k: string;
  v: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-xs uppercase text-fg-secondary">{k}</span>
      <span
        className={[
          mono ? 'font-mono text-xs' : 'text-fg-primary',
          multiline ? 'whitespace-pre-wrap break-all' : 'truncate',
        ].join(' ')}
      >
        {v}
      </span>
    </div>
  );
}
