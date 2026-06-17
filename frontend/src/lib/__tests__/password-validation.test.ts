import { describe, expect, it } from "vitest";

import {
  PASSWORD_RULE_HINT,
  passwordsMatch,
  validatePassword,
} from "../password-validation";

describe("validatePassword", () => {
  it("reject короче 8 символов", () => {
    const r = validatePassword("Ab1");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/8/);
  });

  it("reject пустой строки", () => {
    const r = validatePassword("");
    expect(r.valid).toBe(false);
  });

  it("reject без цифры", () => {
    const r = validatePassword("abcdefgh");
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/букв/);
  });

  it("reject без буквы (только цифры)", () => {
    const r = validatePassword("12345678");
    expect(r.valid).toBe(false);
  });

  it("accept латиница + цифра", () => {
    expect(validatePassword("Password1").valid).toBe(true);
  });

  it("accept кириллица + цифра", () => {
    expect(validatePassword("пароль123").valid).toBe(true);
  });

  it("accept ровно 8 символов: буква + цифры", () => {
    expect(validatePassword("a1234567").valid).toBe(true);
  });

  it("#18 — любая ошибка возвращает ЕДИНЫЙ PASSWORD_RULE_HINT", () => {
    expect(validatePassword("Ab1").message).toBe(PASSWORD_RULE_HINT);
    expect(validatePassword("abcdefgh").message).toBe(PASSWORD_RULE_HINT);
    expect(validatePassword("12345678").message).toBe(PASSWORD_RULE_HINT);
  });
});

describe("passwordsMatch", () => {
  it("true для совпадающих непустых", () => {
    expect(passwordsMatch("abc1", "abc1")).toBe(true);
  });
  it("false для пустых", () => {
    expect(passwordsMatch("", "")).toBe(false);
  });
  it("false для разных", () => {
    expect(passwordsMatch("abc1", "abc2")).toBe(false);
  });
});
