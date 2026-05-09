'use client';

import { useState } from 'react';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/components/shared/Button';
import { t } from '@/lib/i18n';

type Props = {
  meetingId: string;
  onChanged?: () => void;
};

export function AdminMeetingActions({ meetingId, onChanged }: Props) {
  const { addToast } = useToast();
  const [forceFinishLoading, setForceFinishLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);

  async function handleForceFinish() {
    if (!confirm(t('admin.meetings.force_finish_confirm'))) return;
    setForceFinishLoading(true);
    try {
      await adminApi.forceFinish(meetingId);
      addToast({ type: 'success', message: 'OK' });
      onChanged?.();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : t('errors.unknown'),
      });
    } finally {
      setForceFinishLoading(false);
    }
  }

  async function handleRetryAi() {
    if (!confirm(t('admin.meetings.retry_ai_confirm'))) return;
    setRetryLoading(true);
    try {
      await adminApi.retryAi(meetingId);
      addToast({ type: 'success', message: 'OK' });
      onChanged?.();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : t('errors.unknown'),
      });
    } finally {
      setRetryLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="danger"
        size="sm"
        loading={forceFinishLoading}
        onClick={handleForceFinish}
      >
        {t('admin.meetings.force_finish')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        loading={retryLoading}
        onClick={handleRetryAi}
      >
        {t('admin.meetings.retry_ai')}
      </Button>
    </div>
  );
}
