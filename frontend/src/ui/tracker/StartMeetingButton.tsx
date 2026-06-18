"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Loader2 } from "lucide-react";
import { Button } from "@/ui/shadcn/button";
import { issuesApi } from "@/api/tracker/issues.api";
import { humanizeApiError } from "@/api/api-error";

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
      const url =
        res.meetingUrl || `/meetings/${encodeURIComponent(res.meetingId)}`;
      router.push(url);
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось запустить встречу"));
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
