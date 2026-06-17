import { describe, expect, it } from "vitest";

import { deriveInitials, hashPaletteIndex } from "./CloneAvatar";

describe("CloneAvatar.deriveInitials", () => {
  it("одно слово — первая буква в верхнем регистре", () => {
    expect(deriveInitials("маркетолог")).toBe("М");
  });

  it("два слова — две первые буквы", () => {
    expect(deriveInitials("Главный бухгалтер")).toBe("ГБ");
  });

  it('пустая строка / пробелы — fallback "?"', () => {
    expect(deriveInitials("")).toBe("?");
    expect(deriveInitials("   ")).toBe("?");
  });

  it("слова с цифрами в начале — пропускает цифры и берёт первую букву каждого слова", () => {
    expect(deriveInitials("2-й пилот")).toBe("ЙП");
    expect(deriveInitials("123 пилот")).toBe("П");
  });

  it('строка только из цифр/символов — fallback "?"', () => {
    expect(deriveInitials("123 ###")).toBe("?");
  });

  it("три и больше слов — берёт первые две инициалы", () => {
    expect(deriveInitials("Старший вице-президент по продажам")).toBe("СВ");
  });
});

describe("CloneAvatar.hashPaletteIndex", () => {
  it("детерминирован между вызовами", () => {
    const a = hashPaletteIndex("marketing", 12);
    const b = hashPaletteIndex("marketing", 12);
    expect(a).toBe(b);
  });

  it("возвращает значение в [0, mod)", () => {
    for (const key of ["a", "engineering", "абвг", "12345", ""]) {
      const v = hashPaletteIndex(key, 12);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(12);
    }
  });

  it("разные ключи обычно попадают в разные индексы", () => {
    const seen = new Set<number>();
    for (const key of [
      "marketing",
      "engineering",
      "sales",
      "finance",
      "hr",
      "support",
    ]) {
      seen.add(hashPaletteIndex(key, 12));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});
