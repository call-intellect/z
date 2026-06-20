"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import { clonesApi, type CloneListItemApi } from "@/api/clones.api";
import { useAuth } from "@/contexts/auth-context";
import { cloneRefusalReasonRu, mapCloneAnswer } from "@/domain/clone";
import { topClonesByConfidence } from "@/domain/clone-picker";

interface CloneThreadRow {
  id: string;
  role: "user" | "clone";
  text: string;
  cloneName?: string;
  citations?: ReturnType<typeof mapCloneAnswer>["citations"];
  refused?: boolean;
  refusalReason?: string | null;
}

export function ConciergeClonesTab() {
  const { currentOrgId } = useAuth();
  const [selected, setSelected] = useState<CloneListItemApi | null>(null);

  if (!currentOrgId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-fg-tertiary">
        Не выбрана организация.
      </div>
    );
  }

  if (selected) {
    return (
      <CloneDialog
        orgId={currentOrgId}
        clone={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <CloneList orgId={currentOrgId} onSelect={(clone) => setSelected(clone)} />
  );
}

function CloneList({
  orgId,
  onSelect,
}: {
  orgId: string;
  onSelect: (clone: CloneListItemApi) => void;
}) {
  const router = useRouter();
  const { data, isLoading, error } = useSWR(
    ["concierge:clones", orgId],
    async () => {
      const res = await clonesApi.listClones(orgId, { status: "active" });
      return topClonesByConfidence(res.items);
    },
    { revalidateOnFocus: false },
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-fg-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка клонов…
          </div>
        ) : error ? (
          <div className="rounded-md bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
            Не удалось загрузить клонов ролей.
          </div>
        ) : !data || data.length === 0 ? (
          <div className="py-8 text-center text-sm text-fg-tertiary">
            Доступных активных клонов ролей пока нет.
          </div>
        ) : (
          data.map((clone) => (
            <button
              key={clone.personaId}
              type="button"
              onClick={() => onSelect(clone)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md border border-border-subtle bg-bg-base p-3 text-left transition-colors hover:bg-bg-overlay"
            >
              <span className="text-sm font-medium text-fg-primary">
                {clone.publicName}
              </span>
              <span className="text-xs text-fg-tertiary">{clone.roleName}</span>
            </button>
          ))
        )}
      </div>
      <div className="border-t border-border-subtle p-2">
        <button
          type="button"
          onClick={() => router.push("/clones")}
          className="w-full rounded-md px-3 py-2 text-sm text-accent-fg hover:bg-accent/15"
        >
          Все клоны
        </button>
      </div>
    </div>
  );
}

function CloneDialog({
  orgId,
  clone,
  onBack,
}: {
  orgId: string;
  clone: CloneListItemApi;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<CloneThreadRow[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows, busy]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    setRows((r) => [
      ...r,
      { id: `u-${Date.now()}`, role: "user", text: question },
    ]);
    try {
      const res = await clonesApi.askRole(orgId, clone.roleId, {
        question,
        ...(conversationId ? { conversationId } : {}),
      });
      const answer = mapCloneAnswer(res);
      if (!conversationId) setConversationId(answer.conversationId);
      setRows((r) => [
        ...r,
        {
          id: `c-${answer.messageId}`,
          role: "clone",
          text: answer.text,
          cloneName: clone.publicName,
          citations: answer.citations,
          refused: answer.refused,
          refusalReason: answer.refusalReason,
        },
      ]);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Не удалось получить ответ клона.";
      setRows((r) => [
        ...r,
        {
          id: `err-${Date.now()}`,
          role: "clone",
          text: message,
          cloneName: clone.publicName,
          refused: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, orgId, clone.roleId, clone.publicName, conversationId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <button
          type="button"
          aria-label="Назад"
          onClick={onBack}
          className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg-primary">
            {clone.publicName}
          </div>
          <div className="truncate text-xs text-fg-tertiary">
            {clone.roleName}
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto p-3 text-sm"
      >
        {rows.length === 0 && (
          <div className="py-6 text-center text-fg-tertiary">
            Задайте вопрос — ответит {clone.publicName}.
          </div>
        )}
        {rows.map((row) =>
          row.role === "user" ? (
            <div key={row.id} className="rounded-md bg-bg-overlay p-2">
              {row.text}
            </div>
          ) : row.refused ? (
            <div
              key={row.id}
              className="rounded-md bg-bg-subtle p-2 text-xs text-fg-tertiary"
            >
              <div className="mb-0.5 font-medium">— {row.cloneName}</div>
              {row.refusalReason
                ? cloneRefusalReasonRu(row.refusalReason)
                : "Клон не может ответить на этот вопрос."}
            </div>
          ) : (
            <div
              key={row.id}
              className="rounded-md bg-chip-success-bg p-2 text-chip-success-fg"
            >
              <div className="mb-0.5 text-xs font-medium opacity-80">
                — {row.cloneName}
              </div>
              <div className="whitespace-pre-wrap">{row.text}</div>
              {row.citations && row.citations.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
                  <div className="text-xs font-medium opacity-80">
                    Источники:
                  </div>
                  {row.citations.slice(0, 5).map((c, i) => (
                    <div
                      key={`${c.blockId}-${i}`}
                      className="rounded bg-bg-base px-2 py-1 text-xs text-fg-secondary"
                    >
                      <div className="font-medium text-fg-primary">
                        {c.meetingTitle ?? "Источник"}
                      </div>
                      {c.snippet ? (
                        <div className="mt-0.5 italic">«{c.snippet}»</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-fg-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {clone.publicName} думает…
          </div>
        )}
      </div>
      <form
        className="flex gap-2 border-t border-border-subtle p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          className="flex-1 rounded-md border border-border-subtle bg-bg-overlay px-3 py-2 text-sm"
          placeholder="Спросите клон роли…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          aria-label="Отправить"
          disabled={busy || !input.trim()}
          className="rounded-md bg-accent px-3 py-2 text-sm text-accent-fg disabled:opacity-50"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
