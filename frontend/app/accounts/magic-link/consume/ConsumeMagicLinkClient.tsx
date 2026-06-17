"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { accountsApi } from "@/api/accounts.api";
import { ApiError } from "@/api/api-error";

const DEFAULT_NEXT = "/company-admin/sources/bitrix";

function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return DEFAULT_NEXT;
}

export function ConsumeMagicLinkClient() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setError("Ссылка недействительна — нет токена.");
      return;
    }
    accountsApi
      .consumeMagicLink({ token })
      .then(() => router.replace(safeNext(params.get("next"))))
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? "Ссылка недействительна или уже использована. Откройте Кору из приложения Bitrix24 заново."
            : "Не удалось войти. Попробуйте ещё раз.",
        ),
      );
  }, [token, params, router]);

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      {error ? (
        <>
          <h1 className="mb-2 text-xl font-semibold text-fg-primary">
            Не удалось войти
          </h1>
          <p className="text-sm text-fg-secondary">{error}</p>
          <a
            href="/login"
            className="mt-4 inline-block text-sm text-accent underline"
          >
            Войти вручную
          </a>
        </>
      ) : (
        <p className="flex items-center justify-center text-sm text-fg-secondary">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Входим в Кору…
        </p>
      )}
    </div>
  );
}
