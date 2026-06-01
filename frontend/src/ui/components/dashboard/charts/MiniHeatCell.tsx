'use client';

import { cn } from '@/ui/shadcn/lib/utils';

import { toneVars, type ChartTone } from './tones';

type Props = {
  /** Интенсивность 0..1. <=0 → пустая нейтральная ячейка. */
  ratio: number;
  tone?: ChartTone;
  /** Контент ячейки — строка/число. Если undefined и ratio=0 — пусто. */
  value?: string | number;
  /** Сторона квадратной ячейки в px. */
  size?: number;
  className?: string;
};

/**
 * MiniHeatCell — квадратная ячейка heatmap с заливкой по интенсивности.
 *
 * Логика расчёта прозрачности извлечена из `BottleneckHeatmapWidget`:
 * минимальная видимая интенсивность — 0.12, максимум — 1.0; финальная
 * непрозрачность фона — `0.6 + ratio * 0.4`. Для `ratio<=0` рендерим
 * нейтральную пустую ячейку (как в исходнике).
 *
 * Сам `BottleneckHeatmapWidget.tsx` не рефакторится в этой фазе —
 * это задача Фазы 3 ТЗ.
 */
export function MiniHeatCell({
  ratio,
  tone = 'danger',
  value,
  size = 32,
  className,
}: Props) {
  const safeRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const isEmpty = safeRatio <= 0;
  const { fg, bg } = toneVars(tone);

  const computedOpacity = isEmpty
    ? undefined
    : 0.6 + Math.max(0.12, safeRatio) * 0.4;

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-md text-xs font-medium tabular-nums transition-opacity',
        isEmpty ? 'bg-bg-overlay/40 text-fg-tertiary' : '',
        className,
      )}
      style={{
        width: size,
        height: size,
        ...(isEmpty
          ? {}
          : {
              backgroundColor: bg,
              color: fg,
              opacity: computedOpacity,
            }),
      }}
      aria-hidden="true"
    >
      {value !== undefined && value !== '' ? String(value) : ''}
    </div>
  );
}
