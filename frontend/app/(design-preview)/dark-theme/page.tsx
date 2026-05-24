/**
 * Design-preview: тёмная тема (warm-mint).
 *
 * Принудительно навешивает data-theme="dark" на оборачивающий div +
 * style colorScheme="dark", чтобы рендериться независимо от настройки
 * пользователя. НЕ часть production-flow.
 */
import type { Metadata } from 'next';
import { DesignPreviewGallery } from '@/ui/components/design-preview/DesignPreviewGallery';

export const metadata: Metadata = {
  title: 'Z · Дизайн-эталон: тёмная тема',
};

export default function DarkThemePreviewPage() {
  return (
    <div
      data-theme="dark"
      style={{ colorScheme: 'dark' }}
      className="min-h-screen bg-bg-base text-fg-primary"
    >
      <DesignPreviewGallery themeLabel="Тёмная (warm-mint)" />
    </div>
  );
}
