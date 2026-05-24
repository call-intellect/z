'use client';

import { Avatar, AvatarFallback } from '@/ui/shadcn/avatar';
import { cn } from '@/ui/shadcn/lib/utils';

function userInitials(userIdOrName: string): string {
  const trimmed = userIdOrName.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s.@_-]+/u).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Один компактный аватар исполнителя. Phase 2 — рендерит инициалы из userId
 * (имя пользователя подгрузим из `/api/v1/people` в Sprint 3+).
 */
export function AssigneeAvatar({
  userId,
  size = 24,
  className,
  label,
}: {
  userId: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const initials = userInitials(label ?? userId);
  return (
    <Avatar
      className={cn(className)}
      style={{ height: size, width: size }}
      title={label ?? userId}
    >
      <AvatarFallback
        className="text-[10px] font-medium uppercase"
        style={{ fontSize: size > 28 ? '11px' : '10px' }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Группа аватаров с overflow `+N`. Macro-style: до 3 первых, остаток в +N.
 */
export function AssigneeAvatarGroup({
  userIds,
  max = 3,
  size = 22,
  className,
}: {
  userIds: string[];
  max?: number;
  size?: number;
  className?: string;
}) {
  if (userIds.length === 0) {
    return (
      <span className="text-xs text-fg-tertiary" title="Без исполнителя">
        —
      </span>
    );
  }
  const head = userIds.slice(0, max);
  const overflow = userIds.length - head.length;
  return (
    <div
      className={cn('flex items-center', className)}
      style={{ marginLeft: 0 }}
    >
      {head.map((id, i) => (
        <div
          key={id}
          style={{
            marginLeft: i === 0 ? 0 : -6,
            zIndex: head.length - i,
          }}
          className="inline-block rounded-full ring-1 ring-bg-base"
        >
          <AssigneeAvatar userId={id} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <span
          className="ml-1 inline-flex items-center justify-center rounded-full bg-bg-overlay text-[10px] text-fg-secondary ring-1 ring-bg-base"
          style={{ height: size, minWidth: size, padding: '0 4px' }}
          title={`Ещё ${overflow}`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
