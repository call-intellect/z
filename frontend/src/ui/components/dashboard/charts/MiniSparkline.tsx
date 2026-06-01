'use client';

import { useMemo } from 'react';

import { cn } from '@/ui/shadcn/lib/utils';

import { toneVars, type ChartTone } from './tones';

type Props = {
  /** Не-пустой массив значений. Если пустой — компонент ничего не рисует. */
  data: number[];
  tone?: ChartTone;
  width?: number;
  height?: number;
  /** Заполненная область под линией. */
  filled?: boolean;
  className?: string;
};

/**
 * MiniSparkline — крошечный SVG-график тренда 60×20.
 *
 * Чистый SVG, без зависимостей. Цвет — через `var(--chip-{tone}-fg)` /
 * `var(--accent)` (см. `tones.ts`). Подходит для фоновой подсказки внутри
 * KPI-карточек, рядом с числом в строке, в hero-strip.
 *
 * Декоративный: `aria-hidden`. Если значения одинаковые — горизонтальная
 * линия по центру.
 */
export function MiniSparkline({
  data,
  tone = 'accent',
  width = 60,
  height = 20,
  filled = true,
  className,
}: Props) {
  const { linePath, areaPath, isFlat } = useMemo(
    () => buildPath(data, width, height),
    [data, width, height],
  );

  if (data.length === 0) return null;

  const { fg, bg } = toneVars(tone);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('block', className)}
    >
      {filled && !isFlat && (
        <path d={areaPath} fill={bg} fillOpacity={0.4} stroke="none" />
      )}
      <path
        d={linePath}
        fill="none"
        stroke={fg}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function buildPath(data: number[], width: number, height: number) {
  if (data.length === 0) {
    return { linePath: '', areaPath: '', isFlat: true };
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const flat = max === min;

  // Отступ сверху/снизу, чтобы линия не «лизала» границы viewBox.
  const padY = 1.5;
  const usableH = height - padY * 2;

  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = data.length === 1 ? width / 2 : i * stepX;
    const y = flat
      ? height / 2
      : padY + (1 - (v - min) / (max - min)) * usableH;
    return { x, y };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const areaPath = `${linePath} L${last.x.toFixed(2)},${height} L${first.x.toFixed(
    2,
  )},${height} Z`;

  return { linePath, areaPath, isFlat: flat };
}
