"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { accountsApi } from "@/api/accounts.api";
import { ApiError } from "@/api/api-error";
import { Button } from "@/ui/shadcn/button";

export function AcceptInviteMagicClient({
  magicToken,
}: {
  magicToken: string;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState<{ userName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await accountsApi.acceptInvitationMagicLink({ magicToken });
      setAccepted({ userName: res.user.name });
      toast.success("Готово! Вы вошли в кабинет.");
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? localizeError(e.message)
          : "Не удалось принять приглашение";
      setError(msg);
      toast.error(msg);
    } finally {
      setAccepting(false);
    }
  };

  if (accepted) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">
          Здравствуйте, {accepted.userName}!
        </h1>
        <p className="text-sm text-fg-secondary">
          Вы вошли в Кору. Сейчас откроется страница смены пароля — приготовьте
          одноразовый пароль из письма приглашения.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="mb-2 text-2xl font-semibold">Приглашение в компанию</h1>
      <p className="mb-6 text-sm text-fg-secondary">
        Ваш руководитель приглашает вас в компанию в Коре — память вашей
        компании, которая помнит за всю команду. Нажмите «Принять», чтобы войти
        в свой кабинет.
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

function localizeError(rawMessage: string): string {
  const lower = rawMessage.toLowerCase();
  if (lower.includes("уже была использована")) {
    return "Эта ссылка уже была использована. Попросите руководителя перевыпустить приглашение.";
  }
  if (lower.includes("срок действия")) {
    return "Срок действия приглашения истёк. Попросите руководителя перевыпустить ссылку.";
  }
  if (lower.includes("не найдена")) {
    return "Ссылка приглашения не найдена. Проверьте, что вы перешли по корректному адресу.";
  }
  return rawMessage;
}
