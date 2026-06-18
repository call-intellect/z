"use client";

import { useState } from "react";
import { Compass } from "lucide-react";

import type { PulsePatternGoalVectorApi } from "@/domain/pulse-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { cn } from "@/ui/shadcn/lib/utils";

export type CompassTone = "success" | "warning" | "danger";

export interface CompassVector {
  focus: number;
  angleDeg: number;
  lengthRatio: number;
  tone: CompassTone;
}

const TONE_SUCCESS_THRESHOLD = 0.34;
const TONE_DANGER_THRESHOLD = -0.34;

export function computeCompass(
  proScore: number,
  contraScore: number,
  maxVolume: number,
): CompassVector {
  const volume = proScore + contraScore;
  const net = proScore - contraScore;

  let focus = volume > 0 ? net / volume : 0;
  focus = Math.max(-1, Math.min(1, focus));

  const angleDeg = (1 - focus) * 90;
  const lengthRatio = maxVolume > 0 ? Math.min(1, volume / maxVolume) : 0;

  const tone: CompassTone =
    focus >= TONE_SUCCESS_THRESHOLD
      ? "success"
      : focus <= TONE_DANGER_THRESHOLD
        ? "danger"
        : "warning";

  return { focus, angleDeg, lengthRatio, tone };
}

function toneVerdict(tone: CompassTone): string {
  if (tone === "success") return "Идём к цели";
  if (tone === "danger") return "Движение против цели";
  return "Дрейф в сторону";
}

const TONE_TEXT_CLASS: Record<CompassTone, string> = {
  success: "text-chip-success-fg",
  warning: "text-chip-warning-fg",
  danger: "text-chip-danger-fg",
};

function fmtScore(value: number): string {
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return value.toFixed(1);
}

type CompassArrowProps = {
  proScore: number;
  contraScore: number;
  maxVolume: number;
  size: number;
  className?: string;
};

