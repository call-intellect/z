'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import useSWR from 'swr';

import { meetingsApi } from '@/api/meetings.api';
import type { JoinMeetingApiResponse } from '@/api/meetings.api';
import { useToast } from '@/contexts/toast-context';
import { t } from '@/lib/i18n';
import type { MeetingStatus, MeetingType } from '@/domain/enums';

import { ChatPanel } from './ChatPanel';
import { ControlsBar } from './ControlsBar';
import { ParticipantsPanel } from './ParticipantsPanel';
import { RecordingIndicator } from './RecordingIndicator';

type MeetingMeta = {
  id: string;
  title: string;
  type: MeetingType;
  status: MeetingStatus;
};

type Props = {
  meetingId: string;
  meeting: MeetingMeta;
  livekit: JoinMeetingApiResponse['livekit'];
  role: 'host' | 'guest';
  /**
   * Карта `livekitIdentity → participantId` для host-actions. Передаётся хосту
   * (он знает всех участников через `/access` или `/`), у гостя пустая.
   */
  identityToParticipantId?: Record<string, string>;
  onLeave: () => void;
};

const RECORDING_POLL_MS = 10_000;

/**
 * Корневой компонент комнаты. Подключается к LiveKit, рендерит сетку видео
 * + audio mix + панели управления.
 */
export function MeetingRoom({
  meetingId,
  meeting,
  livekit,
  role,
  identityToParticipantId,
  onLeave,
}: Props) {
  const isHost = role === 'host';
  const { addToast } = useToast();
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const identityMap = useMemo(
    () => identityToParticipantId ?? {},
    [identityToParticipantId],
  );

  // Polling статуса встречи каждые 10 сек — нужен для индикатора записи.
  // Используем `/access` (легковесный, без host-only-проверки).
  const { data: accessData } = useSWR(
    ['room-access', meetingId],
    async () => meetingsApi.access(meetingId),
    {
      refreshInterval: RECORDING_POLL_MS,
      revalidateOnFocus: false,
    },
  );

  const status = accessData?.meeting.status ?? meeting.status;
  const isRecording =
    status === 'recording_processing' || status === 'recording_ready';

  // Если встреча перешла в completed/failed — мягко отключаемся.
  useEffect(() => {
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'recording_processing' ||
      status === 'transcription_processing' ||
      status === 'ai_processing' ||
      status === 'ai_ready'
    ) {
      addToast({ type: 'info', message: t('lobby.finished_title') });
      onLeave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <LiveKitRoom
      token={livekit.token}
      serverUrl={livekit.url}
      connect={true}
      audio={true}
      video={true}
      data-lk-theme="default"
      onDisconnected={onLeave}
      onError={(e) => {
        addToast({ type: 'error', message: e.message });
      }}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <RoomAudioRenderer />

      <header className="flex items-center justify-between gap-2 bg-slate-900 px-4 py-2 text-white">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{meeting.title}</span>
          <span className="truncate text-xs text-slate-400">
            {t(`meeting_types.${meeting.type}.label`)}
          </span>
        </div>
        <RecordingIndicator active={isRecording} />
      </header>

      <div className="flex flex-1 overflow-hidden bg-slate-950">
        <div className="flex flex-1 flex-col">
          <VideoArea />
        </div>
        <ParticipantsPanel
          open={participantsOpen}
          onClose={() => setParticipantsOpen(false)}
          meetingId={meetingId}
          isHost={isHost}
          identityToParticipantId={identityMap}
        />
        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>

      <ControlsBar
        meetingId={meetingId}
        isHost={isHost}
        isRecording={isRecording}
        onLeave={onLeave}
        onToggleParticipants={() => {
          setChatOpen(false);
          setParticipantsOpen((v) => !v);
        }}
        onToggleChat={() => {
          setParticipantsOpen(false);
          setChatOpen((v) => !v);
        }}
      />
    </LiveKitRoom>
  );
}

function VideoArea() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <GridLayout
      tracks={tracks}
      style={{ height: '100%' }}
      className="lk-grid-layout"
    >
      <ParticipantTile />
    </GridLayout>
  );
}
