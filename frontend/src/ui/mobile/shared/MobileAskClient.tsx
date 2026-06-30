"use client";

import { MessageCircle } from "lucide-react";

import { useAuth } from "@/contexts/auth-context";
import { MasterScopedChat } from "@/ui/chat/MasterScopedChat";
import { askPromptsForRole } from "./ask-prompts";

export function MobileAskClient() {
  const { currentOrgId, currentOrgRole } = useAuth();

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col px-4 py-5">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-fg-primary">
        <MessageCircle size={20} className="text-accent" aria-hidden />
        Спросить
      </h1>
      <p className="mb-4 text-sm text-fg-secondary">
        Кора ответит по памяти компании — с цитатами из источников.
      </p>

      {currentOrgId ? (
        <MasterScopedChat
          scope="org"
          orgId={currentOrgId}
          enableVoice
          suggestedPrompts={[...askPromptsForRole(currentOrgRole)]}
          placeholder="Спросите Кору о памяти компании…"
          emptyTitle="Спросите Кору"
          emptyHint="Кора ответит по памяти компании — с цитатами из источников."
          className="min-h-0 flex-1"
        />
      ) : null}
    </div>
  );
}
