'use client';

import { useState } from 'react';
import { Compass } from 'lucide-react';

import type { PulsePatternGoalVectorApi } from '@/domain/pulse-patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * CompassWidget (ТЗ-B Фаза 3) — «Вектор движения».
 *
 * Вместо списка целей с числами — наглядная стрелка-компас. Направление
 * стрелки отражает фокус команды относительно цели:
 *   - вверх (север)  = идём к цели (pro >> contra);
 *   - вбок (восток)  = дрейф, делаем не то (pro ≈ contra);
 *   - вниз (юг)      = движение против цели (contra >> pro).
 *
 * Большая стрелка — по главной цели компании; ряд мини-стрелок — по отделам;
 * клик по отделу раскрывает мини-стрелки по людям (топ-контрибьюторы цели).
 *
 * Формула вектора зафиксирована в `computeCompass` (ТЗ §5). Длина стрелки
 * пропорциональна «объёму» сигнала (pro + contra) относительно максимума по
 * всем целям — чтобы стрелки были сопоставимы между собой.
 */

// ─── Чистая функция вектора (тестируется в spec) ────────────────────────────

export type CompassTone = 'success' | 'warning' | 'danger';

export interface CompassVector {
  /** Фокус ∈ [−1, 1] (клампится). 1 = всё к цели, −1 = всё против. */
  focus: number;
  /** Угол стрелки: 0 = север (вверх), 90 = восток (вбок), 180 = юг (вниз). */
  angleDeg: number;
  /** Доля длины ∈ [0, 1] относительно maxVolume. */
  lengthRatio: number;
  tone: CompassTone;
}

// Пороги тона — локальная UI-эвристика (НЕ выносить в настройки).
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
      ? 'success'
      : focus <= TONE_DANGER_THRESHOLD
        ? 'danger'
        : 'warning';

  return { focus, angleDeg, lengthRatio, tone };
}

// Словесный статус по тону (для подписи под главной стрелкой).
function toneVerdict(tone: CompassTone): string {
  if (tone === 'success') return 'Идём к цели';
  if (tone === 'danger') return 'Движение против цели';
  return 'Дрейф в сторону';
}

const TONE_TEXT_CLASS: Record<CompassTone, string> = {
  success: 'text-chip-success-fg',
  warning: 'text-chip-warning-fg',
  danger: 'text-chip-danger-fg',
};

// Округление баллов для подписей: целое при больших значениях, иначе 1 знак.
function fmtScore(value: number): string {
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return value.toFixed(1);
}

// ─── Одна стрелка-компас (SVG) ──────────────────────────────────────────────

type CompassArrowProps = {
  proScore: number;
  contraScore: number;
  maxVolume: number;
  /** Размер квадратного циферблата в px. */
  size: number;
  className?: string;
};

/**
 * CompassArrow — одна стрелка на полукруглом циферблате.
 *
 * Экспортируется отдельно — пригодится в Фазе 4. Циферблат (дуга север→восток→
 * юг) рисуется тоном `text-fg-tertiary`; стрелка-линия и наконечник — тоном
 * `text-chip-{tone}-fg` через `currentColor`. Размер регулируется пропом `size`.
 */
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
  const dialR = size / 2 - size * 0.08; // радиус циферблата с небольшим отступом
  const baseLen = dialR * 0.92;
  // Минимум длины, чтобы короткая стрелка оставалась читаемой.
  const L = baseLen * (0.35 + 0.65 * lengthRatio);

  const a = (angleDeg * Math.PI) / 180;
  const tipX = cx + L * Math.sin(a);
  const tipY = cy - L * Math.cos(a);

  // Наконечник: треугольник у острия, повёрнутый по направлению стрелки.
  const head = Math.max(4, size * 0.12);
  // Единичный вектор направления (от центра к острию).
  const dirX = Math.sin(a);
  const dirY = -Math.cos(a);
  // Перпендикуляр.
  const perpX = -dirY;
  const perpY = dirX;
  const baseX = tipX - dirX * head;
  const baseY = tipY - dirY * head;
  const leftX = baseX + perpX * (head * 0.55);
  const leftY = baseY + perpY * (head * 0.55);
  const rightX = baseX - perpX * (head * 0.55);
  const rightY = baseY - perpY * (head * 0.55);

  // Полукруг циферблата: север (верх) → восток (право) → юг (низ).
  const dialPath = `M ${cx} ${cy - dialR} A ${dialR} ${dialR} 0 0 1 ${cx} ${cy + dialR}`;

  const strokeW = Math.max(1.5, size * 0.04);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('block', className)}
      role="img"
      aria-label={`Направление: ${toneVerdict(tone)}`}
    >
      {/* Циферблат-полукруг */}
      <path
        d={dialPath}
        className="text-fg-tertiary"
        stroke="currentColor"
        strokeWidth={strokeW}
        strokeOpacity={0.4}
        fill="none"
        strokeLinecap="round"
      />
      {/* Засечки: север / восток / юг */}
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
      {/* Стрелка */}
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

// ─── Главный виджет ─────────────────────────────────────────────────────────

type Props = {
  data: PulsePatternGoalVectorApi | null;
  loading: boolean;
  error: string | null;
};

export function CompassWidget({ data, loading, error }: Props) {
  const [openDepartmentId, setOpenDepartmentId] = useState<string | null>(null);

  const hasGoals = !!data && data.goals.length > 0;

  // Главная цель: по primaryGoalId → по isPrimary → первая.
  const primaryGoal = hasGoals
    ? (data!.goals.find((g) => g.goalId === data!.primaryGoalId) ??
      data!.goals.find((g) => g.isPrimary) ??
      data!.goals[0]!)
    : null;

  // Общий масштаб длины — максимум объёма (pro + contra) среди всех целей.
  const maxVolume = hasGoals
    ? Math.max(
        0,
        ...data!.goals.map((g) => g.proScore + g.contraScore),
      )
    : 0;

  const primaryVector = primaryGoal
    ? computeCompass(primaryGoal.proScore, primaryGoal.contraScore, maxVolume)
    : null;

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
            {/* Главная цель — большая стрелка + вердикт */}
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
                    'text-sm font-semibold',
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

            {/* Ряд мини-стрелок по отделам */}
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
                    // Ключ устойчив к null departmentId.
                    const deptKey = dept.departmentId ?? `noname:${dept.departmentName}`;
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
                          'flex w-[88px] flex-col items-center gap-1 rounded-lg p-2 text-center transition-colors hover:bg-bg-overlay/40',
                          isOpen && 'bg-bg-overlay/60',
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
                            'text-[11px] font-medium',
                            TONE_TEXT_CLASS[deptVector.tone],
                          )}
                        >
                          {toneVerdict(deptVector.tone)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Раскрытые мини-стрелки по людям (топ-контрибьюторы цели) */}
                {openDepartmentId && primaryGoal.topContributors.length > 0 && (
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
                                'text-[11px] font-medium',
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
