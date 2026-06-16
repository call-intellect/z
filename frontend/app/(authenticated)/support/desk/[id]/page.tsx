import type { Metadata } from "next";

import { DeskTicketDetailClient } from "./DeskTicketDetailClient";

export const metadata: Metadata = {
  title: "Поддержка — тикет",
};

export default async function DeskTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <DeskTicketDetailClient ticketId={id} />
    </main>
  );
}
