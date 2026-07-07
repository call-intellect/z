"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { toast } from "sonner";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { messagingApi } from "@/api/messaging.api";
import { Button } from "@/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/shadcn/dialog";
import { Input } from "@/ui/shadcn/input";
import { Textarea } from "@/ui/shadcn/textarea";
import { cn } from "@/ui/shadcn/lib/utils";
import {
  ParticipantPicker,
  type ParticipantPickerValue,
} from "@/ui/shared/ParticipantPicker";

type Mode = "colleague" | "external";

export interface NewConversationDialogProps {
  orgId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversationId: string) => void | Promise<void>;
}

export function NewConversationDialog({
  orgId,
  open,
  onOpenChange,
  onCreated,
}: NewConversationDialogProps): JSX.Element | null {
  const [mode, setMode] = useState<Mode>("colleague");
  const [members, setMembers] = useState<ParticipantPickerValue[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [contact, setContact] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    conversationId: string;
    inviteLink: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("colleague");
    setMembers([]);
    setGroupTitle("");
    setContact("");
    setFirstMessage("");
    setError(null);
    setInvite(null);
    setCopied(false);
    setSubmitting(false);
  }, [open]);

  if (!open) return null;

  const selectedUserIds = members
    .filter((m) => m.type === "user")
    .map((m) => (m.type === "user" ? m.userId : ""))
    .filter(Boolean);
  const isGroup = selectedUserIds.length > 1;

  const close = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  const switchMode = (next: Mode) => {
    if (submitting) return;
    setMode(next);
    setError(null);
  };

  const handleColleagueSubmit = async () => {
    if (!orgId || selectedUserIds.length === 0 || submitting) return;
    const kind = selectedUserIds.length === 1 ? "dm" : "group";
    const title =
      kind === "group"
        ? groupTitle.trim() || members.map((m) => m.name).join(", ")
        : undefined;
    setSubmitting(true);
    setError(null);
    try {
      const res = await messagingApi.createConversation(orgId, {
        kind,
        memberUserIds: selectedUserIds,
        ...(title ? { title } : {}),
      });
      await onCreated(res.conversationId);
      onOpenChange(false);
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось создать переписку"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExternalSubmit = async () => {
    if (!orgId || submitting) return;
    const trimmed = contact.trim();
    if (trimmed.length === 0) {
      setError("Нужен email или телефон клиента");
      return;
    }
    const clientContact = trimmed.includes("@")
      ? { email: trimmed }
      : { phone: trimmed };
    setSubmitting(true);
    setError(null);
    try {
      const res = await messagingApi.startExternal(orgId, {
        clientContact,
        ...(firstMessage.trim() ? { message: firstMessage.trim() } : {}),
      });
      setInvite(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === "EXTERNAL_CHAT_DISABLED") {
        setError(
          "Внешний чат с клиентами сейчас отключён. Обратитесь к администратору.",
        );
      } else {
        setError(humanizeApiError(e, "Не удалось начать внешний чат"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.inviteLink);
      setCopied(true);
      toast.success("Ссылка скопирована");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать ссылку");
    }
  };

  const goToInvite = async () => {
    if (!invite) return;
    await onCreated(invite.conversationId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новое сообщение</DialogTitle>
        </DialogHeader>

        {invite ? (
          <ExternalInviteResult
            inviteLink={invite.inviteLink}
            copied={copied}
            onCopy={() => void handleCopy()}
          />
        ) : (
          <>
            <div className="flex gap-1.5 rounded-lg border border-border bg-bg-surface p-1">
              <ModeTab
                active={mode === "colleague"}
                onClick={() => switchMode("colleague")}
              >
                Коллега
              </ModeTab>
              <ModeTab
                active={mode === "external"}
                onClick={() => switchMode("external")}
              >
                Внешний / клиент
              </ModeTab>
            </div>

            {mode === "colleague" ? (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-secondary">
                    Кому
                  </label>
                  <ParticipantPicker
                    value={members}
                    onChange={setMembers}
                    onlyUsers
                    placeholder="Найдите коллегу по имени"
                    disabled={submitting}
                  />
                  <p className="mt-1 text-xs text-fg-tertiary">
                    {selectedUserIds.length <= 1
                      ? "Один коллега — личная переписка."
                      : `Выбрано ${selectedUserIds.length} — будет группа.`}
                  </p>
                </div>

                {isGroup ? (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Название группы (необязательно)
                    </label>
                    <Input
                      value={groupTitle}
                      onChange={(e) => setGroupTitle(e.target.value)}
                      placeholder="Если пусто — соберём из имён участников"
                      disabled={submitting}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-secondary">
                    Email или телефон клиента
                  </label>
                  <Input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="client@site.ru или +7…"
                    disabled={submitting}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-secondary">
                    Первое сообщение (необязательно)
                  </label>
                  <Textarea
                    value={firstMessage}
                    onChange={(e) => setFirstMessage(e.target.value)}
                    placeholder="Здравствуйте! Пишу по…"
                    rows={3}
                    disabled={submitting}
                  />
                </div>
                <p className="text-xs text-fg-tertiary">
                  Мы создадим переписку, отправим клиенту ссылку-приглашение и
                  покажем её вам, чтобы можно было переслать вручную.
                </p>
              </div>
            )}

            {error ? (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}

        <DialogFooter>
          {invite ? (
            <>
              <Button variant="ghost" onClick={close}>
                Готово
              </Button>
              <Button variant="default" onClick={() => void goToInvite()}>
                Перейти в переписку
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={submitting}>
                Отмена
              </Button>
              {mode === "colleague" ? (
                <Button
                  variant="default"
                  onClick={() => void handleColleagueSubmit()}
                  disabled={submitting || selectedUserIds.length === 0}
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Написать"
                  )}
                </Button>
              ) : (
                <Button
                  variant="default"
                  onClick={() => void handleExternalSubmit()}
                  disabled={submitting || contact.trim().length === 0}
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Отправить ссылку"
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-fg"
          : "text-fg-secondary hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

function ExternalInviteResult({
  inviteLink,
  copied,
  onCopy,
}: {
  inviteLink: string;
  copied: boolean;
  onCopy: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">
        Переписка создана. Ссылка-приглашение отправлена клиенту — скопируйте её,
        если хотите переслать вручную.
      </p>
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg-surface px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-primary">
          {inviteLink}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          aria-label="Скопировать ссылку"
        >
          {copied ? (
            <Check size={15} className="text-success" />
          ) : (
            <Copy size={15} />
          )}
          <span className="ml-1.5">{copied ? "Скопировано" : "Скопировать"}</span>
        </Button>
      </div>
    </div>
  );
}
