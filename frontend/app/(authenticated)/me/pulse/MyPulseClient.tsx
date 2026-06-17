"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

import { meProfileApi } from "@/api/structure.api";
import { useAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/ui/shadcn/skeleton";

import { PersonPulseClient } from "../../persons/[id]/pulse/PersonPulseClient";

type State = "loading" | "ready" | "no-person" | "error";

export function MyPulseClient() {
  const { currentOrgId } = useAuth();
  const [personId, setPersonId] = useState<string | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!currentOrgId) return;
    let alive = true;
    void (async () => {
      try {
        const res = await meProfileApi.get(currentOrgId);
        if (!alive) return;
        if (res.person?.id) {
          setPersonId(res.person.id);
          setState("ready");
        } else {
          setState("no-person");
        }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentOrgId]);

  if (state === "ready" && personId) {
    return <PersonPulseClient personId={personId} mode="self" />;
  }

  if (state === "loading") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
        <Skeleton className="mb-4 h-8 w-48" />
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center md:px-6">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Activity size={22} strokeWidth={1.75} />
      </div>
      <h1 className="text-xl font-semibold text-fg-primary">Мой пульс</h1>
      <p className="mt-3 text-sm text-fg-secondary">
        {state === "no-person"
          ? "Ваш профиль ещё не привязан к сотруднику компании — пульс появится, как только администратор добавит вас в структуру."
          : "Не удалось загрузить ваш пульс. Попробуйте обновить страницу."}
      </p>
    </div>
  );
}
