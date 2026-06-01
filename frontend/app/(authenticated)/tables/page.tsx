import type { Metadata } from 'next';

import { TablesListClient } from './TablesListClient';

export const metadata: Metadata = {
  title: 'Таблицы — Z',
};

export default function TablesIndexPage() {
  return <TablesListClient />;
}
