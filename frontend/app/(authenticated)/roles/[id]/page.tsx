import type { Metadata } from 'next';

import { RoleDetailClient } from './RoleDetailClient';

export const metadata: Metadata = {
  title: 'Должность — Кора',
};

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleDetailClient roleId={id} />;
}
