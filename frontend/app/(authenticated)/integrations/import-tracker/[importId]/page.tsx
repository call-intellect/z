import type { Metadata } from "next";

import { ImportDetailClient } from "./ImportDetailClient";

export const metadata: Metadata = {
  title: "Импорт",
};

interface PageProps {
  params: Promise<{ importId: string }>;
}

export default async function ImportDetailPage({ params }: PageProps) {
  const { importId } = await params;
  return <ImportDetailClient importLogId={importId} />;
}
