'use client';

/**
 * CloneAvatar — SVG-аватар клона должности (ТЗ 2026-05-26 §3.3).
 *
 * Дизайн-решения:
 *   - Никакого фото живого человека: «клон ролевой, а не персональный»
 *     (memory `project_clones_are_role_based`).
 *   - Инициал — первая буква роли (или две, если у роли два слова —
 *     «ГБ» для «Главный бухгалтер»).
 *   - Цвет фона — детерминированный hash от departmentId (если есть)
 *     или от roleName. 12-цветная палитра Tailwind-600.
 *   - Чистый SVG, без `<img>` и внешних ассетов — рендерится мгновенно.
 */

import type { ReactElement } from 'react';

import { cn } from '@/ui/shadcn/lib/utils';

/** 12 цветов палитры — оттенки Tailwind-600 для контраста с белым текстом. */
const PALETTE: readonly string[] = [
  '#dc2626', // red-600
  '#ea580c', // orange-600
  '#d97706', // amber-600
  '#65a30d', // lime-600
  '#16a34a', // green-600
  '#0d9488', // teal-600
  '#0891b2', // cyan-600
  '#2563eb', // blue-600
  '#4f46e5', // indigo-600
  '#7c3aed', // violet-600
  '#c026d3', // fuchsia-600
  '#db2777', // pink-600
] as const;

/**
 * Детерминированный djb2-style hash. Чистая функция — одинаковый ввод даёт
 * одинаковый индекс в палитре между рендерами и между сессиями.
 */
export function hashPaletteIndex(key: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33) ^ key.charCodeAt(i);
  }
  return Math.abs(h) % mod;
}

/**
 * Извлекает 1-2 буквы для аватара.
 *   - «Маркетолог» → «М»
 *   - «Главный бухгалтер» → «ГБ»
 *   - «2-й пилот» → «П»  (цифры/символы пропускаются)
 *   - пусто → «?»
 */
export function deriveInitials(roleName: string): string {
  const trimmed = (roleName ?? '').trim();
  if (trimmed.length === 0) return '?';

  // Разбиваем на «слова» по любым пробелам, отбрасываем не-буквенные токены.
  const words = trimmed
    .split(/\s+/)
    .map((w) => {
      // Берём первый буквенный символ (Юникод letter).
      const m = w.match(/\p{L}/u);
      return m ? m[0]!.toUpperCase() : '';
    })
    .filter((w) => w.length > 0);

  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!;
  return (words[0]! + words[1]!).slice(0, 2);
}

export interface CloneAvatarProps {
  roleName: string;
  departmentId?: string | null;
  /** Размер в px. Default 48. */
  size?: number;
  className?: string;
}

export function CloneAvatar({
  roleName,
  departmentId,
  size = 48,
  className,
}: CloneAvatarProps): ReactElement {
  const initials = deriveInitials(roleName);
  const hashKey =
    (departmentId && departmentId.trim().length > 0
      ? departmentId
      : roleName) || 'unknown';
  const colorIdx = hashPaletteIndex(hashKey, PALETTE.length);
  const bg = PALETTE[colorIdx]!;
  const fontSize = Math.round(size * 0.42);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Аватар клона: ${roleName}`}
      className={cn('shrink-0 rounded-full', className)}
    >
      <circle cx={size / 2} cy={size / 2} r={size / 2} fill={bg} />
      <text
        x="50%"
        y="50%"
        dy="0.07em"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#ffffff"
        fontSize={fontSize}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      >
        {initials}
      </text>
    </svg>
  );
}
