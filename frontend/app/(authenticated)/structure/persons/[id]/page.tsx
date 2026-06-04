import type { Metadata } from 'next';

import { PersonCardClient } from './PersonCardClient';

export const metadata: Metadata = {
  title: 'Сотрудник — Кора',
};

export default function PersonCardPage({
  params,
}: {
  params: { id: string };
}) {
  return <PersonCardClient personId={params.id} />;
}
