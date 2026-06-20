import { describe, expect, it } from "vitest";

import { mapPreviewToProvenanceRef } from "./provenance";

describe("mapPreviewToProvenanceRef", () => {
  it("собирает ProvenanceRef из непустого quote и sourceRef", () => {
    const ref = mapPreviewToProvenanceRef("Решили перенести релиз", {
      evidenceId: "ev-1",
      blockId: "blk-1",
      sourceType: "meeting",
      refId: "meet-1",
      startMs: 42000,
      deepLink: "/meetings/meet-1?t=42",
      attribution: "quoted",
      label: "Планёрка",
    });

    expect(ref).not.toBeNull();
    expect(ref?.quote).toBe("Решили перенести релиз");
    expect(ref?.source.deepLink).toBe("/meetings/meet-1?t=42");
    expect(ref?.source.type).toBe("meeting");
    expect(ref?.attribution).toBe("quoted");
    expect(ref?.startMs).toBe(42000);
    expect(ref?.blockId).toBe("blk-1");
  });

  it("возвращает null, когда оба аргумента пусты", () => {
    expect(mapPreviewToProvenanceRef(null, null)).toBeNull();
    expect(mapPreviewToProvenanceRef(undefined, undefined)).toBeNull();
  });
});
