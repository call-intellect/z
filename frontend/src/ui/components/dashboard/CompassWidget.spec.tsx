import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CompassWidget, computeCompass } from "./CompassWidget";

describe("computeCompass", () => {
  it("всё к цели → север (focus=1, angle≈0, success)", () => {
    const v = computeCompass(10, 0, 10);
    expect(v.focus).toBe(1);
    expect(v.angleDeg).toBeCloseTo(0, 5);
    expect(v.lengthRatio).toBe(1);
    expect(v.tone).toBe("success");
  });

  it("равный дрейф → восток (focus=0, angle≈90, warning)", () => {
    const v = computeCompass(5, 5, 10);
    expect(v.focus).toBe(0);
    expect(v.angleDeg).toBeCloseTo(90, 5);
    expect(v.tone).toBe("warning");
  });

  it("всё против → юг (focus=−1, angle≈180, danger)", () => {
    const v = computeCompass(0, 10, 10);
    expect(v.focus).toBe(-1);
    expect(v.angleDeg).toBeCloseTo(180, 5);
    expect(v.tone).toBe("danger");
  });

  it("нет активности → volume=0 → focus=0, angle=90, lengthRatio=0", () => {
    const v = computeCompass(0, 0, 0);
    expect(v.focus).toBe(0);
    expect(v.angleDeg).toBe(90);
    expect(v.lengthRatio).toBe(0);
    expect(v.tone).toBe("warning");
  });

  it("грязные входы (net/volume>1) → focus клампится в [−1, 1], angle ≥ 0", () => {
    const v = computeCompass(12, -2, 10);
    expect(v.focus).toBeLessThanOrEqual(1);
    expect(v.focus).toBeGreaterThanOrEqual(-1);
    expect(v.focus).toBe(1);
    expect(v.angleDeg).toBeGreaterThanOrEqual(0);
    expect(v.angleDeg).toBeCloseTo(0, 5);
  });

  it("обратный клампинг — net сильно отрицателен → focus=−1, angle≤180", () => {
    const v = computeCompass(-2, 12, 10);
    expect(v.focus).toBe(-1);
    expect(v.angleDeg).toBeLessThanOrEqual(180);
    expect(v.angleDeg).toBeCloseTo(180, 5);
  });
});

describe("CompassWidget", () => {
  it("пустые данные → русский empty-state, без ошибок рендера", () => {
    render(
      <CompassWidget
        data={{ goals: [], primaryGoalId: null }}
        loading={false}
        error={null}
      />,
    );
    expect(screen.getByText(/Цель ещё не задана/)).toBeInTheDocument();
  });

  it("ошибка → текст ошибки виден", () => {
    render(<CompassWidget data={null} loading={false} error="Сбой загрузки" />);
    expect(screen.getByText("Сбой загрузки")).toBeInTheDocument();
  });

  it("есть данные → виден заголовок цели и вердикт «Идём к цели»", () => {
    render(
      <CompassWidget
        loading={false}
        error={null}
        data={{
          primaryGoalId: "g1",
          goals: [
            {
              goalId: "g1",
              goalTitle: "Выручка квартала",
              isPrimary: true,
              proScore: 20,
              contraScore: 2,
              netScore: 18,
              topContributors: [
                {
                  personId: "p1",
                  personName: "Иван Петров",
                  proScore: 8,
                  contraScore: 1,
                  netScore: 7,
                },
              ],
              byDepartment: [
                {
                  departmentId: "d1",
                  departmentName: "Продажи",
                  proScore: 12,
                  contraScore: 1,
                  netScore: 11,
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Выручка квартала")).toBeInTheDocument();
    expect(screen.getAllByText("Идём к цели").length).toBeGreaterThan(0);
    expect(screen.getByText("Продажи")).toBeInTheDocument();
  });

  const twoGoalsData = {
    primaryGoalId: "g1",
    goals: [
      {
        goalId: "g1",
        goalTitle: "Выручка квартала",
        isPrimary: true,
        proScore: 20,
        contraScore: 2,
        netScore: 18,
        topContributors: [],
        byDepartment: [
          {
            departmentId: "d1",
            departmentName: "Продажи",
            proScore: 12,
            contraScore: 1,
            netScore: 11,
          },
        ],
      },
      {
        goalId: "g2",
        goalTitle: "Снижение оттока",
        isPrimary: false,
        proScore: 3,
        contraScore: 9,
        netScore: -6,
        topContributors: [],
        byDepartment: [],
      },
    ],
  };

  it("есть данные → виден переключатель уровней (3 русские подписи)", () => {
    render(<CompassWidget loading={false} error={null} data={twoGoalsData} />);
    expect(screen.getByText("Вся компания")).toBeInTheDocument();
    expect(screen.getByText("По целям")).toBeInTheDocument();
    expect(screen.getByText("По спринту недели")).toBeInTheDocument();
  });

  it("клик «По целям» → видны заголовки нескольких целей одновременно", () => {
    render(<CompassWidget loading={false} error={null} data={twoGoalsData} />);
    fireEvent.click(screen.getByText("По целям"));
    expect(screen.getByText("Снижение оттока")).toBeInTheDocument();
    expect(screen.getByText("Выручка квартала")).toBeInTheDocument();
  });
});
