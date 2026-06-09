import type { Metadata } from 'next';

import { TableClient } from './TableClient';

export const metadata: Metadata = {
  title: 'Таблица',
};

export default async function TablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TableClient tableId={id} />;
}
