import type { Metadata } from 'next';

import { RolesListClient } from './RolesListClient';

export const metadata: Metadata = {
  title: 'Карты должностей — Z',
};

export default function RolesListPage() {
  return <RolesListClient />;
}
