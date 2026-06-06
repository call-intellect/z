import type { Metadata } from 'next';

import { TablesListClient } from './TablesListClient';

export const metadata: Metadata = {
  title: 'Таблицы — Кора',
};

export default function TablesIndexPage() {
  return <TablesListClient />;
}
