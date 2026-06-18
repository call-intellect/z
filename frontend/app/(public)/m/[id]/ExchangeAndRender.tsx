"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { authApi } from "@/api/auth.api";
import { ApiError } from "@/api/api-error";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { Skeleton } from "@/ui/components/shared/Skeleton";

import { MeetingPageShell } from "./MeetingPageShell";

type Props = {
  meetingId: string;
  deepLinkToken: string | null;
  inviteToken?: string | null;
};

type ExchangeStage = "pending" | "done";

export function ExchangeAndRender({
  meetingId,
  deepLinkToken,
  inviteToken,
}: Props) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [stage, setStage] = useState<ExchangeStage>(
    deepLinkToken ? "pending" : "done",
  );

  useEffect(() => {
    if (!deepLinkToken) return;

    let cancelled = false;
    (async () => {
      try {
        await authApi.exchange(deepLinkToken, meetingId);
        await refresh();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "unauthorized") {
          const message =
            e instanceof Error ? e.message : "Ошибка обмена токена.";
          toast.error(message);
        }
      } finally {
        if (!cancelled) {
          router.replace(`/m/${meetingId}`);
          setStage("done");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkToken, meetingId]);

  if (stage === "pending") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-subtle p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }

  return (
    <MeetingPageShell meetingId={meetingId} inviteToken={inviteToken ?? null} />
  );
}
