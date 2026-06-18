'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  isTrackReference,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
} from '@livekit/components-react';
import type {
  TrackReference,
  TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import useSWR from 'swr';

import { meetingsApi } from '@/api/meetings.api';
import type { JoinMeetingApiResponse } from '@/api/meetings.api';
import { humanizeApiError } from '@/api/api-error';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import {
  buildAudioCaptureOptions,
  getNoiseSuppressionEnabled,
} from '@/lib/livekit/noise-suppression';
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
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }, []);
  const identityMap = useMemo(
    () => identityToParticipantId ?? {},
    [identityToParticipantId],
  );

  // Шумоподавление: читаем настройку один раз при монтировании комнаты.
  // Менять «на лету» не даём — LiveKit применяет AudioCaptureOptions при
  // создании трека (`enableMicrophone`), и переключение потребовало бы
  // пересоздать трек. Изменить можно из Lobby/PreJoin до входа.
  const audioCaptureOptions = useMemo(
    () => buildAudioCaptureOptions(getNoiseSuppressionEnabled()),
    [],
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
      status === 'ai_failed' ||
      status === 'recording_processing' ||
      status === 'transcription_processing' ||
      status === 'ai_processing' ||
      status === 'ai_ready'
    ) {
      toast(t('lobby.finished_title'));
      onLeave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <LiveKitRoom
      token={livekit.token}
      serverUrl={livekit.url}
      connect={true}
      audio={audioCaptureOptions}
      video={true}
      data-lk-theme="default"
      onDisconnected={onLeave}
      onError={(e) => {
        toast.error(humanizeApiError(e, 'Ошибка соединения со встречей'));
      }}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <RoomAudioRenderer />

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 bg-bg-elevated px-5 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-fg-primary">{meeting.title}</span>
          <span className="truncate text-[11px] text-fg-tertiary">
            {t(`meeting_types.${meeting.type}.label`)}
          </span>
        </div>
        <RecordingIndicator active={isRecording} />
      </header>

      {/* Main content */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-bg-base">
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
        isFullscreen={isFullscreen}
        onLeave={onLeave}
        onToggleParticipants={() => {
          setChatOpen(false);
          setParticipantsOpen((v) => !v);
        }}
        onToggleChat={() => {
          setParticipantsOpen(false);
          setChatOpen((v) => !v);
        }}
        onToggleFullscreen={() => { void toggleFullscreen(); }}
      />
    </LiveKitRoom>
  );
}

/**
 * Совпадают ли две дорожки — чтобы исключить дорожку «в фокусе» из карусели.
 * Заменяет `isEqualTrackRef` из @livekit/components-core (не входит в публичный
 * API @livekit/components-react, тянуть транзитивную зависимость не хотим).
 */
function isSameTrack(
  a: TrackReferenceOrPlaceholder | undefined,
  b: TrackReferenceOrPlaceholder | undefined,
): boolean {
  if (!a || !b) return false;
  if (isTrackReference(a) && isTrackReference(b)) {
    return a.publication.trackSid === b.publication.trackSid;
  }
  return a.participant.identity === b.participant.identity && a.source === b.source;
}

function VideoArea() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const layoutContext = useCreateLayoutContext();

  // Реальные дорожки демонстрации экрана (без плейсхолдеров).
  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare);

  // Дорожка «в фокусе» = закреплённая (демонстрация экрана или ручной пин тайла).
  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((track) => !isSameTrack(track, focusTrack));

  // Авто-фокус на демонстрации экрана: появилась → выводим на главную сцену,
  // исчезла → возвращаемся к сетке. Повторяет поведение прелба VideoConference
  // из @livekit/components-react, чтобы демонстрация не была «ещё одним участником».
  const autoPinnedRef = useRef<TrackReference | null>(null);
  const screenShareSignature = screenShareTracks
    .map((track) => `${track.publication.trackSid}_${track.publication.isSubscribed}`)
    .join();
  useEffect(() => {
    const hasSubscribedShare = screenShareTracks.some(
      (track) => track.publication.isSubscribed,
    );
    if (hasSubscribedShare && autoPinnedRef.current === null) {
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: screenShareTracks[0] });
      autoPinnedRef.current = screenShareTracks[0];
    } else if (
      autoPinnedRef.current &&
      !screenShareTracks.some(
        (track) => track.publication.trackSid === autoPinnedRef.current?.publication.trackSid,
      )
    ) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      autoPinnedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenShareSignature]);

  // Один участник без демонстрации — показываем кадр целиком (object-fit: contain),
  // иначе на широком экране одиночный тайл обрезается/«распирается» во всю ширину.
  const isSolo = !focusTrack && tracks.length === 1;

  return (
    <LayoutContextProvider value={layoutContext}>
      {focusTrack ? (
        <div className="relative flex h-full w-full items-stretch justify-center">
          <FocusLayoutContainer>
            <CarouselLayout tracks={carouselTracks}>
              <ParticipantTile />
            </CarouselLayout>
            <FocusLayout trackRef={focusTrack} />
          </FocusLayoutContainer>
        </div>
      ) : (
        <GridLayout
          tracks={tracks}
          style={{ height: '100%' }}
          className={isSolo ? 'lk-grid-layout kora-video-grid kora-video-solo' : 'lk-grid-layout kora-video-grid'}
        >
          <ParticipantTile />
        </GridLayout>
      )}
    </LayoutContextProvider>
  );
}
