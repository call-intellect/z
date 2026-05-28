'use client';

import { useState } from 'react';
import {
  TrackToggle,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import {
  Copy,
  MessageSquare,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  Monitor,
  MonitorOff,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  CircleStop,
  Circle,
} from 'lucide-react';
import clsx from 'clsx';

import { useHostControls } from '@/hooks/use-host-controls';
import { toast } from 'sonner';
import { Modal } from '@/ui/components/shared/Modal';
import { Button } from '@/ui/components/shared/Button';
import { t } from '@/lib/i18n';

import { RaiseHandButton } from './RaiseHandButton';

type Props = {
  meetingId: string;
  isHost: boolean;
  isRecording: boolean;
  /** Если true — запись автоматическая, кнопку записи не показываем */
  recordByDefault: boolean;
  isFullscreen: boolean;
  onLeave: () => void;
  onToggleParticipants: () => void;
  onToggleChat: () => void;
  onToggleFullscreen: () => void;
};

export function ControlsBar({
  meetingId,
  isHost,
  isRecording,
  recordByDefault,
  isFullscreen,
  onLeave,
  onToggleParticipants,
  onToggleChat,
  onToggleFullscreen,
}: Props) {
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const room = useRoomContext();
  const host = useHostControls(meetingId);
  const [confirmFinish, setConfirmFinish] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/m/${meetingId}`);
      toast.success(t('meetings.copied'));
    } catch {
      toast.error(t('errors.unknown'));
    }
  };

  const onFinishConfirm = async () => {
    setConfirmFinish(false);
    const result = await host.finish();
    if (result.ok) {
      try { await room.disconnect(); } catch { /* ignore */ }
      onLeave();
    }
  };

  return (
    <>
      <div className="flex shrink-0 items-center justify-center gap-1 bg-bg-elevated px-4 py-3">

        {/* Media controls */}
        <TrackToggle
          source={Track.Source.Microphone}
          className={clsx(
            'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-medium transition-colors',
            isMicrophoneEnabled ? 'bg-bg-overlay text-fg-primary hover:bg-bg-overlay/80' : 'bg-danger text-danger-fg hover:opacity-90',
          )}
        >
          {isMicrophoneEnabled
            ? <Mic size={20} strokeWidth={1.75} />
            : <MicOff size={20} strokeWidth={1.75} />}
          <span>{isMicrophoneEnabled ? 'Микрофон' : 'Выкл.'}</span>
        </TrackToggle>

        <TrackToggle
          source={Track.Source.Camera}
          className={clsx(
            'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-medium transition-colors',
            isCameraEnabled ? 'bg-bg-overlay text-fg-primary hover:bg-bg-overlay/80' : 'bg-danger text-danger-fg hover:opacity-90',
          )}
        >
          {isCameraEnabled
            ? <Video size={20} strokeWidth={1.75} />
            : <VideoOff size={20} strokeWidth={1.75} />}
          <span>{isCameraEnabled ? 'Камера' : 'Выкл.'}</span>
        </TrackToggle>

        <TrackToggle
          source={Track.Source.ScreenShare}
          className={clsx(
            'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-medium transition-colors',
            isScreenShareEnabled ? 'bg-info text-info-fg hover:opacity-90' : 'bg-bg-overlay text-fg-primary hover:bg-bg-overlay/80',
          )}
        >
          {isScreenShareEnabled
            ? <MonitorOff size={20} strokeWidth={1.75} />
            : <Monitor size={20} strokeWidth={1.75} />}
          <span>{isScreenShareEnabled ? 'Стоп' : 'Экран'}</span>
        </TrackToggle>

        <div className="mx-2 h-10 w-px bg-slate-600" />

        {/* Interaction controls */}
        <RaiseHandButton />

        <IconBtn icon={<Users size={20} strokeWidth={1.75} />} label="Участники" onClick={onToggleParticipants} />
        <IconBtn icon={<MessageSquare size={20} strokeWidth={1.75} />} label="Чат" onClick={onToggleChat} />
        <IconBtn
          icon={isFullscreen ? <Minimize size={20} strokeWidth={1.75} /> : <Maximize size={20} strokeWidth={1.75} />}
          label={isFullscreen ? 'Окно' : 'На весь экран'}
          onClick={onToggleFullscreen}
        />

        {isHost && (
          <>
            <div className="mx-2 h-10 w-px bg-slate-600" />

            <IconBtn
              icon={<Copy size={20} strokeWidth={1.75} />}
              label="Ссылка"
              onClick={() => { void copyLink(); }}
            />

            {/* Кнопка записи — только если ручной режим */}
            {!recordByDefault && (
              <IconBtn
                icon={isRecording
                  ? <CircleStop size={20} strokeWidth={1.75} />
                  : <Circle size={20} strokeWidth={1.75} />
                }
                label={isRecording ? 'Стоп' : 'Запись'}
                active={isRecording}
                activeClass="bg-danger hover:opacity-90"
                disabled={host.pending === 'record-start' || host.pending === 'record-stop'}
                onClick={() => {
                  if (isRecording) { void host.stopRecording(); }
                  else { void host.startRecording(); }
                }}
              />
            )}

            <button
              type="button"
              onClick={() => setConfirmFinish(true)}
              className="flex flex-col items-center gap-1 rounded-xl bg-danger px-4 py-2 text-[10px] font-medium text-danger-fg transition-colors hover:opacity-90"
            >
              <PhoneOff size={20} strokeWidth={1.75} />
              <span>Завершить</span>
            </button>
          </>
        )}

        {!isHost && (
          <>
            <div className="mx-2 h-10 w-px bg-border" />
            <button
              type="button"
              onClick={() => { void room.disconnect(); onLeave(); }}
              className="flex flex-col items-center gap-1 rounded-xl bg-bg-overlay px-4 py-2 text-[10px] font-medium text-fg-primary transition-colors hover:bg-bg-overlay/80"
            >
              <PhoneOff size={20} strokeWidth={1.75} />
              <span>Выйти</span>
            </button>
          </>
        )}
      </div>

      <Modal
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title={t('room.finish_confirm_title')}
      >
        <p className="mb-6 text-sm text-fg-secondary">{t('room.finish_confirm_description')}</p>
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

function IconBtn({
  icon,
  label,
  onClick,
  active,
  activeClass,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-medium transition-colors disabled:opacity-50',
        active
          ? (activeClass ?? 'bg-warning text-warning-fg hover:opacity-90')
          : 'bg-bg-overlay text-fg-primary hover:bg-bg-overlay/80',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
