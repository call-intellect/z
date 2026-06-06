import type { Metadata } from 'next';

import { PersonCardClient } from './PersonCardClient';

export const metadata: Metadata = {
  title: 'Сотрудник — Кора',
};

export default async function PersonCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonCardClient personId={id} />;
}
