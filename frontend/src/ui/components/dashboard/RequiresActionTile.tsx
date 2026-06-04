'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';

import {
  requiresActionTone,
  type DirectorDashboardRequiresActionDomain,
} from '@/domain/director-dashboard';
import { PENDING_SOURCE_LABEL } from '@/domain/pending-action';

/**
 * RequiresActionTile (Action Center B2) — плитка «Требует вашего подтверждения»
 * на главном дашборде директора.
 *
 * Поведение по тону (парные цветовые токены — memory:
 * feedback_paired_color_tokens):
 *   - есть конфликты (`conflict>0`) → красный (chip-danger) — «горит красным»;
 *   - иначе при total>0 → янтарный/accent тон;
 *   - при total=0 → плитка НЕ показывается (никакого красного при нуле).
 *
 * Клик по плитке (и по CTA) ведёт на `/actions` (deep-link страница B1).
 * Разбивка по источникам — RU-лейблы из `domain/pending-action.ts`.
 */

type Props = {
  data: DirectorDashboardRequiresActionDomain | null;
  /** При loading=true и отсутствии данных плитку не рисуем (нечего показывать). */
  loading?: boolean;
};

/** Порядок источников в разбивке. conflict первым — он «горит». */
const SOURCE_ORDER = ['conflict', 'curation', 'intake', 'probe'] as const;

export function RequiresActionTile({ data, loading }: Props) {
  const router = useRouter();
  const tone = requiresActionTone(data);

  // total=0 (или нет данных) → не показываем. Во время загрузки тоже молчим —
  // это призыв к действию, а не скелетон.
  if (tone === 'none' || !data) {
    return null;
  }
  void loading;

  const isDanger = tone === 'danger';
  const total = data.total;
  const plural =
    total === 1 ? 'подтверждение' : total < 5 ? 'подтверждения' : 'подтверждений';

  const goToActions = () => router.push('/actions');

  return (
    <button
      type="button"
      onClick={goToActions}
      aria-label={`Требует вашего подтверждения: ${total}. Открыть центр действий.`}
      className={
        isDanger
          ? 'group block w-full overflow-hidden rounded-xl border-l-4 border-chip-danger-fg/60 bg-gradient-to-r from-chip-danger-bg/25 via-chip-warning-bg/10 to-transparent p-5 text-left shadow-card-soft transition-shadow hover:shadow-card-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chip-danger-fg'
          : 'group block w-full overflow-hidden rounded-xl border-l-4 border-chip-warning-fg/60 bg-gradient-to-r from-chip-warning-bg/25 to-transparent p-5 text-left shadow-card-soft transition-shadow hover:shadow-card-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chip-warning-fg'
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={
            isDanger
              ? 'inline-flex shrink-0 items-center justify-center rounded-full bg-chip-danger-bg/25 p-2 text-chip-danger-fg'
              : 'inline-flex shrink-0 items-center justify-center rounded-full bg-chip-warning-bg/25 p-2 text-chip-warning-fg'
          }
          aria-hidden="true"
        >
          {isDanger ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={
              isDanger
                ? 'text-sm font-semibold text-chip-danger-fg'
                : 'text-sm font-semibold text-chip-warning-fg'
            }
          >
            Требует вашего подтверждения: {total} {plural}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-secondary">
            {SOURCE_ORDER.map((src) => {
              const n = data.bySource[src];
              if (n <= 0) return null;
              return (
                <li key={src} className="flex items-center gap-1">
                  <span className="font-medium tabular-nums text-fg-primary">
                    {n}
                  </span>
                  <span>{PENDING_SOURCE_LABEL[src]}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <span
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-fg transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        >
          Открыть
          <ArrowRight size={14} />
        </span>
      </div>
    </button>
  );
}
