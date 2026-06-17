"use client";

import { useCallback, useState } from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { supportApi } from "@/api/support.api";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Textarea } from "@/ui/shadcn/textarea";

const SUBJECT_MAX = 200;
const MESSAGE_MAX = 5000;

export function SupportForm({ onSuccess }: { onSuccess?: () => void }) {
  const { mutate } = useSWRConfig();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const subjectLen = subject.trim().length;
  const messageLen = message.trim().length;
  const subjectOver = subject.length > SUBJECT_MAX;
  const messageOver = message.length > MESSAGE_MAX;

  const canSubmit =
    !submitting &&
    subjectLen > 0 &&
    messageLen > 0 &&
    !subjectOver &&
    !messageOver;

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      try {
        await supportApi.submitTicket({
          subject: subject.trim(),
          message: message.trim(),
        });
        toast.success("Обращение отправлено. Поддержка ответит вам.");
        setSubject("");
        setMessage("");
        await mutate("support-my-tickets");
        onSuccess?.();
      } catch (err) {
        if (err instanceof ApiError) {
          toast.error(humanizeApiError(err));
        } else {
          toast.error("Не удалось отправить. Попробуйте ещё раз.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, mutate, message, onSuccess, subject],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label htmlFor="support-subject" className="sr-only">
          Тема обращения
        </label>
        <Input
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX}
          placeholder="Тема (коротко о проблеме)"
          disabled={submitting}
          autoComplete="off"
        />
        <div className="mt-1 text-right text-[11px] text-fg-tertiary">
          <span className={subjectOver ? "text-danger" : undefined}>
            {subject.length} / {SUBJECT_MAX}
          </span>
        </div>
      </div>

      <div>
        <label htmlFor="support-message" className="sr-only">
          Описание
        </label>
        <Textarea
          id="support-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          maxLength={MESSAGE_MAX}
          placeholder="Опишите, что произошло и чем мы можем помочь"
          disabled={submitting}
          className="resize-y"
        />
        <div className="mt-1 text-right text-[11px] text-fg-tertiary">
          <span className={messageOver ? "text-danger" : undefined}>
            {message.length} / {MESSAGE_MAX}
          </span>
        </div>
      </div>

      <Button type="submit" disabled={!canSubmit} className="w-full">
        {submitting ? "Отправляем…" : "Отправить в поддержку"}
      </Button>
    </form>
  );
}