export function CompassArrow({
  proScore,
  contraScore,
  maxVolume,
  size,
  className,
}: CompassArrowProps) {
  const { angleDeg, lengthRatio, tone } = computeCompass(
    proScore,
    contraScore,
    maxVolume,
  );

  const cx = size / 2;
  const cy = size / 2;
  const dialR = size / 2 - size * 0.08;
  const baseLen = dialR * 0.92;
  const L = baseLen * (0.35 + 0.65 * lengthRatio);

  const a = (angleDeg * Math.PI) / 180;
  const tipX = cx + L * Math.sin(a);
  const tipY = cy - L * Math.cos(a);

  const head = Math.max(4, size * 0.12);
  const dirX = Math.sin(a);
  const dirY = -Math.cos(a);
  const perpX = -dirY;
  const perpY = dirX;
  const baseX = tipX - dirX * head;
  const baseY = tipY - dirY * head;
  const leftX = baseX + perpX * (head * 0.55);
  const leftY = baseY + perpY * (head * 0.55);
  const rightX = baseX - perpX * (head * 0.55);
  const rightY = baseY - perpY * (head * 0.55);

  const dialPath = `M ${cx} ${cy - dialR} A ${dialR} ${dialR} 0 0 1 ${cx} ${cy + dialR}`;

  const strokeW = Math.max(1.5, size * 0.04);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("block", className)}
      role="img"
      aria-label={`Направление: ${toneVerdict(tone)}`}
    >
      {}
      <path
        d={dialPath}
        className="text-fg-tertiary"
        stroke="currentColor"
        strokeWidth={strokeW}
        strokeOpacity={0.4}
        fill="none"
        strokeLinecap="round"
      />
      {}
      <g className="text-fg-tertiary" stroke="currentColor" strokeOpacity={0.4}>
        <line
          x1={cx}
          y1={cy - dialR}
          x2={cx}
          y2={cy - dialR + Math.max(2, size * 0.07)}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <line
          x1={cx + dialR}
          y1={cy}
          x2={cx + dialR - Math.max(2, size * 0.07)}
          y2={cy}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <line
          x1={cx}
          y1={cy + dialR}
          x2={cx}
          y2={cy + dialR - Math.max(2, size * 0.07)}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
      </g>
      {}
      <g
        className={TONE_TEXT_CLASS[tone]}
        stroke="currentColor"
        fill="currentColor"
      >
        <circle cx={cx} cy={cy} r={Math.max(1.5, size * 0.035)} stroke="none" />
        <line
          x1={cx}
          y1={cy}
          x2={baseX}
          y2={baseY}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />
        <polygon
          points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`}
          stroke="none"
        />
      </g>
    </svg>
  );
}

type Props = {
  data: PulsePatternGoalVectorApi | null;
  loading: boolean;
  error: string | null;
};

type CompassLevel = "company" | "goals" | "sprint";

const LEVEL_OPTIONS: ReadonlyArray<{ value: CompassLevel; label: string }> = [
  { value: "company", label: "Вся компания" },
  { value: "goals", label: "По целям" },
  { value: "sprint", label: "По спринту недели" },
];

export function CompassWidget({ data, loading, error }: Props) {
  const [openDepartmentId, setOpenDepartmentId] = useState<string | null>(null);
  const [level, setLevel] = useState<CompassLevel>("company");

  const hasGoals = !!data && data.goals.length > 0;

  const primaryGoal = hasGoals
    ? (data!.goals.find((g) => g.goalId === data!.primaryGoalId) ??
      data!.goals.find((g) => g.isPrimary) ??
      data!.goals[0]!)
    : null;

  const maxVolume = hasGoals
    ? Math.max(0, ...data!.goals.map((g) => g.proScore + g.contraScore))
    : 0;

  const primaryVector = primaryGoal
    ? computeCompass(primaryGoal.proScore, primaryGoal.contraScore, maxVolume)
    : null;

  const primaryGoalId = primaryGoal?.goalId ?? null;

  const renderGoalsGrid = () => (
    <div className="flex flex-wrap gap-4">
      {data!.goals.map((goal) => {
        const goalVector = computeCompass(
          goal.proScore,
          goal.contraScore,
          maxVolume,
        );
        const isPrimaryCell = goal.goalId === primaryGoalId;
        return (
          <div
            key={goal.goalId}
            className={cn(
              "flex w-[148px] flex-col items-center gap-1 rounded-lg p-3 text-center",
              isPrimaryCell
                ? "border border-accent/30 bg-bg-overlay/30"
                : "bg-bg-overlay/20",
            )}
          >
            <CompassArrow
              proScore={goal.proScore}
              contraScore={goal.contraScore}
              maxVolume={maxVolume}
              size={84}
            />
            {isPrimaryCell && (
              <span className="text-[11px] font-medium uppercase tracking-wide text-accent-fg">
                главная
              </span>
            )}
            <span className="w-full truncate text-xs text-fg-secondary">
              {goal.goalTitle}
            </span>
            <span
              className={cn(
                "text-[11px] font-medium",
                TONE_TEXT_CLASS[goalVector.tone],
              )}
            >
              {toneVerdict(goalVector.tone)}
            </span>
            <span className="text-[11px] text-fg-tertiary tabular-nums">
              +{fmtScore(goal.proScore)} / −{fmtScore(goal.contraScore)}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass size={16} className="text-accent" />
          Вектор движения
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        )}

        {!loading && error && (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        )}

        {!loading && !error && !hasGoals && (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-bg-overlay/40 p-6 text-center">
            <Compass size={28} className="text-fg-tertiary" />
            <p className="text-sm text-fg-secondary">
              Цель ещё не задана или не собран первый вектор движения.
            </p>
          </div>
        )}

        {!loading && !error && hasGoals && primaryGoal && primaryVector && (
          <div className="space-y-5">
            {}
            <div className="inline-flex flex-wrap gap-1 rounded-lg bg-bg-overlay/30 p-1">
              {LEVEL_OPTIONS.map((opt) => {
                const active = level === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLevel(opt.value)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "bg-accent/15 text-accent-fg"
                        : "text-fg-secondary hover:bg-bg-overlay/40",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {}
            {level === "sprint" && (
              <p className="text-xs text-fg-tertiary">За текущую неделю</p>
            )}

            {}
            {(level === "goals" || level === "sprint") && renderGoalsGrid()}

            {}
            {level === "company" && (
              <>
                {}
                <div className="flex items-center gap-4">
                  <CompassArrow
                    proScore={primaryGoal.proScore}
                    contraScore={primaryGoal.contraScore}
                    maxVolume={maxVolume}
                    size={132}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-medium text-fg-primary">
                      {primaryGoal.goalTitle}
                    </p>
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        TONE_TEXT_CLASS[primaryVector.tone],
                      )}
                    >
                      {toneVerdict(primaryVector.tone)}
                    </p>
                    <p className="text-xs text-fg-tertiary tabular-nums">
                      +{fmtScore(primaryGoal.proScore)} / −
                      {fmtScore(primaryGoal.contraScore)}
                    </p>
                  </div>
                </div>

                {}
                {primaryGoal.byDepartment.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                      По отделам
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {primaryGoal.byDepartment.map((dept) => {
                        const deptVector = computeCompass(
                          dept.proScore,
                          dept.contraScore,
                          maxVolume,
                        );
                        const deptKey =
                          dept.departmentId ?? `noname:${dept.departmentName}`;
                        const isOpen = openDepartmentId === deptKey;
                        return (
                          <button
                            key={deptKey}
                            type="button"
                            onClick={() =>
                              setOpenDepartmentId((cur) =>
                                cur === deptKey ? null : deptKey,
                              )
                            }
                            aria-pressed={isOpen}
                            className={cn(
                              "flex w-[88px] flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors hover:bg-bg-overlay/40",
                              isOpen && "bg-bg-overlay/60",
                            )}
                          >
                            <CompassArrow
                              proScore={dept.proScore}
                              contraScore={dept.contraScore}
                              maxVolume={maxVolume}
                              size={64}
                            />
                            <span className="w-full truncate text-xs text-fg-secondary">
                              {dept.departmentName}
                            </span>
                            <span
                              className={cn(
                                "text-[11px] font-medium",
                                TONE_TEXT_CLASS[deptVector.tone],
                              )}
                            >
                              {toneVerdict(deptVector.tone)}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {}
                    {openDepartmentId &&
                      primaryGoal.topContributors.length > 0 && (
                        <div className="mt-3 rounded-lg bg-bg-overlay/30 p-3">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                            По людям
                          </p>
                          <div className="flex flex-wrap gap-3">
                            {primaryGoal.topContributors.map((person) => {
                              const personVector = computeCompass(
                                person.proScore,
                                person.contraScore,
                                maxVolume,
                              );
                              return (
                                <div
                                  key={person.personId}
                                  className="flex w-[80px] flex-col items-center gap-1 text-center"
                                >
                                  <CompassArrow
                                    proScore={person.proScore}
                                    contraScore={person.contraScore}
                                    maxVolume={maxVolume}
                                    size={52}
                                  />
                                  <span className="w-full truncate text-xs text-fg-secondary">
                                    {person.personName}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-[11px] font-medium",
                                      TONE_TEXT_CLASS[personVector.tone],
                                    )}
                                  >
                                    {toneVerdict(personVector.tone)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
