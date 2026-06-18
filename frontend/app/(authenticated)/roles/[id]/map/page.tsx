import type { Metadata } from "next";

import { RoleMapClient } from "./RoleMapClient";

export const metadata: Metadata = {
  title: "Карта должности",
};

export default async function RoleMapPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleMapClient roleId={id} />;
}
