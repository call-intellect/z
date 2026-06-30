"use client";

import { useState } from "react";
import { ArrowUp, ChevronDown, Compass } from "lucide-react";

import type { WeeklyDigestGoalAlignmentWeekApi } from "@/api/weekly-digest.api";
import { CHART, GRAD, glass } from "@/ui/components/dashboard/modern";
import { CardTitle } from "@/ui/components/dashboard/modern";
import { GoalCompass3D } from "@/ui/components/dashboard/shared/GoalCompass3D";
import { cn } from "@/ui/shadcn/lib/utils";

type Direction = WeeklyDigestGoalAlignmentWeekApi["direction"];

const DIRECTION_CAPTION: Record<Direction, string> = {
  to_goal: "к цели",
  drift: "дрейф",
  against: "против",
};

const DIRECTION_VERDICT: Record<Direction, string> = {
  to_goal: "К цели — за неделю усилия приближали к главной цели",
  drift: "Дрейф — движение есть, но к цели двигала малая часть",
  against: "Против — неделя увела от цели",
};

const DIRECTION_TONE: Record<Direction, string> = {
  to_goal: CHART.mint,
  drift: CHART.amber,
  against: CHART.red,
};

export function WeekGoalCompass({
  goal,
}: {
  goal: WeeklyDigestGoalAlignmentWeekApi;
}) {
  const [open, setOpen] = useState(false);
  const tone = DIRECTION_TONE[goal.direction];

  return (
    <div style={glass()} className="p-6">
      <div className="flex items-center gap-3">
        <CardTitle icon={<Compass size={17} />} grad={GRAD.teal}>
          Цель и компас недели
        </CardTitle>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
          style={{ background: "var(--surface-inset)", color: CHART.dim }}
        >
          Почему так?
          <ChevronDown
            size={14}
            aria-hidden
            className={cn("transition-transform", open ? "rotate-180" : "")}
          />
        </button>
      </div>

      <div className="mt-4 flex items-start gap-4">
        <GoalCompass3D
          direction={goal.direction}
          score={goal.score}
          caption={DIRECTION_CAPTION[goal.direction]}
        />
        <div className="min-w-0 flex-1">
          <div
            className="text-[11px] font-bold uppercase tracking-[0.07em]"
            style={{ color: CHART.faint }}
          >
            Главная цель
          </div>
          {goal.goalName ? (
            <div
              className="mt-1 text-base font-bold tracking-tight"
              style={{ color: CHART.text }}
            >
              {goal.goalName}
            </div>
          ) : null}
          <div
            className="mt-2.5 inline-flex items-center gap-2 text-sm font-bold"
            style={{ color: tone }}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: tone, boxShadow: `0 0 10px ${tone}` }}
              aria-hidden
            />
            {DIRECTION_VERDICT[goal.direction]}
            {goal.score !== null ? (
              <span style={{ color: CHART.dim }}>· балл {goal.score}</span>
            ) : null}
          </div>
          {goal.weekDelta ? (
            <div
              className="mt-2.5 text-[13.5px] leading-snug"
              style={{ color: CHART.dim }}
            >
              {goal.weekDelta}
            </div>
          ) : null}
        </div>
      </div>

      {open ? (
        <div
          className="mt-4 border-t pt-4"
          style={{ borderColor: "var(--glass-border)" }}
        >
          {goal.why ? (
            <p
              className="text-[13.5px] leading-relaxed"
              style={{ color: CHART.dim }}
            >
              {goal.why}
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <h5
                className="mb-2.5 flex items-center gap-1.5 text-xs font-bold"
                style={{ color: CHART.mint }}
              >
                <ArrowUp size={14} aria-hidden />
                Двигало к цели
              </h5>
              <ul className="flex flex-col gap-2">
                {goal.pro.length > 0 ? (
                  goal.pro.map((item, i) => (
                    <li
                      key={`pro-${i}`}
                      className="flex gap-2 text-[13px] leading-snug"
                      style={{ color: CHART.dim }}
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: CHART.mint }}
                        aria-hidden
                      />
                      {item}
                    </li>
                  ))
                ) : (
                  <li className="text-[13px]" style={{ color: CHART.faint }}>
                    За неделю ничего не приблизило к цели.
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h5
                className="mb-2.5 flex items-center gap-1.5 text-xs font-bold"
                style={{ color: CHART.red }}
              >
                <ChevronDown size={14} aria-hidden />
                Мимо цели / тормозило
              </h5>
              <ul className="flex flex-col gap-2">
                {goal.contra.length > 0 ? (
                  goal.contra.map((item, i) => (
                    <li
                      key={`contra-${i}`}
                      className="flex gap-2 text-[13px] leading-snug"
                      style={{ color: CHART.dim }}
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: CHART.red }}
                        aria-hidden
                      />
                      {item}
                    </li>
                  ))
                ) : (
                  <li className="text-[13px]" style={{ color: CHART.faint }}>
                    Ничто не уводило от цели.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
