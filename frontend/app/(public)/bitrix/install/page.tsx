"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/api/api-error";
import { bitrixApi } from "@/api/bitrix.api";

const BX24_SDK_URL = "https://api.bitrix24.com/api/v1/";

type Bx24 = {
  init: (cb: () => void) => void;
  getAuth: () => { member_id?: string } | false;
  installFinish: () => void;
};

declare global {
  interface Window {
    BX24?: Bx24;
  }
}

type Phase = "loading" | "claiming" | "done" | "need_login" | "error";

export default function BitrixInstallPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string>("Устанавливаем приложение…");

  const claim = useCallback(async (memberId: string) => {
    setPhase("claiming");
    setMessage("Привязываем портал к вашей компании…");
    try {
      await bitrixApi.claim(memberId);
      window.BX24?.installFinish();
      setPhase("done");
      setMessage("Готово! Приложение установлено. Можно закрыть это окно.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "unauthorized") {
        setPhase("need_login");
        setMessage("Войдите в Кору, чтобы завершить установку.");
        return;
      }
      setPhase("error");
      setMessage(
        e instanceof ApiError ? e.message : "Не удалось завершить установку.",
      );
    }
  }, []);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = BX24_SDK_URL;
    script.async = true;
    script.onload = () => {
      const bx = window.BX24;
      if (!bx) {
        setPhase("error");
        setMessage("Не удалось загрузить BX24 SDK.");
        return;
      }
      bx.init(() => {
        const auth = bx.getAuth();
        const memberId = auth ? auth.member_id : undefined;
        if (!memberId) {
          setPhase("error");
          setMessage("Не удалось определить портал (member_id).");
          return;
        }
        void claim(memberId);
      });
    };
    script.onerror = () => {
      setPhase("error");
      setMessage("Не удалось загрузить BX24 SDK.");
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [claim]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-bg-card p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold text-fg-primary">
          Установка Bitrix24 → Кора
        </h1>
        <p className="text-sm text-fg-secondary">{message}</p>
        {phase === "need_login" && (
          <a
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block text-sm text-accent hover:underline"
          >
            Открыть вход в Кору →
          </a>
        )}
      </div>
    </main>
  );
}
