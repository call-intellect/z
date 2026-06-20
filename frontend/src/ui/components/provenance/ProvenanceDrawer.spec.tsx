import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Provenance, ProvenanceRef } from "@/domain/provenance";

const useProvenanceMock = vi.fn();
const voiceNoteAudioMock = vi.fn();

vi.mock("@/hooks/useProvenance", () => ({
  useProvenance: (...args: unknown[]) => useProvenanceMock(...args),
}));

vi.mock("@/api/provenance.api", () => ({
  provenanceApi: {
    voiceNoteAudio: (...args: unknown[]) => voiceNoteAudioMock(...args),
  },
}));

import { ProvenanceDrawer } from "./ProvenanceDrawer";

function makeNode(over: Partial<ProvenanceRef>): ProvenanceRef {
  return {
    blockId: "b-1",
    rawEventId: "raw-1",
    source: { type: "voice_note", refId: null, label: "Голосовая заметка", deepLink: null },
    quote: "Надо ускорить онбординг",
    attribution: "quoted",
    startMs: null,
    endMs: null,
    confidence: null,
    needsReview: false,
    accessFiltered: false,
    hasAudio: true,
    ...over,
  };
}

function setProvenance(nodes: ProvenanceRef[]): void {
  const value: { provenance: Provenance; isLoading: boolean; error: unknown } = {
    provenance: { nodes, coverage: { blocks: nodes.length, meetings: 0 } },
    isLoading: false,
    error: null,
  };
  useProvenanceMock.mockReturnValue(value);
}

describe("ProvenanceDrawer — плеер голосового источника (B3)", () => {
  beforeEach(() => {
    useProvenanceMock.mockReset();
    voiceNoteAudioMock.mockReset();
  });

  it("voice_note с hasAudio → кнопка «Послушать оригинал»", () => {
    setProvenance([makeNode({})]);
    render(
      <ProvenanceDrawer
        open
        onOpenChange={() => undefined}
        orgId="org-1"
        entityType="decision"
        entityId="d-1"
      />,
    );
    expect(screen.getByText("Послушать оригинал")).toBeInTheDocument();
  });

  it("meeting-источник → кнопки нет", () => {
    setProvenance([
      makeNode({
        source: { type: "meeting", refId: "m-1", label: "Встреча", deepLink: null },
        hasAudio: false,
      }),
    ]);
    render(
      <ProvenanceDrawer
        open
        onOpenChange={() => undefined}
        orgId="org-1"
        entityType="decision"
        entityId="d-1"
      />,
    );
    expect(screen.queryByText("Послушать оригинал")).not.toBeInTheDocument();
  });

  it("voice_note без hasAudio → кнопки нет (graceful)", () => {
    setProvenance([makeNode({ hasAudio: false })]);
    render(
      <ProvenanceDrawer
        open
        onOpenChange={() => undefined}
        orgId="org-1"
        entityType="decision"
        entityId="d-1"
      />,
    );
    expect(screen.queryByText("Послушать оригинал")).not.toBeInTheDocument();
  });

  it("клик → presigned URL → рендерит audio", async () => {
    voiceNoteAudioMock.mockResolvedValue({
      url: "https://s3.example/voice.ogg?sig=1",
      expiresAt: "2026-06-21T00:10:00.000Z",
    });
    setProvenance([makeNode({})]);
    render(
      <ProvenanceDrawer
        open
        onOpenChange={() => undefined}
        orgId="org-1"
        entityType="decision"
        entityId="d-1"
      />,
    );
    fireEvent.click(screen.getByText("Послушать оригинал"));
    await waitFor(() => {
      const audio = document.querySelector("audio");
      expect(audio).not.toBeNull();
      expect(audio?.getAttribute("src")).toBe("https://s3.example/voice.ogg?sig=1");
    });
    expect(voiceNoteAudioMock).toHaveBeenCalledWith("org-1", "raw-1");
  });

  it("404 на presigned → плеер скрывается (graceful)", async () => {
    voiceNoteAudioMock.mockRejectedValue(new Error("not found"));
    setProvenance([makeNode({})]);
    render(
      <ProvenanceDrawer
        open
        onOpenChange={() => undefined}
        orgId="org-1"
        entityType="decision"
        entityId="d-1"
      />,
    );
    fireEvent.click(screen.getByText("Послушать оригинал"));
    await waitFor(() => {
      expect(screen.queryByText("Послушать оригинал")).not.toBeInTheDocument();
    });
    expect(document.querySelector("audio")).toBeNull();
  });
});
