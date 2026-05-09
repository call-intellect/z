'use client';

import { useState } from 'react';

import { meetingsApi } from '@/api/meetings.api';
import { ApiError } from '@/api/api-error';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/components/shared/Button';
import { Modal } from '@/ui/components/shared/Modal';
import type { MeetingDomain, ParticipantDomain } from '@/domain/meeting';
import { meetingDurationSeconds } from '@/domain/meeting';
import { t } from '@/lib/i18n';

type Props = {
  meeting: MeetingDomain;
  participants: ParticipantDomain[];
  hasRecording: boolean;
  onDeleted: () => void;
};

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const mins = Math.round(sec / 60);
  if (mins < 1) return `<1 ${t('common.minutes')}`;
  return `${mins} ${t('common.minutes')}`;
}

export function ResultPageHeader({
  meeting,
  participants,
  hasRecording,
  onDeleted,
}: Props) {
  const { addToast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/m/${meeting.id}`);
      addToast({ type: 'success', message: t('meetings.copied') });
    } catch {
      addToast({ type: 'error', message: t('errors.unknown') });
    }
  };

  const onDownload = async () => {
    setPending('download');
    try {
      const res = await meetingsApi.downloadUrl(meeting.id);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('errors.unknown');
      addToast({ type: 'error', message });
    } finally {
      setPending(null);
    }
  };

  const onDelete = async () => {
    setPending('delete');
    setConfirmDelete(false);
    try {
      await meetingsApi.deleteRecording(meeting.id);
      addToast({ type: 'success', message: t('result.deleted_toast') });
      onDeleted();
    } catch (e) {
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : t('errors.unknown');
      addToast({ type: 'error', message });
    } finally {
      setPending(null);
    }
  };

  return (
    <header className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{meeting.title}</h1>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-600">
            <span>
              {t('result.type')}: <strong>{t(`meeting_types.${meeting.type}.label`)}</strong>
            </span>
            <span>
              {t('result.date')}: <strong>{formatDate(meeting.createdAt)}</strong>
            </span>
            <span>
              {t('result.duration')}:{' '}
              <strong>{formatDuration(meetingDurationSeconds(meeting))}</strong>
            </span>
            <span>
              {t('result.participants')}: <strong>{participants.length}</strong>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void onCopy()}>
            {t('meetings.copy_link')}
          </Button>
          {hasRecording ? (
            <Button
              variant="primary"
              size="sm"
              loading={pending === 'download'}
              onClick={() => void onDownload()}
            >
              {t('result.download_recording')}
            </Button>
          ) : null}
          {hasRecording ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              loading={pending === 'delete'}
            >
              {t('result.delete_recording')}
            </Button>
          ) : null}
        </div>
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('result.delete_confirm_title')}
      >
        <p className="mb-6 text-sm text-slate-700">
          {t('result.delete_confirm_description')}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void onDelete()}>
            {t('common.delete')}
          </Button>
        </div>
      </Modal>
    </header>
  );
}
