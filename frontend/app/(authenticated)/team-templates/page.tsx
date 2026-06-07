import type { Metadata } from 'next';

import { TeamTemplatesClient } from './TeamTemplatesClient';

export const metadata: Metadata = {
  title: 'Шаблоны команд',
};

export default function TeamTemplatesPage() {
  return <TeamTemplatesClient />;
}
