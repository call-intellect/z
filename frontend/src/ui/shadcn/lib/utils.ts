import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Конкатенирует условные классы и резолвит конфликты tailwind-merge'ом. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
