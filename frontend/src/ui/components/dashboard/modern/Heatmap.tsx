'use client';

import type { ReactNode } from 'react';

import { CardTitle } from './CardTitle';
import { CHART, glass } from './tokens';

/**
 * Тепловая карта на стеклянной карточке: сетка `rows × cols`, прозрачность ячейки
 * пропорциональна интенсивности (0..1), пиковые ячейки (>0.85) подсвечиваются
 * свечением. Разметка из витрины.
 *
 * `hue` — базовая тройка oklch (`L C H`), которую раскрашивают ячейки;
 * по умолчанию мятная `'0.85 0.15 165'` (как в витрине).
 */
export function Heatmap({
  title,
  icon,
  grad,
  rows,
  cols,
  grid,
  hue = '0.85 0.15 165',
}: {
  title: string;
  icon: ReactNode;
  grad: string;
  rows: string[];
  cols: string[];
  grid: number[][];
  hue?: string;
}) {
  return (
    <div style={glass()} className="p-6">
      <CardTitle icon={icon} grad={grad}>
        {title}
      </CardTitle>
      <div className="mt-4 space-y-2">
        {grid.map((row, ri) => (
          <div key={rows[ri]} className="flex items-center gap-2">
            <span className="w-10 text-[11px]" style={{ color: CHART.faint }}>
              {rows[ri]}
            </span>
            <div className="flex flex-1 gap-2">
              {row.map((cell, ci) => (
                <div
                  key={cols[ci]}
                  className="aspect-square flex-1 rounded-lg"
                  style={{
                    background: `oklch(${hue} / ${0.12 + cell * 0.78})`,
                    boxShadow: cell > 0.85 ? `0 0 16px -2px oklch(${hue} / 0.7)` : 'none',
                  }}
                  title={`${rows[ri]} · ${cols[ci]}`}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-2 pl-12 pt-1">
          {cols.map((c) => (
            <span key={c} className="flex-1 text-center text-[11px]" style={{ color: CHART.faint }}>
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
