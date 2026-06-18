"use client";

import { useMemo } from "react";
import clsx from "clsx";
import { useParticipants } from "@livekit/components-react";
import type { Participant } from "livekit-client";

import { useHostControls } from "@/hooks/use-host-controls";
import { readRaiseHand } from "@/hooks/use-raise-hand";
import { t } from "@/lib/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  meetingId: string;
  isHost: boolean;
  identityToParticipantId: Record<string, string>;
};

type Row = {
  participant: Participant;
  isRaised: boolean;
  raisedAt: Date | null;
};

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    if (a.isRaised && !b.isRaised) return -1;
    if (!a.isRaised && b.isRaised) return 1;
    if (a.isRaised && b.isRaised) {
      const ta = a.raisedAt?.getTime() ?? 0;
      const tb = b.raisedAt?.getTime() ?? 0;
      return ta - tb;
    }
    return a.participant.identity.localeCompare(b.participant.identity);
  });
}

export function ParticipantsPanel({
  open,
  onClose,
  meetingId,
  isHost,
  identityToParticipantId,
}: Props) {
  const participants = useParticipants();
  const host = useHostControls(meetingId);

  const rows = useMemo<Row[]>(() => {
    const list = participants.map((p) => {
      const { isRaised, raisedAt } = readRaiseHand(p);
      return { participant: p, isRaised, raisedAt };
    });
    return sortRows(list);
  }, [participants]);

  if (!open) return null;

  return (
    <aside
      className={clsx(
        "flex h-full w-80 flex-col border-l border-border bg-bg-elevated text-fg-primary",
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {t("room.participants_panel_title")} · {rows.length}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="rounded p-1 text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-fg-tertiary">
            {t("room.no_participants")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(({ participant, isRaised }) => {
              const internalId = identityToParticipantId[participant.identity];
              const isLocal = participant.isLocal;
              const isHostRow = participant.identity.startsWith("host:");
              return (
                <li
                  key={participant.sid || participant.identity}
                  className="flex items-center gap-2 px-4 py-3"
                >
                  <div className="flex flex-1 items-center gap-2 truncate">
                    {isRaised ? (
                      <span aria-label={t("room.controls.raise_hand")}>✋</span>
                    ) : null}
                    <span className="truncate text-sm">
                      {participant.name || participant.identity}
                      {isLocal ? " (вы)" : ""}
                    </span>
                    {isHostRow ? (
                      <span className="rounded bg-info/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-info">
                        host
                      </span>
                    ) : null}
                  </div>
                  {isHost && !isLocal && internalId ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          void host.mute(internalId);
                        }}
                        className="rounded bg-bg-overlay px-2 py-1 text-xs hover:bg-bg-overlay/80"
                      >
                        {t("room.host_actions.mute")}
                      </button>
                      {isRaised ? (
                        <button
                          type="button"
                          onClick={() => {
                            void host.lowerHand(internalId);
                          }}
                          className="rounded bg-bg-overlay px-2 py-1 text-xs hover:bg-bg-overlay/80"
                        >
                          {t("room.host_actions.lower_hand")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          void host.kick(internalId);
                        }}
                        className="rounded bg-danger/80 px-2 py-1 text-xs text-danger-fg hover:opacity-90"
                      >
                        {t("room.host_actions.kick")}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
