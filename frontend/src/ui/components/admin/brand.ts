/**
 * Единый источник бренда админки (ТЗ 2026-06-11 cabinet-inbox-nav-ui-honesty, D6).
 * Раньше в логотипе / хлебных крошках / title вкладок светился старый «Z-Admin».
 * Один константный источник + узкий vitest-гард (`brand.guard.spec.ts`) не дают
 * новой странице снова притащить «Z-Admin».
 *
 * Внутреннее имя роли `super_admin` и комментарии с «Z-Admin» — это другое, их
 * НЕ трогаем (гард сканирует только видимые конструкты title/label/логотип).
 */
export const ADMIN_BRAND = 'Кора-Админ';

/** Корневая хлебная крошка админки. */
export const adminRootCrumb = (): { label: string; href: string } => ({
  label: ADMIN_BRAND,
  href: '/admin',
});
