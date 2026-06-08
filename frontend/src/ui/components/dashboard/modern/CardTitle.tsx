'use client';

import type { ReactNode } from 'react';

import { CHART } from './tokens';

/**
 * Заголовок карточки: квадратная градиентная иконка + текст заголовка.
 * Разметка 1-в-1 из витрины редизайна.
 */
export function CardTitle({
  icon,
  grad,
  children,
}: {
  icon: ReactNode;
  grad: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-8 w-8 place-items-center rounded-xl"
        style={{ background: grad, color: CHART.text }}
      >
        {icon}
      </span>
      <h3 className="text-[15px] font-semibold">{children}</h3>
    </div>
  );
}
