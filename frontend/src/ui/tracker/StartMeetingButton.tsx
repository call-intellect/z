'use client';

/**
 * StartMeetingButton — запустить LiveKit-встречу по задаче.
 *
 * Backend `POST /issues/:id/start-meeting` создаёт Meeting + host JWT, после
 * чего фронт делает редирект на страницу встречи (`/meetings/:id`).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Video, Loader2 } from 'lucide-react';
import { Button } from '@/ui/shadcn/button';
import { issuesApi } from '@/api/tracker/issues.api';

export function StartMeetingButton({
  orgId,
  issueId,
}: {
  orgId: string;
  issueId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await issuesApi.startMeeting(orgId, issueId, {
        inviteUserIds: [],
      });
      // Если backend вернул meetingUrl — используем его, иначе строим по meetingId.
      const url = res.meetingUrl || `/meetings/${encodeURIComponent(res.meetingId)}`;
      router.push(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить встречу');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="default"
        size="sm"
        onClick={() => void handleClick()}
        disabled={loading}
        className="w-full gap-2"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Video size={14} />
        )}
        Запустить встречу по задаче
      </Button>
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
