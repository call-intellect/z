import type { Metadata } from 'next';

import { RolesListClient } from './RolesListClient';

export const metadata: Metadata = {
  title: 'Карты должностей — Кора',
};

export default function RolesListPage() {
  return <RolesListClient />;
}
