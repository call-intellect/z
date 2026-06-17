import type { Metadata } from "next";

import { MyTicketDetailClient } from "./MyTicketDetailClient";

export const metadata: Metadata = {
  title: "Обращение",
};

export default async function MyTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <MyTicketDetailClient ticketId={id} />
    </main>
  );
}
