import type { Metadata } from "next";

import { OrgDetailClient } from "./OrgDetailClient";

export const metadata: Metadata = { title: "Организация" };

export default async function AdminOrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrgDetailClient orgId={id} />;
}
