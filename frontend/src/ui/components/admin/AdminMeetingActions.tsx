'use client';

import { useState } from 'react';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Button } from '@/ui/components/shared/Button';
import { t } from '@/lib/i18n';

type Props = {
  meetingId: string;
  onChanged?: () => void;
};

export function AdminMeetingActions({ meetingId, onChanged }: Props) {
  const [forceFinishLoading, setForceFinishLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  async function handleForceFinish() {
    const ok = await ask({
      title: t('admin.meetings.force_finish_confirm'),
      confirmLabel: 'Подтвердить',
      destructive: true,
    });
    if (!ok) return;
    setForceFinishLoading(true);
    try {
      await adminApi.forceFinish(meetingId);
      toast.success('OK');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.unknown'));
    } finally {
      setForceFinishLoading(false);
    }
  }

  async function handleRetryAi() {
    const ok = await ask({
      title: t('admin.meetings.retry_ai_confirm'),
      confirmLabel: 'Подтвердить',
    });
    if (!ok) return;
    setRetryLoading(true);
    try {
      await adminApi.retryAi(meetingId);
      toast.success('OK');
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('errors.unknown'));
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
      {confirmDialog}
    </div>
  );
}
