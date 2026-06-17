import { redirect } from "next/navigation";

import { ExchangeAndRender } from "./ExchangeAndRender";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[]; inv?: string | string[] }>;
};

export default async function MeetingPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!id || id.length < 5) {
    redirect("/");
  }
  const sp = await searchParams;
  const tokenParam = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const inviteParam = Array.isArray(sp.inv) ? sp.inv[0] : sp.inv;

  return (
    <ExchangeAndRender
      meetingId={id}
      deepLinkToken={tokenParam ?? null}
      inviteToken={inviteParam ?? null}
    />
  );
}
