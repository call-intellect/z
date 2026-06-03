'use client';

import Link from 'next/link';

import {
  GOAL_PROGRESS_STATUS_LABELS,
  krProgressBarColor,
  progressStatusChipClasses,
  type GoalTreeRenderNode,
} from '@/domain/goal';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Дерево целей (Goals OKR v2, Фаза 4 — frontend).
 *
 * Рекурсивный рендер иерархии целей. Используется в двух местах:
 *   - дашборд директора (узлы из `goalsTree`, с `keyResults`),
 *   - страница `/goals` (узлы собраны из плоского списка через `buildTree`,
 *     без `keyResults` — на уровне цели).
 *
 * Узел: чип статуса движения (парные токены chip-*), имя-ссылка на
 * `/goals/[id]`, опц. per-KR прогресс-бары (semantic-токены, см.
 * `krProgressBarColor` Фазы 1), вложенные дети с отступом. Без сворачивания —
 * только отступ (правило простоты ТЗ §5 Фаза 4).
 */
export function GoalsTreeView({
  nodes,
}: {
  nodes: readonly GoalTreeRenderNode[];
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {nodes.map((node) => (
        <GoalTreeNodeRow key={node.id} node={node} depth={0} />
      ))}
    </ul>
  );
}

function GoalTreeNodeRow({
  node,
  depth,
}: {
  node: GoalTreeRenderNode;
  depth: number;
}) {
  const chip = progressStatusChipClasses(node.progressStatus);
  const krs = node.keyResults ?? [];

  return (
    <li>
      <div
        className="flex flex-col gap-2 rounded-lg border border-border-subtle/60 bg-bg-card p-3"
        // Отступ вложенности — динамическое значение, поэтому inline-стиль
        // (правило «не использовать inline styles для layout» допускает
        // динамические значения).
        style={depth > 0 ? { marginInlineStart: depth * 16 } : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/goals/${encodeURIComponent(node.id)}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary transition-colors hover:text-accent-fg hover:underline"
          >
            {node.name}
          </Link>
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              chip.bg,
              chip.fg,
            )}
          >
            {GOAL_PROGRESS_STATUS_LABELS[node.progressStatus]}
          </span>
        </div>

        {krs.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {krs.map((kr) => {
              const pct = Math.max(0, Math.min(100, kr.progressPercent));
              return (
                <li key={kr.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-fg-secondary">
                      {kr.name}
                      {kr.unit ? `, ${kr.unit}` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums text-fg-tertiary">
                      {Math.round(pct)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-overlay">
                    <div
                      className={cn('h-full rounded-full', krProgressBarColor(pct))}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {node.children.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {node.children.map((child) => (
            <GoalTreeNodeRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
