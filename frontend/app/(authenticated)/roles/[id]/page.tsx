import type { Metadata } from 'next';

import { RoleDetailClient } from './RoleDetailClient';

export const metadata: Metadata = {
  title: 'Должность — Z',
};

export default function RoleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <RoleDetailClient roleId={params.id} />;
}
