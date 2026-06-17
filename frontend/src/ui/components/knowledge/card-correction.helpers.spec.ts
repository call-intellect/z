import { describe, expect, it } from "vitest";

import {
  correctConfirmLabel,
  correctSuccessMessage,
  pickChangedFields,
} from "./card-correction.helpers";

describe("correctConfirmLabel", () => {
  it("owner/admin → «Сохранить как проверенную версию»", () => {
    expect(correctConfirmLabel(true)).toBe("Сохранить как проверенную версию");
  });

  it("остальные → «Предложить правку»", () => {
    expect(correctConfirmLabel(false)).toBe("Предложить правку");
  });
});

describe("correctSuccessMessage", () => {
  it("applied=true → правка применена", () => {
    expect(correctSuccessMessage(true)).toBe(
      "Карточка обновлена — теперь она проверена человеком",
    );
  });

  it("applied=false → правка ушла куратору", () => {
    expect(correctSuccessMessage(false)).toBe(
      "Правка отправлена куратору на проверку",
    );
  });
});

describe("pickChangedFields", () => {
  const fields = [
    { key: "name", value: "Старое название" },
    { key: "statement", value: "Суть" },
  ];

  it("возвращает только изменённое поле", () => {
    const result = pickChangedFields(fields, {
      name: "Новое название",
      statement: "Суть",
    });
    expect(result).toEqual({ name: "Новое название" });
  });

  it("неизменённое значение не попадает в результат", () => {
    const result = pickChangedFields(fields, {
      name: "Старое название",
      statement: "Суть",
    });
    expect(result).toEqual({});
  });

  it("игнорирует тримминг по краям при сравнении", () => {
    const result = pickChangedFields(fields, {
      name: "  Старое название  ",
      statement: "Суть",
    });
    expect(result).toEqual({});
  });

  it("реальная правка попадает с НЕтримленным значением", () => {
    const result = pickChangedFields(fields, {
      name: "  Новое название  ",
      statement: "Суть",
    });
    expect(result).toEqual({ name: "  Новое название  " });
  });

  it("поле, отсутствующее в current, не попадает", () => {
    const result = pickChangedFields(fields, { name: "Новое название" });
    expect(result).toEqual({ name: "Новое название" });
  });

  it("несколько изменённых полей", () => {
    const result = pickChangedFields(fields, {
      name: "Новое название",
      statement: "Новая суть",
    });
    expect(result).toEqual({
      name: "Новое название",
      statement: "Новая суть",
    });
  });
});
