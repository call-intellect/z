import type { Metadata } from "next";

import { PersonContributionsClient } from "./PersonContributionsClient";

export const metadata: Metadata = {
  title: "Профиль сотрудника",
};

export default async function PersonContributionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonContributionsClient personId={id} />;
}
