import type { Metadata } from "next";

import { RoleCloneHistoryClient } from "./RoleCloneHistoryClient";

export const metadata: Metadata = {
  title: "История клона должности",
};

export default async function RoleCloneHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleCloneHistoryClient roleId={id} />;
}
