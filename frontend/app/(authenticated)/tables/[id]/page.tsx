import type { Metadata } from 'next';

import { TableClient } from './TableClient';

export const metadata: Metadata = {
  title: 'Таблица — Z',
};

export default function TablePage({
  params,
}: {
  params: { id: string };
}) {
  return <TableClient tableId={params.id} />;
}
