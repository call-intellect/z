import type { Metadata } from "next";

import { RoleSkillProfileClient } from "./RoleSkillProfileClient";

export const metadata: Metadata = {
  title: "Навыковый профиль роли",
};

export default async function RoleSkillProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleSkillProfileClient roleId={id} />;
}
