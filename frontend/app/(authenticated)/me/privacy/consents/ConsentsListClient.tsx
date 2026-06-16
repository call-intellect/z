"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import {
  privacyApi,
  type ConsentDataType,
  type ConsentRecordDto,
} from "@/api/privacy.api";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/ui/shadcn/button";

interface ConsentMeta {
  type: ConsentDataType;
  title: string;
  description: string;
}

const CONSENT_META: readonly ConsentMeta[] = [
  {
    type: "checkin_processing",
    title: "Обработка чек-инов и настроения",
    description:
      "Кора читает ваши чек-ины, определяет настроение и использует это для агрегатов команды.",
  },
  {
    type: "risk_analysis",
    title: "Анализ сигналов риска",
    description:
      "Кора ищет сигналы перегруза, выгорания и конфликтов и подсказывает руководителю.",
  },
  {
    type: "card_visible_to_manager",
    title: "Показ карточки руководителю",
    description:
      "Ваша pulse-карточка видна непосредственному руководителю. Полный текст ваших чек-инов не показывается.",
  },
] as const;

export function ConsentsListClient() {
  const { currentOrgId, isLoading } = useAuth();
  const swrKey = currentOrgId ? ["my-consents", currentOrgId] : null;
  const {
    data,
    error,
    isLoading: loading,
    mutate,
  } = useSWR(swrKey, async () => privacyApi.listMyConsents(currentOrgId!));
  const [busyType, setBusyType] = useState<ConsentDataType | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (isLoading) {
    return (
      <section className="px-6 py-8">
        <Loader2 className="h-5 w-5 animate-spin text-fg-tertiary" />
      </section>
    );
  }

  if (!currentOrgId) {
    return (
      <section className="px-6 py-8">
        <p className="text-sm text-fg-secondary">
          Этот раздел доступен только в рамках организации.
        </p>
      </section>
    );
  }

  const byType = new Map<string, ConsentRecordDto>();
  for (const c of data?.items ?? []) byType.set(c.dataType, c);

  const handleToggle = async (type: ConsentDataType, nextValue: boolean) => {
    if (!currentOrgId) return;
    setBusyType(type);
    setErrorText(null);
    try {
      await privacyApi.upsertMyConsent(currentOrgId, {
        dataType: type,
        consented: nextValue,
      });
      await mutate();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось изменить согласие.";
      setErrorText(msg);
    } finally {
      setBusyType(null);
    }
  };

  return (
    <section className="container mx-auto max-w-3xl space-y-4 px-4 py-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-fg-primary">
          <ShieldCheck className="text-accent" size={24} />
          Мои согласия
        </h1>
        <p className="text-sm text-fg-secondary">
          Согласия 152-ФЗ на обработку ваших данных в Z. Можно отозвать или
          выдать заново в любой момент.
        </p>
      </header>

      {loading && (
        <div className="rounded-md border border-border-subtle bg-bg-card p-4 text-sm text-fg-tertiary">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Загружаем согласия…
        </div>
      )}

      {error instanceof Error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger-fg">
          Не удалось загрузить: {error.message}
        </div>
      )}

      {errorText && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger-fg">
          {errorText}
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {CONSENT_META.map((meta) => {
            const current = byType.get(meta.type);
            const consented = current?.consented ?? false;
            const updatedAt = current
              ? new Date(current.createdAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null;
            return (
              <article
                key={meta.type}
                className="flex items-start justify-between gap-4 rounded-xl border border-border-subtle bg-bg-card p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg-primary">
                      {meta.title}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        consented
                          ? "bg-success/15 text-success-fg"
                          : "bg-warning/15 text-warning-fg"
                      }`}
                    >
                      {consented ? "Согласие дано" : "Отозвано"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
                    {meta.description}
                  </p>
                  {updatedAt && (
                    <p className="mt-1 text-xs text-fg-tertiary">
                      Последнее изменение: {updatedAt} (v
                      {current?.policyVersion ?? "1"})
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  <Button
                    size="sm"
                    variant={consented ? "outline" : "default"}
                    disabled={busyType === meta.type}
                    onClick={() => handleToggle(meta.type, !consented)}
                  >
                    {busyType === meta.type ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />…
                      </span>
                    ) : consented ? (
                      "Отозвать"
                    ) : (
                      "Дать согласие"
                    )}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
