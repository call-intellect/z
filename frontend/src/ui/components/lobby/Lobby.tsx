'use client';

import { GuestNameForm } from './GuestNameForm';
import { WaitingHost } from './WaitingHost';
import type { JoinMeetingApiResponse } from '@/api/meetings.api';

type Props = {
  meetingId: string;
  meetingTitle: string;
  /** true — встреча scheduled (хост ещё не подключился). Показываем + форму, + ожидание. */
  waitingForHost: boolean;
  /** Персональный токен приглашения (`?inv=`). Пробрасывается в join, чтобы
   *  переиспользовать pre-seed `invitee:`-строку, а не плодить дубль `guest:`. */
  inviteToken?: string | null;
  onJoined: (data: JoinMeetingApiResponse) => void;
};

/**
 * Гостевой Lobby. Логика разделена:
 *  - waitingForHost === true → форма имени + сообщение «ожидание организатора».
 *  - waitingForHost === false (active) → только форма имени.
 *
 * После успешного join'а вызовется `onJoined` с LiveKit-данными — родитель
 * подключит `<MeetingRoom />`.
 */
export function Lobby({ meetingId, meetingTitle, waitingForHost, inviteToken, onJoined }: Props) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg-subtle px-4 py-12">
      <h1 className="text-center text-2xl font-semibold text-fg-primary">
        {meetingTitle}
      </h1>
      {waitingForHost ? <WaitingHost /> : null}
      <GuestNameForm meetingId={meetingId} inviteToken={inviteToken} onJoined={onJoined} />
    </main>
  );
}
