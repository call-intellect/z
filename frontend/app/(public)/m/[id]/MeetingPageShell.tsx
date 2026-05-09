'use client';

import { useEffect, useState } from 'react';

import { meetingsApi, type JoinMeetingApiResponse } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { useMeetingAccess } from '@/hooks/use-meeting-access';
import { useToast } from '@/contexts/toast-context';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Lobby } from '@/ui/components/lobby/Lobby';
import { MeetingFinishedPlaceholder } from '@/ui/components/MeetingFinishedPlaceholder';
import { MeetingFailedPlaceholder } from '@/ui/components/MeetingFailedPlaceholder';
import { MeetingRoom } from '@/ui/components/meeting-room/MeetingRoom';
import { t } from '@/lib/i18n';
import type { MeetingStatus } from '@/domain/enums';

type Props = { meetingId: string };

const FINISHED_STATUSES: MeetingStatus[] = [
  'completed',
  'recording_processing',
  'recording_ready',
  'transcription_processing',
  'transcription_ready',
  'ai_processing',
  'ai_ready',
];

type JoinedState = {
  joined: JoinMeetingApiResponse;
  identityToParticipantId: Record<string, string>;
};

export function MeetingPageShell({ meetingId }: Props) {
  const access = useMeetingAccess(meetingId);
  const { addToast } = useToast();
  const [joined, setJoined] = useState<JoinedState | null>(null);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);

  // Авто-join хоста — как только мы знаем что role === 'host' и встреча
  // ещё «живая».
  useEffect(() => {
    if (joined) return;
    if (autoJoinAttempted) return;
    if (access.state !== 'ready') return;
    const role = access.data.role;
    const status = access.data.meeting.status;

    const isJoinableStatus = status === 'scheduled' || status === 'active';
    if (role === 'host' && isJoinableStatus) {
      setAutoJoinAttempted(true);
      void joinAsHostOrGuest();
    } else if (role === 'guest' && status === 'active') {
      // Зарегистрированный гость с уже сохранённым Participant — также авто-join.
      setAutoJoinAttempted(true);
      void joinAsHostOrGuest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.state]);

  const joinAsHostOrGuest = async () => {
    try {
      const result = await meetingsApi.join(meetingId, {});
      // Карту identity→pid строим из /meetings/:id (host-only) — для гостя пустая.
      let identityMap: Record<string, string> = {};
      if (result.role === 'host') {
        try {
          const detail = await meetingsApi.get(meetingId);
          identityMap = Object.fromEntries(
            detail.participants.map((p) => [p.livekitIdentity, p.id]),
          );
        } catch {
          // ignore
        }
      }
      setJoined({ joined: result, identityToParticipantId: identityMap });
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : 'Не удалось подключиться.';
      addToast({ type: 'error', message });
    }
  };

  // ─── render ────────────────────────────────────────────
  if (access.state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }

  if (access.state === 'error') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <ErrorState message={access.error} onRetry={() => access.mutate()} />
      </main>
    );
  }

  const { role, meeting } = access.data;

  if (meeting.status === 'failed') {
    return <MeetingFailedPlaceholder />;
  }

  // Если уже подключились — комната.
  if (joined) {
    return (
      <MeetingRoom
        meetingId={meetingId}
        meeting={meeting}
        livekit={joined.joined.livekit}
        role={joined.joined.role}
        identityToParticipantId={joined.identityToParticipantId}
        onLeave={() => {
          setJoined(null);
          // После leave вернёмся в страницу — access по-прежнему валиден.
          // Если встреча уже не active — useMeetingAccess подтянет это.
          access.mutate();
        }}
      />
    );
  }

  // Завершённые статусы.
  if (FINISHED_STATUSES.includes(meeting.status)) {
    return (
      <MeetingFinishedPlaceholder
        meetingId={meetingId}
        isHost={role === 'host'}
      />
    );
  }

  // Live: scheduled / active.
  if (role === 'none') {
    // Гость без cookie — форма имени.
    return (
      <Lobby
        meetingId={meetingId}
        meetingTitle={meeting.title}
        waitingForHost={meeting.status === 'scheduled'}
        onJoined={(data) =>
          setJoined({ joined: data, identityToParticipantId: {} })
        }
      />
    );
  }

  // role === host или guest, но joined ещё не выставлено (автоjoin в полёте) —
  // показываем «загрузка комнаты».
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm space-y-3 text-center">
        <p className="text-slate-700">{t('app.loading')}</p>
        <Skeleton className="h-32 w-full" />
      </div>
    </main>
  );
}
