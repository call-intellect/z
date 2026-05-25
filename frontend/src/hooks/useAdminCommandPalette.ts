'use client';

/**
 * Re-export хука для удобного импорта из страниц админки. Сам Provider и
 * собственно палитра живут в
 * `@/ui/components/admin/AdminCommandPalette.tsx` — там же определены типы
 * action и логика глобального шортката ⌘K / Ctrl+K.
 */
export {
  useAdminCommandPalette,
  AdminCommandPaletteProvider,
  type AdminPaletteAction,
} from '@/ui/components/admin/AdminCommandPalette';
