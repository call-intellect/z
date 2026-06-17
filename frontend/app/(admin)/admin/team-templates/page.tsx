import type { Metadata } from "next";

import { TeamTemplatesClient } from "@app/(authenticated)/team-templates/TeamTemplatesClient";

export const metadata: Metadata = {
  title: "Шаблоны команд (админка)",
};

export default function AdminTeamTemplatesPage() {
  return <TeamTemplatesClient />;
}
