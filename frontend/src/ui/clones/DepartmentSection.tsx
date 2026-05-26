'use client';

/**
 * DepartmentSection — сворачиваемая секция группировки карточек клонов
 * по департаменту (ТЗ §3.4).
 *
 * Заголовок — кнопка со стрелкой и бейджем количества. Контент — grid
 * адаптивный (1/2/3 кол.). При collapsed скрывается через `hidden`.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Badge } from '@/ui/shadcn/badge';

export interface DepartmentSectionProps {
  departmentName: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function DepartmentSection({
  departmentName,
  count,
  collapsed,
  onToggle,
  children,
}: DepartmentSectionProps): ReactElement {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-fg-primary hover:bg-bg-hover"
      >
        <Chevron size={16} className="text-fg-tertiary" aria-hidden="true" />
        <span className="flex-1">{departmentName}</span>
        <Badge variant="secondary" className="font-normal">
          {count}
        </Badge>
      </button>
      <div
        className={
          collapsed
            ? 'hidden'
            : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
        }
      >
        {children}
      </div>
    </section>
  );
}
