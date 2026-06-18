import type { Metadata } from "next";

import { AcceptInviteMagicClient } from "./AcceptInviteMagicClient";

export const metadata: Metadata = {
  title: "Приглашение в компанию",
};

export default async function AcceptInviteMagicPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AcceptInviteMagicClient magicToken={token} />;
}
