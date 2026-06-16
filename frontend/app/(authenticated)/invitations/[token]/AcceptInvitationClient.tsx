"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { orgsApi } from "@/api/orgs.api";
import { toast } from "sonner";
import { Button } from "@/ui/shadcn/button";

export function AcceptInvitationClient({ token }: { token: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState<{
    orgId: string;
    role: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await orgsApi.acceptInvitation(token);
      setAccepted({ orgId: res.orgId, role: res.membership.role });
      toast.success("Вы добавлены в организацию");
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (e) {
      const msg = humanizeApiError(e, "Не удалось принять приглашение");
      setError(msg);
      toast.error(msg);
    } finally {
      setAccepting(false);
    }
  };

  if (accepted) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">Готово</h1>
        <p className="text-sm text-fg-secondary">
          Вы добавлены как <strong>{accepted.role}</strong>. Сейчас перенесём
          вас на дашборд…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="mb-2 text-2xl font-semibold">Приглашение в организацию</h1>
      <p className="mb-6 text-sm text-fg-secondary">
        Вы получили приглашение присоединиться к организации в Z. Нажмите
        «Принять», чтобы стать участником.
      </p>
      <Button
        size="lg"
        className="w-full"
        onClick={handleAccept}
        disabled={accepting}
      >
        {accepting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Принимаем…
          </>
        ) : (
          "Принять приглашение"
        )}
      </Button>
      {error ? (
        <p className="mt-4 text-sm text-status-danger">{error}</p>
      ) : null}
    </div>
  );
}
