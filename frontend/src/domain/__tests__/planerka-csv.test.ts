import { describe, expect, it } from "vitest";

import type { WeeklyPersonItemUi } from "../weekly-per-person";
import {
  buildPlanerkaCsv,
  buildPlanerkaRows,
  type PlanerkaPerson,
} from "../planerka-csv";

function item(over: Partial<WeeklyPersonItemUi> = {}): WeeklyPersonItemUi {
  return {
    kind: "task",
    kindLabel: "задача",
    title: "Сделать отчёт",
    factStatus: "done",
    factLabel: "сделано",
    tone: "ok",
    plannedDueLabel: "13 июня",
    blockedBy: null,
    ...over,
  };
}

describe("buildPlanerkaRows", () => {
  it("одна строка на пункт; имя человека повторяется", () => {
    const people: PlanerkaPerson[] = [
      {
        personName: "Иван Петров",
        items: [
          item({ title: "А" }),
          item({ title: "Б", factLabel: "просрочено" }),
        ],
      },
    ];
    const rows = buildPlanerkaRows(people);
    expect(rows).toHaveLength(2);
    expect(rows[0].person).toBe("Иван Петров");
    expect(rows[1].person).toBe("Иван Петров");
    expect(rows[0].what).toBe("А");
    expect(rows[1].fact).toBe("просрочено");
  });

  it("человек без пунктов → строка-заглушка «—»", () => {
    const rows = buildPlanerkaRows([{ personName: "Без дел", items: [] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      person: "Без дел",
      what: "—",
      plan: "—",
      fact: "—",
      blocked: "—",
    });
  });

  it("blockedBy=null → «—», иначе текст блокера", () => {
    const rows = buildPlanerkaRows([
      {
        personName: "Анна",
        items: [
          item({ blockedBy: null }),
          item({ blockedBy: "Ждём согласования" }),
        ],
      },
    ]);
    expect(rows[0].blocked).toBe("—");
    expect(rows[1].blocked).toBe("Ждём согласования");
  });
});

describe("buildPlanerkaCsv", () => {
  it("заголовок в фиксированном порядке колонок", () => {
    const csv = buildPlanerkaCsv([]);
    expect(csv.split("\r\n")[0]).toBe("Человек;Что;План;Факт;Что мешало");
  });

  it("в самом CSV НЕТ BOM (его добавляет Blob)", () => {
    const csv = buildPlanerkaCsv([]);
    expect(csv.startsWith("﻿")).toBe(false);
    expect(csv.charCodeAt(0)).toBe("Ч".charCodeAt(0));
  });

  it("строки разделены \\r\\n; имя повторяется", () => {
    const csv = buildPlanerkaCsv([
      {
        personName: "Иван",
        items: [item({ title: "А" }), item({ title: "Б" })],
      },
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("Иван;А;13 июня;сделано;—");
    expect(lines[2]).toBe("Иван;Б;13 июня;сделано;—");
  });

  it("эскейпит запятую внутри значения (запятая не разделитель → без кавычек)", () => {
    const csv = buildPlanerkaCsv([
      { personName: "Иван", items: [item({ title: "А, Б, В" })] },
    ]);
    const line = csv.split("\r\n")[1];
    expect(line).toBe("Иван;А, Б, В;13 июня;сделано;—");
  });

  it("оборачивает в кавычки и удваивает кавычки", () => {
    const csv = buildPlanerkaCsv([
      { personName: "Иван", items: [item({ title: 'Скажи "привет"' })] },
    ]);
    const line = csv.split("\r\n")[1];
    expect(line).toBe('Иван;"Скажи ""привет""";13 июня;сделано;—');
  });

  it("оборачивает значение с точкой с запятой (разделителем)", () => {
    const csv = buildPlanerkaCsv([
      { personName: "Иван", items: [item({ title: "А; Б" })] },
    ]);
    const line = csv.split("\r\n")[1];
    expect(line).toBe('Иван;"А; Б";13 июня;сделано;—');
  });

  it("оборачивает значение с переводом строки", () => {
    const csv = buildPlanerkaCsv([
      { personName: "Иван", items: [item({ title: "Строка1\nСтрока2" })] },
    ]);
    expect(csv.startsWith("Человек;Что;План;Факт;Что мешало\r\n")).toBe(true);
    expect(csv).toContain('Иван;"Строка1\nСтрока2";13 июня;сделано;—');
  });
});
