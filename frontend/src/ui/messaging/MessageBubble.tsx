"use client";

import { ListPlus, Reply, Smile, Sparkles } from "lucide-react";

import type { ChatMessage, ConversationKind } from "@/domain/messaging";
import { AssigneeAvatar } from "@/ui/tracker/AssigneeAvatar";
import { Button } from "@/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/shadcn/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/shadcn/tooltip";
import { cn } from "@/ui/shadcn/lib/utils";

const QUICK_REACTIONS = ["👍", "🎉", "❤️", "👀", "🙏", "🔥"];

export interface MessageBubbleProps {
  message: ChatMessage;
  sourceKind: ConversationKind;
  isOwn: boolean;
  authorName?: string | null;
  currentUserId?: string | null;
  onReply?: (message: ChatMessage) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onMakeTask?: (message: ChatMessage) => void;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessageBubble({
  message,
  sourceKind,
  isOwn,
  authorName,
  currentUserId,
  onReply,
  onToggleReaction,
  onMakeTask,
}: MessageBubbleProps) {
  const isClone = message.authorType === "clone";
  const isSystem = message.authorType === "system";
  const isInternalNote = sourceKind === "ticket" && message.access === "internal";
  const name = authorName ?? (isClone ? "Клон" : isSystem ? "Система" : "Участник");

  const reactionEntries = Object.entries(message.reactions).filter(
    ([, ids]) => ids.length > 0,
  );

  if (isSystem) {
    return (
      <li className="self-center max-w-[82%]">
        <div className="rounded-xl border border-dashed border-border bg-bg-subtle px-3 py-1.5 text-center text-xs text-fg-tertiary">
          {message.content}
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group flex max-w-[78%] gap-2.5",
        isOwn ? "flex-row-reverse self-end" : "self-start",
      )}
    >
      {isClone ? (
        <span className="grid h-8 w-8 shrink-0 self-end place-items-center rounded-[10px] bg-accent-muted text-accent">
          <Sparkles size={15} />
        </span>
      ) : (
        <AssigneeAvatar
          userId={message.authorUserId}
          label={authorName ?? undefined}
          size={32}
          className="shrink-0 self-end"
        />
      )}

      <div className="flex min-w-0 flex-col gap-1">
        <div
          className={cn(
            "flex items-center gap-2 px-1 text-[11px] text-fg-tertiary",
            isOwn && "justify-end",
          )}
        >
          <b className="font-medium text-fg-secondary">{name}</b>
          {isClone ? (
            <span className="rounded-full bg-accent-muted px-1.5 text-[10px] font-semibold text-accent">
              Клон
            </span>
          ) : null}
          {isInternalNote ? (
            <span className="rounded-full bg-chip-warning-bg px-1.5 text-[10px] font-semibold text-chip-warning-fg">
              Заметка
            </span>
          ) : null}
          <span>{formatTime(message.createdAt)}</span>
          {message.isEdited ? <span>· изменено</span> : null}
        </div>

        <div className="relative">
          <div
            className={cn(
              "whitespace-pre-wrap break-words rounded-[15px] px-3 py-2.5 text-sm leading-relaxed",
              isInternalNote
                ? "border border-dashed border-chip-warning-fg/40 bg-chip-warning-bg/30 text-chip-warning-fg"
                : isClone
                  ? "border border-accent-border bg-accent-muted text-fg-primary"
                  : isOwn
                    ? "rounded-br-[5px] border border-accent-border bg-accent-muted text-fg-primary"
                    : "rounded-bl-[5px] border border-border bg-bg-surface text-fg-primary",
            )}
          >
            {message.voiceUrl ? (
              <span className="text-xs text-fg-secondary">
                🎤 Голосовое сообщение
                {message.voiceDuration ? ` · ${message.voiceDuration}с` : ""}
              </span>
            ) : (
              message.content
            )}
          </div>

          <div
            className={cn(
              "absolute -top-3 hidden items-center gap-0.5 rounded-[9px] border border-border-strong bg-bg-elevated p-0.5 shadow-card-raised group-hover:flex",
              isOwn ? "left-2" : "right-2",
            )}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid h-6 w-6 place-items-center rounded-md text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary"
                  aria-label="Реакция"
                >
                  <Smile size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="flex gap-1 p-1">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="grid h-8 w-8 place-items-center rounded-md text-base hover:bg-bg-subtle"
                    onClick={() => onToggleReaction?.(message.id, emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded-md text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary"
                    aria-label="Ответить в ветке"
                    onClick={() => onReply?.(message)}
                  >
                    <Reply size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ответить в ветке</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={!onMakeTask}
                    className="grid h-6 w-6 place-items-center rounded-md text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Сделать задачей"
                    onClick={() => onMakeTask?.(message)}
                  >
                    <ListPlus size={14} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {onMakeTask ? "Сделать задачей" : "Сделать задачей — скоро"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {reactionEntries.length > 0 ? (
          <div className={cn("flex flex-wrap gap-1 px-1", isOwn && "justify-end")}>
            {reactionEntries.map(([emoji, ids]) => {
              const mine = currentUserId ? ids.includes(currentUserId) : false;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onToggleReaction?.(message.id, emoji)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                    mine
                      ? "border-accent-border bg-accent-muted text-fg-primary"
                      : "border-border bg-bg-surface text-fg-secondary",
                  )}
                >
                  <span>{emoji}</span>
                  <span className="text-[11px] text-fg-tertiary">
                    {ids.length}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {message.parentMessageId ? (
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 px-1 text-[11px] text-accent",
              isOwn && "justify-end",
            )}
            onClick={() => onReply?.(message)}
          >
            <Reply size={11} /> в ветке
          </button>
        ) : null}
      </div>
    </li>
  );
}
