'use client';

import { CHART } from './tokens';

/**
 * Кастомный тултип для recharts-графиков. Стекло + размытие, подпись + строки
 * «имя: значение». Сигнатура `any` совместима с recharts `Tooltip content` и
 * изолирована в этом файле (lint проекта не запрещает any).
 */
export function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '8px 12px',
        boxShadow: 'var(--shadow-card-raised)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {label != null && (
        <div className="mb-1 text-xs" style={{ color: CHART.faint }}>
          {label}
        </div>
      )}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="text-sm" style={{ color: CHART.text }}>
          {p.name ?? p.dataKey}: <b>{p.value}</b>
        </div>
      ))}
    </div>
  );
}
