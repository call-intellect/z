import type { ReactNode } from "react";

export default function DesignPreviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-base text-fg-primary">{children}</div>
  );
}
