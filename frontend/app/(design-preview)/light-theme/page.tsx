import type { Metadata } from "next";
import { DesignPreviewGallery } from "@/ui/components/design-preview/DesignPreviewGallery";

export const metadata: Metadata = {
  title: "Дизайн-эталон: светлая тема",
};

export default function LightThemePreviewPage() {
  return (
    <div
      data-theme="light"
      style={{ colorScheme: "light" }}
      className="min-h-screen bg-bg-base text-fg-primary"
    >
      <DesignPreviewGallery themeLabel="Светлая (sage)" />
    </div>
  );
}
