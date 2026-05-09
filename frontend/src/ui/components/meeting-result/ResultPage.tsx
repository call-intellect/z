'use client';

import { useEffect, useRef, useState } from 'react';

import { meetingsApi } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { useResultPolling } from '@/hooks/use-result-polling';
import { useToast } from '@/contexts/toast-context';
import { aiResultFromApi } from '@/domain/ai-result';
import {
  meetingFromApi,
  participantFromApi,
  type MeetingDomain,
  type ParticipantDomain,
} from '@/domain/meeting';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Button } from '@/ui/components/shared/Button';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { t } from '@/lib/i18n';

import { CustomReportMd } from './CustomReportMd';
import { FollowUpCard } from './FollowUpCard';
import { ProgressState } from './ProgressState';
import { ReportByType } from './ReportByType';
import { ResultPageHeader } from './ResultPageHeader';
import { SummaryCard } from './SummaryCard';
import { TasksList } from './TasksList';
import { TranscriptViewer } from './TranscriptViewer';
import { VideoPlayer } from './VideoPlayer';

type Props = { meetingId: string };

export function ResultPage({ meetingId }: Props) {
  const result = useResultPolling(meetingId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { addToast } = useToast();
  const [retrying, setRetrying] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Если AI готов и есть запись — подтягиваем presigned URL для видео.
  const data = result.state === 'ready' || result.state === 'failed' || result.state === 'progress'
    ? result.data
    : null;
  const recordingReady = !!data?.recording?.hasRecording;

  useEffect(() => {
    if (!recordingReady) {
      setVideoUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await meetingsApi.downloadUrl(meetingId);
        if (!cancelled) setVideoUrl(res.url);
      } catch {
        // не показываем тост — отображение видео опционально
        if (!cancelled) setVideoUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, recordingReady]);

  const onRetry = async () => {
    setRetrying(true);
    try {
      await meetingsApi.retryAi(meetingId);
      addToast({ type: 'success', message: t('result.retry_started') });
      result.mutate();
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('errors.unknown');
      addToast({ type: 'error', message });
    } finally {
      setRetrying(false);
    }
  };

  // ── render ──
  if (result.state === 'loading') {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }
  if (result.state === 'error') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <ErrorState message={result.error} onRetry={() => result.mutate()} />
      </main>
    );
  }

  if (result.state === 'progress') {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
        <ProgressState status={result.data.meeting.status} />
      </main>
    );
  }

  if (result.state === 'failed') {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
        <section className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="text-lg font-semibold text-red-800">
            {t('result.failed_title')}
          </h2>
          <p className="mt-2 text-sm text-red-700">
            {result.error ?? t('result.failed_description')}
          </p>
          <div className="mt-4">
            <Button
              variant="primary"
              onClick={() => void onRetry()}
              loading={retrying}
            >
              {t('result.retry')}
            </Button>
          </div>
        </section>
      </main>
    );
  }

  // result.state === 'ready' — у нас есть AiResult.
  const meeting: MeetingDomain = meetingFromApi(result.data.meeting);
  const participants: ParticipantDomain[] = result.data.participants.map(
    participantFromApi,
  );
  if (!result.data.aiResult) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <EmptyState title={t('errors.unknown')} />
      </main>
    );
  }
  const ai = aiResultFromApi(result.data.aiResult);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">
      <ResultPageHeader
        meeting={meeting}
        participants={participants}
        hasRecording={recordingReady}
        onDeleted={() => result.mutate()}
      />

      {videoUrl ? (
        <VideoPlayer ref={videoRef} src={videoUrl} />
      ) : recordingReady ? (
        <Skeleton className="h-64 w-full" />
      ) : null}

      <SummaryCard summary={ai.summary} />

      {ai.customOutputMd ? (
        <CustomReportMd markdown={ai.customOutputMd} />
      ) : ai.structuredData ? (
        <ReportByType type={meeting.type} data={ai.structuredData} />
      ) : null}

      {ai.followUpEmail ? <FollowUpCard email={ai.followUpEmail} /> : null}
      {ai.tasks ? <TasksList tasks={ai.tasks} /> : null}

      {result.data.transcript?.hasMerged ? (
        <TranscriptViewer meetingId={meetingId} videoRef={videoRef} />
      ) : null}
    </main>
  );
}
