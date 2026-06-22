"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Lightbulb, Loader2, NotebookPen, Send } from "lucide-react";
import useSWR from "swr";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { dumpApi } from "@/api/dump.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import { generateNonce } from "@/domain/source";
import { Button } from "@/ui/shadcn/button";
import { Textarea } from "@/ui/shadcn/textarea";

const MAX_LEN = 50_000;
const SHORT_TEXT_THRESHOLD_FALLBACK = 200;

export function DumpClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  const configSwr = useSWR(
    currentOrgId ? ["dump-config", currentOrgId] : null,
    () => dumpApi.config(currentOrgId as string),
    { revalidateOnFocus: false },
  );
  const shortTextThreshold =
    configSwr.data?.shortTextToIdeaThreshold ?? SHORT_TEXT_THRESHOLD_FALLBACK;

  const trimmed = text.trim();
  const len = text.length;
  const overflow = len > MAX_LEN;
  const nearLimit = len > MAX_LEN * 0.9;
  const looksLikeIdea = trimmed.length > 0 && trimmed.length <= shortTextThreshold;
  const canSubmit =
    !submitting && trimmed.length > 0 && !overflow && Boolean(currentOrgId);

  const submit = async (asIdea: boolean) => {
    if (!canSubmit || !currentOrgId) return;
    setSubmitting(true);
    try {
      const nonce = generateNonce();
      const res = await dumpApi.create(currentOrgId, {
        text,
        nonce,
        asIdea,
      });
      if (res.idempotent) {
        toast("Эта заметка уже была сохранена ранее");
      } else if (asIdea) {
        toast.success("✓ Отправлено в «Идеи»");
      } else {
        toast.success("✓ Записано в память компании");
      }
      setText("");
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "quota_exceeded") {
        toast.error("Лимит 30 заметок в день. Попробуйте позже.");
      } else {
        toast.error(humanizeApiError(e, "Не удалось сохранить"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
        <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
      </div>
    );
  }

  if (!currentOrgId) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          Эта страница доступна только в рамках организации. Создайте или
          присоединитесь к организации.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <header className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-overlay text-accent">
          <NotebookPen size={18} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Текстовая заметка
          </h1>
          <p className="text-sm text-fg-secondary">
            Любая мысль, замечание или идея. Через несколько минут она попадёт в
            общую память компании и появится в поиске и помощнике.
          </p>
        </div>
      </header>

      {saved && (
        <div className="rounded-md border border-success/30 bg-success/10 p-4 text-sm">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" />
            <div className="space-y-2">
              <p className="font-medium text-success">
                Заметка сохранена в память компании
              </p>
              <p className="text-fg-secondary">
                Через несколько минут она появится в поиске и у помощника
                компании — у него можно сразу спросить по ней.
              </p>
              <div className="flex flex-wrap gap-3 pt-0.5">
                <Link href="/chat" className="text-accent hover:underline">
                  Спросить помощника компании
                </Link>
                <Link href="/ideas" className="text-accent hover:underline">
                  Открыть «Идеи»
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (saved) setSaved(false);
          }}
          placeholder="Что вы думаете? Любая мысль, замечание, идея..."
          className="min-h-[60vh] resize-none font-mono text-sm leading-relaxed"
          disabled={submitting}
          maxLength={MAX_LEN + 1}
          autoFocus
        />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-fg-tertiary">
            Если отправить ту же заметку ещё раз — дубль не создастся.
          </span>
          <span
            className={
              overflow
                ? "text-danger"
                : nearLimit
                  ? "text-warning"
                  : "text-fg-tertiary"
            }
          >
            {len.toLocaleString("ru")} / {MAX_LEN.toLocaleString("ru")}
          </span>
        </div>
      </div>

      {looksLikeIdea && !overflow && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2.5 text-sm">
          <Lightbulb size={16} className="shrink-0 text-accent" />
          <span className="text-fg-secondary">
            Похоже на идею — отправить в «Идеи»?
          </span>
          <span className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canSubmit}
              onClick={() => void submit(false)}
            >
              Всё равно заметкой
            </Button>
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={() => void submit(true)}
            >
              {submitting ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Lightbulb size={14} className="mr-1" />
              )}
              Отправить в «Идеи»
            </Button>
          </span>
        </div>
      )}

      {!looksLikeIdea && (
        <div className="flex justify-end">
          <Button onClick={() => void submit(false)} disabled={!canSubmit}>
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Сохранить заметку
          </Button>
        </div>
      )}
    </div>
  );
}
