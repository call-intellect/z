import { describe, expect, it } from "vitest";

import { buildRenderSegments } from "./document-render";

describe("buildRenderSegments", () => {
  it("без pageOffsets и без цитаты — один сегмент без разделителей", () => {
    const text = "Привет мир, это документ.";
    const segments = buildRenderSegments(text, [], null);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      text,
      isQuote: false,
      pageBreakBefore: null,
    });
  });

  it("с pageOffsets — разделители на нужных offset (страницы 2 и 3)", () => {
    const text = "AAAABBBBCCCC";
    const segments = buildRenderSegments(text, [0, 4, 8], null);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({
      text: "AAAA",
      isQuote: false,
      pageBreakBefore: null,
    });
    expect(segments[1]).toEqual({
      text: "BBBB",
      isQuote: false,
      pageBreakBefore: 2,
    });
    expect(segments[2]).toEqual({
      text: "CCCC",
      isQuote: false,
      pageBreakBefore: 3,
    });
  });

  it("цитата корректно обёрнута и совмещена с разделителями страниц", () => {
    const text = "AAAABBBBCCCC";
    const segments = buildRenderSegments(text, [0, 4, 8], {
      start: 5,
      end: 7,
    });
    const quoted = segments.filter((s) => s.isQuote);
    expect(quoted).toHaveLength(1);
    expect(quoted[0]!.text).toBe("BB");
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.some((s) => s.pageBreakBefore === 2)).toBe(true);
    expect(segments.some((s) => s.pageBreakBefore === 3)).toBe(true);
  });

  it("цитата без pageOffsets — три сегмента, средний помечен isQuote", () => {
    const text = "abcdefghij";
    const segments = buildRenderSegments(text, [], { start: 3, end: 6 });
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({
      text: "abc",
      isQuote: false,
      pageBreakBefore: null,
    });
    expect(segments[1]).toEqual({
      text: "def",
      isQuote: true,
      pageBreakBefore: null,
    });
    expect(segments[2]).toEqual({
      text: "ghij",
      isQuote: false,
      pageBreakBefore: null,
    });
  });

  it("первая страница (offset 0) не создаёт разделитель", () => {
    const text = "XXYY";
    const segments = buildRenderSegments(text, [0, 2], null);
    expect(segments[0]!.pageBreakBefore).toBeNull();
    expect(segments[1]!.pageBreakBefore).toBe(2);
  });
});
