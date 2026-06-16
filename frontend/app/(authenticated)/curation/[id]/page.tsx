import type { Metadata } from "next";

import { CurationDetailClient } from "./CurationDetailClient";

export const metadata: Metadata = {
  title: "Карточка курации",
};

export default async function CurationItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CurationDetailClient itemId={id} />;
}
