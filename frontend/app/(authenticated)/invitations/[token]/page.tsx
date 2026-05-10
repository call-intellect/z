import type { Metadata } from 'next';

import { AcceptInvitationClient } from './AcceptInvitationClient';

export const metadata: Metadata = {
  title: 'Приглашение в организацию — Z',
};

export default function AcceptInvitationPage({
  params,
}: {
  params: { token: string };
}) {
  return <AcceptInvitationClient token={params.token} />;
}
