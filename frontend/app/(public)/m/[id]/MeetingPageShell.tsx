'use client';

import { useEffect, useState } from 'react';

import { meetingsApi, type JoinMeetingApiResponse } from '@/api/meetings.api';
import { ApiError, humanizeApiError } from '@/api/api-error';
import { useMeetingAccess } from '@/hooks/use-meeting-access';
import { toast } from 'sonner';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Lobby } from '@/ui/components/lobby/Lobby';
import { MeetingFinishedPlaceholder } from '@/ui/components/MeetingFinishedPlaceholder';
import { MeetingFailedPlaceholder } from '@/ui/components/MeetingFailedPlaceholder';
import { MeetingRoom } from '@/ui/components/meeting-room/MeetingRoom';
import { Button } from '@/ui/components/shared/Button';
import { copyToClipboard } from '@/lib/copy-to-clipboard';
import { isJoinableStatus } from '@/domain/meeting';
import type { MeetingStatus } from '@/domain/enums';

type Props = {
  meetingId: string;
  /**
   * Персональный токен приглашения (`?inv=`, Ф3.1). Если задан — пробрасываем
   * в `meetingsApi.join`, чтобы приглашённый вошёл под своей identity
   * (pre-seeded `Participant`), а не как новый аноним.
   */
  inviteToken?: string | null;
};

const FINISHED_STATUSES: MeetingStatus[] = [
  'completed',
  'recording_processing',
  'recording_ready',
  'transcription_processing',
  'transcription_ready',
  'ai_processing',
  'ai_ready',
  // `ai_failed` — встреча завершена, упала только AI-ветка, но запись готова.
  // Это НЕ полный провал: показываем «завершено» (запись доступна), а не
  // экран ошибки.
  'ai_failed',
];

type JoinedState = {
  joined: JoinMeetingApiResponse;
  identityToParticipantId: Record<string, string>;
};

export function MeetingPageShell({ meetingId, inviteToken }: Props) {
  const access = useMeetingAccess(meetingId);
  const [joined, setJoined] = useState<JoinedState | null>(null);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);
  const [hasLeft, setHasLeft] = useState(false);

  // Авто-join хоста — как только мы знаем что role === 'host' и встреча
  // ещё «живая».
  useEffect(() => {
    if (joined) return;
    if (autoJoinAttempted) return;
    if (access.state !== 'ready') return;
    const { role, meeting: { status } } = access.data;

    if (role === 'host' && isJoinableStatus(status)) {
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
      const result = await meetingsApi.join(
        meetingId,
        inviteToken ? { invite_token: inviteToken } : {},
      );
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
        humanizeApiError(e, 'Не удалось подключиться.');
      toast.error(message);
    }
  };

  const rejoin = async () => {
    setHasLeft(false);
    await joinAsHostOrGuest();
  };

  const copyShellLink = async () => {
    const ok = await copyToClipboard(`${window.location.origin}/m/${meetingId}`);
    if (ok) toast.success('Ссылка скопирована');
    else toast.error('Не удалось скопировать ссылку');
  };

  // ─── render ────────────────────────────────────────────
  if (access.state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-subtle p-6">
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
      <main className="flex min-h-screen items-center justify-center bg-bg-subtle p-6">
        <ErrorState message={access.error} onRetry={() => access.mutate()} />
      </main>
    );
  }

  const { role, meeting, recordByDefault } = access.data;

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
        recordByDefault={recordByDefault}
        identityToParticipantId={joined.identityToParticipantId}
        onLeave={() => {
          setJoined(null);
          setHasLeft(true);
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
        inviteToken={inviteToken ?? null}
        onJoined={(data) =>
          setJoined({ joined: data, identityToParticipantId: {} })
        }
      />
    );
  }

  // role === host/guest, joined ещё не выставлено: либо авто-join в полёте,
  // либо пользователь вышел (B2) и может вернуться. Для хоста — копирование
  // ссылки (B4). Сюда попадаем только при joinable-статусе (failed/finished
  // отсеяны выше).
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-subtle p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border-subtle bg-bg-elevated p-6 text-center">
        <h1 className="text-lg font-semibold text-fg-primary">
          {hasLeft ? 'Вы вышли из встречи' : meeting.title}
        </h1>
        <p className="text-sm text-fg-secondary">
          {hasLeft
            ? 'Встреча продолжается — вы можете вернуться в любой момент.'
            : 'Подключаемся к встрече…'}
        </p>
        {!hasLeft && <Skeleton className="h-2 w-full" />}
        <div className="flex flex-col gap-2">
          <Button onClick={() => void rejoin()}>
            {hasLeft ? 'Вернуться в встречу' : 'Войти'}
          </Button>
          {role === 'host' && (
            <Button variant="secondary" onClick={() => void copyShellLink()}>
              Скопировать ссылку
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
