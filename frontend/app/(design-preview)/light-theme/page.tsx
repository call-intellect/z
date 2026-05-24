/**
 * Design-preview: светлая тема (sage).
 *
 * Принудительно навешивает data-theme="light" на оборачивающий div +
 * style colorScheme="light", чтобы рендериться независимо от настройки
 * пользователя. НЕ часть production-flow.
 */
import type { Metadata } from 'next';
import { DesignPreviewGallery } from '@/ui/components/design-preview/DesignPreviewGallery';

export const metadata: Metadata = {
  title: 'Z · Дизайн-эталон: светлая тема',
};

export default function LightThemePreviewPage() {
  return (
    <div
      data-theme="light"
      style={{ colorScheme: 'light' }}
      className="min-h-screen bg-bg-base text-fg-primary"
    >
      <DesignPreviewGallery themeLabel="Светлая (sage)" />
    </div>
  );
}
