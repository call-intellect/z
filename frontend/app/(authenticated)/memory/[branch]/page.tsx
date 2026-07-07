import type { Metadata } from "next";

import { BranchDetailClient } from "./BranchDetailClient";

export const metadata: Metadata = {
  title: "Область памяти",
};

export default async function BranchDetailPage({
  params,
}: {
  params: Promise<{ branch: string }>;
}) {
  const { branch } = await params;
  return <BranchDetailClient branch={branch} />;
}
