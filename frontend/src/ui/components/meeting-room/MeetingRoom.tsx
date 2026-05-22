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
  recordByDefault?: boolean;
  identityToParticipantId?: Record<string, string>;
  onLeave: () => void;
};

const RECORDING_POLL_MS = 5_000;

export function MeetingRoom({
  meetingId,
  meeting,
  livekit,
  role,
  recordByDefault = true,
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

  const { data: accessData } = useSWR(
    ['room-access', meetingId],
    async () => meetingsApi.access(meetingId),
    {
      refreshInterval: RECORDING_POLL_MS,
      revalidateOnFocus: false,
    },
  );

  const status = accessData?.meeting.status ?? meeting.status;
  const isRecording = accessData?.isRecordingActive ?? false;

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

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 bg-[#1a1a2e] px-5 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-white">{meeting.title}</span>
          <span className="truncate text-[11px] text-slate-400">
            {t(`meeting_types.${meeting.type}.label`)}
          </span>
        </div>
        <RecordingIndicator active={isRecording} />
      </header>

      {/* Main content */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0d0d1a]">
        <div className="flex flex-1 flex-col overflow-hidden">
          <VideoArea />
        </div>
        <ParticipantsPanel
          open={participantsOpen}
          onClose={() => setParticipantsOpen(false)}
          meetingId={meetingId}
          isHost={isHost}
          identityToParticipantId={identityMap}
        />
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          meetingId={meetingId}
        />
      </div>

      {/* Controls */}
      <ControlsBar
        meetingId={meetingId}
        isHost={isHost}
        isRecording={isRecording}
        recordByDefault={recordByDefault}
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
