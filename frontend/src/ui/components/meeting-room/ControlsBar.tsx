'use client';

import { useState } from 'react';
import clsx from 'clsx';
import {
  TrackToggle,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';

import { useHostControls } from '@/hooks/use-host-controls';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/components/shared/Button';
import { Modal } from '@/ui/components/shared/Modal';
import { t } from '@/lib/i18n';

import { RaiseHandButton } from './RaiseHandButton';

type Props = {
  meetingId: string;
  isHost: boolean;
  /** true → запись активна (по статусу встречи). Управляется родителем через polling. */
  isRecording: boolean;
  onLeave: () => void;
  onToggleParticipants: () => void;
  onToggleChat: () => void;
};

const baseBtn =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors';
const ghost = clsx(baseBtn, 'bg-slate-700 text-white hover:bg-slate-600');
const danger = clsx(baseBtn, 'bg-red-600 text-white hover:bg-red-700');

export function ControlsBar({
  meetingId,
  isHost,
  isRecording,
  onLeave,
  onToggleParticipants,
  onToggleChat,
}: Props) {
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const room = useRoomContext();
  const host = useHostControls(meetingId);
  const { addToast } = useToast();
  const [confirmFinish, setConfirmFinish] = useState(false);

  const copyLink = async () => {
    try {
      const url = `${window.location.origin}/m/${meetingId}`;
      await navigator.clipboard.writeText(url);
      addToast({ type: 'success', message: t('meetings.copied') });
    } catch {
      addToast({ type: 'error', message: t('errors.unknown') });
    }
  };

  const onFinishConfirm = async () => {
    setConfirmFinish(false);
    const result = await host.finish();
    if (result.ok) {
      // На стороне backend room удалится → LiveKit разорвёт соединение, сработает onLeave.
      // Но в качестве страховки — явный disconnect.
      try {
        await room.disconnect();
      } catch {
        // ignore
      }
      onLeave();
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-2 bg-slate-900/95 px-4 py-3 text-white">
        <TrackToggle
          source={Track.Source.Microphone}
          className={ghost}
          aria-label={
            isMicrophoneEnabled
              ? t('room.controls.mic_on')
              : t('room.controls.mic_off')
          }
        >
          {isMicrophoneEnabled
            ? t('room.controls.mic_on')
            : t('room.controls.mic_off')}
        </TrackToggle>
        <TrackToggle
          source={Track.Source.Camera}
          className={ghost}
          aria-label={
            isCameraEnabled
              ? t('room.controls.camera_on')
              : t('room.controls.camera_off')
          }
        >
          {isCameraEnabled
            ? t('room.controls.camera_on')
            : t('room.controls.camera_off')}
        </TrackToggle>
        <TrackToggle
          source={Track.Source.ScreenShare}
          className={ghost}
          aria-label={
            isScreenShareEnabled
              ? t('room.controls.screen_on')
              : t('room.controls.screen_off')
          }
        >
          {isScreenShareEnabled
            ? t('room.controls.screen_on')
            : t('room.controls.screen_off')}
        </TrackToggle>

        <RaiseHandButton />

        <button type="button" onClick={onToggleParticipants} className={ghost}>
          {t('room.controls.participants')}
        </button>
        <button type="button" onClick={onToggleChat} className={ghost}>
          {t('room.controls.chat')}
        </button>

        {isHost ? (
          <>
            <button
              type="button"
              onClick={() => {
                if (isRecording) {
                  void host.stopRecording();
                } else {
                  void host.startRecording();
                }
              }}
              disabled={
                host.pending === 'record-start' || host.pending === 'record-stop'
              }
              className={clsx(
                baseBtn,
                isRecording
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700',
                'disabled:opacity-60',
              )}
            >
              {isRecording
                ? t('room.controls.record_stop')
                : t('room.controls.record_start')}
            </button>
            <button
              type="button"
              onClick={() => {
                void copyLink();
              }}
              className={ghost}
            >
              {t('room.controls.copy_link')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmFinish(true)}
              className={danger}
            >
              {t('room.controls.finish')}
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => {
            void room.disconnect();
            onLeave();
          }}
          className={clsx(baseBtn, 'bg-slate-700 text-white hover:bg-slate-600')}
        >
          {t('room.controls.leave')}
        </button>
      </div>

      <Modal
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title={t('room.finish_confirm_title')}
      >
        <p className="mb-6 text-sm text-slate-700">
          {t('room.finish_confirm_description')}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmFinish(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void onFinishConfirm()}>
            {t('room.controls.finish')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
