import type { Metadata } from "next";
import { DesignPreviewGallery } from "@/ui/components/design-preview/DesignPreviewGallery";

export const metadata: Metadata = {
  title: "Дизайн-эталон: тёмная тема",
};

export default function DarkThemePreviewPage() {
  return (
    <div
      data-theme="dark"
      style={{ colorScheme: "dark" }}
      className="min-h-screen bg-bg-base text-fg-primary"
    >
      <DesignPreviewGallery themeLabel="Тёмная (warm-mint)" />
    </div>
  );
}
