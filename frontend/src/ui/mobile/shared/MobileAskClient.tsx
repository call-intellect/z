"use client";

import { MessageCircle } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { OrgChatPanel } from "@/ui/components/chat/OrgChatPanel";
import { askPromptsForRole } from "./ask-prompts";

export function MobileAskClient() {
  const { currentOrgRole } = useAuth();
  const prompts = [...askPromptsForRole(currentOrgRole)];

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-4 py-5">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg-primary">
        <MessageCircle size={20} className="text-accent" aria-hidden />
        Спросить
      </h1>
      <p className="mb-4 text-sm text-fg-secondary">
        Кора ответит по памяти компании — с цитатами из источников.
      </p>

      <OrgChatPanel
        className="min-h-0 flex-1"
        suggestedPrompts={prompts}
        voiceInput
        placeholder="Спросите Кору о памяти компании…"
      />
    </div>
  );
}
