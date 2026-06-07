import type { Metadata } from 'next';

import { TeamsListClient } from './TeamsListClient';

export const metadata: Metadata = {
  title: 'Команды',
};

export default function TeamsListPage() {
  return <TeamsListClient />;
}
