"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { feedbackApi } from "@/api/feedback.api";
import { toFeedbackLimit, type FeedbackLimit } from "@/domain/feedback";
import { Button } from "@/ui/shadcn/button";
import { Textarea } from "@/ui/shadcn/textarea";

const MAX_LENGTH = 5000;
const PLACEHOLDER =
  "Напишите, чего вам не хватает в Коре. Какие функции вы хотите? " +
  "Что не нравится? Что нравится? Любая обратная связь поможет нам " +
  "сделать продукт лучше.";

export function FeedbackForm() {
  const { mutate } = useSWRConfig();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: limit, error: limitError } = useSWR(
    "feedback-limit",
    () => feedbackApi.getMyLimit().then(toFeedbackLimit),
    { revalidateOnFocus: false },
  );

  const trimmedLength = text.trim().length;
  const overLimit = text.length > MAX_LENGTH;
  const limitExceeded = useMemo(() => {
    if (!limit) return false;
    return limit.usedToday >= limit.limit;
  }, [limit]);

  const canSubmit =
    !submitting && trimmedLength > 0 && !overLimit && !limitExceeded;

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      try {
        await feedbackApi.submit({ text: text.trim() });
        toast.success("Спасибо, передали команде");
        setText("");
        await Promise.all([
          mutate("feedback-limit"),
          mutate(
            (key) => Array.isArray(key) && key[0] === "feedback-history",
            undefined,
            { revalidate: true },
          ),
        ]);
      } catch (err) {
        if (err instanceof ApiError) {
          toast.error(humanizeApiError(err));
          await mutate("feedback-limit");
        } else {
          toast.error("Не удалось отправить. Попробуйте ещё раз.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, mutate, text],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border-subtle bg-bg-card p-5"
    >
      <LimitBanner limit={limit} limitError={limitError} />

      <label htmlFor="feedback-text" className="sr-only">
        Текст обращения
      </label>
      <Textarea
        id="feedback-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        maxLength={MAX_LENGTH}
        placeholder={PLACEHOLDER}
        disabled={submitting || limitExceeded}
        className="resize-y"
      />

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className={overLimit ? "text-danger" : "text-fg-tertiary"}>
          {text.length} / {MAX_LENGTH}
        </span>
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? "Отправляем…" : "Отправить"}
        </Button>
      </div>
    </form>
  );
}

function LimitBanner({
  limit,
  limitError,
}: {
  limit: FeedbackLimit | undefined;
  limitError: unknown;
}) {
  if (limitError) {
    return (
      <div className="mb-3 rounded-md border border-border-subtle bg-bg-muted px-3 py-2 text-xs text-fg-tertiary">
        Не удалось загрузить счётчик лимита. Попробуйте обновить страницу.
      </div>
    );
  }
  if (!limit) {
    return <div className="mb-3 h-8 animate-pulse rounded-md bg-bg-muted/70" />;
  }

  const remaining = Math.max(0, limit.limit - limit.usedToday);
  const isExceeded = limit.usedToday >= limit.limit;
  const resetLabel = formatResetTime(limit.resetAt);

  if (isExceeded) {
    return (
      <div className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
        Лимит {limit.limit} сообщений в сутки исчерпан. Следующая возможность
        отправить — {resetLabel}.
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-border-subtle bg-bg-muted/70 px-3 py-2 text-xs text-fg-secondary">
      Сегодня вы отправили {limit.usedToday} из {limit.limit} сообщений.
      Осталось {remaining}. Счётчик обнулится {resetLabel}.
    </div>
  );
}

function formatResetTime(resetAt: Date): string {
  const sameDay = new Date().toDateString() === resetAt.toDateString();
  const time = resetAt.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `сегодня в ${time}`;
  const date = resetAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${date} в ${time}`;
}
