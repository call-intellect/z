import type { Metadata } from "next";

import { PersonSocialContributionClient } from "./PersonSocialContributionClient";

export const metadata: Metadata = {
  title: "Вклад в команду",
};

export default async function PersonSocialContributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonSocialContributionClient personId={id} />;
}
