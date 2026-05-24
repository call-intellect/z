'use client';

/**
 * Цветной бейдж статуса задачи. Цвет определяется по category статуса
 * (Phase 2 не грузит полную сущность IssueState из БД — используем category
 * как fallback). Когда появится state.label из API — текст можно будет
 * заменить на реальное название.
 */

import { Badge } from '@/ui/shadcn/badge';
import {
  ISSUE_STATE_CATEGORY_LABELS,
  type IssueStateCategory,
} from '@/domain/tracker';

const VARIANT_BY_CATEGORY: Record<
  IssueStateCategory,
  'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger'
> = {
  backlog: 'secondary',
  unstarted: 'outline',
  started: 'default',
  completed: 'success',
  cancelled: 'danger',
};

export function IssueStateBadge({
  category,
  label,
  className,
}: {
  category: IssueStateCategory;
  /** Если у нас есть человеко-читаемое имя статуса — показать его вместо category. */
  label?: string;
  className?: string;
}) {
  return (
    <Badge
      variant={VARIANT_BY_CATEGORY[category]}
      className={className}
    >
      {label ?? ISSUE_STATE_CATEGORY_LABELS[category]}
    </Badge>
  );
}
