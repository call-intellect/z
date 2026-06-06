import type { Metadata } from 'next';

import { AcceptInvitationClient } from './AcceptInvitationClient';

export const metadata: Metadata = {
  title: 'Приглашение в организацию — Кора',
};

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AcceptInvitationClient token={token} />;
}
