'use client';

import type { ReactNode } from 'react';

/**
 * Заголовок карточки: квадратная градиентная иконка + текст заголовка.
 * Разметка 1-в-1 из витрины редизайна.
 *
 * Иконка лежит на насыщенном градиенте (`grad`) в ОБЕИХ темах, поэтому её цвет —
 * постоянный почти-белый (НЕ `--text-primary`: иначе в светлой теме была бы
 * тёмная иконка на ярком фоне — низкий контраст). Текст заголовка наследует
 * `--text-primary` (адаптируется к теме).
 */
const ICON_ON_GRADIENT = 'oklch(0.99 0.005 280)';
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
        style={{ background: grad, color: ICON_ON_GRADIENT }}
      >
        {icon}
      </span>
      <h3 className="text-[15px] font-semibold">{children}</h3>
    </div>
  );
}
